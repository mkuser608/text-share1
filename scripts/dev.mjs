// One command to run the backend (Node) + frontend (Vite) together.
// Usage: npm run dev
import { spawn } from 'node:child_process'

const node = process.execPath
const procs = [
  { name: 'backend ', color: '\x1b[36m', cmd: node, args: ['server/index.js'] },
  { name: 'frontend', color: '\x1b[32m', cmd: node, args: ['node_modules/vite/bin/vite.js'] },
]
const RESET = '\x1b[0m'
let shuttingDown = false

const children = procs.map(({ name, color, cmd, args }) => {
  const child = spawn(cmd, args, { env: process.env, stdio: ['inherit', 'pipe', 'pipe'] })
  const prefix = `${color}[${name}]${RESET} `
  const pipe = (stream, out) => {
    let buf = ''
    stream.on('data', (d) => {
      buf += d.toString()
      const lines = buf.split('\n'); buf = lines.pop()
      for (const l of lines) out.write(prefix + l + '\n')
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code) => {
    if (!shuttingDown) { process.stdout.write(prefix + `exited (${code}) — stopping the other.\n`); shutdown() }
  })
  return child
})

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) { try { c.kill() } catch { /* noop */ } }
  setTimeout(() => process.exit(0), 200)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

console.log('ShareHub dev: backend on http://localhost:' + (process.env.PORT || 3000) + ', frontend on http://localhost:5173  (Ctrl+C to stop both)')
