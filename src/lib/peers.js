import { Emitter } from './util'

const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
    // Add a TURN server here for strict-NAT networks:
    // { urls: 'turn:your.turn.server:3478', username: '...', credential: '...' }
  ]
}

/**
 * Mesh WebRTC manager. One RTCPeerConnection per remote peer with a
 * negotiated "ctl" DataChannel (files + remote control + stream metadata),
 * using the "perfect negotiation" pattern for glare-free renegotiation.
 *
 * Events:
 *  'dc-open' (peerId)
 *  'ctl-json' (peerId, obj)   'ctl-bin' (peerId, ArrayBuffer)
 *  'remote-changed' ()        — remote stream set changed
 *  'peer-removed' (peerId)
 */
export class PeerManager extends Emitter {
  constructor(conn) {
    super()
    this.conn = conn
    this.peers = new Map()        // id -> { pc, dc, name, polite, makingOffer, ignoreOffer }
    this.localStreams = new Map() // stream -> kind ('media' | 'screen')
    this.remote = new Map()       // peerId -> Map<streamId, { stream, kind }>
    conn.on('signal', (m) => this._onSignal(m.from, m.d))
  }

  getName(id) { return this.peers.get(id)?.name || 'Peer' }

  addPeer(id, name) {
    if (this.peers.has(id)) return
    const polite = this.conn.selfId > id
    const pc = new RTCPeerConnection(RTC_CONFIG)
    const state = { pc, dc: null, name, polite, makingOffer: false, ignoreOffer: false }
    this.peers.set(id, state)

    const dc = pc.createDataChannel('ctl', { negotiated: true, id: 0 })
    dc.binaryType = 'arraybuffer'
    dc.bufferedAmountLowThreshold = 1024 * 1024
    dc.onopen = () => {
      // announce our current streams so the peer can label them
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
      } catch (e) { console.error(e) } finally { state.makingOffer = false }
    }
    pc.ontrack = (e) => {
      const stream = e.streams[0]
      if (!stream) return
      let map = this.remote.get(id)
      if (!map) { map = new Map(); this.remote.set(id, map) }
      if (!map.has(stream.id)) map.set(stream.id, { stream, kind: 'media' })
      const drop = () => {
        if (stream.getTracks().filter(t => t.readyState === 'live').length === 0) {
          map.delete(stream.id)
          this.emit('remote-changed')
        } else this.emit('remote-changed')
      }
      stream.onremovetrack = drop
      e.track.onended = drop
      e.track.onmute = () => this.emit('remote-changed')
      e.track.onunmute = () => this.emit('remote-changed')
      this.emit('remote-changed')
    }
    pc.onconnectionstatechange = () => this.emit('remote-changed')

    // share any active local tracks with the new peer
    for (const [stream] of this.localStreams)
      for (const track of stream.getTracks()) pc.addTrack(track, stream)
  }

  removePeer(id) {
    const p = this.peers.get(id)
    if (!p) return
    try { p.pc.close() } catch { /* noop */ }
    this.peers.delete(id)
    this.remote.delete(id)
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
    let p = this.peers.get(from)
    if (!p) return
    const { pc } = p
    try {
      if (d.description) {
        const offerCollision = d.description.type === 'offer' &&
          (p.makingOffer || pc.signalingState !== 'stable')
        p.ignoreOffer = !p.polite && offerCollision
        if (p.ignoreOffer) return
        await pc.setRemoteDescription(d.description)
        if (d.description.type === 'offer') {
          await pc.setLocalDescription()
          this._signal(from, { description: pc.localDescription })
        }
      } else if (d.candidate) {
        try { await pc.addIceCandidate(d.candidate) }
        catch (e) { if (!p.ignoreOffer) throw e }
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
