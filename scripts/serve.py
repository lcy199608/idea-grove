#!/usr/bin/env python3
"""Local preview only. Run manually: python3 scripts/serve.py [--port 4173]."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser(description="在 localhost 预览拾念 PWA")
parser.add_argument("--port", type=int, default=4173)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1] / "web"
handler = partial(SimpleHTTPRequestHandler, directory=str(root))
with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
    print(f"拾念预览：http://localhost:{args.port}（Ctrl+C 停止）", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
