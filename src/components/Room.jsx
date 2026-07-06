import React, { useEffect, useRef, useState } from 'react'
import { RoomConnection } from '../lib/connection'
import RoomShell from './RoomShell'

// A "connect to a remote computer" intent set by the Landing page.
function readRemoteIntent() {
  try {
    const raw = sessionStorage.getItem('sh-remote')
    if (!raw) return null
    sessionStorage.removeItem('sh-remote')
    return JSON.parse(raw)
  } catch { return null }
}

export default function Room({ roomKey }) {
  const connRef = useRef(null)
  if (!connRef.current) connRef.current = new RoomConnection(roomKey)
  const conn = connRef.current
  const remote = useRef(readRemoteIntent()) // { password, name } | null

  const [phase, setPhase] = useState('connecting') // connecting | setup | login | in | offline
  const [joined, setJoined] = useState(null)
  const [error, setError] = useState('')
  const [wsDown, setWsDown] = useState(false)

  useEffect(() => {
    const offs = [
      conn.on('room-status', (m) => {
        if (conn.creds) return
        if (remote.current) {
          // connecting to a remote PC: join only; if it doesn't exist, it's offline
          if (m.exists) conn.auth('join', remote.current.password, remote.current.name || 'Guest')
          else setPhase('offline')
        } else {
          setPhase(m.exists ? 'login' : 'setup')
        }
      }),
      conn.on('joined', (m) => { setJoined(m); setPhase('in'); setError(''); setWsDown(false) }),
      conn.on('error', (m) => {
        if (m.code === 'gone') {
          if (remote.current) setPhase('offline')
          else if (conn.creds) conn.send({ type: 'create', password: conn.creds.password, name: conn.creds.name })
        } else if (m.code === 'badpass' && remote.current) {
          setError('Wrong password for this Remote ID'); setPhase('login')
        } else if (m.code === 'exists') {
          setPhase('login'); setError('Room already exists — enter its password')
        } else setError(m.message || 'Something went wrong')
      }),
      conn.on('ws-close', () => setWsDown(true)),
      conn.on('ws-open', () => setWsDown(false)),
    ]
    return () => { offs.forEach(o => o()); conn.destroy() }
  }, [])

  if (phase === 'offline') {
    return (
      <div className="min-h-full flex items-center justify-center px-5 bg-[radial-gradient(ellipse_at_top,#1e293b_0%,#0b0f19_60%)]">
        <div className="w-full max-w-sm text-center">
          <a href="/" className="block text-2xl font-extrabold bg-gradient-to-r from-sky-400 to-fuchsia-400 bg-clip-text text-transparent mb-6">⚡ ShareHub</a>
          <div className="rounded-2xl bg-slate-800/60 border border-slate-700 p-6">
            <div className="text-4xl mb-2">💤</div>
            <h1 className="font-bold text-lg">That computer isn’t online</h1>
            <p className="text-sm text-slate-400 mt-1">Remote ID “{roomKey}” isn’t hosting right now. Ask them to open ShareHub Desktop and start hosting, then try again.</p>
            <a href="/" className="inline-block mt-4 text-sm rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-semibold px-4 py-2">Back</a>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'in' && joined) {
    return (
      <>
        {wsDown && (
          <div className="fixed top-0 inset-x-0 z-50 bg-amber-500/90 text-black text-center text-sm font-medium py-1.5">
            Connection lost — reconnecting…
          </div>
        )}
        <RoomShell key={joined.selfId} conn={conn} joined={joined} roomKey={roomKey} initialTab={remote.current ? 'call' : 'editor'} />
      </>
    )
  }

  return <Gate phase={phase} roomKey={roomKey} error={error} remote={!!remote.current}
    onSubmit={(mode, pw, name) => { setError(''); conn.auth(mode, pw, name) }} />
}

function Gate({ phase, roomKey, error, remote, onSubmit }) {
  const [name, setName] = useState(() => localStorage.getItem('sh-name') || '')
  const [pw, setPw] = useState('')
  const creating = phase === 'setup'

  const submit = (e) => {
    e.preventDefault()
    if (!name.trim() || !pw) return
    localStorage.setItem('sh-name', name.trim())
    onSubmit(creating ? 'create' : 'join', pw, name.trim())
  }

  return (
    <div className="min-h-full flex items-center justify-center px-5 bg-[radial-gradient(ellipse_at_top,#1e293b_0%,#0b0f19_60%)]">
      <div className="w-full max-w-sm">
        <a href="/" className="block text-center text-2xl font-extrabold bg-gradient-to-r from-sky-400 to-fuchsia-400 bg-clip-text text-transparent mb-6">⚡ ShareHub</a>
        <div className="rounded-2xl bg-slate-800/60 border border-slate-700 p-6">
          <h1 className="font-bold text-lg">
            {phase === 'connecting' ? 'Connecting…' : remote ? 'Connect to remote computer' : creating ? 'Create room' : 'Join room'}
          </h1>
          <p className="text-sm text-slate-400 mt-0.5 break-all">
            {phase === 'connecting' ? roomKey : remote
              ? <>Enter the password for Remote ID “{roomKey}”.</>
              : creating
                ? <>“{roomKey}” doesn’t exist yet — set a password to create it.</>
                : <>Enter the password for “{roomKey}”.</>}
          </p>

          {phase !== 'connecting' && (
            <form onSubmit={submit} className="mt-4 space-y-3">
              <input
                value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Your name" maxLength={32} autoFocus
                className="w-full rounded-lg bg-slate-900/70 border border-slate-700 px-3.5 py-3 outline-none focus:border-sky-500 placeholder:text-slate-500"
              />
              <input
                type="password" value={pw} onChange={(e) => setPw(e.target.value)}
                placeholder={creating ? 'Set a password' : 'Password'}
                className="w-full rounded-lg bg-slate-900/70 border border-slate-700 px-3.5 py-3 outline-none focus:border-sky-500 placeholder:text-slate-500"
              />
              {error && <div className="text-sm text-rose-400">{error}</div>}
              <button className="w-full rounded-lg bg-sky-500 hover:bg-sky-400 active:scale-[.98] transition py-3 font-semibold text-white">
                {remote ? 'Connect' : creating ? 'Create & enter' : 'Join room'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
