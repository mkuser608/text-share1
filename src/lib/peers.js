import { Emitter } from './util'

// ICE servers: STUN finds your public address; TURN relays media when a direct
// path is impossible (symmetric/corporate NAT, mobile networks). Without TURN,
// calls between people on different networks frequently fail to connect.
//
// Override in production with your own TURN (recommended) via either:
//   window.ICE_SERVERS = [ ... ]              (set before the app loads)
//   VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL  (build-time env)
function resolveIceServers() {
  if (typeof window !== 'undefined' && Array.isArray(window.ICE_SERVERS) && window.ICE_SERVERS.length)
    return window.ICE_SERVERS

  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}
  const servers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ]
  if (env.VITE_TURN_URL) {
    servers.push({ urls: env.VITE_TURN_URL, username: env.VITE_TURN_USERNAME, credential: env.VITE_TURN_CREDENTIAL })
  } else {
    // Free public TURN fallback (Open Relay by Metered). Fine for testing;
    // replace with your own for reliability & privacy in production.
    servers.push(
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    )
  }
  return servers
}

const RTC_CONFIG = { iceServers: resolveIceServers(), iceCandidatePoolSize: 2 }

/**
 * Mesh WebRTC manager. One RTCPeerConnection per remote peer with a
 * negotiated "ctl" DataChannel (files + remote control + stream metadata),
 * using the "perfect negotiation" pattern for glare-free renegotiation.
 *
 * Events:
 *  'dc-open' (peerId)
 *  'ctl-json' (peerId, obj)   'ctl-bin' (peerId, ArrayBuffer)
 *  'remote-changed' ()        — remote stream set or connection state changed
 *  'peer-removed' (peerId)
 */
export class PeerManager extends Emitter {
  constructor(conn) {
    super()
    this.conn = conn
    this.peers = new Map()         // id -> peer state
    this.localStreams = new Map()  // stream -> kind ('media' | 'screen')
    this.remote = new Map()        // peerId -> Map<streamId, { stream, kind }>
    this.pending = new Map()       // peerId -> [signal,...] buffered before addPeer
    conn.on('signal', (m) => this._onSignal(m.from, m.d))
  }

  getName(id) { return this.peers.get(id)?.name || 'Peer' }
  getState(id) { return this.peers.get(id)?.pc?.connectionState || 'new' }

  addPeer(id, name) {
    if (this.peers.has(id)) return
    const polite = String(this.conn.selfId) > String(id)
    const pc = new RTCPeerConnection(RTC_CONFIG)
    const state = { pc, dc: null, name, polite, makingOffer: false, ignoreOffer: false, candQueue: [] }
    this.peers.set(id, state)

    const dc = pc.createDataChannel('ctl', { negotiated: true, id: 0 })
    dc.binaryType = 'arraybuffer'
    dc.bufferedAmountLowThreshold = 1024 * 1024
    dc.onopen = () => {
      // announce our current streams so the peer can label them (screen vs cam)
      for (const [stream, kind] of this.localStreams)
        this._dcSend(dc, { t: 'stream-meta', sid: stream.id, kind })
      this.emit('dc-open', id)
    }
    dc.onmessage = (e) => {
      if (typeof e.data === 'string') {
        let m; try { m = JSON.parse(e.data) } catch { return }
        if (m.t === 'stream-meta') return this._setRemoteKind(id, m.sid, m.kind)
        this.emit('ctl-json', id, m)
      } else {
        this.emit('ctl-bin', id, e.data)
      }
    }
    state.dc = dc

    pc.onicecandidate = (e) => { if (e.candidate) this._signal(id, { candidate: e.candidate }) }
    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer = true
        await pc.setLocalDescription()
        this._signal(id, { description: pc.localDescription })
      } catch (e) { console.error('negotiation error', e) } finally { state.makingOffer = false }
    }
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') { try { pc.restartIce() } catch { /* noop */ } }
      this.emit('remote-changed')
    }
    pc.onconnectionstatechange = () => this.emit('remote-changed')

    pc.ontrack = (e) => {
      const stream = e.streams[0]
      if (!stream) return
      let map = this.remote.get(id)
      if (!map) { map = new Map(); this.remote.set(id, map) }
      const existing = map.get(stream.id)
      if (existing) existing.stream = stream            // keep any kind we already learned
      else map.set(stream.id, { stream, kind: 'media' })
      const onchange = () => {
        const m = this.remote.get(id)
        if (m && stream.getTracks().every(t => t.readyState === 'ended')) m.delete(stream.id)
        this.emit('remote-changed')
      }
      stream.onremovetrack = onchange
      e.track.onended = onchange
      e.track.onmute = () => this.emit('remote-changed')
      e.track.onunmute = () => this.emit('remote-changed')
      this.emit('remote-changed')
    }

    // share any active local tracks with the new peer (triggers negotiation)
    for (const [stream] of this.localStreams)
      for (const track of stream.getTracks()) pc.addTrack(track, stream)

    // drain any signals that arrived before this peer existed
    const buf = this.pending.get(id)
    if (buf) { this.pending.delete(id); buf.forEach(d => this._onSignal(id, d)) }
  }

  removePeer(id) {
    const p = this.peers.get(id)
    if (!p) return
    try { p.pc.close() } catch { /* noop */ }
    this.peers.delete(id)
    this.remote.delete(id)
    this.pending.delete(id)
    this.emit('peer-removed', id)
    this.emit('remote-changed')
  }

  destroy() {
    for (const id of [...this.peers.keys()]) this.removePeer(id)
    for (const [stream] of this.localStreams) stream.getTracks().forEach(t => t.stop())
    this.localStreams.clear()
  }

  _setRemoteKind(peerId, sid, kind) {
    let map = this.remote.get(peerId)
    if (!map) { map = new Map(); this.remote.set(peerId, map) }
    const entry = map.get(sid)
    if (entry) entry.kind = kind
    else map.set(sid, { stream: null, kind }) // meta may arrive before the track
    this.emit('remote-changed')
  }

  _signal(to, d) { this.conn.send({ type: 'signal', to, d }) }

  async _onSignal(from, d) {
    const p = this.peers.get(from)
    if (!p) { // peer not set up yet — buffer in order and replay from addPeer()
      const q = this.pending.get(from) || []
      q.push(d); this.pending.set(from, q)
      return
    }
    const { pc } = p
    try {
      if (d.description) {
        const offerCollision = d.description.type === 'offer' &&
          (p.makingOffer || pc.signalingState !== 'stable')
        p.ignoreOffer = !p.polite && offerCollision
        if (p.ignoreOffer) return
        await pc.setRemoteDescription(d.description)
        // remote description is set — flush any queued ICE candidates
        for (const c of p.candQueue) { try { await pc.addIceCandidate(c) } catch { /* noop */ } }
        p.candQueue = []
        if (d.description.type === 'offer') {
          await pc.setLocalDescription()
          this._signal(from, { description: pc.localDescription })
        }
      } else if (d.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          try { await pc.addIceCandidate(d.candidate) } catch (e) { if (!p.ignoreOffer) throw e }
        } else {
          p.candQueue.push(d.candidate) // arrived before the offer/answer
        }
      }
    } catch (e) { console.error('signal error', e) }
  }

  // ---------- local media ----------
  addLocalStream(stream, kind) {
    this.localStreams.set(stream, kind)
    this.broadcastCtl({ t: 'stream-meta', sid: stream.id, kind })
    for (const [, p] of this.peers)
      for (const track of stream.getTracks()) p.pc.addTrack(track, stream)
  }

  /** add a single track to an already-shared stream */
  addLocalTrack(stream, track) {
    for (const [, p] of this.peers) p.pc.addTrack(track, stream)
  }

  removeLocalTrack(track) {
    for (const [, p] of this.peers) {
      const sender = p.pc.getSenders().find(s => s.track === track)
      if (sender) { try { p.pc.removeTrack(sender) } catch { /* noop */ } }
    }
  }

  removeLocalStream(stream) {
    for (const track of stream.getTracks()) { this.removeLocalTrack(track); track.stop() }
    this.localStreams.delete(stream)
  }

  // ---------- ctl channel ----------
  _dcSend(dc, data) {
    if (dc?.readyState !== 'open') return false
    dc.send(typeof data === 'string' || data instanceof ArrayBuffer ? data : JSON.stringify(data))
    return true
  }
  sendCtl(peerId, data) { return this._dcSend(this.peers.get(peerId)?.dc, data) }
  broadcastCtl(data) { for (const [, p] of this.peers) this._dcSend(p.dc, data) }
  getDc(peerId) { return this.peers.get(peerId)?.dc }
}
