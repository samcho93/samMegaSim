#!/usr/bin/env python3
"""samMegaSim compiler bridge (cross-platform).

Runs avr-gcc for https://samcho93.github.io/samMegaSim on http://127.0.0.1:8787.
Windows users can use samMegaSim-bridge.cmd instead (it can also install WinAVR).

  Linux : sudo apt install gcc-avr avr-libc binutils-avr
  macOS : brew tap osx-cross/avr && brew install avr-gcc
  usage : python3 sms_bridge.py [--port 8787] [--avr-bin /path/to/bin]
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.0.0"
ORIGIN_RE = re.compile(r"^(https://samcho93\.github\.io|https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?|null)$")
AVR_BIN = None


def find_avr_bin():
    if AVR_BIN:
        return AVR_BIN
    exe = shutil.which("avr-gcc")
    if exe:
        return os.path.dirname(exe)
    if os.name == "nt":
        for base in ("C:\\", "D:\\"):
            try:
                for d in sorted(os.listdir(base), reverse=True):
                    if d.lower().startswith("winavr") and os.path.exists(os.path.join(base, d, "bin", "avr-gcc.exe")):
                        return os.path.join(base, d, "bin")
            except OSError:
                pass
    return None


def tool(name):
    b = find_avr_bin()
    return os.path.join(b, name + (".exe" if os.name == "nt" else "")) if b else name


def gcc_version():
    try:
        return subprocess.run([tool("avr-gcc"), "--version"], capture_output=True, text=True, timeout=10).stdout.splitlines()[0]
    except Exception:
        return ""


def compile_req(req):
    if not find_avr_bin():
        return {"ok": False, "log": "avr-gcc not found in PATH", "error": "winavr-not-found"}
    mcu = str(req.get("mcu", ""))
    fcpu = str(req.get("fcpu", ""))
    opt = str(req.get("opt", "-Os"))
    if not re.match(r"^at(mega|tiny|xmega)\w+$", mcu):
        return {"ok": False, "log": f"invalid mcu {mcu!r}"}
    if not re.match(r"^\d{1,9}$", fcpu):
        return {"ok": False, "log": f"invalid F_CPU {fcpu!r}"}
    if opt not in ("-O0", "-O1", "-O2", "-O3", "-Os"):
        opt = "-Os"
    d = tempfile.mkdtemp(prefix="sms_")
    try:
        sources = []
        for f in req.get("files", []):
            name = str(f.get("name", ""))
            if not re.match(r"^[\w.-]+$", name) or name.startswith("."):
                return {"ok": False, "log": f"invalid file name {name!r}"}
            with open(os.path.join(d, name), "w", encoding="utf-8") as fh:
                fh.write(str(f.get("content", "")))
            if re.search(r"\.(c|S)$", name):
                sources.append(name)
        if not sources:
            return {"ok": False, "log": "no .c source files"}
        args = [tool("avr-gcc"), f"-mmcu={mcu}", f"-DF_CPU={fcpu}UL", opt, "-g", "-Wall", "-std=gnu99",
                "-funsigned-char", "-funsigned-bitfields", "-fpack-struct", "-fshort-enums",
                "-ffunction-sections", "-fdata-sections", "-Wl,--gc-sections", *sources, "-o", "main.elf"]
        if req.get("printfFloat"):
            args += ["-Wl,-u,vfprintf", "-lprintf_flt"]
        args += ["-lm"]
        r = subprocess.run(args, cwd=d, capture_output=True, text=True, timeout=120)
        log = (r.stdout + r.stderr).strip()
        cmd = " ".join(os.path.basename(a) if i == 0 else a for i, a in enumerate(args))
        if r.returncode != 0:
            return {"ok": False, "log": log, "cmd": cmd}
        o = subprocess.run([tool("avr-objcopy"), "-O", "ihex", "-R", ".eeprom", "-R", ".fuse", "-R", ".lock", "main.elf", "main.hex"],
                           cwd=d, capture_output=True, text=True)
        if o.returncode != 0:
            return {"ok": False, "log": (log + "\n" + o.stderr).strip(), "cmd": cmd}
        s = subprocess.run([tool("avr-size"), "main.elf"], cwd=d, capture_output=True, text=True)
        with open(os.path.join(d, "main.hex")) as fh:
            hexdata = fh.read()
        return {"ok": True, "hex": hexdata, "log": log, "size": s.stdout.strip(), "cmd": cmd}
    finally:
        shutil.rmtree(d, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and ORIGIN_RE.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, obj, code=200):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _allowed(self):
        origin = self.headers.get("Origin")
        if origin and not ORIGIN_RE.match(origin):
            self._json({"ok": False, "error": "origin not allowed"}, 403)
            return False
        return True

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if not self._allowed():
            return
        if self.path.rstrip("/") == "/status":
            b = find_avr_bin()
            self._json({"ok": True, "version": VERSION, "platform": f"python-{sys.platform}",
                        "winavr": {"found": bool(b), "path": os.path.dirname(b) if b else None, "version": gcc_version() if b else ""}})
        elif self.path.rstrip("/") == "/install/status":
            self._json({"ok": True, "state": "idle", "progress": 0, "message": ""})
        else:
            self._json({"ok": False, "error": "not found"}, 404)

    def do_POST(self):
        if not self._allowed():
            return
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        p = self.path.rstrip("/")
        if p == "/compile":
            r = compile_req(body)
            print(f"compile {body.get('mcu')} -> {'OK' if r['ok'] else 'FAILED'}")
            self._json(r)
        elif p == "/install":
            self._json({"ok": False, "error": "automatic install is only supported by the Windows bridge; install avr-gcc with your package manager"})
        elif p == "/config":
            global AVR_BIN
            path = body.get("winavrPath") or ""
            cand = os.path.join(path, "bin") if path else None
            if cand and os.path.exists(os.path.join(cand, "avr-gcc" + (".exe" if os.name == "nt" else ""))):
                AVR_BIN = cand
                self._json({"ok": True})
            else:
                self._json({"ok": False, "error": "avr-gcc not found in that folder"})
        else:
            self._json({"ok": False, "error": "not found"}, 404)

    def log_message(self, fmt, *args):
        pass


def main():
    global AVR_BIN
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--avr-bin", help="folder containing avr-gcc")
    a = ap.parse_args()
    AVR_BIN = a.avr_bin
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    b = find_avr_bin()
    print(f"samMegaSim compiler bridge v{VERSION} listening on http://127.0.0.1:{a.port}")
    print(f"avr-gcc: {b or 'NOT FOUND'} {gcc_version() if b else ''}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
