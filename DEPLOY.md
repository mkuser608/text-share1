# Deploying ShareHub

Three pieces: the **backend** (WebSocket + API), the **frontend** (the website), and
the **desktop app** installers. Domains used below:

- Frontend: `https://text.ipoup.in`
- Backend/API: `https://api.text.ipoup.in`

## 1. Backend (api.text.ipoup.in)

The backend is a single Node process (WebSocket signaling + Yjs relay + downloads).

```bash
npm install
PORT=3000 npm start        # or use the .env file
```

Put it behind a reverse proxy (Nginx/Caddy) with TLS on `api.text.ipoup.in`, and
make sure **WebSocket upgrades** are proxied (path `/ws`). Example Nginx:

```nginx
server {
  server_name api.text.ipoup.in;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

Keep it running with pm2 / systemd. Rooms are in-memory, so a restart drops them.

## 2. Frontend (text.ipoup.in)

Build the static site with the backend URL baked in, then host `dist/` on any
static host (or let the Node server serve it).

```bash
# .env (used by the Vite build)
# VITE_BACKEND_URL=https://api.text.ipoup.in
npm run build      # outputs dist/
```

Host `dist/` on `text.ipoup.in`. If you serve the frontend from the same Node
server (`npm start` serves `dist/`), you can leave `VITE_BACKEND_URL` blank and put
everything on one domain instead.

> The browser opens `wss://api.text.ipoup.in/ws`, so the backend must be HTTPS.

### TURN (important for cross-network remote control)

For control between different networks, set a TURN server in `.env`
(`VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`) and rebuild the
frontend. Without it, connections between different networks often fail.

## 3. Desktop app installers (GitHub Release)

A GitHub Actions workflow (`.github/workflows/desktop-release.yml`) builds the
Windows `.exe` and macOS `.dmg` on GitHub's runners, with the production URLs
baked in, and publishes them to a Release.

**To cut a release:**

```bash
git tag v1.0.0
git push origin v1.0.0
```

Actions builds both installers and attaches them to the `v1.0.0` Release. (Or run
the workflow manually from the Actions tab to get build artifacts without a
release.)

**Serving the installers from the website's Download buttons:** download the
built `.exe`/`.dmg` from the Release and drop them into `desktop/installers/` on
the backend host (or point `DESKTOP_INSTALLERS_DIR` at wherever they live). The
`/download/windows` and `/download/mac` routes then serve them.

### Code signing (optional but recommended)

Unsigned installers show "unknown developer" warnings. To sign, add secrets and
the matching env to the workflow:

- macOS: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` (notarization).
- Windows: a code-signing certificate via `tauri-action`'s Windows signing inputs.

See https://tauri.app/distribute/ for the exact variable names.
