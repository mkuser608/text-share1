import React, { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { b64ToU8, u8ToB64, colorFor } from '../lib/util'
import { PeerManager } from '../lib/peers'
import { FileShare } from '../lib/fileshare'
import { buildDeepLink, launchDesktop, downloadUrls, detectOS, randomToken } from '../lib/desktop'
import EditorPane from './EditorPane'
import FilesPane from './FilesPane'
import CallPane from './CallPane'
import RemotePane from './RemotePane'

const TABS = [
  ['editor', '📝', 'Editor'],
  ['files', '📁', 'Files'],
  ['call', '🎥', 'Call'],
  ['remote', '🖥️', 'Remote'],
]

export default function RoomShell({ conn, joined, roomKey, initialTab }) {
  const [ctx] = useState(() => {
    const ydoc = new Y.Doc()
    const awareness = new Awareness(ydoc)
    const pm = new PeerManager(conn)
    const fs = new FileShare(pm, conn)
    return { ydoc, awareness, pm, fs }
  })
  const { ydoc, awareness, pm, fs } = ctx

  const [tab, setTab] = useState(initialTab || 'editor')
  const [peers, setPeers] = useState(() => joined.peers.filter(p => p.role !== 'agent'))
  const [files, setFiles] = useState(joined.files)
  const [copied, setCopied] = useState(false)
  const [agents, setAgents] = useState({})
  const [myAgentId, setMyAgentId] = useState(null)
  const [ownCreds, setOwnCreds] = useState(null)   // { id, pw } from our own desktop app
  const [chat, setChat] = useState([])
  const [timeline, setTimeline] = useState([])
  const pendingToken = useRef(null)
  const myAgentRef = useRef(null); myAgentRef.current = myAgentId
  const nameById = useRef({})
  const myName = conn.creds?.name || 'Me'

  const pushTimeline = (name, kind) => setTimeline(t => [...t.slice(-80), { name, kind, at: Date.now() }])

  useEffect(() => {
    Y.applyUpdate(ydoc, b64ToU8(joined.doc), 'remote')
    joined.peers.forEach(p => { if (p.role !== 'agent') nameById.current[p.id] = p.name })

    const onUpdate = (u, origin) => { if (origin !== 'remote') conn.send({ type: 'yupdate', u: u8ToB64(u) }) }
    ydoc.on('update', onUpdate)
    const color = colorFor(conn.selfId || myName)
    awareness.setLocalStateField('user', { name: myName, color, colorLight: color + '55' })
    const onAwareness = ({ added, updated, removed }, origin) => {
      if (origin === 'remote') return
      const changed = added.concat(updated).concat(removed)
      if (changed.length) conn.send({ type: 'awareness', d: u8ToB64(encodeAwarenessUpdate(awareness, changed)) })
    }
    awareness.on('update', onAwareness)

    joined.peers.forEach(p => { if (p.role !== 'agent') pm.addPeer(p.id, p.name) })

    const offs = [
      conn.on('yupdate', (m) => Y.applyUpdate(ydoc, b64ToU8(m.u), 'remote')),
      conn.on('awareness', (m) => applyAwarenessUpdate(awareness, b64ToU8(m.d), 'remote')),
      conn.on('peer-joined', (m) => {
        if (m.role === 'agent') return
        nameById.current[m.id] = m.name
        pm.addPeer(m.id, m.name)
        setPeers(ps => [...ps.filter(p => p.id !== m.id), { id: m.id, name: m.name }])
        pushTimeline(m.name, 'joined')
        if (myAgentRef.current) conn.send({ type: 'relay', to: '*', d: { t: 'agent-bind', agentId: myAgentRef.current, ownerId: conn.selfId } })
      }),
      conn.on('peer-left', (m) => {
        const nm = nameById.current[m.id]; if (nm) pushTimeline(nm, 'left')
        pm.removePeer(m.id)
        setPeers(ps => ps.filter(p => p.id !== m.id))
        setAgents(a => { const n = { ...a }; for (const k of Object.keys(n)) if (n[k] === m.id || k === m.id) delete n[k]; return n })
        setMyAgentId(id => (id === m.id ? null : id))
      }),
      conn.on('file-offer', (m) => setFiles(f => [...f.filter(x => x.id !== m.file.id), m.file])),
      conn.on('file-revoke', (m) => setFiles(f => f.filter(x => x.id !== m.id))),
      conn.on('relay', (m) => {
        const d = m.d || {}
        switch (d.t) {
          case 'agent-ready':
            if (d.token && d.token === pendingToken.current) {
              setMyAgentId(d.agentId)
              conn.send({ type: 'relay', to: d.agentId, d: { t: 'agent-owner', ownerId: conn.selfId } })
              conn.send({ type: 'relay', to: '*', d: { t: 'agent-bind', agentId: d.agentId, ownerId: conn.selfId } })
            }
            break
          case 'agent-bind': setAgents(a => ({ ...a, [d.ownerId]: d.agentId })); break
          case 'chat': setChat(c => [...c.slice(-200), { id: d.id, name: d.name, text: d.text, at: d.at }]); break
        }
      }),
      // owner creds arrive over the P2P data channel from our own desktop app
      pm.on('dc-open', (id) => { if (id === myAgentRef.current && pendingToken.current) pm.sendCtl(id, { t: 'claim-owner', token: pendingToken.current }) }),
      pm.on('ctl-json', (id, m) => { if (id === myAgentRef.current && m.t === 'creds') setOwnCreds({ id: m.id, pw: m.pw }) }),
    ]
    return () => {
      offs.forEach(o => o()); ydoc.off('update', onUpdate); awareness.off('update', onAwareness); pm.destroy(); ydoc.destroy()
    }
  }, [])

  // when our agent connects, claim ownership to receive our creds
  useEffect(() => {
    if (myAgentId && pendingToken.current) pm.sendCtl(myAgentId, { t: 'claim-owner', token: pendingToken.current })
  }, [myAgentId])

  const copyLink = async () => { try { await navigator.clipboard.writeText(location.href) } catch {} setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const sendChat = (text) => {
    text = String(text || '').trim(); if (!text) return
    const msg = { id: randomToken(), name: myName, text, at: Date.now() }
    setChat(c => [...c.slice(-200), msg])
    conn.send({ type: 'relay', to: '*', d: { t: 'chat', ...msg } })
  }

  const agentApi = {
    agents, myAgentId, os: detectOS(), downloads: downloadUrls(),
    enableFullControl: () => {
      const token = randomToken(); pendingToken.current = token
      const link = buildDeepLink({ server: location.origin, room: roomKey, password: conn.creds?.password || '', token, name: myName })
      launchDesktop(link); return { link, token }
    },
    unlink: () => { if (myAgentId) conn.send({ type: 'relay', to: myAgentId, d: { t: 'unpair' } }); setMyAgentId(null); setOwnCreds(null) },
    sendToAgent: (agentId, d) => conn.send({ type: 'relay', to: agentId, d }),
  }

  const everyone = [{ id: conn.selfId, name: myName + ' (you)' }, ...peers.filter(p => !agents[p.id])]

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-2 px-3 sm:px-4 h-14 border-b border-slate-800 bg-slate-900/60 backdrop-blur shrink-0">
        <a href="/" className="text-lg font-extrabold bg-gradient-to-r from-sky-400 to-fuchsia-400 bg-clip-text text-transparent shrink-0">⚡</a>
        <div className="font-semibold truncate">{roomKey}</div>
        <button onClick={copyLink} className="text-xs rounded-md border border-slate-700 hover:border-sky-500 text-slate-300 px-2 py-1 transition shrink-0">{copied ? '✓ copied' : 'copy link'}</button>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="hidden sm:flex -space-x-1.5">
            {everyone.slice(0, 5).map(p => (
              <div key={p.id} title={p.name} className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold text-slate-900 ring-2 ring-slate-900" style={{ background: colorFor(p.id || p.name) }}>{p.name.trim()[0]?.toUpperCase()}</div>
            ))}
          </div>
          <span className="text-xs text-slate-400">{everyone.length} online</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="connected" />
        </div>
      </header>

      <nav className="hidden sm:flex gap-1 px-4 pt-2 border-b border-slate-800 bg-slate-900/40 shrink-0">
        {TABS.map(([id, icon, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 rounded-t-lg text-sm font-medium transition border-b-2 ${tab === id ? 'border-sky-400 text-sky-300 bg-slate-800/60' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {icon} {label}{id === 'files' && files.length > 0 && <span className="ml-1.5 text-xs bg-sky-500/20 text-sky-300 rounded-full px-1.5">{files.length}</span>}
          </button>
        ))}
      </nav>

      <main className="flex-1 min-h-0 relative">
        <div className={tab === 'editor' ? 'h-full' : 'hidden'}><EditorPane ydoc={ydoc} awareness={awareness} /></div>
        <div className={tab === 'files' ? 'h-full' : 'hidden'}><FilesPane files={files} fs={fs} selfId={conn.selfId} peerCount={peers.length} roomKey={roomKey} /></div>
        <div className={tab === 'call' ? 'h-full' : 'hidden'}><CallPane pm={pm} peers={peers} myName={myName} selfId={conn.selfId} chat={chat} sendChat={sendChat} timeline={timeline} agents={agents} /></div>
        <div className={tab === 'remote' ? 'h-full' : 'hidden'}><RemotePane pm={pm} peers={peers} myName={myName} selfId={conn.selfId} agentApi={agentApi} ownCreds={ownCreds} /></div>
      </main>

      <nav className="sm:hidden flex border-t border-slate-800 bg-slate-900/90 backdrop-blur pb-safe shrink-0">
        {TABS.map(([id, icon, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[11px] font-medium transition ${tab === id ? 'text-sky-400' : 'text-slate-500'}`}>
            <span className="text-xl leading-none">{icon}</span>{label}
          </button>
        ))}
      </nav>
    </div>
  )
}
