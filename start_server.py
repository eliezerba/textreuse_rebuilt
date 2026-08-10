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


def discover_json_files(app_dir: Path | str) -> list[Path]:
    """Find JSON datasets near the app directory, including sibling dataset folders."""
    try:
        app_dir = Path(app_dir).resolve(strict=False)
    except OSError:
        app_dir = Path(app_dir)

    workspace_dir = app_dir
    if not (workspace_dir / "index.html").exists() and not (workspace_dir / "styles.css").exists():
        workspace_dir = app_dir.parent

    search_roots: list[Path] = []
    current = workspace_dir
    for _ in range(4):
        try:
            search_roots.append(current.resolve(strict=False))
        except (OSError, ValueError):
            search_roots.append(current)
        try:
            dataset_root = (current / "dataset").resolve(strict=False)
        except (OSError, ValueError):
            dataset_root = current / "dataset"
        search_roots.append(dataset_root)
        current = current.parent

    seen: set[Path] = set()
    discovered: list[Path] = []
    for root in search_roots:
        if not root.exists() or not root.is_dir():
            continue
        for path in sorted(root.glob("*.json"), key=lambda item: item.name.casefold()):
            if not path.is_file():
                continue
            try:
                resolved = path.resolve(strict=False)
            except (OSError, ValueError):
                resolved = path
            if resolved in seen:
                continue
            seen.add(resolved)
            discovered.append(resolved)

    return sorted(discovered, key=lambda item: item.name.casefold())


class ReusableThreadingHTTPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class TextReuseHandler(http.server.SimpleHTTPRequestHandler):
    """Static file handler with read-only JSON discovery and file endpoints."""

    app_dir: Path
    allowed_json_files: tuple[Path, ...] = ()

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
        if parsed.path == "/api/file":
            self._send_json_file(parsed.query)
            return
        super().do_GET()

    def _send_json_file_list(self) -> None:
        files = []
        for path in self.allowed_json_files or tuple(discover_json_files(self.app_dir)):
            if not path.is_file():
                continue
            stat = path.stat()
            files.append(
                {
                    "name": path.name,
                    "url": f"/api/file?path={urllib.parse.quote(str(path.resolve()))}",
                    "size": stat.st_size,
                    "modified": int(stat.st_mtime),
                }
            )
        self._send_json({"files": files})

    def _send_json_file(self, query_string: str) -> None:
        params = urllib.parse.parse_qs(query_string)
        raw_path = params.get("path", [""])[0]
        if not raw_path:
            self._send_json({"error": "missing path"}, 404)
            return

        requested = Path(urllib.parse.unquote(raw_path))
        if requested.is_absolute():
            candidate = requested.resolve(strict=False)
        else:
            candidate = (self.app_dir / requested).resolve(strict=False)

        allowed = {path.resolve() for path in self.allowed_json_files or tuple(discover_json_files(self.app_dir))}
        if candidate not in allowed:
            self._send_json({"error": "file not allowed"}, 404)
            return
        if not candidate.exists() or not candidate.is_file():
            self._send_json({"error": "file not found"}, 404)
            return

        body = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
    TextReuseHandler.allowed_json_files = tuple(discover_json_files(app_dir))

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
