// Thin native bridge. All game logic lives in the Node runtime that owns
// DesktopApplicationService; this process only supervises that sidecar and
// forwards typed commands to it.
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::Manager;

struct Runtime {
    port: u16,
    token: String,
    child: Mutex<Child>,
}

impl Drop for Runtime {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

#[derive(serde::Deserialize)]
struct Handshake {
    port: u16,
    token: String,
}

fn error_result(code: &str, message: &str, detail: Option<String>) -> Value {
    json!({
        "ok": false,
        "error": { "code": code, "message": message, "detail": detail }
    })
}

/// Single passthrough command. The UI contract is defined once in
/// packages/shared-types; Rust deliberately does not model the payloads.
#[tauri::command]
async fn runtime_command(
    state: tauri::State<'_, Runtime>,
    command: String,
    args: Value,
) -> Result<Value, String> {
    let url = format!("http://127.0.0.1:{}/command/{}", state.port, command);
    let response = reqwest::Client::new()
        .post(url)
        .header("x-runtime-token", &state.token)
        .json(&args)
        .send()
        .await;

    match response {
        Ok(response) => match response.json::<Value>().await {
            Ok(value) => Ok(value),
            Err(error) => Ok(error_result(
                "RUNTIME_UNAVAILABLE",
                "The game runtime returned an unreadable response.",
                Some(error.to_string()),
            )),
        },
        Err(error) => Ok(error_result(
            "RUNTIME_UNAVAILABLE",
            "The game runtime is not reachable.",
            Some(error.to_string()),
        )),
    }
}

fn spawn_runtime(saves_directory: &str, dataset_path: &str) -> Result<Runtime, String> {
    let mut child = Command::new("node")
        .arg("nepal-football-desktop-runtime")
        .env("NEPAL_SAVES_DIR", saves_directory)
        .env("NEPAL_WORLD_DATASET", dataset_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("Could not start the game runtime: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Runtime produced no handshake output.".to_string())?;
    let mut line = String::new();
    BufReader::new(stdout)
        .read_line(&mut line)
        .map_err(|error| format!("Could not read the runtime handshake: {error}"))?;
    let handshake: Handshake = serde_json::from_str(line.trim())
        .map_err(|error| format!("Malformed runtime handshake: {error}"))?;

    Ok(Runtime {
        port: handshake.port,
        token: handshake.token,
        child: Mutex::new(child),
    })
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let saves = app.path().app_data_dir()?.join("saves");
            std::fs::create_dir_all(&saves)?;
            let dataset = app
                .path()
                .resolve("data/nepal/2026-08/club-registry.json", tauri::path::BaseDirectory::Resource)?;
            let runtime = spawn_runtime(&saves.to_string_lossy(), &dataset.to_string_lossy())
                .map_err(|error| std::io::Error::other(error))?;
            app.manage(runtime);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![runtime_command])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
