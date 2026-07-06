export function u8ToB64(u8) {
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH))
  return btoa(s)
}

export function b64ToU8(b64) {
  const s = atob(b64)
  const u8 = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i)
  return u8
}

export function prettySize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

const PALETTE = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#38bdf8', '#818cf8', '#c084fc', '#f472b6']
export function colorFor(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}

export function randomKey() {
  const words = ['swift', 'lunar', 'ember', 'nova', 'pixel', 'cobalt', 'delta', 'orbit', 'quartz', 'zephyr']
  const w = words[Math.floor(Math.random() * words.length)]
  return `${w}-${Math.random().toString(36).slice(2, 7)}`
}

export class Emitter {
  constructor() { this._l = new Map() }
  on(ev, fn) {
    if (!this._l.has(ev)) this._l.set(ev, new Set())
    this._l.get(ev).add(fn)
    return () => this._l.get(ev)?.delete(fn)
  }
  emit(ev, ...args) { this._l.get(ev)?.forEach(fn => { try { fn(...args) } catch (e) { console.error(e) } }) }
}
