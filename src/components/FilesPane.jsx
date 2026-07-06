import React, { useEffect, useRef, useState } from 'react'
import { prettySize, colorFor } from '../lib/util'

const ICONS = [
  [/^image\//, '🖼️'], [/^video\//, '🎬'], [/^audio\//, '🎵'],
  [/pdf/, '📕'], [/zip|rar|7z|tar|gz/, '🗜️'], [/text|json|javascript|xml/, '📄'],
]
const iconFor = (mime = '') => (ICONS.find(([re]) => re.test(mime))?.[1]) || '📦'

export default function FilesPane({ files, fs, selfId, peerCount }) {
  const inputRef = useRef(null)
  const [drag, setDrag] = useState(false)
  const [prog, setProg] = useState({}) // fileId -> latest progress event

  useEffect(() => fs.on('progress', (p) => {
    setProg(prev => ({ ...prev, [p.id]: p }))
    if (p.done || p.error) setTimeout(() => setProg(prev => {
      if (prev[p.id] !== p) return prev
      const { [p.id]: _, ...rest } = prev
      return rest
    }), p.error ? 5000 : 2500)
  }), [])

  const share = (fileList) => { for (const f of fileList) fs.offer(f) }

  const onDrop = (e) => {
    e.preventDefault(); setDrag(false)
    if (e.dataTransfer.files?.length) share(e.dataTransfer.files)
  }

  const sorted = [...files].sort((a, b) => b.at - a.at)

  return (
    <div
      className="h-full flex flex-col p-3 sm:p-5 gap-4 max-w-3xl mx-auto w-full"
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
    >
      {/* drop zone */}
      <button
        onClick={() => inputRef.current?.click()}
        className={`rounded-2xl border-2 border-dashed transition p-6 sm:p-8 text-center ${
          drag ? 'border-sky-400 bg-sky-500/10' : 'border-slate-700 hover:border-slate-500 bg-slate-800/30'}`}
      >
        <div className="text-3xl">📤</div>
        <div className="mt-1 font-semibold">Tap to share files{peerCount > 0 ? '' : ' (waiting for peers…)'}</div>
        <div className="text-sm text-slate-400">or drag & drop — any size, sent directly device-to-device</div>
      </button>
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => { share(e.target.files); e.target.value = '' }} />

      {/* file list */}
      <div className="flex-1 overflow-y-auto space-y-2 pb-2">
        {sorted.length === 0 && (
          <div className="text-center text-slate-500 text-sm pt-8">No files shared yet</div>
        )}
        {sorted.map(f => {
          const mine = f.owner === selfId
          const p = prog[f.id]
          const pct = p && p.size ? Math.min(100, Math.round(p.received / p.size * 100)) : 0
          return (
            <div key={f.id} className="rounded-xl bg-slate-800/50 border border-slate-700/60 p-3 flex items-center gap-3">
              <div className="text-2xl shrink-0">{iconFor(f.mime)}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{f.name}</div>
                <div className="text-xs text-slate-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: colorFor(f.owner) }} />
                  {mine ? 'You' : f.ownerName} · {prettySize(f.size)}
                </div>
                {p && !p.done && !p.error && (
                  <div className="mt-1.5 h-1.5 rounded bg-slate-700 overflow-hidden">
                    <div className="h-full bg-sky-400 transition-all" style={{ width: pct + '%' }} />
                  </div>
                )}
                {p?.error && <div className="text-xs text-rose-400 mt-1">{p.error}</div>}
                {p?.done && <div className="text-xs text-emerald-400 mt-1">✓ {p.dir === 'down' ? 'downloaded' : 'sent'}</div>}
              </div>
              {mine ? (
                <button onClick={() => fs.revoke(f.id)}
                  className="text-xs rounded-lg border border-slate-600 hover:border-rose-500 hover:text-rose-400 px-3 py-2 transition shrink-0">
                  Remove
                </button>
              ) : (
                <button onClick={() => fs.download(f)} disabled={p && !p.done && !p.error}
                  className="text-xs rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold px-3 py-2 transition shrink-0">
                  {p && !p.done && !p.error ? pct + '%' : 'Download'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-slate-600 text-center shrink-0">
        Transfers are peer-to-peer over WebRTC — the sharer must stay in the room while others download.
      </p>
    </div>
  )
}
