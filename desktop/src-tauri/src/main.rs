// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use enigo::{
    Axis, Button, Coordinate,
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Mouse, Settings,
};
use serde::Deserialize;
use tauri::{Emitter, Manager, State};

/// A single remote-control event coming from a viewer (via the webview).
#[derive(Deserialize)]
struct Ev {
    t: String,
    #[serde(default)] x: Option<f64>,
    #[serde(default)] y: Option<f64>,
    #[serde(default)] button: Option<i64>,
    #[serde(default)] dy: Option<f64>,
    #[serde(default)] text: Option<String>,
    #[serde(default)] key: Option<String>,
    #[serde(default)] ctrl: bool,
    #[serde(default)] shift: bool,
    #[serde(default)] alt: bool,
    #[serde(default)] meta: bool,
}

struct AppState {
    enigo: Mutex<Enigo>,
    pending: Mutex<Option<String>>,
    creds: Mutex<(String, String)>,
}

fn btn(b: Option<i64>) -> Button {
    match b {
        Some(2) => Button::Right,
        Some(1) => Button::Middle,
        _ => Button::Left,
    }
}

fn map_key(k: &str) -> Option<Key> {
    Some(match k {
        "Enter" | "Return" => Key::Return,
        "Backspace" => Key::Backspace,
        "Tab" => Key::Tab,
        "Escape" | "Esc" => Key::Escape,
        "Delete" => Key::Delete,
        "ArrowUp" => Key::UpArrow,
        "ArrowDown" => Key::DownArrow,
        "ArrowLeft" => Key::LeftArrow,
        "ArrowRight" => Key::RightArrow,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        " " | "Spacebar" | "Space" => Key::Space,
        "F1" => Key::F1, "F2" => Key::F2, "F3" => Key::F3, "F4" => Key::F4,
        "F5" => Key::F5, "F6" => Key::F6, "F7" => Key::F7, "F8" => Key::F8,
        "F9" => Key::F9, "F10" => Key::F10, "F11" => Key::F11, "F12" => Key::F12,
        _ => return None,
    })
}

/// Inject one control event into the real OS input stream.
#[tauri::command]
fn inject(state: State<AppState>, ev: Ev) -> Result<(), String> {
    let mut enigo = state.enigo.lock().map_err(|e| e.to_string())?;
    let (w, h) = enigo.main_display().map_err(|e| e.to_string())?;
    let abs = |x: f64, y: f64| ((x * w as f64) as i32, (y * h as f64) as i32);

    match ev.t.as_str() {
        "rc-move" => {
            if let (Some(x), Some(y)) = (ev.x, ev.y) {
                let (px, py) = abs(x, y);
                enigo.move_mouse(px, py, Coordinate::Abs).map_err(|e| e.to_string())?;
            }
        }
        "rc-down" => {
            if let (Some(x), Some(y)) = (ev.x, ev.y) {
                let (px, py) = abs(x, y);
                let _ = enigo.move_mouse(px, py, Coordinate::Abs);
            }
            enigo.button(btn(ev.button), Press).map_err(|e| e.to_string())?;
        }
        "rc-up" => {
            enigo.button(btn(ev.button), Release).map_err(|e| e.to_string())?;
        }
        "rc-click" => {
            if let (Some(x), Some(y)) = (ev.x, ev.y) {
                let (px, py) = abs(x, y);
                let _ = enigo.move_mouse(px, py, Coordinate::Abs);
            }
            enigo.button(btn(ev.button), Click).map_err(|e| e.to_string())?;
        }
        "rc-dblclick" => {
            let _ = enigo.button(btn(ev.button), Click);
            enigo.button(btn(ev.button), Click).map_err(|e| e.to_string())?;
        }
        "rc-wheel" => {
            if let Some(dy) = ev.dy {
                let steps = ((dy.abs() / 40.0).max(1.0)) as i32;
                let n = if dy > 0.0 { steps } else { -steps };
                enigo.scroll(n, Axis::Vertical).map_err(|e| e.to_string())?;
            }
        }
        "rc-text" => {
            if let Some(t) = ev.text {
                enigo.text(&t).map_err(|e| e.to_string())?;
            }
        }
        "rc-combo" => {
            let key = ev
                .key
                .as_deref()
                .and_then(map_key)
                .or_else(|| ev.key.as_deref().and_then(|s| s.chars().next()).map(Key::Unicode));
            if let Some(k) = key {
                if ev.ctrl { let _ = enigo.key(Key::Control, Press); }
                if ev.shift { let _ = enigo.key(Key::Shift, Press); }
                if ev.alt { let _ = enigo.key(Key::Alt, Press); }
                if ev.meta { let _ = enigo.key(Key::Meta, Press); }
                let _ = enigo.key(k, Click);
                if ev.meta { let _ = enigo.key(Key::Meta, Release); }
                if ev.alt { let _ = enigo.key(Key::Alt, Release); }
                if ev.shift { let _ = enigo.key(Key::Shift, Release); }
                if ev.ctrl { let _ = enigo.key(Key::Control, Release); }
            }
        }
        _ => {}
    }
    Ok(())
}

/// Returns and clears the last sharehub:// launch URL (cold-start safe).
#[tauri::command]
fn take_pending_url(state: State<AppState>) -> Option<String> {
    state.pending.lock().ok().and_then(|mut p| p.take())
}

/// Open a URL in the user's default browser (no extra plugin needed).
#[tauri::command]
fn open_url(url: String) {
    #[cfg(target_os = "windows")]
    { let _ = std::process::Command::new("cmd").args(["/C", "start", "", &url]).spawn(); }
    #[cfg(target_os = "macos")]
    { let _ = std::process::Command::new("open").arg(&url).spawn(); }
    #[cfg(target_os = "linux")]
    { let _ = std::process::Command::new("xdg-open").arg(&url).spawn(); }
}

/// Capture the primary screen as a base64 JPEG (downscaled). Native — no picker.
#[tauri::command]
fn capture_frame() -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors.into_iter().next().ok_or_else(|| "no monitor".to_string())?;
    let cap = monitor.capture_image().map_err(|e| e.to_string())?;
    let (w, h) = (cap.width(), cap.height());
    let raw: Vec<u8> = cap.into_raw();
    let buf = image::RgbaImage::from_raw(w, h, raw).ok_or_else(|| "bad frame".to_string())?;
    let dynimg = image::DynamicImage::ImageRgba8(buf);
    let target = 1600u32;
    let scaled = if w > target { dynimg.resize(target, u32::MAX / 2, image::imageops::FilterType::Triangle) } else { dynimg };
    let rgb = image::DynamicImage::ImageRgb8(scaled.to_rgb8());
    let mut cur = std::io::Cursor::new(Vec::<u8>::new());
    rgb.write_to(&mut cur, image::ImageFormat::Jpeg).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(cur.get_ref()))
}

fn config_dir() -> std::path::PathBuf {
    let base = std::env::var("APPDATA").ok()
        .or_else(|| std::env::var("XDG_CONFIG_HOME").ok())
        .or_else(|| std::env::var("HOME").ok().map(|h| format!("{}/.config", h)))
        .unwrap_or_else(|| ".".to_string());
    let dir = std::path::PathBuf::from(base).join("ShareHub");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn rand_u64() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut x = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0x9e3779b9)
        ^ (std::process::id() as u64).wrapping_mul(0x9e3779b97f4a7c15);
    x ^= x << 13; x ^= x >> 7; x ^= x << 17; x
}

/// Persistent per-machine credentials: a 9-digit id + short password.
fn load_or_create_creds() -> (String, String) {
    let p = config_dir().join("creds.json");
    if let Ok(s) = std::fs::read_to_string(&p) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
            if let (Some(id), Some(pw)) = (v.get("id").and_then(|x| x.as_str()), v.get("pw").and_then(|x| x.as_str())) {
                if id.len() == 9 { return (id.to_string(), pw.to_string()); }
            }
        }
    }
    let mut r = rand_u64();
    let mut id = String::new();
    for _ in 0..9 {
        r = r.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let d = ((r >> 33) % 10) as u8;
        id.push((b'0' + d) as char);
    }
    let pw = format!("{:08x}", rand_u64() as u32);
    let _ = std::fs::write(&p, serde_json::json!({"id": id, "pw": pw}).to_string());
    (id, pw)
}

/// Serve the machine creds on localhost so the website can read them directly.
fn start_creds_server(id: String, pw: String) {
    std::thread::spawn(move || {
        let listener = match std::net::TcpListener::bind("127.0.0.1:47615") {
            Ok(l) => l,
            Err(_) => return,
        };
        let body = format!("{{\"id\":\"{}\",\"pw\":\"{}\"}}", id, pw);
        let resp = format!(
            "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(), body
        );
        for stream in listener.incoming() {
            if let Ok(mut s) = stream {
                use std::io::{Read, Write};
                let mut buf = [0u8; 512];
                let _ = s.read(&mut buf);
                let _ = s.write_all(resp.as_bytes());
            }
        }
    });
}

#[tauri::command]
fn machine_creds(state: State<AppState>) -> serde_json::Value {
    let c = state.creds.lock().map(|g| g.clone()).unwrap_or_default();
    serde_json::json!({ "id": c.0, "pw": c.1 })
}

fn deliver(app: &tauri::AppHandle, url: &str) {
    if !url.starts_with("sharehub://") {
        return;
    }
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut p) = state.pending.lock() {
            *p = Some(url.to_string());
        }
    }
    let _ = app.emit("deep-link", url.to_string());
}

fn main() {
    // Keep the (hidden) webview running at full speed for capture/hosting in the background.
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows",
    );

    let enigo = Enigo::new(&Settings::default()).expect("failed to init input backend");

    tauri::Builder::default()
        // single-instance MUST be registered first; forwards deep links to the running app
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for a in &argv {
                if a.starts_with("sharehub://") {
                    deliver(app, a);
                }
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Don't quit — hide to the tray and keep hosting in the background.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .manage(AppState {
            enigo: Mutex::new(enigo),
            pending: Mutex::new(None),
            creds: Mutex::new((String::new(), String::new())),
        })
        .invoke_handler(tauri::generate_handler![inject, take_pending_url, open_url, capture_frame, machine_creds])
        .setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;

            // Register the scheme at runtime (needed on Windows/Linux dev).
            #[cfg(any(windows, target_os = "linux"))]
            {
                let _ = app.deep_link().register("sharehub");
            }

            // Deliver the launch URL (cold start) to the webview.
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                if let Some(u) = urls.first() {
                    deliver(&app.handle(), u.as_str());
                }
            }

            // Deliver any later URLs (app already running).
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for u in event.urls() {
                    deliver(&handle, u.as_str());
                }
            });

            // system tray so the app can live in the background
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::TrayIconBuilder;
                let show = MenuItem::with_id(app, "show", "Open ShareHub", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &quit])?;
                let mut builder = TrayIconBuilder::new().menu(&menu).tooltip("ShareHub Desktop");
                if let Some(icon) = app.default_window_icon() {
                    builder = builder.icon(icon.clone());
                }
                builder
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "quit" => app.exit(0),
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        _ => {}
                    })
                    .build(app)?;
            }

            // launch on login so it's always available without reopening
            {
                use tauri_plugin_autostart::ManagerExt;
                let _ = app.autolaunch().enable();
            }

            // persistent machine creds + localhost endpoint the website can read
            {
                let (cid, cpw) = load_or_create_creds();
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut g) = state.creds.lock() { *g = (cid.clone(), cpw.clone()); }
                }
                start_creds_server(cid, cpw);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ShareHub Desktop");
}
