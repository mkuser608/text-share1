# ShareHub Control Agent 🖥️

A tiny program you run **on the machine you want to be controllable**. It joins a
ShareHub room and injects real operating-system mouse & keyboard input received
from people in the room — so a teammate can drive your **whole desktop** (IDE,
terminal, browser, anything) for pair programming and live debugging.

The browser alone can only control the shared browser *tab* — a hard security
limit of the web. This agent is what unlocks true full-PC control.

## ⚠️ Security — read this

Whoever you pair with can **fully control this computer** while the agent runs.

- Only run it in a **password-protected room** with people you trust.
- Pairing requires a **one-time 6-digit code** shown in this window — nobody can
  control your machine until you share that code and it's entered in the browser.
- A red banner shows in the browser whenever someone is controlling you.
- **Quit the agent (Ctrl+C) to cut all control instantly.**
- Use `--approve` to be asked in this window before each new person is allowed.

## Install

Requires Node.js 18+. From this `agent/` folder:

```bash
npm install
```

`@nut-tree-fork/nut-js` ships prebuilt binaries for common platforms. If install
fails to build, you may need OS build tools (Xcode CLT on macOS, build-essential
on Linux, windows-build-tools on Windows).

## Run

```bash
node index.js --server https://YOUR-SHAREHUB-HOST --room my-room --password secret
```

Or just `node index.js` and it will prompt for the server, room, and password.

Then:

1. The agent prints a **6-digit pair code**.
2. In the browser, open the same room → **Call** tab → **Link this PC** → enter the code.
3. **Share your entire screen** in the browser (choose "Entire Screen").
4. Anyone in the room now sees **"🖥️ Take full control"** on your screen tile.

Flags:

| Flag | Effect |
|------|--------|
| `--name "Label"` | Name shown in the room (default: your username + "(this PC)") |
| `--approve` | Ask in this window before each new controller is allowed |
| `--no-keyboard` | Relay mouse only; ignore keyboard events |

Env: `SHAREHUB_SERVER` can replace `--server`.

## OS notes

- **Windows** — works out of the box.
- **macOS** — grant your terminal app **Accessibility** *and* **Screen Recording**
  permission (System Settings → Privacy & Security). Input injection is blocked
  without Accessibility.
- **Linux** — works under **X11**. **Wayland** restricts synthetic input; run an
  Xorg session or use XWayland for full support.
- **Android / iOS** — not supported. Mobile OSes sandbox input injection; remote
  control of a phone needs a dedicated accessibility-service app or ADB/root,
  which is a separate project. You can still *view* a phone's shared screen.

## How it works

Control events travel: **viewer's browser → ShareHub server (relay) → this agent
→ OS input** (via nut.js). The screen itself is shared peer-to-peer by your
browser (WebRTC). The agent never handles video; it only injects input, so it
needs no WebRTC stack. Coordinates are sent normalized (0..1) against your shared
screen and scaled to your real resolution here.
