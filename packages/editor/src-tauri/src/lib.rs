//! Desktop shell. File access happens in the webview through plugin-fs (scoped to folders the user picked;
//! persisted-scope remembers them). This file adds the one thing a webview cannot do: listen on a local port.
//!
//! The MCP server itself is TypeScript and runs in the webview (same tools as the stdio server). Rust only
//! accepts HTTP requests on 127.0.0.1, hands each JSON-RPC body to the webview as an event, and sends the
//! webview's answer back. Anything that is not plainly a local, non-browser client is refused.
use std::{
    collections::HashMap,
    io::Read,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_fs::FsExt;

const DEFAULT_PORT: u16 = 17877;
const PORT_TRIES: u16 = 20;
const MAX_BODY: u64 = 25 * 1024 * 1024;
const REPLY_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Default)]
struct Mcp {
    port: Mutex<Option<u16>>,
    /// The running listener, kept so it can be stopped (`unblock`) for restart/stop.
    server: Mutex<Option<Arc<tiny_http::Server>>>,
    started_ms: Mutex<Option<u64>>,
    pending: Mutex<HashMap<u64, mpsc::Sender<String>>>,
    next: AtomicU64,
}

/// Folder passed as `--project <dir>` (lets scripts and tests open a project without the picker).
struct InitialProject(Option<String>);

#[derive(serde::Serialize)]
struct McpStatus {
    running: bool,
    port: Option<u16>,
    /// Unix time in ms when the listener started, for "up for ..." in the UI.
    started_ms: Option<u64>,
}

fn status(state: &Mcp) -> McpStatus {
    let port = *state.port.lock().unwrap();
    McpStatus { running: port.is_some(), port, started_ms: *state.started_ms.lock().unwrap() }
}

#[tauri::command]
fn mcp_port(state: State<Mcp>) -> Option<u16> {
    *state.port.lock().unwrap()
}

#[tauri::command]
fn mcp_status(state: State<Mcp>) -> McpStatus {
    status(&state)
}

/// Stop listening. Requests already being answered finish; new connections are refused.
#[tauri::command]
fn mcp_stop(state: State<Mcp>) -> McpStatus {
    stop_mcp_server(&state);
    status(&state)
}

#[tauri::command]
fn mcp_start(app: AppHandle, state: State<Mcp>) -> McpStatus {
    if state.port.lock().unwrap().is_none() {
        start_mcp_server(app, None);
    }
    status(&state)
}

/// Stop and listen again, on the same port when it frees up in time (so saved client configs keep working).
#[tauri::command]
fn mcp_restart(app: AppHandle, state: State<Mcp>) -> McpStatus {
    let previous = *state.port.lock().unwrap();
    stop_mcp_server(&state);
    start_mcp_server(app, previous);
    status(&state)
}

/// The webview's answer to an `mcp-request` event. An empty body means "notification, nothing to return".
#[tauri::command]
fn mcp_reply(state: State<Mcp>, id: u64, body: String) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(body);
    }
}

const KEYCHAIN_SERVICE: &str = "com.monspire.editor";

/// Secrets live in the OS credential store, never in files or the webview's storage. Names are restricted so
/// the webview can only reach the entries this app creates.
fn secret_entry(name: &str) -> Result<keyring::Entry, String> {
    if !name.starts_with("mse_") || name.len() > 64 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("Invalid secret name".into());
    }
    keyring::Entry::new(KEYCHAIN_SERVICE, name).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_set(name: String, value: String) -> Result<(), String> {
    secret_entry(&name)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    match secret_entry(&name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_delete(name: String) -> Result<(), String> {
    match secret_entry(&name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn initial_project(state: State<InitialProject>) -> Option<String> {
    state.0.clone()
}

fn respond(req: tiny_http::Request, code: u16, body: &str) {
    let json = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
    let _ = req.respond(tiny_http::Response::from_string(body).with_status_code(code).with_header(json));
}

fn rpc_error(message: &str) -> String {
    serde_json::json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32000, "message": message } }).to_string()
}

fn header(req: &tiny_http::Request, name: &str) -> Option<String> {
    req.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.to_string())
}

fn handle(app: AppHandle, port: u16, mut req: tiny_http::Request) {
    // DNS-rebinding guard: the Host must be exactly our local address.
    let host = header(&req, "Host").unwrap_or_default();
    if host != format!("127.0.0.1:{port}") && host != format!("localhost:{port}") {
        return respond(req, 403, &rpc_error("Forbidden host"));
    }
    // Browsers always send Origin on cross-site requests; MCP clients (CLI/desktop apps) do not.
    if header(&req, "Origin").is_some() {
        return respond(req, 403, &rpc_error("Requests from web pages are not allowed"));
    }
    if req.url().split('?').next() != Some("/mcp") {
        return respond(req, 404, &rpc_error("Not found. The MCP endpoint is /mcp"));
    }
    match req.method() {
        tiny_http::Method::Delete => return respond(req, 200, "{}"), // stateless: nothing to end
        tiny_http::Method::Post => {}
        _ => {
            let allow = tiny_http::Header::from_bytes(&b"Allow"[..], &b"POST"[..]).unwrap();
            let _ = req.respond(tiny_http::Response::from_string(rpc_error("Use POST")).with_status_code(405).with_header(allow));
            return;
        }
    }
    if !header(&req, "Content-Type").unwrap_or_default().contains("application/json") {
        return respond(req, 415, &rpc_error("Content-Type must be application/json"));
    }

    let mut body = String::new();
    if req.as_reader().take(MAX_BODY).read_to_string(&mut body).is_err() {
        return respond(req, 400, &rpc_error("Could not read the request body"));
    }

    let state = app.state::<Mcp>();
    let id = state.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    state.pending.lock().unwrap().insert(id, tx);
    if app.emit("mcp-request", serde_json::json!({ "id": id, "body": body })).is_err() {
        state.pending.lock().unwrap().remove(&id);
        return respond(req, 503, &rpc_error("The editor window is not available"));
    }
    match rx.recv_timeout(REPLY_TIMEOUT) {
        Ok(reply) if reply.is_empty() => {
            let _ = req.respond(tiny_http::Response::empty(202));
        }
        Ok(reply) => respond(req, 200, &reply),
        Err(_) => {
            state.pending.lock().unwrap().remove(&id);
            respond(req, 504, &rpc_error("Mon Spire Editor did not answer in time. Is its window open?"));
        }
    }
}

fn stop_mcp_server(state: &Mcp) {
    if let Some(server) = state.server.lock().unwrap().take() {
        server.unblock(); // ends the accept loop; the socket closes once that thread drops its handle
    }
    *state.port.lock().unwrap() = None;
    *state.started_ms.lock().unwrap() = None;
}

/// Listen on `preferred` if given (retrying briefly while the old socket closes), else the first free port from BASE_PORT.
/// 17877 unless `MSE_MCP_PORT` says otherwise (tests use their own port so they never take over a real session).
fn base_port() -> u16 {
    std::env::var("MSE_MCP_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(DEFAULT_PORT)
}

fn start_mcp_server(app: AppHandle, preferred: Option<u16>) {
    let base = base_port();
    let try_bind = |port: u16| tiny_http::Server::http(("127.0.0.1", port)).ok();
    let bound = preferred
        .and_then(|p| {
            (0..15).find_map(|_| try_bind(p).map(|s| (p, s)).or_else(|| (thread::sleep(Duration::from_millis(100)), None).1))
        })
        .or_else(|| (base..base + PORT_TRIES).find_map(|p| try_bind(p).map(|s| (p, s))));
    let Some((port, server)) = bound else {
        eprintln!("Mon Spire Editor: no free port in {}..{} for the MCP server", base, base + PORT_TRIES);
        return;
    };
    let server = Arc::new(server);
    let state = app.state::<Mcp>();
    *state.server.lock().unwrap() = Some(server.clone());
    *state.port.lock().unwrap() = Some(port);
    *state.started_ms.lock().unwrap() = SystemTime::now().duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64);
    thread::spawn(move || {
        for req in server.incoming_requests() {
            let app = app.clone();
            thread::spawn(move || handle(app, port, req));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut args = std::env::args().skip(1);
    let mut initial = None;
    while let Some(a) = args.next() {
        if a == "--project" {
            initial = args.next();
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_http::init())
        .manage(Mcp::default())
        .manage(InitialProject(initial.clone()))
        .invoke_handler(tauri::generate_handler![mcp_port, mcp_status, mcp_stop, mcp_start, mcp_restart, mcp_reply, initial_project, secret_set, secret_get, secret_delete])
        .setup(move |app| {
            if let Some(dir) = &initial {
                // an explicitly passed folder is trusted like one picked in the dialog
                let _ = app.fs_scope().allow_directory(dir, true);
            }
            start_mcp_server(app.handle().clone(), None);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Mon Spire Editor");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Restart relies on two facts: `unblock` ends the accept loop, and the same port can then be bound again.
    #[test]
    fn stopping_a_listener_frees_its_port_for_a_restart() {
        let port = 17990;
        let server = Arc::new(tiny_http::Server::http(("127.0.0.1", port)).expect("bind"));
        let worker = {
            let server = server.clone();
            thread::spawn(move || server.incoming_requests().count()) // returns when unblocked
        };
        thread::sleep(Duration::from_millis(100));
        server.unblock();
        assert_eq!(worker.join().expect("accept loop ends"), 0);
        drop(server);

        // same retry the app uses: the OS may take a moment to release the socket
        let rebound = (0..15).find_map(|_| {
            tiny_http::Server::http(("127.0.0.1", port)).ok().or_else(|| {
                thread::sleep(Duration::from_millis(100));
                None
            })
        });
        assert!(rebound.is_some(), "port {port} was not released after unblock");
    }
}
