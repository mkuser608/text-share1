import React, { useState } from 'react'
import { randomKey } from '../lib/util'

const FEATURES = [
  ['📝', 'Live editor', 'Write code & notes together, cursors and all'],
  ['📁', 'P2P file drop', 'Any size — files fly device-to-device, never stored'],
  ['🎥', 'Calls', 'Voice & video with everyone in the room'],
  ['🖥️', 'Screen share', 'Present your screen, even hand over control'],
]

export default function Landing() {
  const [key, setKey] = useState('')

  const go = (e) => {
    e.preventDefault()
    const k = key.trim().replace(/\s+/g, '-').toLowerCase()
    if (k) location.href = '/' + encodeURIComponent(k)
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-5 py-10 bg-[radial-gradient(ellipse_at_top,#1e293b_0%,#0b0f19_60%)]">
      <div className="w-full max-w-xl text-center">
        <div className="text-5xl mb-4">⚡</div>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-sky-400 via-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">
          ShareHub
        </h1>
        <p className="mt-3 text-slate-400 text-base sm:text-lg">
          Private rooms for editing together, sharing huge files peer-to-peer, and jumping on a call — no accounts.
        </p>

        <form onSubmit={go} className="mt-8 flex flex-col sm:flex-row gap-3">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="room name, e.g. project-x"
            className="flex-1 rounded-xl bg-slate-800/70 border border-slate-700 px-4 py-3.5 text-base outline-none focus:border-sky-500 placeholder:text-slate-500"
            autoFocus
          />
          <button
            type="submit"
            className="rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-95 transition px-6 py-3.5 font-semibold text-white"
          >
            Open room →
          </button>
        </form>
        <button
          onClick={() => setKey(randomKey())}
          className="mt-3 text-sm text-slate-500 hover:text-sky-400 transition"
        >
          🎲 generate a random room name
        </button>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
          {FEATURES.map(([icon, title, desc]) => (
            <div key={title} className="rounded-xl bg-slate-800/40 border border-slate-700/60 p-4">
              <div className="text-2xl">{icon}</div>
              <div className="mt-1 font-semibold">{title}</div>
              <div className="text-sm text-slate-400">{desc}</div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-xs text-slate-600">
          Rooms are password-protected · everything lives in memory · nothing is stored on disk
        </p>
      </div>
    </div>
  )
}
