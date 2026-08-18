#!/usr/bin/env python3
"""Static server for Downstrike with caching disabled, so edits show up on refresh."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

if __name__ == '__main__':
    print('Downstrike at http://localhost:8642')
    ThreadingHTTPServer(('127.0.0.1', 8642), Handler).serve_forever()
