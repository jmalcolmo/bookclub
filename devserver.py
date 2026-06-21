#!/usr/bin/env python3
"""Tiny static file server for local dev that disables HTTP caching.

Plain `python -m http.server` lets the browser heuristically cache our ES
modules (it sends Last-Modified but no Cache-Control). After an edit that adds
an export, the browser can end up with a fresh module importing a name from a
stale one — the import link fails and the app hangs on the loading splash. This
server sends `Cache-Control: no-store` on every response so a normal refresh
always pulls fresh modules.

    python devserver.py [port]   # default 5174
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5174
    print(f"dev server (no-cache) on http://localhost:{port}")
    HTTPServer(("", port), NoCacheHandler).serve_forever()
