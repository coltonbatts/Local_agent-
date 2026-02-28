mod error_page;
mod health;
mod sidecar;

use sidecar::SidecarManager;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

struct AppState {
    sidecar: Mutex<Option<SidecarManager>>,
}

const BACKEND_URL: &str = "http://127.0.0.1:3001";
const HEALTH_URL: &str = "http://127.0.0.1:3001/health";

fn is_dev() -> bool {
    cfg!(debug_assertions)
}

#[tauri::command]
async fn restart_backend(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    {
        let guard = state.sidecar.lock().unwrap();
        if let Some(ref sidecar) = *guard {
            sidecar.shutdown();
        }
    }

    {
        let guard = state.sidecar.lock().unwrap();
        if let Some(ref sidecar) = *guard {
            sidecar.spawn_with_retry()?;
        } else {
            return Err("No sidecar manager available".to_string());
        }
    }

    health::poll_health(HEALTH_URL, 250, 15000).await?;

    // Navigate main window to backend URL
    if let Some(main_window) = app.get_webview_window("main") {
        let url: tauri::Url = BACKEND_URL.parse().unwrap();
        let _ = main_window.navigate(url);
    }

    Ok("Backend restarted".to_string())
}

fn show_error(app: &tauri::AppHandle, message: &str, log_lines: &[String]) {
    let error_html = error_page::generate_error_html(message, log_lines);
    if let Some(main_window) = app.get_webview_window("main") {
        let js = format!(
            "document.open(); document.write({}); document.close();",
            serde_json::to_string(&error_html).unwrap()
        );
        let _ = main_window.eval(&js);
        let _ = main_window.show();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            sidecar: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![restart_backend])
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Resolve project root
            let project_root = if is_dev() {
                std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
            } else {
                app_handle
                    .path()
                    .resource_dir()
                    .unwrap_or_else(|_| {
                        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
                    })
            };

            let spawn_sidecar = !is_dev();

            if spawn_sidecar {
                let manager = SidecarManager::new(project_root);

                match manager.spawn_with_retry() {
                    Ok(()) => {
                        println!("[tauri] Sidecar spawned, starting health check...");
                    }
                    Err(e) => {
                        eprintln!("[tauri] Sidecar spawn failed: {}", e);
                        let log_lines = manager.read_last_log_lines(20);
                        let state: State<AppState> = app.state();
                        *state.sidecar.lock().unwrap() = Some(manager);
                        show_error(&app_handle, &e, &log_lines);
                        return Ok(());
                    }
                }

                let state: State<AppState> = app.state();
                *state.sidecar.lock().unwrap() = Some(manager);
            }

            // Health check then show UI
            tauri::async_runtime::spawn(async move {
                match health::poll_health(HEALTH_URL, 250, 15000).await {
                    Ok(()) => {
                        if let Some(main_window) = app_handle.get_webview_window("main") {
                            // In production, navigate to backend (serves built frontend)
                            if !is_dev() {
                                let url: tauri::Url = BACKEND_URL.parse().unwrap();
                                let _ = main_window.navigate(url);
                            }
                            let _ = main_window.show();
                            let _ = main_window.set_focus();
                        }
                    }
                    Err(e) => {
                        eprintln!("[tauri] Health check failed: {}", e);

                        let log_lines = if !is_dev() {
                            let state: State<AppState> = app_handle.state();
                            let guard = state.sidecar.lock().unwrap();
                            guard
                                .as_ref()
                                .map(|s| s.read_last_log_lines(20))
                                .unwrap_or_default()
                        } else {
                            vec![
                                "Dev mode: backend not responding.".to_string(),
                                "Start it with: npm run dev:backend".to_string(),
                            ]
                        };

                        show_error(&app_handle, &e, &log_lines);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state: State<AppState> = window.state();
                let guard = state.sidecar.lock().unwrap();
                if let Some(ref sidecar) = *guard {
                    sidecar.shutdown();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
