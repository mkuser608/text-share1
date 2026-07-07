// WebSocket room connection with auto-reconnect + tiny event emitter
export class RoomConnection {
  constructor(key) {
    this.key = key
    this.creds = null // { mode:'create'|'join', password, name }
    this.selfId = null
    this.listeners = new Map()
    this.ws = null
    this.closed = false
    this.retry = 0
    this._connect()
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(fn)
    return () => this.listeners.get(type)?.delete(fn)
  }
  emit(type, data) { this.listeners.get(type)?.forEach(fn => fn(data)) }

  _connect() {
    const base = (import.meta.env && import.meta.env.VITE_BACKEND_URL) || ''
    const url = base
      ? base.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws'
      : (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws'
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.emit('ws-open')
      this.send({ type: 'hello', key: this.key })
      // auto re-auth after reconnect
      if (this.creds) this.send({ type: 'join', password: this.creds.password, name: this.creds.name })
    }
    ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data) } catch { return }
      if (msg.type === 'joined') this.selfId = msg.selfId
      this.emit(msg.type, msg)
    }
    ws.onclose = () => {
      if (this.closed) return
      this.emit('ws-close')
      const delay = Math.min(1000 * 2 ** this.retry++, 10000)
      setTimeout(() => !this.closed && this._connect(), delay)
    }
    ws.onerror = () => ws.close()
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj))
  }

  auth(mode, password, name) {
    this.creds = { mode, password, name }
    this.send(mode === 'create'
      ? { type: 'create', password, name }
      : { type: 'join', password, name })
    // subsequent reconnects always join
    this.creds.mode = 'join'
  }

  destroy() {
    this.closed = true
    this.ws?.close()
    this.listeners.clear()
  }
}

export const b64ToU8 = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0))
export const u8ToB64 = (u8) => {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
  return btoa(s)
}
