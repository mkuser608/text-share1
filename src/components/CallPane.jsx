import React, { useEffect, useRef, useState } from 'react'
import { colorFor } from '../lib/util'

export default function CallPane({ pm, peers, myName, selfId, chat, sendChat, timeline }) {
  const [media, setMedia] = useState(null)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [, force] = useState(0)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const off = pm.on('remote-changed', () => force(n => n + 1))
    return () => { off(); if (media) pm.removeLocalStream(media) }
  }, [])

  const start = async (withVideo) => {
    setErr('')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo })
      pm.addLocalStream(s, 'media'); setMedia(s); setMicOn(true); setCamOn(withVideo)
    } catch (e) { setErr(e.name === 'NotAllowedError' ? 'Camera/mic permission denied' : 'Could not start: ' + e.message) }
  }
  const leave = () => { if (media) { pm.removeLocalStream(media); setMedia(null) } }
  const toggleMic = () => { if (!media) return; const on = !micOn; media.getAudioTracks().forEach(t => (t.enabled = on)); setMicOn(on) }
  const toggleCam = async () => {
    if (!media) return
    const v = media.getVideoTracks()
    if (v.length) { const on = !camOn; v.forEach(t => (t.enabled = on)); setCamOn(on) }
    else { try { const cam = await navigator.mediaDevices.getUserMedia({ video: true }); const tr = cam.getVideoTracks()[0]; media.addTrack(tr); pm.addLocalTrack(media, tr); setCamOn(true); force(n => n + 1) } catch (e) { setErr('Camera: ' + e.message) } }
  }

  // remote media streams
  const tiles = []
  for (const p of peers) {
    const map = pm.remote.get(p.id); if (!map) continue
    for (const [sid, e] of map) if (e.kind === 'media' && e.stream) tiles.push({ key: p.id + ':' + sid, name: p.name, stream: e.stream })
  }
  const callActive = tiles.length > 0
  const inCall = !!media
  const grid = (media ? 1 : 0) + tiles.length

  return (
    <div className="h-full flex flex-col lg:flex-row">
      {/* call area */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {grid === 0 ? (
            <div className="h-full grid place-items-center text-center px-6">
              <div>
                <div className="text-5xl mb-3">🎥</div>
                <div className="font-semibold text-lg">{callActive ? 'A call is happening' : 'No call yet'}</div>
                <p className="text-sm text-slate-400 mt-1">{callActive ? 'Join to talk with the room.' : 'Start a call and others can join.'}</p>
                <div className="flex gap-2 justify-center mt-4">
                  <button onClick={() => start(true)} className="rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold px-5 py-2.5">🎥 {callActive ? 'Join with video' : 'Start video call'}</button>
                  <button onClick={() => start(false)} className="rounded-xl bg-slate-700 hover:bg-slate-600 font-semibold px-5 py-2.5">🎙️ Audio only</button>
                </div>
                {err && <div className="text-sm text-rose-400 mt-3">{err}</div>}
              </div>
            </div>
          ) : (
            <div className={`grid gap-3 ${grid <= 1 ? 'grid-cols-1' : grid <= 4 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 lg:grid-cols-3'}`}>
              {media && <Tile stream={media} label={myName + ' (you)'} mine muted camOff={!camOn} />}
              {tiles.map(t => <Tile key={t.key} stream={t.stream} label={t.name} />)}
            </div>
          )}
        </div>
        {inCall && (
          <div className="shrink-0 border-t border-slate-800 bg-slate-900/70 px-3 py-2.5 flex items-center justify-center gap-2">
            <Ctl onClick={toggleMic} icon={micOn ? '🎙️' : '🔇'} label={micOn ? 'Mute' : 'Unmute'} active={!micOn} />
            <Ctl onClick={toggleCam} icon={camOn ? '📹' : '📷'} label={camOn ? 'Cam off' : 'Cam on'} active={!camOn} />
            <Ctl onClick={leave} icon="📴" label="Leave" danger />
          </div>
        )}
      </div>

      {/* chat + timeline */}
      <aside className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col min-h-0 h-64 lg:h-auto">
        <div className="px-3 py-2 border-b border-slate-800 text-sm font-semibold shrink-0">💬 Chat</div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {timeline.slice(-30).map((e, i) => (
            <div key={'t' + i} className="text-[11px] text-slate-500 text-center">{e.name} {e.kind} · {new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          ))}
          {chat.map(m => (
            <div key={m.id} className="text-sm">
              <span className="font-semibold" style={{ color: colorFor(m.name) }}>{m.name === myName ? 'You' : m.name}</span>
              <span className="text-slate-500 text-[10px] ml-1">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <div className="text-slate-200 break-words">{m.text}</div>
            </div>
          ))}
          {chat.length === 0 && <div className="text-xs text-slate-500 text-center pt-4">No messages yet. Say hi 👋</div>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); sendChat(draft); setDraft('') }} className="p-2 border-t border-slate-800 flex gap-2 shrink-0">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message…" className="flex-1 rounded-lg bg-slate-900/70 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-sky-500" />
          <button className="rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-semibold px-3 text-sm">Send</button>
        </form>
      </aside>
    </div>
  )
}

function Tile({ stream, label, mine, muted, camOff }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream }, [stream])
  return (
    <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-700/60 aspect-video">
      <video ref={ref} autoPlay playsInline muted={mine || muted} className={`w-full h-full object-cover ${mine ? '-scale-x-100' : ''}`} />
      {camOff && (
        <div className="absolute inset-0 grid place-items-center bg-slate-900">
          <div className="w-16 h-16 rounded-full grid place-items-center text-2xl font-bold text-slate-900" style={{ background: colorFor(label) }}>{label.trim()[0]?.toUpperCase()}</div>
        </div>
      )}
      <div className="absolute bottom-1.5 left-1.5 text-[11px] font-medium bg-black/60 rounded-md px-2 py-0.5 truncate max-w-[60%]">{label}</div>
    </div>
  )
}

function Ctl({ onClick, icon, label, danger, active }) {
  const cls = danger ? 'bg-rose-500/90 hover:bg-rose-500 text-white' : active ? 'bg-amber-500/90 hover:bg-amber-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
  return <button onClick={onClick} className={`flex flex-col items-center gap-0.5 rounded-xl px-4 py-2 text-[11px] font-medium ${cls}`}><span className="text-lg leading-none">{icon}</span>{label}</button>
}
