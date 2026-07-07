import { Emitter } from './util'

const CHUNK = 64 * 1024
const HIGH_WATER = 8 * 1024 * 1024

/**
 * P2P file transfer over the ctl DataChannel.
 * The server only ever sees metadata; bytes go peer-to-peer.
 *
 * Protocol (per peer, ordered/reliable channel):
 *   -> { t:'file-request', id }
 *   <- { t:'file-start', id, name, size, mime }
 *   <- ArrayBuffer chunks ...
 *   <- { t:'file-done', id }
 *
 * Events: 'progress' ({ id, dir:'up'|'down', peerId, received, size, done, error })
 */
export class FileShare extends Emitter {
  constructor(pm, conn) {
    super()
    this.pm = pm
    this.conn = conn
    this.outgoing = new Map()   // fileId -> File
    this.sendChain = new Map()  // peerId -> Promise (serialize sends per peer)
    this.incoming = new Map()   // peerId -> { id, name, size, mime, chunks, received }
    pm.on('ctl-json', (pid, m) => this._onCtl(pid, m))
    pm.on('ctl-bin', (pid, buf) => this._onChunk(pid, buf))
    pm.on('peer-removed', (pid) => {
      const st = this.incoming.get(pid)
      if (st) {
        this.incoming.delete(pid)
        this.emit('progress', { id: st.id, dir: 'down', peerId: pid, received: st.received, size: st.size, error: 'Peer disconnected' })
      }
    })
  }

  /** share a local file: registers it and broadcasts metadata via server */
  offer(file) {
    const id = crypto.randomUUID()
    this.outgoing.set(id, file)
    this.conn.send({ type: 'file-offer', id, name: file.name, size: file.size, mime: file.type })
    return id
  }

  /** Upload a file to the server so it persists and downloads without WebRTC. */
  async offerPersisted(file, roomKey, onProgress) {
    const id = crypto.randomUUID()
    const backend = (import.meta.env && import.meta.env.VITE_BACKEND_URL) || ''
    const base = backend ? backend.replace(/\/+$/, '') : ''
    const putUrl = `${base}/files/${encodeURIComponent(roomKey)}/${id}`
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', putUrl)
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
      xhr.upload.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress(e.loaded, e.total) }
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error('upload failed (' + xhr.status + ')'))
      xhr.onerror = () => reject(new Error('upload failed'))
      xhr.send(file)
    })
    const dl = base + `/files/${encodeURIComponent(roomKey)}/${id}?name=` + encodeURIComponent(file.name)
    this.conn.send({ type: 'file-offer', id, name: file.name, size: file.size, mime: file.type, persisted: true, url: dl })
    return id
  }

  revoke(id) {
    this.outgoing.delete(id)
    this.conn.send({ type: 'file-revoke', id })
  }

  /** request download of a peer's file */
  download(meta) {
    if (meta.owner === this.conn.selfId) return
    if (this.incoming.has(meta.owner)) return // one transfer per peer at a time
    this.incoming.set(meta.owner, { id: meta.id, name: meta.name, size: meta.size, mime: meta.mime, chunks: [], received: 0 })
    this.emit('progress', { id: meta.id, dir: 'down', peerId: meta.owner, received: 0, size: meta.size })
    if (!this.pm.sendCtl(meta.owner, { t: 'file-request', id: meta.id })) {
      this.incoming.delete(meta.owner)
      this.emit('progress', { id: meta.id, dir: 'down', peerId: meta.owner, received: 0, size: meta.size, error: 'No direct connection to peer yet — try again in a moment' })
    }
  }

  _onCtl(pid, m) {
    if (m.t === 'file-request') {
      const prev = this.sendChain.get(pid) || Promise.resolve()
      this.sendChain.set(pid, prev.then(() => this._sendFile(pid, m.id)).catch(console.error))
    } else if (m.t === 'file-start') {
      const st = this.incoming.get(pid)
      if (st && st.id === m.id) Object.assign(st, { size: m.size, name: m.name, mime: m.mime })
    } else if (m.t === 'file-done') {
      this._finalize(pid)
    } else if (m.t === 'file-error') {
      const st = this.incoming.get(pid)
      if (st) {
        this.incoming.delete(pid)
        this.emit('progress', { id: st.id, dir: 'down', peerId: pid, received: st.received, size: st.size, error: m.message || 'Transfer failed' })
      }
    }
  }

  async _sendFile(pid, id) {
    const file = this.outgoing.get(id)
    const dc = this.pm.getDc(pid)
    if (!dc || dc.readyState !== 'open') return
    if (!file) return this.pm.sendCtl(pid, { t: 'file-error', id, message: 'File no longer shared' })

    this.pm.sendCtl(pid, { t: 'file-start', id, name: file.name, size: file.size, mime: file.type })
    let offset = 0
    try {
      while (offset < file.size) {
        if (dc.readyState !== 'open') throw new Error('channel closed')
        if (dc.bufferedAmount > HIGH_WATER) {
          await new Promise((res) => {
            const h = () => { dc.removeEventListener('bufferedamountlow', h); res() }
            dc.addEventListener('bufferedamountlow', h)
          })
        }
        const buf = await file.slice(offset, offset + CHUNK).arrayBuffer()
        dc.send(buf)
        offset += buf.byteLength
        this.emit('progress', { id, dir: 'up', peerId: pid, received: offset, size: file.size, done: offset >= file.size })
      }
      this.pm.sendCtl(pid, { t: 'file-done', id })
    } catch (e) {
      this.emit('progress', { id, dir: 'up', peerId: pid, received: offset, size: file.size, error: e.message })
    }
  }

  _onChunk(pid, buf) {
    const st = this.incoming.get(pid)
    if (!st) return
    st.chunks.push(buf)
    st.received += buf.byteLength
    this.emit('progress', { id: st.id, dir: 'down', peerId: pid, received: st.received, size: st.size })
  }

  _finalize(pid) {
    const st = this.incoming.get(pid)
    if (!st) return
    this.incoming.delete(pid)
    const blob = new Blob(st.chunks, { type: st.mime || 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = st.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
    this.emit('progress', { id: st.id, dir: 'down', peerId: pid, received: st.received, size: st.size, done: true })
  }
}
