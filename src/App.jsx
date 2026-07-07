import React, { useEffect, useState } from 'react'
import Landing from './components/Landing'
import Room from './components/Room'

function fmtId(s) { return String(s || '').replace(/\D/g, '').replace(/(\d{3})(?=\d)/g, '$1 ').trim() }

// Shown when the desktop app opens the site to reveal THIS machine's credentials.
function Device({ raw }) {
  const [creds, setCreds] = useState(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    try { setCreds(JSON.parse(atob(decodeURIComponent(raw)))) } catch { setCreds(false) }
    // remove the credentials from the URL bar
    try { history.replaceState(null, '', location.pathname) } catch { /* noop */ }
  }, [])

  if (creds === null) return null
  if (creds === false) return (
    <div className="min-h-full grid place-items-center px-5 text-center bg-[radial-gradient(ellipse_at_top,#1e293b_0%,#0b0f19_60%)]">
      <div className="text-slate-400">This link is invalid or expired.</div>
    </div>
  )

  const id = fmtId(creds.id)
  const copy = () => { try { navigator.clipboard.writeText(`ShareHub — ID: ${id}  Password: ${creds.pw}`) } catch {} setCopied(true); setTimeout(() => setCopied(false), 1500) }

  return (
    <div className="min-h-full flex items-center justify-center px-5 bg-[radial-gradient(ellipse_at_top,#1e293b_0%,#0b0f19_60%)]">
      <div className="w-full max-w-md">
        <a href="/" className="block text-center text-2xl font-extrabold bg-gradient-to-r from-sky-400 to-fuchsia-400 bg-clip-text text-transparent mb-6">⚡ ShareHub</a>
        <div className="rounded-2xl bg-slate-800/60 border border-slate-700 p-6 text-center">
          <div className="text-4xl mb-1">🖥️</div>
          <h1 className="font-bold text-lg">This computer is online</h1>
          <p className="text-sm text-slate-400 mt-1">Share these with anyone who should control this PC. They enter them at <b>Connect to a computer</b> on ShareHub.</p>

          <div className="mt-5 rounded-xl bg-slate-900/70 border border-dashed border-slate-600 p-4">
            <div className="text-xs text-slate-500">Machine ID</div>
            <div className="text-2xl font-extrabold tracking-widest select-all">{id}</div>
            <div className="text-xs text-slate-500 mt-3">Password</div>
            <div className="text-lg font-bold select-all">{creds.pw}</div>
          </div>

          <div className="flex gap-2 mt-4">
            <button onClick={copy} className="flex-1 rounded-lg bg-slate-700 hover:bg-slate-600 py-2.5 text-sm font-semibold">{copied ? '✓ Copied' : 'Copy ID + password'}</button>
            <a href={'/' + encodeURIComponent(String(creds.id).replace(/\D/g, ''))}
              onClick={() => sessionStorage.setItem('sh-remote', JSON.stringify({ password: creds.pw, name: 'Owner' }))}
              className="flex-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-white py-2.5 text-sm font-semibold grid place-items-center">Connect now</a>
          </div>
          <p className="text-[11px] text-slate-600 mt-4">Keep these private — anyone with them can control this computer while it's online.</p>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const hash = typeof location !== 'undefined' ? (location.hash || '') : ''
  if (hash.startsWith('#device=')) return <Device raw={hash.slice('#device='.length)} />

  const key = decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, ''))
  if (!key) return <Landing />
  return <Room roomKey={key} />
}
