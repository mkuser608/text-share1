import React, { useEffect, useRef, useState } from 'react'
import { colorFor } from '../lib/util'
import { applyRemoteEvent, attachViewerControls, removeRemoteCursor, attachFullControl } from '../lib/remotecontrol'

/**
 * Calls (audio/video mesh) + screen share + remote control.
 *
 * Two kinds of remote control:
 *  - in-tab: forwarded as synthetic events inside the sharer's browser tab
 *    (works with no install, but only controls that tab).
 *  - full-PC: routed to a native agent the host runs; injects real OS input so
 *    a viewer can drive the whole desktop (IDE/terminal/etc) for pair debugging.
 */
export default function CallPane({ pm, peers, myName, selfId, agentApi }) {
  const [media, setMedia] = useState(null)
  const [screen, setScreen] = useState(null)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [, force] = useState(0)
  const [err, setErr] = useState('')

  // in-tab control state
  const [controlling, setControlling] = useState(null)
  const [grantedTo, setGrantedTo] = useState(null)
  const [reqFrom, setReqFrom] = useState(null)
  const grantedRef = useRef(null); grantedRef.current = grantedTo

  // full-PC control state
  const [fullCtrl, setFullCtrl] = useState(null)   // agentId we're driving
  const [linkOpen, setLinkOpen] = useState(false)
  const [code, setCode] = useState('')

  const { agents = {}, myAgentId, agentSeen, controlledBy } = agentApi || {}

  useEffect(() => {
    const offs = [
      pm.on('remote-changed', () => force(n => n + 1)),
      pm.on('peer-removed', (id) => {
        setControlling(c => (c === id ? null : c))
        setGrantedTo(g => (g === id ? null : g))
        setReqFrom(r => (r?.id === id ? null : r))
      }),
      pm.on('ctl-json', (pid, m) => {
        switch (m.t) {
          case 'rc-request': setReqFrom({ id: pid, name: pm.getName(pid) }); break
          case 'rc-grant': setControlling(pid); break
          case 'rc-deny':
          case 'rc-stop': setControlling(c => (c === pid ? null : c)); break
          case 'rc-move': case 'rc-click': case 'rc-wheel': case 'rc-key':
            if (grantedRef.current === pid) applyRemoteEvent(m, pm.getName(pid))
            break
        }
      }),
    ]
    return () => { offs.forEach(o => o()); removeRemoteCursor() }
  }, [])

  // ---- local media ----
  const startCall = async (withVideo) => {
    setErr('')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo })
      pm.addLocalStream(s, 'media'); setMedia(s); setMicOn(true); setCamOn(withVideo)
    } catch (e) { setErr(e.name === 'NotAllowedError' ? 'Camera/mic permission denied' : 'Could not start call: ' + e.message) }
  }
  const endCall = () => { if (media) { pm.removeLocalStream(media); setMedia(null) } }
  const toggleMic = () => { if (!media) return; const on = !micOn; media.getAudioTracks().forEach(t => (t.enabled = on)); setMicOn(on) }
  const toggleCam = async () => {
    if (!media) return
    const vids = media.getVideoTracks()
    if (vids.length) { const on = !camOn; vids.forEach(t => (t.enabled = on)); setCamOn(on) }
    else {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: true })
        const track = cam.getVideoTracks()[0]
        media.addTrack(track); pm.addLocalTrack(media, track); setCamOn(true); force(n => n + 1)
      } catch (e) { setErr('Could not enable camera: ' + e.message) }
    }
  }

  // ---- screen share ----
  const startScreen = async () => {
    setErr('')
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true })
      pm.addLocalStream(s, 'screen'); setScreen(s)
      s.getVideoTracks()[0].addEventListener('ended', () => stopScreen(s))
    } catch (e) { if (e.name !== 'NotAllowedError') setErr('Screen share failed: ' + e.message) }
  }
  const stopScreen = (s = screen) => {
    if (s) { pm.removeLocalStream(s); setScreen(null); setGrantedTo(null); removeRemoteCursor() }
  }

  // ---- in-tab control signalling ----
  const requestControl = (pid) => { pm.sendCtl(pid, { t: 'rc-request' }); setControlling('pending:' + pid) }
  const stopControlling = (pid) => { pm.sendCtl(pid, { t: 'rc-stop' }); setControlling(null) }
  const grant = () => { pm.sendCtl(reqFrom.id, { t: 'rc-grant' }); setGrantedTo(reqFrom.id); setReqFrom(null) }
  const deny = () => { pm.sendCtl(reqFrom.id, { t: 'rc-deny' }); setReqFrom(null) }
  const revokeControl = () => { if (grantedTo) { pm.sendCtl(grantedTo, { t: 'rc-stop' }); setGrantedTo(null); removeRemoteCursor() } }

  // ---- full-PC control ----
  const startFull = (agentId) => { agentApi.sendToAgent(agentId, { t: 'rc-request', name: myName }); setFullCtrl(agentId) }
  const stopFull = (agentId) => { agentApi.sendToAgent(agentId, { t: 'rc-stop' }); setFullCtrl(f => (f === agentId ? null : f)) }
  const submitLink = (e) => { e.preventDefault(); if (code.trim()) { agentApi.link(code.trim()); setCode(''); setLinkOpen(false) } }

  // gather remote tiles
  const remoteTiles = []
  for (const p of peers) {
    const map = pm.remote.get(p.id)
    if (!map) continue
    for (const [sid, entry] of map) {
      if (!entry.stream) continue
      remoteTiles.push({ key: p.id + ':' + sid, peerId: p.id, name: p.name, stream: entry.stream, kind: entry.kind })
    }
  }

  const inCall = !!media || !!screen
  const shown = new Set(remoteTiles.map(t => t.peerId))
  const connectingTiles = (inCall ? peers : []).filter(p => !shown.has(p.id))
    .map(p => ({ peerId: p.id, name: p.name, state: pm.getState(p.id) }))
  const anyTiles = remoteTiles.length + connectingTiles.length + (media ? 1 : 0) + (screen ? 1 : 0)

  return (
    <div className="h-full flex flex-col">
      {/* incoming in-tab control request */}
      {reqFrom && (
        <div className="m-3 rounded-xl bg-indigo-500/15 border border-indigo-500/40 p-3 flex items-center gap-3">
          <div className="text-2xl">🖱️</div>
          <div className="flex-1 text-sm">
            <b>{reqFrom.name}</b> wants to control your shared screen.
            <div className="text-xs text-slate-400">They'll be able to click & type on this browser tab.</div>
          </div>
          <button onClick={deny} className="text-xs rounded-lg border border-slate-600 hover:border-rose-500 px-3 py-2">Deny</button>
          <button onClick={grant} className="text-xs rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-semibold px-3 py-2">Allow</button>
        </div>
      )}
      {grantedTo && (
        <div className="mx-3 mt-3 rounded-lg bg-amber-500/15 border border-amber-500/40 px-3 py-2 text-xs flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <b>{pm.getName(grantedTo)}</b> is controlling your tab.
          <button onClick={revokeControl} className="ml-auto rounded-md border border-amber-500/50 hover:bg-amber-500/20 px-2 py-1">Stop</button>
        </div>
      )}
      {/* someone controlling my whole PC via the agent */}
      {controlledBy && (
        <div className="mx-3 mt-3 rounded-lg bg-rose-500/15 border border-rose-500/50 px-3 py-2 text-xs flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
          <b>{controlledBy}</b> is controlling your <b>whole PC</b>. Quit the agent (Ctrl+C) to cut it instantly.
        </div>
      )}
      {err && <div className="mx-3 mt-3 rounded-lg bg-rose-500/15 border border-rose-500/40 px-3 py-2 text-xs text-rose-300">{err}</div>}

      {/* agent link status / prompt */}
      <div className="mx-3 mt-3">
        {myAgentId ? (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/40 px-3 py-2 text-xs flex items-center gap-2 flex-wrap">
            <span>🖥️</span><b>This PC is linked</b> — share your <b>entire screen</b> and others can take full control for debugging.
            <button onClick={agentApi.unlink} className="ml-auto rounded-md border border-emerald-500/40 hover:bg-emerald-500/20 px-2 py-1">Unlink</button>
          </div>
        ) : agentSeen ? (
          linkOpen ? (
            <form onSubmit={submitLink} className="rounded-lg bg-slate-800/60 border border-slate-700 px-3 py-2 flex items-center gap-2">
              <span className="text-xs text-slate-300">Enter the 6-digit code from the agent window:</span>
              <input value={code} onChange={e => setCode(e.target.value)} autoFocus inputMode="numeric" maxLength={6}
                className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm outline-none focus:border-sky-500" placeholder="123456" />
              <button className="text-xs rounded-md bg-sky-500 hover:bg-sky-400 text-white font-semibold px-3 py-1.5">Link</button>
              <button type="button" onClick={() => setLinkOpen(false)} className="text-xs text-slate-400 px-1">cancel</button>
              {agentApi.pairMsg && <span className="text-xs text-rose-300">{agentApi.pairMsg}</span>}
            </form>
          ) : (
            <button onClick={() => setLinkOpen(true)}
              className="w-full rounded-lg bg-indigo-500/15 border border-indigo-500/40 hover:bg-indigo-500/25 px-3 py-2 text-xs text-left">
              🖥️ A control agent is running on this network — <b>Link this PC</b> to allow full-desktop control.
            </button>
          )
        ) : (
          <div className="rounded-lg bg-slate-800/40 border border-slate-700/60 px-3 py-2 text-[11px] text-slate-400">
            💡 Want a viewer to control your whole PC (IDE, terminal) for debugging? Run the <b>ShareHub agent</b> on this machine (see agent/README), then link it here.
          </div>
        )}
      </div>

      {/* video grid */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {anyTiles === 0 ? (
          <div className="h-full grid place-items-center text-center px-6">
            <div>
              <div className="text-5xl mb-3">🎥</div>
              <div className="font-semibold text-lg">Start a call or share your screen</div>
              <p className="text-sm text-slate-400 mt-1 max-w-xs mx-auto">Voice, video and screen sharing run peer-to-peer with everyone in this room.</p>
              {peers.length === 0 && <p className="text-xs text-slate-500 mt-3">You're the only one here — invite someone with “copy link”.</p>}
            </div>
          </div>
        ) : (
          <div className={`grid gap-3 ${gridCols(anyTiles)}`}>
            {media && <Tile stream={media} label={myName + ' (you)'} mine muted camOff={!camOn} micOff={!micOn} />}
            {screen && <Tile stream={screen} label={myName + ' — screen'} mine muted isScreen />}
            {remoteTiles.map(t => {
              const agentId = t.kind === 'screen' ? agents[t.peerId] : null
              return (
                <Tile
                  key={t.key} stream={t.stream} label={t.name + (t.kind === 'screen' ? ' — screen' : '')}
                  isScreen={t.kind === 'screen'}
                  // full-PC control if the host runs an agent; else in-tab control
                  fullState={agentId ? (fullCtrl === agentId ? 'active' : 'idle') : null}
                  onFullStart={() => startFull(agentId)}
                  onFullStop={() => stopFull(agentId)}
                  sendFull={(evt) => agentApi.sendToAgent(agentId, evt)}
                  controlState={(!agentId && t.kind === 'screen')
                    ? (controlling === t.peerId ? 'active' : controlling === 'pending:' + t.peerId ? 'pending' : 'idle')
                    : null}
                  onRequestControl={() => requestControl(t.peerId)}
                  onStopControl={() => stopControlling(t.peerId)}
                  sendControl={(evt) => pm.sendCtl(t.peerId, evt)}
                />
              )
            })}
            {connectingTiles.map(c => (
              <div key={'c:' + c.peerId}
                className="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-700/60 aspect-video grid place-items-center">
                <div className="text-center px-3">
                  <div className="w-12 h-12 mx-auto rounded-full grid place-items-center text-lg font-bold text-slate-900 mb-2"
                    style={{ background: colorFor(c.name) }}>{c.name.trim()[0]?.toUpperCase()}</div>
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className={`text-xs mt-0.5 ${c.state === 'failed' ? 'text-rose-400' : 'text-slate-400'}`}>
                    {c.state === 'connected' ? 'connected — camera/mic off' : c.state === 'failed' ? 'connection failed — retrying' : 'connecting…'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* control bar */}
      <div className="shrink-0 border-t border-slate-800 bg-slate-900/70 backdrop-blur px-3 py-2.5 pb-safe flex items-center justify-center gap-2 flex-wrap">
        {!media ? (
          <>
            <Ctl onClick={() => startCall(true)} icon="🎥" label="Video call" primary />
            <Ctl onClick={() => startCall(false)} icon="🎙️" label="Audio only" />
          </>
        ) : (
          <>
            <Ctl onClick={toggleMic} icon={micOn ? '🎙️' : '🔇'} label={micOn ? 'Mute' : 'Unmute'} active={!micOn} />
            <Ctl onClick={toggleCam} icon={camOn ? '📹' : '📷'} label={camOn ? 'Camera off' : 'Camera on'} active={!camOn} />
            <Ctl onClick={endCall} icon="📴" label="Leave" danger />
          </>
        )}
        <div className="w-px h-8 bg-slate-700 mx-1 hidden sm:block" />
        {!screen ? (
          <Ctl onClick={startScreen} icon="🖥️" label="Share screen" />
        ) : (
          <Ctl onClick={() => stopScreen()} icon="🛑" label="Stop share" danger />
        )}
      </div>
    </div>
  )
}

function gridCols(n) {
  if (n <= 1) return 'grid-cols-1'
  if (n === 2) return 'grid-cols-1 sm:grid-cols-2'
  if (n <= 4) return 'grid-cols-1 sm:grid-cols-2'
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
}

function Tile({ stream, label, mine, muted, isScreen, camOff, micOff,
  controlState, onRequestControl, onStopControl, sendControl,
  fullState, onFullStart, onFullStop, sendFull }) {
  const videoRef = useRef(null)
  const detachRef = useRef(null)

  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream
  }, [stream])

  // in-tab viewer control capture
  useEffect(() => {
    if (controlState === 'active' && videoRef.current && sendControl) {
      detachRef.current = attachViewerControls(videoRef.current, sendControl)
      videoRef.current.focus?.()
    }
    return () => { detachRef.current?.(); detachRef.current = null }
  }, [controlState])

  // full-PC control capture (to native agent)
  useEffect(() => {
    if (fullState === 'active' && videoRef.current && sendFull) {
      detachRef.current = attachFullControl(videoRef.current, sendFull)
      videoRef.current.focus?.()
    }
    return () => { detachRef.current?.(); detachRef.current = null }
  }, [fullState])

  const active = controlState === 'active' || fullState === 'active'

  return (
    <div className={`relative rounded-xl overflow-hidden bg-slate-950 border ${active ? 'border-emerald-400' : 'border-slate-700/60'} aspect-video`}>
      <video ref={videoRef} autoPlay playsInline muted={mine || muted}
        className={`w-full h-full ${isScreen ? 'object-contain' : 'object-cover'} ${mine && !isScreen ? '-scale-x-100' : ''}`} />
      {camOff && !isScreen && (
        <div className="absolute inset-0 grid place-items-center bg-slate-900">
          <div className="w-16 h-16 rounded-full grid place-items-center text-2xl font-bold text-slate-900"
            style={{ background: colorFor(label) }}>{label.trim()[0]?.toUpperCase()}</div>
        </div>
      )}

      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-[11px] font-medium bg-black/60 rounded-md px-2 py-0.5">
        {micOff && <span title="muted">🔇</span>}
        <span className="truncate max-w-[40vw]">{label}</span>
      </div>

      {/* full-PC control buttons */}
      {fullState && (
        <div className="absolute top-1.5 right-1.5">
          {fullState === 'idle'
            ? <button onClick={onFullStart} className="text-[11px] rounded-md bg-sky-500/90 hover:bg-sky-400 text-white font-semibold px-2 py-1">🖥️ Take full control</button>
            : <button onClick={onFullStop} className="text-[11px] rounded-md bg-emerald-500/90 hover:bg-emerald-400 text-white font-semibold px-2 py-1">● Controlling PC — stop</button>}
        </div>
      )}
      {/* in-tab control buttons */}
      {controlState && (
        <div className="absolute top-1.5 right-1.5">
          {controlState === 'idle' && <button onClick={onRequestControl} className="text-[11px] rounded-md bg-indigo-500/90 hover:bg-indigo-400 text-white font-semibold px-2 py-1">Request control</button>}
          {controlState === 'pending' && <span className="text-[11px] rounded-md bg-slate-800/90 text-slate-300 px-2 py-1">Waiting…</span>}
          {controlState === 'active' && <button onClick={onStopControl} className="text-[11px] rounded-md bg-emerald-500/90 hover:bg-emerald-400 text-white font-semibold px-2 py-1">● Controlling — stop</button>}
        </div>
      )}
      {active && (
        <div className="absolute top-1.5 left-1.5 text-[10px] bg-emerald-500/20 text-emerald-300 rounded px-1.5 py-0.5">
          click &amp; type on the video
        </div>
      )}
    </div>
  )
}

function Ctl({ onClick, icon, label, primary, danger, active }) {
  const base = 'flex flex-col items-center justify-center gap-0.5 rounded-xl px-4 py-2 text-[11px] font-medium transition active:scale-95 min-w-[64px]'
  const cls = primary ? 'bg-sky-500 hover:bg-sky-400 text-white'
    : danger ? 'bg-rose-500/90 hover:bg-rose-500 text-white'
    : active ? 'bg-amber-500/90 hover:bg-amber-500 text-white'
    : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
  return (
    <button onClick={onClick} className={`${base} ${cls}`}>
      <span className="text-lg leading-none">{icon}</span>
      {label}
    </button>
  )
}
