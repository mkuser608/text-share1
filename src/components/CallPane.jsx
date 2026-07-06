import React, { useEffect, useRef, useState } from 'react'
import { colorFor } from '../lib/util'
import { applyRemoteEvent, attachViewerControls, removeRemoteCursor } from '../lib/remotecontrol'

/**
 * Calls (audio/video mesh) + screen share + remote control.
 *
 * Streams flow through PeerManager (WebRTC mesh). Remote-control signalling
 * rides the ctl DataChannel as JSON:
 *   rc-request / rc-grant / rc-deny / rc-stop
 *   rc-move / rc-click / rc-wheel / rc-key   (only honoured after a grant)
 */
export default function CallPane({ pm, peers, myName }) {
  const [media, setMedia] = useState(null)     // camera+mic MediaStream
  const [screen, setScreen] = useState(null)   // screen MediaStream
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [, force] = useState(0)                // re-render on remote changes
  const [err, setErr] = useState('')

  // remote-control state
  const [controlling, setControlling] = useState(null) // peerId whose screen WE drive (viewer)
  const [grantedTo, setGrantedTo] = useState(null)     // peerId we let drive US (sharer)
  const [reqFrom, setReqFrom] = useState(null)         // incoming control request { id, name }

  const grantedRef = useRef(null)
  grantedRef.current = grantedTo

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
      pm.addLocalStream(s, 'media')
      setMedia(s)
      setMicOn(true); setCamOn(withVideo)
    } catch (e) { setErr(e.name === 'NotAllowedError' ? 'Camera/mic permission denied' : 'Could not start call: ' + e.message) }
  }
  const endCall = () => {
    if (media) { pm.removeLocalStream(media); setMedia(null) }
  }
  const toggleMic = () => {
    if (!media) return
    const on = !micOn; media.getAudioTracks().forEach(t => (t.enabled = on)); setMicOn(on)
  }
  const toggleCam = async () => {
    if (!media) return
    const vids = media.getVideoTracks()
    if (vids.length) {
      const on = !camOn; vids.forEach(t => (t.enabled = on)); setCamOn(on)
    } else {
      // upgrade audio-only call to video
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: true })
        const track = cam.getVideoTracks()[0]
        media.addTrack(track)
        pm.addLocalTrack(media, track)
        setCamOn(true); force(n => n + 1)
      } catch (e) { setErr('Could not enable camera: ' + e.message) }
    }
  }

  // ---- screen share ----
  const startScreen = async () => {
    setErr('')
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true })
      pm.addLocalStream(s, 'screen')
      setScreen(s)
      s.getVideoTracks()[0].addEventListener('ended', () => stopScreen(s))
    } catch (e) { if (e.name !== 'NotAllowedError') setErr('Screen share failed: ' + e.message) }
  }
  const stopScreen = (s = screen) => {
    if (s) { pm.removeLocalStream(s); setScreen(null); setGrantedTo(null); removeRemoteCursor() }
  }

  // ---- remote control signalling ----
  const requestControl = (pid) => { pm.sendCtl(pid, { t: 'rc-request' }); setControlling('pending:' + pid) }
  const stopControlling = (pid) => { pm.sendCtl(pid, { t: 'rc-stop' }); setControlling(null) }
  const grant = () => { pm.sendCtl(reqFrom.id, { t: 'rc-grant' }); setGrantedTo(reqFrom.id); setReqFrom(null) }
  const deny = () => { pm.sendCtl(reqFrom.id, { t: 'rc-deny' }); setReqFrom(null) }
  const revokeControl = () => { if (grantedTo) { pm.sendCtl(grantedTo, { t: 'rc-stop' }); setGrantedTo(null); removeRemoteCursor() } }

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
  const anyTiles = remoteTiles.length + (media ? 1 : 0) + (screen ? 1 : 0)

  return (
    <div className="h-full flex flex-col">
      {/* incoming control request */}
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
          <b>{pm.getName(grantedTo)}</b> is controlling your screen.
          <button onClick={revokeControl} className="ml-auto rounded-md border border-amber-500/50 hover:bg-amber-500/20 px-2 py-1">Stop</button>
        </div>
      )}
      {err && <div className="mx-3 mt-3 rounded-lg bg-rose-500/15 border border-rose-500/40 px-3 py-2 text-xs text-rose-300">{err}</div>}

      {/* video grid */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {anyTiles === 0 ? (
          <div className="h-full grid place-items-center text-center px-6">
            <div>
              <div className="text-5xl mb-3">🎥</div>
              <div className="font-semibold text-lg">Start a call or share your screen</div>
              <p className="text-sm text-slate-400 mt-1 max-w-xs mx-auto">
                Voice, video and screen sharing run peer-to-peer with everyone in this room.
              </p>
              {peers.length === 0 && <p className="text-xs text-slate-500 mt-3">You're the only one here — invite someone with “copy link”.</p>}
            </div>
          </div>
        ) : (
          <div className={`grid gap-3 ${gridCols(anyTiles)}`}>
            {media && <Tile stream={media} label={myName + ' (you)'} peerId="me" mine muted camOff={!camOn} micOff={!micOn} />}
            {screen && <Tile stream={screen} label={myName + ' — screen'} peerId="me-screen" mine muted isScreen />}
            {remoteTiles.map(t => (
              <Tile
                key={t.key} stream={t.stream} label={t.name + (t.kind === 'screen' ? ' — screen' : '')}
                peerId={t.peerId} isScreen={t.kind === 'screen'}
                controlState={t.kind === 'screen'
                  ? (controlling === t.peerId ? 'active' : controlling === 'pending:' + t.peerId ? 'pending' : 'idle')
                  : null}
                onRequestControl={() => requestControl(t.peerId)}
                onStopControl={() => stopControlling(t.peerId)}
                sendControl={(evt) => pm.sendCtl(t.peerId, evt)}
              />
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

function Tile({ stream, label, mine, muted, isScreen, camOff, micOff, controlState, onRequestControl, onStopControl, sendControl }) {
  const videoRef = useRef(null)
  const detachRef = useRef(null)

  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream
  }, [stream])

  // attach/detach viewer control capture
  useEffect(() => {
    if (controlState === 'active' && videoRef.current && sendControl) {
      detachRef.current = attachViewerControls(videoRef.current, sendControl)
      videoRef.current.focus?.()
    }
    return () => { detachRef.current?.(); detachRef.current = null }
  }, [controlState])

  return (
    <div className={`relative rounded-xl overflow-hidden bg-slate-950 border ${controlState === 'active' ? 'border-emerald-400' : 'border-slate-700/60'} aspect-video`}>
      <video
        ref={videoRef} autoPlay playsInline muted={mine || muted}
        className={`w-full h-full ${isScreen ? 'object-contain' : 'object-cover'} ${mine && !isScreen ? '-scale-x-100' : ''}`}
      />
      {camOff && !isScreen && (
        <div className="absolute inset-0 grid place-items-center bg-slate-900">
          <div className="w-16 h-16 rounded-full grid place-items-center text-2xl font-bold text-slate-900"
            style={{ background: colorFor(label) }}>{label.trim()[0]?.toUpperCase()}</div>
        </div>
      )}

      {/* label */}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-[11px] font-medium bg-black/60 rounded-md px-2 py-0.5">
        {micOff && <span title="muted">🔇</span>}
        <span className="truncate max-w-[40vw]">{label}</span>
      </div>

      {/* remote-control controls on a peer's screen */}
      {controlState && (
        <div className="absolute top-1.5 right-1.5">
          {controlState === 'idle' && (
            <button onClick={onRequestControl}
              className="text-[11px] rounded-md bg-indigo-500/90 hover:bg-indigo-400 text-white font-semibold px-2 py-1">
              Request control
            </button>
          )}
          {controlState === 'pending' && (
            <span className="text-[11px] rounded-md bg-slate-800/90 text-slate-300 px-2 py-1">Waiting…</span>
          )}
          {controlState === 'active' && (
            <button onClick={onStopControl}
              className="text-[11px] rounded-md bg-emerald-500/90 hover:bg-emerald-400 text-white font-semibold px-2 py-1">
              ● Controlling — stop
            </button>
          )}
        </div>
      )}
      {controlState === 'active' && (
        <div className="absolute top-1.5 left-1.5 text-[10px] bg-emerald-500/20 text-emerald-300 rounded px-1.5 py-0.5">
          click & type on the video
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
