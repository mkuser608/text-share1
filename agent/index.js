#!/usr/bin/env node
/*
 * ShareHub native control agent
 * ------------------------------
 * Runs on the machine you want to be controllable. Joins a ShareHub room and
 * injects real OS mouse/keyboard input received from room peers, so someone in
 * the room can drive your whole desktop (IDE, terminal, browser, anything) for
 * pair programming / debugging.
 *
 * SECURITY: whoever you pair with can fully control this computer. Only run this
 * in rooms with people you trust, and quit (Ctrl+C) to cut control instantly.
 *
 * Usage:
 *   node index.js --server https://your-host --room my-room --password secret
 *   node index.js                     (prompts for anything missing)
 * Flags:
 *   --name  <label>     name shown in the room        (default: "<host> (this PC)")
 *   --approve           ask in the console before each new controller is allowed
 *   --no-keyboard       relay mouse only (ignore keyboard events)
 */

const os = require('os')
const readline = require('readline')
const WebSocket = require('ws')

// ---- nut.js (native input injection) ----
let nut
try {
  nut = require('@nut-tree-fork/nut-js')
} catch (e) {
  console.error('\n[!] Could not load @nut-tree-fork/nut-js. Run "npm install" inside the agent/ folder first.\n')
  process.exit(1)
}
const { mouse, keyboard, Point, Button, Key, screen } = nut
mouse.config.autoDelayMs = 0
keyboard.config.autoDelayMs = 0

// ---------- args ----------
function parseArgs(argv) {
  const a = { flags: new Set() }
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--approve') a.flags.add('approve')
    else if (t === '--no-keyboard') a.flags.add('no-keyboard')
    else if (t.startsWith('--')) { a[t.slice(2)] = argv[++i] }
  }
  return a
}
const args = parseArgs(process.argv)

function ask(q, { hide = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    if (hide) {
      const stdout = process.stdout
      rl._writeToOutput = (s) => { if (s.includes(q)) stdout.write(s); else stdout.write('*') }
    }
    rl.question(q, (ans) => { rl.close(); process.stdout.write('\n'); resolve(ans.trim()) })
  })
}

// ---------- key mapping ----------
const KEYMAP = {
  Enter: Key.Enter, Return: Key.Enter, Backspace: Key.Backspace, Tab: Key.Tab,
  Escape: Key.Escape, Esc: Key.Escape, Delete: Key.Delete, ' ': Key.Space, Spacebar: Key.Space,
  ArrowUp: Key.Up, ArrowDown: Key.Down, ArrowLeft: Key.Left, ArrowRight: Key.Right,
  Home: Key.Home, End: Key.End, PageUp: Key.PageUp, PageDown: Key.PageDown,
  Insert: Key.Insert, CapsLock: Key.CapsLock,
  F1: Key.F1, F2: Key.F2, F3: Key.F3, F4: Key.F4, F5: Key.F5, F6: Key.F6,
  F7: Key.F7, F8: Key.F8, F9: Key.F9, F10: Key.F10, F11: Key.F11, F12: Key.F12,
}
const DIGIT = { '0': Key.Num0, '1': Key.Num1, '2': Key.Num2, '3': Key.Num3, '4': Key.Num4, '5': Key.Num5, '6': Key.Num6, '7': Key.Num7, '8': Key.Num8, '9': Key.Num9 }
function mapKey(k) {
  if (!k) return null
  if (KEYMAP[k]) return KEYMAP[k]
  if (k.length === 1) {
    const lower = k.toLowerCase()
    if (lower >= 'a' && lower <= 'z') return Key[lower.toUpperCase()]
    if (DIGIT[k]) return DIGIT[k]
  }
  return null
}
const btn = (b) => (b === 2 ? Button.RIGHT : b === 1 ? Button.MIDDLE : Button.LEFT)

// ---------- screen size (cached) ----------
let SW = 1920, SH = 1080
async function refreshScreen() {
  try { SW = await screen.width(); SH = await screen.height() } catch { /* keep last */ }
}

// ---------- injection ----------
async function inject(msg) {
  try {
    switch (msg.t) {
      case 'rc-move':
        await mouse.setPosition(new Point(Math.round(msg.x * SW), Math.round(msg.y * SH))); break
      case 'rc-down':
        if (msg.x != null) await mouse.setPosition(new Point(Math.round(msg.x * SW), Math.round(msg.y * SH)))
        await mouse.pressButton(btn(msg.button)); break
      case 'rc-up':
        await mouse.releaseButton(btn(msg.button)); break
      case 'rc-click':
        if (msg.x != null) await mouse.setPosition(new Point(Math.round(msg.x * SW), Math.round(msg.y * SH)))
        await mouse.click(btn(msg.button)); break
      case 'rc-dblclick':
        await mouse.doubleClick(btn(msg.button)); break
      case 'rc-wheel':
        if (msg.dy > 0) await mouse.scrollDown(Math.max(1, Math.round(Math.abs(msg.dy) / 40)))
        else if (msg.dy < 0) await mouse.scrollUp(Math.max(1, Math.round(Math.abs(msg.dy) / 40)))
        break
      case 'rc-text':
        if (!args.flags.has('no-keyboard') && msg.text) await keyboard.type(msg.text)
        break
      case 'rc-combo': {
        if (args.flags.has('no-keyboard')) break
        const main = mapKey(msg.key)
        if (!main) break
        const mods = []
        if (msg.ctrl) mods.push(Key.LeftControl)
        if (msg.shift) mods.push(Key.LeftShift)
        if (msg.alt) mods.push(Key.LeftAlt)
        if (msg.meta) mods.push(process.platform === 'darwin' ? Key.LeftSuper : Key.LeftSuper)
        await keyboard.pressKey(...mods, main)
        await keyboard.releaseKey(...mods, main)
        break
      }
    }
  } catch (e) { /* one bad event shouldn't kill the agent */ }
}

// ---------- main ----------
;(async () => {
  console.log('\n  ShareHub control agent')
  console.log('  ----------------------')
  let server = args.server || process.env.SHAREHUB_SERVER
  if (!server) server = await ask('  Server URL (e.g. https://your-host, or http://localhost:3000): ')
  const room = args.room || await ask('  Room name: ')
  const password = args.password || await ask('  Room password: ', { hide: true })
  const name = args.name || `${os.userInfo().username || 'host'} (this PC)`

  const wsUrl = server.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws'
  const pairCode = String(Math.floor(100000 + Math.random() * 900000))

  await refreshScreen()
  setInterval(refreshScreen, 5000)

  let selfId = null
  let ownerId = null                 // browser that paired with us
  const controllers = new Map()      // peerId -> name (currently allowed)
  const approving = new Set()

  const ws = new WebSocket(wsUrl)
  const sendMsg = (o) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(o))
  const relay = (to, d) => sendMsg({ type: 'relay', to, d })

  ws.on('open', () => sendMsg({ type: 'hello', key: room }))

  ws.on('message', async (raw) => {
    let m; try { m = JSON.parse(raw.toString()) } catch { return }
    switch (m.type) {
      case 'room-status':
        sendMsg({ type: m.exists ? 'join' : 'create', password, name, role: 'agent' })
        break
      case 'error':
        console.error('  [server] ' + (m.message || m.code))
        if (m.code === 'badpass' || m.code === 'gone') process.exit(1)
        break
      case 'joined':
        selfId = m.selfId
        console.log(`\n  Connected to room "${room}" as an agent on ${process.platform} (${SW}x${SH}).`)
        console.log('\n  ┌───────────────────────────────────────────────┐')
        console.log(`  │   PAIR CODE:   ${pairCode}                        │`)
        console.log('  └───────────────────────────────────────────────┘')
        console.log('\n  In the browser, open the room, go to the Call tab,')
        console.log('  click "Link this PC" and enter the code above.')
        console.log('  Then share your ENTIRE screen so others can see it.')
        console.log('\n  Press Ctrl+C to stop and cut all control instantly.\n')
        relay('*', { t: 'agent-here', agentId: selfId })
        break
      case 'peer-joined':
        if (selfId) relay('*', { t: 'agent-here', agentId: selfId, paired: !!ownerId, ownerId })
        break
      case 'relay':
        await onRelay(m.from, m.role, m.d)
        break
    }
  })

  async function allow(from, who) {
    if (controllers.has(from)) return true
    if (args.flags.has('approve')) {
      if (approving.has(from)) return false
      approving.add(from)
      const ans = await ask(`  Allow "${who}" to control this PC? [y/N]: `)
      approving.delete(from)
      if (!/^y/i.test(ans)) { relay(from, { t: 'rc-deny' }); return false }
    }
    controllers.set(from, who)
    console.log(`  [+] ${who} is now controlling this PC.`)
    relay(from, { t: 'rc-grant', agentId: selfId, screen: { w: SW, h: SH } })
    if (ownerId && ownerId !== from) relay(ownerId, { t: 'agent-controlled', by: who })
    return true
  }

  async function onRelay(from, role, d) {
    if (!d || !d.t) return
    if (d.t === 'pair') {
      if (String(d.code) === pairCode) {
        ownerId = from
        console.log('  [✓] Paired with browser. Full control is now available to the room.')
        relay(from, { t: 'agent-paired', agentId: selfId, screen: { w: SW, h: SH }, os: process.platform })
        relay('*', { t: 'agent-ready', agentId: selfId, ownerId })
      } else {
        relay(from, { t: 'pair-bad' })
      }
      return
    }
    if (!ownerId) return // not paired yet — ignore everything else
    if (d.t === 'unpair') { if (from === ownerId) { ownerId = null; controllers.clear(); console.log('  [-] Unpaired; control disabled.') } return }
    if (d.t === 'rc-request') { await allow(from, d.name || 'A peer'); return }
    if (d.t === 'rc-stop') { if (controllers.delete(from)) { console.log('  [-] A controller stopped.'); if (ownerId) relay(ownerId, { t: 'agent-uncontrolled' }) } return }
    if (d.t && d.t.startsWith('rc-')) {
      if (!controllers.has(from)) { if (!(await allow(from, 'A peer'))) return }
      await inject(d)
    }
  }

  ws.on('close', () => { console.log('\n  Disconnected from server. Exiting.'); process.exit(0) })
  ws.on('error', (e) => { console.error('  [ws] ' + e.message) })

  process.on('SIGINT', () => { console.log('\n  Stopped. Control cut.'); try { ws.close() } catch {} process.exit(0) })
})()
