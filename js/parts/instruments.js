// Virtual instruments: oscilloscope, logic analyzer, virtual terminal, meters
import { register, Sym, esc } from './kit.js';
import { formatSI, parseSI } from '../sim/circuit.js';

const CAT = 'Instruments';

export class Trace {
  constructor(cap = 1 << 18) {
    this.cap = cap;
    this.t = new Float64Array(cap);
    this.v = new Float32Array(cap);
    this.head = 0; // next write index
    this.len = 0;
    this.last = NaN;
  }
  push(t, v) {
    const i = this.head;
    this.t[i] = t; this.v[i] = v;
    this.head = (i + 1) % this.cap;
    if (this.len < this.cap) this.len++;
    this.last = v;
  }
  /** i-th oldest sample */
  at(i) { return (this.head - this.len + i + this.cap) % this.cap; }
  /** index (0..len-1, oldest first) of the last sample with time <= t, or -1 */
  find(t) {
    let lo = 0, hi = this.len - 1, res = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.t[this.at(mid)] <= t) { res = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return res;
  }
  valueAt(t) {
    const i = this.find(t);
    return i < 0 ? (this.len ? this.v[this.at(0)] : 0) : this.v[this.at(i)];
  }
  clear() { this.head = 0; this.len = 0; this.last = NaN; }
}

/** Records voltage on a node whenever it changes */
function recorder(node, trace, thresh = 1e-3) {
  return {
    stamp() {},
    post(c) {
      if (node == null) return false;
      const v = c.V(node);
      const last = trace.last;
      if (!(Math.abs(v - last) <= thresh)) {
        if (Number.isFinite(last) && Math.abs(v - last) > 0.3) trace.push(c.t, last);
        trace.push(c.t, v);
      }
      return false;
    },
  };
}

// ---------------------------------------------------------------------------
// Oscilloscope
// ---------------------------------------------------------------------------
export const SCOPE_CH = ['A', 'B', 'C', 'D'];
export const SCOPE_COLORS = ['#f5d90a', '#27d7f5', '#f54be6', '#52f56a'];

register({
  type: 'scope', name: 'Oscilloscope', category: CAT, prefix: 'OSC', instrument: 'scope',
  desc: '4채널 오실로스코프 — 우측 패널 [오실로스코프] 탭에서 확인',
  props: [],
  valueText: () => 'OSCILLOSCOPE',
  symbol() {
    const s = new Sym();
    s.rect(-40, -40, 80, 70, 'inst');
    SCOPE_CH.forEach((c, i) => s.pin(c, -60, -30 + i * 10, 'R', 20, { name: c, showName: true, nameSize: 8 }));
    s.rect(-14, -32, 48, 34, 'scr');
    s.poly([-12, -8, -4, -8, -4, -24, 6, -24, 6, -8, 14, -8, 14, -24, 24, -24, 24, -8, 32, -8], 'scrl');
    s.text(10, 18, 'OSC', { a: 'middle', size: 9, cls: 'insttx', bold: true });
    return s.ref(-40, -46).val(0, -46).build();
  },
  sim(part, n, S) {
    const traces = SCOPE_CH.map(() => new Trace());
    const nodes = SCOPE_CH.map((c) => (S.isUnconnected(part.id, c) ? null : n(c)));
    const inst = { traces, nodes, part, kind: 'scope' };
    inst.elements = nodes.map((node, i) => recorder(node, traces[i]));
    inst.snapshot = (t) => nodes.forEach((node, i) => { if (node != null) traces[i].push(t, S.circuit.V(node)); });
    S.registerInstrument(inst);
    return inst;
  },
});

// ---------------------------------------------------------------------------
// Logic analyzer
// ---------------------------------------------------------------------------
register({
  type: 'logic', name: 'Logic Analyzer', category: CAT, prefix: 'LA', instrument: 'logic',
  desc: '8채널 로직 분석기 — 우측 패널 [로직 분석기] 탭에서 확인',
  props: [],
  valueText: () => 'LOGIC ANALYSER',
  symbol() {
    const s = new Sym();
    s.rect(-40, -50, 80, 100, 'inst');
    for (let i = 0; i < 8; i++) s.pin('D' + i, -60, -40 + i * 10, 'R', 20, { name: 'D' + i, showName: true, nameSize: 8 });
    s.rect(-8, -42, 42, 50, 'scr');
    for (let i = 0; i < 4; i++) {
      const y = -34 + i * 11;
      s.poly([-6, y, 2 + i * 3, y, 2 + i * 3, y - 6, 14 + i * 2, y - 6, 14 + i * 2, y, 32, y], 'scrl');
    }
    s.text(12, 30, 'LOGIC', { a: 'middle', size: 9, cls: 'insttx', bold: true });
    return s.ref(-40, -56).val(0, -56).build();
  },
  sim(part, n, S) {
    const traces = [], nodes = [];
    for (let i = 0; i < 8; i++) {
      const node = S.isUnconnected(part.id, 'D' + i) ? null : n('D' + i);
      nodes.push(node);
      traces.push(new Trace(1 << 17));
    }
    const lv = new Array(8).fill(-1);
    const inst = { traces, nodes, part, kind: 'logic' };
    inst.elements = [{
      stamp() {},
      post(c) {
        for (let i = 0; i < 8; i++) {
          if (nodes[i] == null) continue;
          const v = c.V(nodes[i]);
          const l = v >= S.vcc * 0.6 ? 1 : v <= S.vcc * 0.3 ? 0 : lv[i] < 0 ? 0 : lv[i];
          if (l !== lv[i]) { traces[i].push(c.t, l); lv[i] = l; }
        }
        return false;
      },
    }];
    S.registerInstrument(inst);
    return inst;
  },
});

// ---------------------------------------------------------------------------
// Virtual terminal (bit-level UART decoder / encoder)
// ---------------------------------------------------------------------------
register({
  type: 'terminal', name: 'Virtual Terminal', category: CAT, prefix: 'VT', instrument: 'terminal',
  desc: 'UART 가상 터미널 — RXD를 MCU의 TXD에, TXD를 MCU의 RXD에 연결',
  props: [
    { key: 'baud', label: 'Baud rate', default: '9600', options: ['1200', '2400', '4800', '9600', '14400', '19200', '38400', '57600', '76800', '115200', '250000'] },
  ],
  valueText: (p) => `${p.baud || 9600} 8N1`,
  symbol() {
    const s = new Sym();
    s.rect(-40, -30, 80, 50, 'inst');
    s.pin('RXD', -60, -20, 'R', 20, { name: 'RXD', showName: true, nameSize: 8 });
    s.pin('TXD', -60, -10, 'R', 20, { name: 'TXD', showName: true, nameSize: 8 });
    s.pin('RTS', -60, 0, 'R', 20, { name: 'RTS', showName: true, nameSize: 8 });
    s.pin('CTS', -60, 10, 'R', 20, { name: 'CTS', showName: true, nameSize: 8 });
    s.rect(2, -24, 34, 26, 'scr');
    s.text(6, -15, '>_', { size: 9, cls: 'scrt' });
    s.text(19, 12, 'TERM', { a: 'middle', size: 8, cls: 'insttx', bold: true });
    return s.ref(-40, -36).val(0, -36).build();
  },
  sim(part, n, S) {
    const rx = S.isUnconnected(part.id, 'RXD') ? null : n('RXD');
    const tx = n('TXD');
    const baud = parseSI(part.props.baud, 9600);
    const bitT = 1 / baud;
    const inst = {
      part, kind: 'terminal', baud, rxNode: rx, txNode: tx,
      out: [], // received bytes {b, err}
      txLevel: 1, txQueue: [], txBusy: false,
      listeners: new Set(),
    };
    // --- receive: bit-level decoder ---
    const hist = []; // [t, level]
    let level = null, state = 'idle', startT = 0;
    const levelAt = (t) => {
      let l = 1;
      for (let i = hist.length - 1; i >= 0; i--) if (hist[i][0] <= t) { l = hist[i][1]; break; }
      return l;
    };
    const beginFrame = (t0) => {
      state = 'rx'; startT = t0;
      S.schedule(t0 + 9.6 * bitT, () => { decode(); return false; });
    };
    const decode = () => {
      let b = 0;
      for (let i = 0; i < 8; i++) b |= levelAt(startT + (1.5 + i) * bitT) << i;
      const stop = levelAt(startT + 9.5 * bitT);
      const startOk = levelAt(startT + 0.5 * bitT) === 0;
      const item = { b, err: !stop || !startOk };
      inst.out.push(item);
      if (inst.out.length > 20000) inst.out.splice(0, 5000);
      for (const l of inst.listeners) l(item);
      state = 'idle';
      // trim history, look for a start bit that already began
      const tEnd = startT + 9.5 * bitT;
      while (hist.length > 2 && hist[1][0] < tEnd - 12 * bitT) hist.shift();
      for (let i = 1; i < hist.length; i++) {
        if (hist[i][0] > startT + 9 * bitT && hist[i][1] === 0 && hist[i - 1][1] === 1) { beginFrame(hist[i][0]); break; }
      }
    };
    const rxEl = {
      stamp(St) { if (rx != null) St.G(rx, -1, 1e-7); },
      post(c) {
        if (rx == null) return false;
        const v = c.V(rx);
        const l = v >= S.vcc * 0.5 ? 1 : 0;
        if (level === null) { level = l; hist.push([c.t, l]); return false; }
        if (l !== level) {
          hist.push([c.t, l]);
          if (hist.length > 400) hist.splice(0, 200);
          if (state === 'idle' && l === 0) beginFrame(c.t);
          level = l;
        }
        return false;
      },
    };
    // --- transmit: drive TXD + logically deliver to connected MCU USARTs ---
    const txEl = { stamp(St) { St.norton(tx, -1, 1 / 50, inst.txLevel ? S.vcc : 0); } };
    const pump = () => {
      if (inst.txBusy || !inst.txQueue.length) return;
      const b = inst.txQueue.shift();
      inst.txBusy = true;
      const t0 = S.time;
      const frame = [0];
      for (let i = 0; i < 8; i++) frame.push((b >> i) & 1);
      frame.push(1);
      frame.forEach((lvl, i) => S.schedule(t0 + i * bitT, () => { inst.txLevel = lvl; return true; }));
      S.schedule(t0 + 10 * bitT, () => { inst.txBusy = false; S.deliverSerial(tx, b, baud); pump(); return false; });
    };
    inst.send = (bytes) => { for (const b of bytes) inst.txQueue.push(b & 0xff); pump(); };
    inst.elements = [rxEl, txEl];
    S.registerInstrument(inst);
    return inst;
  },
});

// ---------------------------------------------------------------------------
// Meters
// ---------------------------------------------------------------------------
function meterDef(type, name, unit, desc, series) {
  register({
    type, name, category: CAT, prefix: series ? 'AM' : 'VM',
    desc,
    props: [],
    valueText: () => (series ? 'DC AMMETER' : 'DC VOLTMETER'),
    symbol() {
      const s = new Sym();
      s.rect(-30, -20, 60, 40, 'inst');
      s.pin('+', -20, 30, 'U', 10).pin('-', 20, 30, 'U', 10);
      s.text(-24, 15, '+', { size: 9, cls: 'insttx' }).text(24, 15, '−', { size: 9, cls: 'insttx', a: 'end' });
      s.rect(-26, -16, 52, 20, 'lcdm');
      return s.ref(-30, -26).val(0, -26).build();
    },
    dyn(part, inst) {
      const v = inst ? inst.value : null;
      const txt = v == null ? (series ? '---- A' : '---- V') : formatSI(v, unit, 3);
      return `<text x="0" y="-1" text-anchor="middle" class="meter">${esc(txt)}</text>`;
    },
    sim(part, n) {
      const a = n('+'), b = n('-');
      const R = series ? 0.01 : 1e7;
      const inst = { value: 0, sum: 0, tAcc: 0, inst: 0 };
      inst.elements = [{
        stamp(St) { St.G(a, b, 1 / R); },
        post(c) { inst.inst = series ? (c.V(a) - c.V(b)) / R : c.V(a) - c.V(b); return false; },
        integrate(dt) { inst.sum += inst.inst * dt; inst.tAcc += dt; },
      }];
      inst.frame = () => {
        inst.value = inst.tAcc > 0 ? inst.sum / inst.tAcc : inst.inst;
        if (Math.abs(inst.value) < (series ? 1e-7 : 1e-4)) inst.value = 0;
        inst.sum = 0; inst.tAcc = 0;
      };
      return inst;
    },
  });
}
meterDef('voltmeter', 'DC Voltmeter', 'V', 'DC 전압계 (평균값 표시, 내부저항 10MΩ)', false);
meterDef('ammeter', 'DC Ammeter', 'A', 'DC 전류계 (직렬 연결, 평균값 표시)', true);

register({
  type: 'vprobe', name: 'Voltage Probe', category: CAT, prefix: 'P', hideRef: true,
  desc: '연결된 네트의 전압을 표시하는 프로브',
  props: [],
  symbol() {
    const s = new Sym();
    s.pin('1', 0, 0, 'R', 0);
    s.poly([0, 0, 8, -8, 12, -8, 12, -4], 'sl');
    return s.build();
  },
  dyn(part, inst) {
    const txt = inst ? formatSI(inst.value, 'V', 3) : '?V';
    return `<rect x="11" y="-18" width="${txt.length * 6 + 8}" height="13" rx="2" class="probebg"/><text x="15" y="-8.5" class="probet">${esc(txt)}</text>`;
  },
  sim(part, n) {
    const a = n('1');
    const inst = { value: 0, sum: 0, tAcc: 0, v: 0 };
    inst.elements = [{
      stamp() {},
      post(c) { inst.v = c.V(a); return false; },
      integrate(dt) { inst.sum += inst.v * dt; inst.tAcc += dt; },
    }];
    inst.frame = () => { inst.value = inst.tAcc > 0 ? inst.sum / inst.tAcc : inst.v; inst.sum = 0; inst.tAcc = 0; };
    return inst;
  },
});
