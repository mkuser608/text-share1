// Helpers for the AnyDesk-style flow: launch the ShareHub Desktop app via a
// custom URL scheme, and fall back to a download if it isn't installed.

export function detectOS() {
  const ua = navigator.userAgent || ''
  const p = navigator.platform || ''
  if (/Win/i.test(p) || /Windows/i.test(ua)) return 'windows'
  if (/Mac/i.test(p) || /Macintosh|Mac OS X/i.test(ua)) return 'mac'
  return 'other'
}

const enc = encodeURIComponent

/** Build the deep link the desktop app understands. */
export function buildDeepLink({ server, room, password, token, name }) {
  return `sharehub://join?s=${enc(server)}&r=${enc(room)}&p=${enc(password)}&t=${token}&n=${enc(name || 'This PC')}`
}

/** Try to launch the installed desktop app. Silent no-op if not installed. */
export function launchDesktop(link) {
  try {
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = link
    document.body.appendChild(iframe)
    setTimeout(() => iframe.remove(), 2000)
  } catch {
    try { window.location.href = link } catch { /* noop */ }
  }
}

export function downloadUrls() {
  const base = location.origin
  return { windows: base + '/download/windows', mac: base + '/download/mac', page: base + '/download' }
}

export function randomToken() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
}
