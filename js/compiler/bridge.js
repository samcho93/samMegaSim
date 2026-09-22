// Client for the local samMegaSim compiler bridge (WinAVR avr-gcc)
const DEFAULT_URL = 'http://127.0.0.1:8787';

export class CompilerBridge {
  constructor() {
    this.url = DEFAULT_URL;
    try { this.url = localStorage.getItem('sms.bridgeUrl') || DEFAULT_URL; } catch { /* ignore */ }
    this.state = null; // last /status result
    this.listeners = new Set();
  }

  setUrl(u) {
    this.url = (u || DEFAULT_URL).replace(/\/+$/, '');
    try { localStorage.setItem('sms.bridgeUrl', this.url); } catch { /* ignore */ }
  }

  async _fetch(path, opts = {}, timeout = 4000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(this.url + path, { ...opts, signal: ctl.signal, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
      const txt = await r.text();
      let j;
      try { j = JSON.parse(txt); } catch { throw new Error(`브리지 응답 형식 오류: ${txt.slice(0, 200)}`); }
      if (!r.ok && !j.log) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    } finally {
      clearTimeout(t);
    }
  }

  async status() {
    try {
      this.state = await this._fetch('/status', {}, 1500);
      this.state.connected = true;
    } catch (e) {
      this.state = { connected: false, error: e.name === 'AbortError' ? '응답 없음' : e.message };
    }
    for (const l of this.listeners) l(this.state);
    return this.state;
  }

  async compile(req) {
    return this._fetch('/compile', { method: 'POST', body: JSON.stringify(req) }, 120000);
  }

  async install() { return this._fetch('/install', { method: 'POST', body: '{}' }, 10000); }
  async installStatus() { return this._fetch('/install/status', {}, 4000); }
  async setWinavrPath(path) { return this._fetch('/config', { method: 'POST', body: JSON.stringify({ winavrPath: path }) }, 4000); }
}

/** Parse gcc output into diagnostics */
export function parseDiagnostics(log) {
  const out = [];
  for (const line of (log || '').split(/\r?\n/)) {
    let m = /^(?:.*[\\/])?([^\\/:]+\.(?:c|h|cpp|S|s)):(\d+)(?::(\d+))?:\s*(fatal error|error|warning|note):\s*(.*)$/.exec(line);
    if (m) {
      out.push({ file: m[1], line: +m[2], col: m[3] ? +m[3] : 0, kind: m[4] === 'note' ? 'note' : m[4].includes('error') ? 'error' : 'warning', msg: m[5] });
      continue;
    }
    m = /^(?:.*[\\/])?([^\\/:]+\.(?:c|cpp)):\(.*?\):\s*(.*)$/.exec(line);
    if (m) out.push({ file: m[1], line: 0, kind: 'error', msg: m[2] });
  }
  return out;
}
