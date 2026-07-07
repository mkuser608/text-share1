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
        .manage(AppState {
            enigo: Mutex::new(enigo),
            pending: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![inject, take_pending_url, open_url])
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ShareHub Desktop");
}
