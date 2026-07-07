import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import * as Y from 'yjs'
import bcrypt from 'bcryptjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// minimal .env loader (no dependency) — reads ../.env into process.env
try {
  const envPath = path.join(__dirname, '..', '.env')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
} catch { /* noop */ }

const PORT = process.env.PORT || 3000
const DIST = path.join(__dirname, '..', 'dist')
// Where locally-built desktop installers are dropped (.exe/.msi/.dmg).
const INSTALLERS = process.env.DESKTOP_INSTALLERS_DIR || path.join(__dirname, '..', 'desktop', 'installers')
// If no local installer exists, send users to the GitHub Releases page instead.
const RELEASES_URL = process.env.RELEASES_URL || 'https://github.com/mkuser608/text-share1/releases/latest'
// Persisted (server-stored) shared files live here.
const UPLOADS = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads')
try { fs.mkdirSync(UPLOADS, { recursive: true }) } catch { /* noop */ }
const safe = (s) => String(s || '').replace(/[^\w.-]/g, '').slice(0, 100)

// ---------- HTTP ----------
const app = express()
app.use(express.static(DIST))
app.get('/healthz', (_req, res) => res.json({ ok: true }))

// ---- ShareHub Desktop downloads ----
function findInstaller(exts) {
  try {
    const files = fs.readdirSync(INSTALLERS).filter(f => exts.some(e => f.toLowerCase().endsWith(e)))
    if (!files.length) return null
    files.sort((a, b) => fs.statSync(path.join(INSTALLERS, b)).mtimeMs - fs.statSync(path.join(INSTALLERS, a)).mtimeMs)
    return path.join(INSTALLERS, files[0])
  } catch { return null }
}
const notBuilt = (os) => `ShareHub Desktop for ${os} hasn't been built yet.\nBuild it locally (see desktop/README.md) and drop the installer in ${INSTALLERS}`
app.get('/download/windows', (_req, res) => {
  const f = findInstaller(['.exe', '.msi'])
  if (f) return res.download(f)
  if (RELEASES_URL) return res.redirect(RELEASES_URL)
  res.status(404).type('text').send(notBuilt('Windows'))
})
app.get('/download/mac', (_req, res) => {
  const f = findInstaller(['.dmg'])
  if (f) return res.download(f)
  if (RELEASES_URL) return res.redirect(RELEASES_URL)
  res.status(404).type('text').send(notBuilt('macOS'))
})
app.get('/download', (_req, res) => {
  const hasWin = !!findInstaller(['.exe', '.msi'])
  const hasMac = !!findInstaller(['.dmg'])
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ShareHub Desktop</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#0b0f19;color:#e2e8f0;display:grid;place-items:center;height:100vh}
.card{background:#111827;border:1px solid #1f2937;border-radius:16px;padding:32px;max-width:420px;text-align:center}
a.btn{display:inline-block;margin:8px 6px;padding:12px 18px;border-radius:10px;background:#38bdf8;color:#06283b;font-weight:700;text-decoration:none}
a.off{background:#334155;color:#94a3b8;pointer-events:none}small{color:#94a3b8}</style></head>
<body><div class="card"><div style="font-size:40px">⚡</div><h2>ShareHub Desktop</h2>
<p style="color:#94a3b8">Install once so this computer can be controlled from the website.</p>
<a class="btn ${hasWin ? '' : 'off'}" href="/download/windows">⬇ Windows</a>
<a class="btn ${hasMac ? '' : 'off'}" href="/download/mac">⬇ macOS</a>
<p><small>After installing, open it and click “Go online”, then use its Machine ID + password on the website.</small></p></div></body></html>`)
})

// ---- Persisted file storage (server relay; works without WebRTC/TURN) ----
app.put('/files/:room/:id', express.raw({ type: '*/*', limit: '1024mb' }), (req, res) => {
  const room = safe(req.params.room), id = safe(req.params.id)
  if (!room || !id || !req.body || !req.body.length) return res.status(400).json({ error: 'bad request' })
  try {
    const dir = path.join(UPLOADS, room); fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, id), req.body)
    res.json({ ok: true, url: `/files/${room}/${id}` })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})
app.get('/files/:room/:id', (req, res) => {
  const p = path.join(UPLOADS, safe(req.params.room), safe(req.params.id))
  if (!fs.existsSync(p)) return res.status(404).send('File not found (it may have been removed).')
  const name = req.query.name ? safe(req.query.name) : safe(req.params.id)
  res.download(p, name)
})

// SPA fallback: every room path serves the app.
// Middleware form (no path pattern) works on both Express 4 and 5.
app.use((req, res, next) => {
  if (req.method !== 'GET') return next()
  const index = path.join(DIST, 'index.html')
  if (!fs.existsSync(index)) {
    return res.status(200).type('html').send('<div style="font-family:system-ui;background:#0b0f19;color:#e2e8f0;min-height:100vh;display:grid;place-items:center;text-align:center"><div><h2>⚡ ShareHub — frontend not built yet</h2><p>Run <code>npm run build</code>, then restart with <code>npm start</code>.</p></div></div>')
  }
  res.sendFile(index)
})

const server = http.createServer(app)

// ---------- Rooms (in-memory) ----------
const rooms = new Map()
let nextId = 1
const genId = () => `p${nextId++}_${Math.random().toString(36).slice(2, 8)}`

const send = (ws, obj) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
}
const broadcast = (room, obj, exceptId = null) => {
  for (const [id, c] of room.clients) if (id !== exceptId) send(c.ws, obj)
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  let roomKey = null
  let selfId = null
  let authed = false
  let role = 'human'

  const room = () => rooms.get(roomKey)

  ws.on('message', async (raw) => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    try {
      switch (msg.type) {
        case 'hello': {
          roomKey = String(msg.key || '').slice(0, 64)
          if (!roomKey) return send(ws, { type: 'error', message: 'Invalid room key' })
          send(ws, { type: 'room-status', exists: rooms.has(roomKey) })
          break
        }

        case 'create': {
          if (!roomKey) return
          if (rooms.has(roomKey)) return send(ws, { type: 'error', code: 'exists', message: 'Room already exists — join with its password' })
          if (!msg.password || msg.password.length < 1) return send(ws, { type: 'error', message: 'Password required' })
          const passwordHash = await bcrypt.hash(String(msg.password), 10)
          rooms.set(roomKey, { passwordHash, ydoc: new Y.Doc(), clients: new Map(), files: new Map() })
          joinRoom(msg.name, msg.role)
          break
        }

        case 'join': {
          const r = room()
          if (!r) return send(ws, { type: 'error', code: 'gone', message: 'Room does not exist' })
          const ok = await bcrypt.compare(String(msg.password || ''), r.passwordHash)
          if (!ok) return send(ws, { type: 'error', code: 'badpass', message: 'Wrong password' })
          joinRoom(msg.name, msg.role)
          break
        }

        case 'yupdate': {
          const r = room(); if (!authed || !r) return
          Y.applyUpdate(r.ydoc, Buffer.from(msg.u, 'base64'))
          broadcast(r, { type: 'yupdate', u: msg.u }, selfId)
          break
        }

        case 'awareness': {
          const r = room(); if (!authed || !r) return
          broadcast(r, { type: 'awareness', d: msg.d }, selfId)
          break
        }

        // WebRTC signaling relay (targeted)
        case 'signal': {
          const r = room(); if (!authed || !r) return
          const target = r.clients.get(msg.to)
          if (target) send(target.ws, { type: 'signal', from: selfId, d: msg.d })
          break
        }

        // Generic app relay: targeted (msg.to = peerId) or broadcast (msg.to = '*').
        case 'relay': {
          const r = room(); if (!authed || !r) return
          const payload = { type: 'relay', from: selfId, role, d: msg.d }
          if (msg.to == null || msg.to === '*') broadcast(r, payload, selfId)
          else { const t = r.clients.get(msg.to); if (t) send(t.ws, payload) }
          break
        }

        case 'file-offer': {
          const r = room(); if (!authed || !r) return
          const f = {
            id: String(msg.id), name: String(msg.name).slice(0, 255),
            size: Number(msg.size) || 0, mime: String(msg.mime || ''),
            owner: selfId, ownerName: r.clients.get(selfId)?.name || '?',
            persisted: !!msg.persisted, url: msg.url ? String(msg.url).slice(0, 300) : null,
            at: Date.now()
          }
          r.files.set(f.id, f)
          broadcast(r, { type: 'file-offer', file: f })
          break
        }

        case 'file-revoke': {
          const r = room(); if (!authed || !r) return
          const f = r.files.get(msg.id)
          if (f && f.owner === selfId) {
            r.files.delete(msg.id)
            broadcast(r, { type: 'file-revoke', id: msg.id })
          }
          break
        }
      }
    } catch (e) {
      console.error('ws error:', e)
      send(ws, { type: 'error', message: 'Server error' })
    }
  })

  function joinRoom(name, wantRole) {
    const r = room()
    selfId = genId()
    authed = true
    role = wantRole === 'agent' ? 'agent' : 'human'
    const cleanName = String(name || 'Guest').slice(0, 32)
    r.clients.set(selfId, { ws, name: cleanName, role })
    send(ws, {
      type: 'joined',
      selfId,
      role,
      peers: [...r.clients.entries()].filter(([id]) => id !== selfId).map(([id, c]) => ({ id, name: c.name, role: c.role })),
      files: [...r.files.values()],
      doc: Buffer.from(Y.encodeStateAsUpdate(r.ydoc)).toString('base64')
    })
    broadcast(r, { type: 'peer-joined', id: selfId, name: cleanName, role }, selfId)
  }

  ws.on('close', () => {
    const r = room()
    if (!r || !selfId) return
    r.clients.delete(selfId)
    broadcast(r, { type: 'peer-left', id: selfId })
    // P2P (non-persisted) offers die with their owner; persisted files stay.
    for (const [fid, f] of r.files) {
      if (f.owner === selfId && !f.persisted) {
        r.files.delete(fid)
        broadcast(r, { type: 'file-revoke', id: fid })
      }
    }
    // NOTE: the room (editor text + persisted files) is kept in memory so it
    // survives everyone leaving. It only clears on a server restart.
  })
})

server.listen(PORT, () => {
  const hasDist = fs.existsSync(path.join(DIST, 'index.html'))
  console.log(`ShareHub running on http://localhost:${PORT}`)
  console.log(hasDist
    ? '  serving frontend (dist/) + backend (WebSocket) on this one server'
    : '  frontend not built yet — run `npm run build`, then `npm start` again')
})
