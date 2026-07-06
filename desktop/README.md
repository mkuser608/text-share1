# ShareHub Desktop 🖥️

The small native app (Tauri) that unlocks **full-PC control** for pair
debugging. A browser tab can only control the shared *tab*; this app injects
real OS mouse/keyboard, so a teammate can drive your whole desktop — IDE,
terminal, any app.

It's tiny (~8–12 MB installer), launches from the browser via a `sharehub://`
link (AnyDesk-style), and needs no terminal once installed.

## How it fits together

```
Viewer's browser ──(control events over the ShareHub relay)──► ShareHub Desktop ──► real OS input (enigo)
Host's browser ──(shares ENTIRE screen via WebRTC)──► Viewer sees it
```

Screen sharing stays in the browser (works everywhere); this app only injects
input, so it stays small and has no video/WebRTC code.

## Prerequisites (to BUILD)

- **Node.js 18+** and **Rust** (https://rustup.rs).
- **Windows:** "Desktop development with C++" (Visual Studio Build Tools) + WebView2 (preinstalled on Win 10/11).
- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Linux:** `webkit2gtk`, `libappindicator`, `librsvg`, `patchelf` (see Tauri docs).

## Build locally

```bash
cd desktop
npm install
npm run tauri dev      # run it locally to test
npm run tauri build    # produce the installer
```

Output installers land in `src-tauri/target/release/bundle/`:
- Windows → `nsis/ShareHub Desktop_1.0.0_x64-setup.exe`
- macOS → `dmg/ShareHub Desktop_1.0.0_aarch64.dmg` (or x64)

### Icons (required by the bundler)

Generate icons once from any square PNG:

```bash
cd desktop
npx @tauri-apps/cli icon path/to/logo.png
```

This fills `src-tauri/icons/`. (Until then `npm run tauri build` will complain about missing icons.)

## Serve the installers from the web app

The web server exposes `/download/windows` and `/download/mac`. Drop your built
installers into **`desktop/installers/`** (create it) and the server serves the
newest one automatically:

```bash
mkdir -p desktop/installers
cp "desktop/src-tauri/target/release/bundle/nsis/"*.exe desktop/installers/
cp "desktop/src-tauri/target/release/bundle/dmg/"*.dmg  desktop/installers/
```

Or point the server elsewhere with `DESKTOP_INSTALLERS_DIR=/path`.

## Using it

1. In a room's **Call** tab, click **Enable full control of this PC**.
2. First time: the browser offers a download → install → click again.
3. The app opens, auto-joins the room, shows a green "ready" status.
4. **Share your entire screen** in the browser.
5. Any viewer clicks **🖥️ Take full control** on your screen tile.

Quit the app (or click Disconnect) to cut control instantly. Check
"Ask me before allowing each new controller" for a per-person prompt.

## Signing (avoid "unknown developer" warnings)

Unsigned builds run fine but show warnings (macOS: right-click → Open; Windows:
SmartScreen "More info → Run anyway"). For distribution:

- **macOS:** Apple Developer ID ($99/yr) + notarization (`codesign` + `notarytool`).
- **Windows:** an Authenticode code-signing certificate.

Tauri supports both via `tauri.conf.json` / env vars — see
https://tauri.app/distribute/.

## OS support for control

Windows/macOS/Linux desktops. macOS needs **Accessibility** permission (System
Settings → Privacy & Security → Accessibility) for input injection. Linux full
support is under X11 (Wayland restricts synthetic input). Phones aren't
supported — mobile OSes sandbox input injection.

## Security

- Control needs the host to click **Enable full control** and launch this app —
  it never runs silently.
- The room password gates who can be in the room at all.
- The host sees a live banner and a controller list; closing the app cuts control.
- The `sharehub://` link carries the room password to the app; treat room links
  as sensitive.
