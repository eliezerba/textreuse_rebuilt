#!/usr/bin/env python3
"""Start the local TextReuse viewer and expose the JSON files in its folder."""

from __future__ import annotations

import http.server
import json
import os
import socketserver
import sys
import threading
import urllib.parse
import webbrowser
from pathlib import Path

START_PORT = 8765
END_PORT = 8865


class ReusableThreadingHTTPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class TextReuseHandler(http.server.SimpleHTTPRequestHandler):
    """Static file handler with a tiny read-only endpoint for JSON discovery."""

    app_dir: Path

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/json-files":
            self._send_json_file_list()
            return
        if parsed.path == "/api/health":
            self._send_json({"ok": True})
            return
        super().do_GET()

    def _send_json_file_list(self) -> None:
        files = []
        for path in sorted(self.app_dir.glob("*.json"), key=lambda item: item.name.casefold()):
            if not path.is_file():
                continue
            stat = path.stat()
            files.append(
                {
                    "name": path.name,
                    "url": urllib.parse.quote(path.name),
                    "size": stat.st_size,
                    "modified": int(stat.st_mtime),
                }
            )
        self._send_json({"files": files})

    def _send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    app_dir = Path(__file__).resolve().parent
    os.chdir(app_dir)
    TextReuseHandler.app_dir = app_dir

    server = None
    selected_port = None
    for port in range(START_PORT, END_PORT + 1):
        try:
            server = ReusableThreadingHTTPServer(("127.0.0.1", port), TextReuseHandler)
            selected_port = port
            break
        except OSError:
            continue

    if server is None or selected_port is None:
        print(f"Could not find a free port between {START_PORT} and {END_PORT}.")
        return 1

    url = f"http://localhost:{selected_port}/"
    print("TextReuse viewer is running.")
    print(f"Open: {url}")
    print("JSON files placed beside index.html will appear in the data-source picker.")
    print("Press Ctrl+C to stop the server.")

    timer = threading.Timer(1.0, lambda: webbrowser.open(url))
    timer.daemon = True
    timer.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
