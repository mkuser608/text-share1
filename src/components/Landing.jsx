import React, { useState } from 'react'
import { randomKey } from '../lib/util'
import { downloadUrls, detectOS } from '../lib/desktop'

const FEATURES = [
  ['🖥️', 'Remote desktop', 'Control any PC from your browser with a Machine ID + password. Real mouse, keyboard, clipboard — like AnyDesk, but web-native.'],
  ['📝', 'Live code editor', 'Edit together in real time with shared cursors and language highlighting. Powered by CRDTs — no conflicts, ever.'],
  ['📁', 'P2P file drop', 'Send files of any size device-to-device over WebRTC. Nothing is stored on a server — it flies straight across.'],
  ['🎥', 'Calls & chat', 'Jump on voice or video with the room, drop a message, and see who joined — all in one place.'],
]

const STEPS = [
  ['Open a room', 'Pick a name and a password. Share the link — anyone can join instantly.'],
  ['Install the app', 'One tiny install turns any computer into a machine you can reach from anywhere.'],
  ['Connect & control', 'Enter a Machine ID + password and you’re driving that desktop — in the browser.'],
]

export default function Landing() {
  const [key, setKey] = useState('')
  const [rid, setRid] = useState('')
  const [rpw, setRpw] = useState('')
  const [rname, setRname] = useState(() => localStorage.getItem('sh-name') || '')
  const dl = downloadUrls()
  const os = detectOS()

  const go = (e) => {
    e.preventDefault()
    const k = key.trim().replace(/\s+/g, '-').toLowerCase()
    if (k) location.href = '/' + encodeURIComponent(k)
  }
  const connectRemote = (e) => {
    e.preventDefault()
    const id = rid.replace(/\s+/g, '').trim()
    if (!id || !rpw) return
    if (rname.trim()) localStorage.setItem('sh-name', rname.trim())
    sessionStorage.setItem('sh-remote', JSON.stringify({ password: rpw, name: rname.trim() || 'Guest' }))
    location.href = '/' + encodeURIComponent(id)
  }

  return (
    <div className="relative min-h-screen text-slate-100">
      <style>{`
        @keyframes floatBlob { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(30px,-40px) scale(1.08)} 66%{transform:translate(-20px,20px) scale(.96)} }
        @keyframes rise { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        .rise{animation:rise .7s cubic-bezier(.2,.7,.2,1) both}
        .rise-1{animation-delay:.05s}.rise-2{animation-delay:.12s}.rise-3{animation-delay:.2s}.rise-4{animation-delay:.28s}
        .blob{position:absolute;border-radius:9999px;filter:blur(70px);opacity:.5;animation:floatBlob 18s ease-in-out infinite}
        .glass{background:rgba(17,24,39,.6);backdrop-filter:blur(14px)}
      `}</style>

      {/* animated backdrop */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#070b14]">
        <div className="blob" style={{ width: 460, height: 460, top: -120, left: -80, background: '#0ea5e9' }} />
        <div className="blob" style={{ width: 420, height: 420, top: 120, right: -100, background: '#8b5cf6', animationDelay: '3s' }} />
        <div className="blob" style={{ width: 380, height: 380, bottom: -140, left: '40%', background: '#ec4899', animationDelay: '6s' }} />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(2,6,23,0)_0%,#070b14_70%)]" />
      </div>

      {/* nav */}
      <header className="max-w-6xl mx-auto flex items-center gap-3 px-5 sm:px-8 py-5">
        <div className="text-2xl font-extrabold bg-gradient-to-r from-sky-400 to-fuchsia-400 bg-clip-text text-transparent">⚡ ShareHub</div>
        <nav className="ml-auto hidden sm:flex items-center gap-6 text-sm text-slate-300">
          <a href="#features" className="hover:text-white transition">Features</a>
          <a href="#how" className="hover:text-white transition">How it works</a>
          <a href={dl.page} className="rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2 font-semibold transition">Download app</a>
        </nav>
      </header>

      {/* hero */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-8 sm:pt-16 pb-10 text-center">
        <div className="rise inline-flex items-center gap-2 rounded-full border border-white/10 glass px-4 py-1.5 text-xs text-slate-300">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Remote desktop · Live editor · P2P files · Calls
        </div>
        <h1 className="rise rise-1 mt-6 text-4xl sm:text-6xl font-black tracking-tight leading-[1.05]">
          Your computer,
          <span className="block bg-gradient-to-r from-sky-400 via-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">anywhere you are.</span>
        </h1>
        <p className="rise rise-2 mt-5 text-base sm:text-lg text-slate-400 max-w-2xl mx-auto">
          Control any PC from your browser, edit code together, and share huge files peer-to-peer — all in one private, password-protected room. No accounts.
        </p>

        {/* action cards */}
        <div className="rise rise-3 mt-10 grid grid-cols-1 md:grid-cols-2 gap-4 text-left max-w-3xl mx-auto">
          <div className="glass rounded-2xl border border-white/10 p-5">
            <div className="flex items-center gap-2 font-semibold"><span>🚪</span> Open a room</div>
            <p className="text-sm text-slate-400 mt-1">Collaborate: editor, files, calls, and remote control.</p>
            <form onSubmit={go} className="mt-3 flex gap-2">
              <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="room name, e.g. project-x" autoFocus
                className="flex-1 rounded-xl bg-slate-950/60 border border-white/10 px-4 py-3 outline-none focus:border-sky-500 placeholder:text-slate-500" />
              <button className="rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-95 transition px-5 py-3 font-semibold text-white">Open →</button>
            </form>
            <button onClick={() => setKey(randomKey())} className="mt-2 text-xs text-slate-500 hover:text-sky-400 transition">🎲 random name</button>
          </div>

          <div className="glass rounded-2xl border border-emerald-500/20 p-5">
            <div className="flex items-center gap-2 font-semibold"><span>🖥️</span> Connect to a computer</div>
            <p className="text-sm text-slate-400 mt-1">Enter a Machine ID + password to view &amp; control it.</p>
            <form onSubmit={connectRemote} className="mt-3 space-y-2">
              <div className="flex gap-2">
                <input value={rid} onChange={(e) => setRid(e.target.value)} placeholder="Machine ID"
                  className="flex-1 rounded-xl bg-slate-950/60 border border-white/10 px-4 py-3 outline-none focus:border-emerald-500 placeholder:text-slate-500" />
                <input type="password" value={rpw} onChange={(e) => setRpw(e.target.value)} placeholder="Password"
                  className="w-32 rounded-xl bg-slate-950/60 border border-white/10 px-4 py-3 outline-none focus:border-emerald-500 placeholder:text-slate-500" />
              </div>
              <button className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[.99] transition px-5 py-3 font-semibold text-white">Connect &amp; control</button>
            </form>
          </div>
        </div>
      </section>

      {/* features */}
      <section id="features" className="max-w-6xl mx-auto px-5 sm:px-8 py-12">
        <h2 className="text-center text-2xl sm:text-3xl font-bold">Everything in one room</h2>
        <p className="text-center text-slate-400 mt-2">Four powerful tools, zero setup.</p>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FEATURES.map(([icon, title, desc], i) => (
            <div key={title} className={`rise rise-${i + 1} glass rounded-2xl border border-white/10 p-6 hover:border-white/20 transition`}>
              <div className="text-3xl">{icon}</div>
              <div className="mt-3 text-lg font-semibold">{title}</div>
              <p className="text-sm text-slate-400 mt-1 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="max-w-6xl mx-auto px-5 sm:px-8 py-12">
        <h2 className="text-center text-2xl sm:text-3xl font-bold">How it works</h2>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {STEPS.map(([title, desc], i) => (
            <div key={title} className="glass rounded-2xl border border-white/10 p-6">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sky-500 to-fuchsia-500 grid place-items-center font-bold">{i + 1}</div>
              <div className="mt-3 font-semibold">{title}</div>
              <p className="text-sm text-slate-400 mt-1">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* download CTA */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-12">
        <div className="glass rounded-3xl border border-white/10 p-8 sm:p-12 text-center bg-gradient-to-br from-sky-500/10 to-fuchsia-500/10">
          <div className="text-4xl">🖥️</div>
          <h2 className="mt-3 text-2xl sm:text-3xl font-bold">Turn this computer into a remote machine</h2>
          <p className="text-slate-400 mt-2 max-w-xl mx-auto">Install ShareHub Desktop once. It runs quietly in the background and gives this PC a Machine ID you can reach from anywhere.</p>
          <div className="mt-6 flex flex-wrap gap-3 justify-center">
            <a href={dl.windows} className={`rounded-xl px-5 py-3 font-semibold transition ${os === 'windows' ? 'bg-sky-500 hover:bg-sky-400 text-white' : 'bg-white/10 hover:bg-white/20 border border-white/10'}`}>⬇ Download for Windows</a>
            <a href={dl.mac} className={`rounded-xl px-5 py-3 font-semibold transition ${os === 'mac' ? 'bg-sky-500 hover:bg-sky-400 text-white' : 'bg-white/10 hover:bg-white/20 border border-white/10'}`}>⬇ Download for macOS</a>
          </div>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-5 sm:px-8 py-10 text-center text-xs text-slate-600">
        <div className="text-slate-400 font-semibold">⚡ ShareHub</div>
        <p className="mt-2">Password-protected rooms · peer-to-peer · nothing stored on disk.</p>
      </footer>
    </div>
  )
}
