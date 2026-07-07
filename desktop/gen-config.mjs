// Reads ../.env and writes ui/config.js so the desktop app knows the backend/frontend.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const env = {}
try {
  const p = path.join(__dirname, '..', '.env')
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* noop */ }
const cfg = { backend: env.BACKEND_URL || 'http://localhost:3000', frontend: env.FRONTEND_URL || 'http://localhost:5173' }
fs.writeFileSync(path.join(__dirname, 'ui', 'config.js'), 'window.__CFG__ = ' + JSON.stringify(cfg) + '\n')
console.log('desktop/ui/config.js ->', cfg)
