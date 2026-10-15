"""A tiny stand-in for the Anthropic Messages API so the in-app agent can be tested without a real key.

It plays a fixed five-turn artist: create the sheet, draw, preview, complete the request, say done.
Every request is recorded so tests can check what the app really sent.
"""
import json, re, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
}

class Mock:
    def __init__(self):
        self.calls = []        # one dict per request: key, version, model, tool names, system text, messages
        self.problems = []     # protocol violations the mock noticed (tests assert this stays empty)
        mock = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a): pass
            def _send(self, code, obj):
                body = json.dumps(obj).encode()
                self.send_response(code)
                for k, v in {**CORS, "content-type": "application/json"}.items(): self.send_header(k, v)
                self.send_header("content-length", str(len(body))); self.end_headers()
                try: self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError): pass
            def do_OPTIONS(self):
                self.send_response(204)
                for k, v in CORS.items(): self.send_header(k, v)
                self.end_headers()
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
                key = self.headers.get("x-api-key", "")
                mock.calls.append({"key": key, "version": self.headers.get("anthropic-version"), "model": body.get("model"),
                                   "tools": [t["name"] for t in body.get("tools", [])], "system": json.dumps(body.get("system", "")),
                                   "messages": body.get("messages", []), "max_tokens": body.get("max_tokens")})
                if key == "bad-key":
                    return self._send(401, {"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}})
                if key == "slow-key":
                    time.sleep(8)
                msgs = body.get("messages", [])
                n = sum(1 for m in msgs if m["role"] == "assistant")
                first = msgs[0]["content"] if msgs else ""
                first = first if isinstance(first, str) else json.dumps(first)
                m = re.search(r'sprite_create id "([^"]+)" width (\d+) height (\d+)', first)
                rid = re.search(r'request "(req-[a-z0-9]+)"', first)
                if len(msgs) <= 1 and body.get("max_tokens") == 1:   # the "Test key" ping
                    return self._send(200, {"id": "m", "type": "message", "role": "assistant", "model": body["model"], "content": [{"type": "text", "text": "ok"}], "stop_reason": "end_turn", "usage": {"input_tokens": 1, "output_tokens": 1}})
                if not m:
                    mock.problems.append("the brief did not contain a sprite_create step")
                    return self._send(400, {"type": "error", "error": {"type": "invalid_request_error", "message": "no brief"}})
                sid, w, h = m.group(1), int(m.group(2)), int(m.group(3))
                def use(i, name, inp, text=None):
                    c = ([{"type": "text", "text": text}] if text else []) + [{"type": "tool_use", "id": f"tu_{i}", "name": name, "input": inp}]
                    return self._send(200, {"id": f"msg_{i}", "type": "message", "role": "assistant", "model": body["model"], "content": c, "stop_reason": "tool_use", "usage": {"input_tokens": 500 + 100 * n, "output_tokens": 40}})
                if n == 0: return use(0, "sprite_create", {"id": sid, "width": w, "height": h}, "I will start with the silhouette.")
                if n == 1: return use(1, "sprite_draw", {"sheetId": sid, "ops": [{"op": "ellipse", "cx": 12, "cy": 14, "rx": 9, "ry": 8, "color": "#3cb44b"}, {"op": "rect", "x": 8, "y": 10, "w": 2, "h": 2, "color": "#ffffff"}]})
                if n == 2: return use(2, "sprite_preview", {"sheetId": sid, "scale": 4})
                if n == 3:
                    last = msgs[-1]["content"]
                    if not any(b.get("type") == "tool_result" and any(c.get("type") == "image" for c in b.get("content", [])) for b in last):
                        mock.problems.append("the preview image was not sent back to the model")
                    return use(3, "request_complete", {"id": rid.group(1) if rid else "missing", "note": "green blob"})
                return self._send(200, {"id": "msg_end", "type": "message", "role": "assistant", "model": body["model"], "content": [{"type": "text", "text": "Done: a green blob."}], "stop_reason": "end_turn", "usage": {"input_tokens": 900, "output_tokens": 12}})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self): self.server.shutdown()
