# ⚡ ShareHub

Private, real-time collaboration rooms — no accounts, nothing stored on disk.
Edit together, drop huge files peer-to-peer, jump on a call, share your screen,
and even hand over control of a shared tab. Built mobile-first.

## Features

- **Live collaborative editor** — CodeMirror 6 + Yjs CRDT, live cursors,
  per-room language switching (Markdown, JS/TS, Python, HTML, CSS, JSON, plain).
- **Peer-to-peer file sharing** — any size. Bytes stream device-to-device over
  a WebRTC DataChannel (chunked, backpressure-aware). The server only ever sees
  file *metadata*, never the file.
- **Voice & video calls** — WebRTC mesh with everyone in the room; mute/camera
  toggles; upgrade an audio call to video on the fly.
- **Screen sharing** — present a tab, window, or your whole screen.
- **Remote control** — a viewer can request control of a shared screen; the
  sharer approves. Pointer/keyboard events are forwarded over the DataChannel.
  *Browser limit: control applies to the shared browser tab, not the whole OS.*
- **Password-protected rooms** — bcrypt-hashed, kept in memory. Rooms vanish
  when the last person leaves.
- **Mobile-optimized** — dark UI, bottom tab navigation, touch-friendly
  controls, responsive video grid, safe-area aware.

## Architecture

```
Browser (React + Vite build, Tailwind, CodeMirror)
   │  WebSocket ──► Node server (single process)
   │                ├─ serves the built static app
   │                ├─ rooms + bcrypt passwords (in-memory)
   │                ├─ Yjs document sync relay (editor)
   │                └─ WebRTC signaling relay only
   └─ WebRTC (direct, peer-to-peer)
        ├─ large files (DataChannel, chunked — never touches the server)
        ├─ audio / video calls (mesh)
        └─ screen share + remote-control events
```

### Why Vite + a plain Node server (not Next.js)

The app is one real-time screen behind a password — the opposite of what SSR/SEO
frameworks optimize for. It needs a long-lived WebSocket process anyway (Yjs sync
+ WebRTC signaling), so a single Node process that serves the built static app and
handles WebSockets is simpler, smaller, and deploys as one `npm start`.

## Getting started

```bash
npm install        # install dependencies
npm run dev        # Vite dev server (proxies /ws to the Node server on :3000)
# in a second terminal:
npm start          # Node server (WebSocket signaling + Yjs relay) on :3000
```

Production:

```bash
npm run build      # bundles the app into dist/
npm start          # serves dist/ + WebSocket on PORT (default 3000)
```

Open `http://localhost:3000`, pick a room name, set a password to create it (or
enter the password to join). Share the link + password with others.

## Configuration

- `PORT` — HTTP/WebSocket port (default `3000`).
- **TURN server (recommended for production):** WebRTC uses public Google STUN
  by default, which is enough for most networks. Peers behind strict/corporate
  NATs may fail to connect without a TURN relay. Add your TURN credentials in
  `src/lib/peers.js` → `RTC_CONFIG.iceServers`.

## Notes & limits

- Rooms and documents live **in memory** — restarting the server clears them.
- File transfers are peer-to-peer: the **sharer must stay in the room** while
  others download.
- Remote control works on the **shared browser tab** only (a web page can inject
  input into itself, not the OS). Full-desktop control would need a native app.

## Project layout

```
server/index.js         Node: static hosting, room auth, Yjs relay, WebRTC signaling
index.html              app entry
src/main.jsx            React bootstrap
src/App.jsx             room-key router (path = room)
src/lib/connection.js   WebSocket client + auto-reconnect
src/lib/peers.js        WebRTC mesh (perfect-negotiation), ctl DataChannel
src/lib/fileshare.js    chunked P2P file transfer
src/lib/remotecontrol.js remote pointer/keyboard capture + replay
src/lib/util.js         helpers (base64, sizes, colors)
src/components/         Landing, Room (gate), RoomShell, EditorPane, FilesPane, CallPane
```

## Full-PC control for pair debugging 🖥️

Browser remote-control only reaches the shared **tab**. For true full-desktop
control (IDE, terminal, any app), the host installs **ShareHub Desktop** — a
tiny native app (Tauri, ~8–12 MB) that injects real OS input. It launches
straight from the browser, AnyDesk-style:

1. Host: in a room's **Call** tab → **Enable full control of this PC**.
2. First time only, the browser offers a one-click **download** (Windows/macOS);
   after installing, it opens automatically via a `sharehub://` link.
3. Host **shares their entire screen**; any viewer clicks **🖥️ Take full
   control** on that screen tile and drives the host's real mouse/keyboard.

Closing the app cuts control instantly. Build it locally and wire up the
download buttons per [`desktop/README.md`](desktop/README.md). The server serves
installers from `desktop/installers/` via `/download/windows` and
`/download/mac`.
