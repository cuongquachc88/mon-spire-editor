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
        mpsc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_fs::FsExt;

const BASE_PORT: u16 = 17877;
const PORT_TRIES: u16 = 20;
const MAX_BODY: u64 = 25 * 1024 * 1024;
const REPLY_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Default)]
struct Mcp {
    port: Mutex<Option<u16>>,
    pending: Mutex<HashMap<u64, mpsc::Sender<String>>>,
    next: AtomicU64,
}

/// Folder passed as `--project <dir>` (lets scripts and tests open a project without the picker).
struct InitialProject(Option<String>);

#[tauri::command]
fn mcp_port(state: State<Mcp>) -> Option<u16> {
    *state.port.lock().unwrap()
}

/// The webview's answer to an `mcp-request` event. An empty body means "notification, nothing to return".
#[tauri::command]
fn mcp_reply(state: State<Mcp>, id: u64, body: String) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(body);
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

fn start_mcp_server(app: AppHandle) {
    for port in BASE_PORT..BASE_PORT + PORT_TRIES {
        if let Ok(server) = tiny_http::Server::http(("127.0.0.1", port)) {
            *app.state::<Mcp>().port.lock().unwrap() = Some(port);
            thread::spawn(move || {
                for req in server.incoming_requests() {
                    let app = app.clone();
                    thread::spawn(move || handle(app, port, req));
                }
            });
            return;
        }
    }
    eprintln!("Mon Spire Editor: no free port in {}..{} for the MCP server", BASE_PORT, BASE_PORT + PORT_TRIES);
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
        .manage(Mcp::default())
        .manage(InitialProject(initial.clone()))
        .invoke_handler(tauri::generate_handler![mcp_port, mcp_reply, initial_project])
        .setup(move |app| {
            if let Some(dir) = &initial {
                // an explicitly passed folder is trusted like one picked in the dialog
                let _ = app.fs_scope().allow_directory(dir, true);
            }
            start_mcp_server(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Mon Spire Editor");
}
