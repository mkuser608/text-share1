import React, { useEffect, useRef, useState } from 'react'
import { colorFor } from '../lib/util'
import { attachFullControl } from '../lib/remotecontrol'

const fmtId = (s) => String(s || '').replace(/\D/g, '').replace(/(\d{3})(?=\d)/g, '$1 ').trim()

export default function RemotePane({ pm, peers, myName, selfId, agentApi, ownCreds }) {
  const [, force] = useState(0)
  const [ctrl, setCtrl] = useState(null)
  const [panel, setPanel] = useState(null)
  const [copied, setCopied] = useState(false)
  const [otherId, setOtherId] = useState('')
  const [otherPw, setOtherPw] = useState('')
  const [paused, setPaused] = useState(false)
  const [localCreds, setLocalCreds] = useState(null)
  const timerRef = useRef(null)
  const { agents = {}, myAgentId, os, downloads } = agentApi || {}

  useEffect(() => {
    const off = pm.on('remote-changed', () => force(n => n + 1))
    // read this machine's own creds from the local ShareHub Desktop app (if running)
    fetch('http://127.0.0.1:47615', { cache: 'no-store' }).then(r => r.json()).then(c => { if (c && c.id) setLocalCreds(c) }).catch(() => {})
    return () => { off(); clearTimeout(timerRef.current) }
  }, [])
  useEffect(() => { if (myAgentId) { setPanel(null); clearTimeout(timerRef.current) } }, [myAgentId])
  useEffect(() => { if (ctrl && !agents[ctrl.peerId]) setCtrl(null) })

  const enable = () => {
    agentApi.enableFullControl(); setPanel('launching')
    clearTimeout(timerRef.current); timerRef.current = setTimeout(() => setPanel(p => (p === 'launching' ? 'download' : p)), 3500)
  }
  const showMyCreds = async () => {
    try {
      const r = await fetch('http://127.0.0.1:47615', { cache: 'no-store' })
      const c = await r.json()
      if (c && c.id) { setLocalCreds(c); return }
    } catch {}
    enable() // fallback: launch the app + P2P handshake
  }
  const shownCreds = ownCreds || localCreds

  // desktop app only ever sends a screen; accept any stream with a video track
  const screenOf = (peerId) => {
    const map = pm.remote.get(peerId); if (!map) return null
    let fallback = null
    for (const [, e] of map) {
      if (!e.stream) continue
      if (e.kind === 'screen') return e.stream
      const v = e.stream.getVideoTracks ? e.stream.getVideoTracks() : []
      if (v.length) fallback = e.stream
    }
    return fallback
  }

  const startControl = (peerId, agentId) => { agentApi.sendToAgent(agentId, { t: 'rc-request', name: myName }); setCtrl({ peerId, agentId }) }
  const stopControl = () => { if (ctrl) agentApi.sendToAgent(ctrl.agentId, { t: 'rc-stop' }); setCtrl(null) }
  const sendClipboard = async () => {
    if (!ctrl) return
    try { const text = await navigator.clipboard.readText(); if (text) agentApi.sendToAgent(ctrl.agentId, { t: 'rc-text', text }) } catch {}
  }
  const copyCreds = () => { const c = ownCreds || localCreds; if (!c) return; try { navigator.clipboard.writeText(`ShareHub — ID: ${fmtId(c.id)}  Password: ${c.pw}`) } catch {} setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const connectOther = (e) => {
    e.preventDefault()
    const id = otherId.replace(/\D/g, '').trim(); if (!id || !otherPw) return
    sessionStorage.setItem('sh-remote', JSON.stringify({ password: otherPw, name: myName }))
    location.href = '/' + encodeURIComponent(id)
  }

  if (ctrl) {
    const stream = screenOf(ctrl.peerId)
    const name = peers.find(p => p.id === ctrl.peerId)?.name || 'Remote PC'
    return (
      <div className="h-full flex flex-col bg-slate-950">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 shrink-0">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm font-medium">Controlling <b>{name}</b></span>
          <div className="ml-auto flex gap-2">
            <button onClick={sendClipboard} className="text-xs rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5">📋 Send clipboard</button>
            <button onClick={stopControl} className="text-xs rounded-lg bg-rose-500/90 hover:bg-rose-500 text-white font-semibold px-3 py-1.5">Disconnect</button>
          </div>
        </div>
        <div className="flex-1 min-h-0 p-1">
          {stream ? <ControlVideo stream={stream} send={(evt) => agentApi.sendToAgent(ctrl.agentId, evt)} />
            : <div className="text-slate-400 text-sm text-center">Connecting to {name}'s screen…<div className="text-xs text-slate-600 mt-1">Make sure ShareHub Desktop is online on that PC.</div></div>}
        </div>
        <div className="text-[11px] text-slate-500 text-center py-1 shrink-0">Click &amp; type on the screen to control it · your keyboard and mouse drive the remote PC</div>
      </div>
    )
  }

  const controllable = peers.filter(p => agents[p.id])

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-5 max-w-2xl mx-auto w-full space-y-4">
      {/* your computer */}
      <div className="rounded-2xl bg-slate-800/50 border border-slate-700/60 p-4">
        <div className="font-semibold flex items-center gap-2">🖥️ Your computer</div>
        {shownCreds ? (
          <div className="mt-3 rounded-xl bg-slate-900/70 border border-dashed border-slate-600 p-3 text-center">
            <div className="text-[11px] text-slate-500">Your Machine ID</div>
            <div className="text-xl font-extrabold tracking-widest select-all">{fmtId(shownCreds.id)}</div>
            <div className="text-[11px] text-slate-500 mt-2">Password</div>
            <div className="font-bold select-all">{shownCreds.pw}</div>
            <button onClick={copyCreds} className="mt-3 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 px-3 py-1.5">{copied ? '✓ copied' : 'Copy ID + password'}</button>
            <div className={`text-[11px] mt-2 ${paused ? 'text-slate-400' : 'text-emerald-400'}`}>{paused ? '● Paused — no one can connect' : '● Online — others can connect with these'}</div>
            <div className="mt-2 flex gap-2 justify-center">
              {paused
                ? <button onClick={() => { agentApi.sendToAgent(myAgentId, { t: 'set-sharing', on: true }); setPaused(false) }} className="text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-3 py-1.5">Connect</button>
                : <button onClick={() => { agentApi.sendToAgent(myAgentId, { t: 'set-sharing', on: false }); setPaused(true) }} className="text-xs rounded-lg bg-rose-500/80 hover:bg-rose-500 text-white font-semibold px-3 py-1.5">Disconnect</button>}
            </div>
          </div>
        ) : panel === 'launching' ? (
          <div className="mt-3 text-xs text-slate-300 flex items-center gap-2"><span className="w-3 h-3 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" /> Opening ShareHub Desktop…</div>
        ) : panel === 'download' ? (
          <div className="mt-3 text-xs">
            <div className="text-slate-300">Install ShareHub Desktop once, then this PC is always reachable.</div>
            <div className="flex gap-2 mt-2 flex-wrap">
              <a href={downloads.windows} className={`rounded-md px-3 py-1.5 font-semibold ${os === 'windows' ? 'bg-sky-500 text-white' : 'bg-slate-700 text-slate-200'}`}>⬇ Windows</a>
              <a href={downloads.mac} className={`rounded-md px-3 py-1.5 font-semibold ${os === 'mac' ? 'bg-sky-500 text-white' : 'bg-slate-700 text-slate-200'}`}>⬇ macOS</a>
              <button onClick={enable} className="rounded-md px-3 py-1.5 bg-emerald-600 text-white font-semibold">I've installed it — link</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-400 mt-1">Show this computer's Machine ID &amp; password so it can be controlled from anywhere.</p>
            <button onClick={showMyCreds} className="mt-3 text-sm rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-semibold px-4 py-2">Show my ID &amp; password</button>
          </>
        )}
      </div>

      {/* connect to another computer */}
      <div className="rounded-2xl bg-slate-800/40 border border-slate-700/60 p-4">
        <div className="font-semibold flex items-center gap-2">🔗 Connect to another computer</div>
        <p className="text-sm text-slate-400 mt-1">Enter a Machine ID + password to view and control that PC.</p>
        <form onSubmit={connectOther} className="mt-3 grid grid-cols-1 sm:grid-cols-[1.2fr_1fr_auto] gap-2">
          <input value={otherId} onChange={(e) => setOtherId(e.target.value)} placeholder="Machine ID (e.g. 123 456 789)"
            className="rounded-lg bg-slate-900/70 border border-slate-700 px-3 py-2.5 text-sm outline-none focus:border-sky-500" />
          <input type="password" value={otherPw} onChange={(e) => setOtherPw(e.target.value)} placeholder="Password"
            className="rounded-lg bg-slate-900/70 border border-slate-700 px-3 py-2.5 text-sm outline-none focus:border-sky-500" />
          <button className="rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white font-semibold px-4 py-2.5 text-sm">Connect</button>
        </form>
      </div>

      {/* people in this room */}
      <div className="rounded-2xl bg-slate-800/40 border border-slate-700/60 p-4">
        <div className="font-semibold">People in this room</div>
        <div className="mt-2 divide-y divide-slate-800">
          <Row name={myName + ' (you)'} id={selfId} tag={myAgentId ? 'your PC is shareable' : null} />
          {peers.filter(p => !agents[p.id]).map(p => (
            <Row key={p.id} name={p.name} id={p.id}
              tag={controllable.find(c => c.name === p.name) ? null : null}
              action={<span className="text-[11px] text-slate-500">{agents[p.id] ? '' : ''}</span>} />
          ))}
        </div>
        {controllable.length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-slate-400 mb-1">Computers you can control</div>
            <div className="divide-y divide-slate-800">
              {controllable.map(p => (
                <Row key={p.id} name={p.name} id={p.id} tag={'controllable'}
                  action={<button onClick={() => startControl(p.id, agents[p.id])} className="text-xs rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-semibold px-3 py-1.5">Connect &amp; control</button>} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ name, id, tag, action }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="w-8 h-8 rounded-full grid place-items-center text-xs font-bold text-slate-900" style={{ background: colorFor(id || name) }}>{name.trim()[0]?.toUpperCase()}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{name}</div>
        {tag && <div className="text-[11px] text-emerald-400">● {tag}</div>}
      </div>
      {action}
    </div>
  )
}

function ControlVideo({ stream, send }) {
  const ref = useRef(null); const detach = useRef(null)
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream }, [stream])
  useEffect(() => {
    if (ref.current) { detach.current = attachFullControl(ref.current, send); ref.current.focus?.() }
    return () => { detach.current?.(); detach.current = null }
  }, [])
  return <video ref={ref} autoPlay playsInline className="w-full h-full rounded-lg border border-emerald-500/40 object-contain bg-black" tabIndex={0} />
}
