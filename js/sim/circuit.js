// Event-driven DC/transient circuit solver (Modified Nodal Analysis).
// Nodes are net indices; ground is -1. Non-linear devices use piecewise-linear
// models and are iterated until their state is consistent.

const GMIN = 1e-9;

export class Stamper {
  constructor() {
    this.n = 0; this.size = 0; this.A = null; this.b = null;
  }
  init(nNodes, nVs) {
    this.n = nNodes;
    this.size = nNodes + nVs;
    const N = this.size;
    if (!this.A || this.A.length !== N * N) {
      this.A = new Float64Array(N * N);
      this.b = new Float64Array(N);
    } else {
      this.A.fill(0);
      this.b.fill(0);
    }
    for (let i = 0; i < nNodes; i++) this.A[i * N + i] = GMIN;
  }
  G(a, b, g) {
    const { A, size: N } = this;
    if (a >= 0) A[a * N + a] += g;
    if (b >= 0) A[b * N + b] += g;
    if (a >= 0 && b >= 0) { A[a * N + b] -= g; A[b * N + a] -= g; }
  }
  I(a, i) { if (a >= 0) this.b[a] += i; }
  /** voltage source v (a relative to b) with series conductance g */
  norton(a, b, g, v) { this.G(a, b, g); this.I(a, g * v); this.I(b, -g * v); }
  /** ideal voltage source using branch k: V(a) - V(b) = v */
  V(k, a, b, v) {
    const { A, size: N } = this;
    const r = this.n + k;
    if (a >= 0) { A[a * N + r] += 1; A[r * N + a] += 1; }
    if (b >= 0) { A[b * N + r] -= 1; A[r * N + b] -= 1; }
    this.b[r] += v;
  }
  /** voltage controlled current source: I = gm * (V(cp)-V(cn)) flowing from a to b (through element) */
  VCCS(a, b, cp, cn, gm) {
    const { A, size: N } = this;
    // current leaves node a, enters node b
    if (a >= 0) { if (cp >= 0) A[a * N + cp] += gm; if (cn >= 0) A[a * N + cn] -= gm; }
    if (b >= 0) { if (cp >= 0) A[b * N + cp] -= gm; if (cn >= 0) A[b * N + cn] += gm; }
  }
  solve(x) {
    const { A, b, size: N } = this;
    const M = A, r = b;
    for (let c = 0; c < N; c++) {
      let piv = c, best = Math.abs(M[c * N + c]);
      for (let i = c + 1; i < N; i++) {
        const v = Math.abs(M[i * N + c]);
        if (v > best) { best = v; piv = i; }
      }
      if (best < 1e-18) continue;
      if (piv !== c) {
        for (let j = c; j < N; j++) { const t = M[c * N + j]; M[c * N + j] = M[piv * N + j]; M[piv * N + j] = t; }
        const t = r[c]; r[c] = r[piv]; r[piv] = t;
      }
      const d = M[c * N + c];
      for (let i = c + 1; i < N; i++) {
        const f = M[i * N + c] / d;
        if (f === 0) continue;
        for (let j = c; j < N; j++) M[i * N + j] -= f * M[c * N + j];
        r[i] -= f * r[c];
      }
    }
    for (let i = N - 1; i >= 0; i--) {
      let s = r[i];
      for (let j = i + 1; j < N; j++) s -= M[i * N + j] * x[j];
      const d = M[i * N + i];
      x[i] = Math.abs(d) < 1e-18 ? 0 : s / d;
    }
    return x;
  }
}

export class Circuit {
  constructor(nodeCount) {
    this.nodeCount = nodeCount;
    this.elements = [];
    this.nVs = 0;
    this.S = new Stamper();
    this.x = new Float64Array(nodeCount);
    this.t = 0;
    this.lastT = 0;
    this.solving = false;
    this.pending = false;
    this.solveCount = 0;
    this.dynamic = []; // elements with integrate()
    this.reactive = []; // capacitors etc: need time-stepping
    this.nextReactiveT = Infinity;
    this.reactiveStep = 1e-5;
    this.warnings = new Set();
  }

  add(el) {
    if (el.vsCount) { el.vsBase = this.nVs; this.nVs += el.vsCount; }
    this.elements.push(el);
    if (el.integrate) this.dynamic.push(el);
    if (el.reactive) this.reactive.push(el);
    return el;
  }

  finalize() {
    this.x = new Float64Array(this.nodeCount + this.nVs);
    this.nonlinear = this.elements.filter((e) => e.updateNL);
    this.posters = this.elements.filter((e) => e.post);
  }

  V(node) { return node >= 0 ? this.x[node] : 0; }

  /** Solve the circuit at time t (seconds). */
  solve(t) {
    if (this.solving) { this.pending = true; return; }
    this.solving = true;
    try {
      if (t < this.t) t = this.t;
      const dt = t - this.t;
      if (dt > 0) for (const el of this.dynamic) el.integrate(dt, this);
      this.t = t;
      let rounds = 0;
      do {
        this.pending = false;
        this._solveNL(dt);
        let changed = false;
        for (const el of this.posters) if (el.post(this)) changed = true;
        if (changed) this.pending = true;
      } while (this.pending && ++rounds < 12);
      for (const el of this.reactive) el.accept?.(this);
      this._scheduleReactive();
    } finally {
      this.solving = false;
    }
  }

  _solveNL(dt) {
    const { S } = this;
    const env = { dt, t: this.t };
    for (let iter = 0; iter < 40; iter++) {
      S.init(this.nodeCount, this.nVs);
      for (const el of this.elements) el.stamp(S, env, this);
      S.solve(this.x);
      this.solveCount++;
      let changed = false;
      for (const el of this.nonlinear) if (el.updateNL(this)) changed = true;
      if (!changed) return;
    }
    this.warnings.add('비선형 소자 수렴 실패');
  }

  _scheduleReactive() {
    if (!this.reactive.length) { this.nextReactiveT = Infinity; return; }
    let maxRate = 0;
    for (const el of this.reactive) maxRate = Math.max(maxRate, el.activity?.(this) || 0);
    if (maxRate < 1e-4) { this.nextReactiveT = Infinity; this.reactiveStep = 1e-6; return; }
    // Adaptive step: fast when changing, slower as it settles
    if (maxRate > 0.05) this.reactiveStep = Math.max(this.reactiveStep / 2, 1e-6);
    else if (maxRate < 0.02) this.reactiveStep = Math.min(this.reactiveStep * 1.5, 2e-3);
    this.nextReactiveT = this.t + this.reactiveStep;
  }

  kickReactive() { this.reactiveStep = 1e-6; }

  /** Move time forward without re-solving (for averaging meters between events) */
  advanceTo(t) {
    if (this.solving) return;
    const dt = t - this.t;
    if (dt > 0) {
      for (const el of this.dynamic) el.integrate(dt, this);
      this.t = t;
    }
  }
}

// ---------------------------------------------------------------------------
// Reusable element models
// ---------------------------------------------------------------------------
export function resistor(a, b, R) {
  const g = 1 / Math.max(R, 1e-6);
  return {
    a, b, g, i: 0,
    stamp(S) { S.G(this.a, this.b, this.g); },
  };
}

/** Piecewise-linear diode: off = open, on = Vf + Rs */
export function diode(a, k, Vf = 0.7, Rs = 1) {
  return {
    a, k, Vf, Rs, on: false, i: 0,
    stamp(S) {
      if (this.on) S.norton(this.a, this.k, 1 / this.Rs, this.Vf);
      else S.G(this.a, this.k, 1e-12);
    },
    updateNL(c) {
      const vd = c.V(this.a) - c.V(this.k);
      if (!this.on && vd > this.Vf + 1e-6) { this.on = true; return true; }
      if (this.on && vd < this.Vf - 1e-6) { this.on = false; return true; }
      return false;
    },
    current(c) { return this.on ? (c.V(this.a) - c.V(this.k) - this.Vf) / this.Rs : 0; },
  };
}

/** Capacitor with backward-Euler companion model */
export function capacitor(a, b, C) {
  return {
    a, b, C, v: 0, lastT: 0, reactive: true,
    stamp(S, env) {
      const dt = Math.max(env.t - this.lastT, 1e-9);
      const g = this.C / dt;
      S.norton(this.a, this.b, g, this.v);
    },
    accept(c) {
      const nv = c.V(this.a) - c.V(this.b);
      this.dv = Math.abs(nv - this.v);
      this.v = nv;
      this.lastT = c.t;
    },
    activity() { return this.dv || 0; },
  };
}

export function parseSI(str, fallback = 0) {
  if (typeof str === 'number') return str;
  if (str == null) return fallback;
  let s = String(str).trim().replace(/,/g, '').replace(/\s*(ohms?|Ω|Hz|F|H|V|A|s|°C)$/i, '').trim();
  const mult = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, R: 1 };
  // "4k7" notation
  const m1 = /^(\d+)([pnuµmkKMGR])(\d+)$/.exec(s);
  if (m1) return parseFloat(`${m1[1]}.${m1[3]}`) * mult[m1[2]];
  const m2 = /^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([pnuµmkKMGR]?)$/.exec(s);
  if (m2) return parseFloat(m2[1]) * (m2[2] ? mult[m2[2]] : 1);
  const f = parseFloat(s);
  return Number.isFinite(f) ? f : fallback;
}

export function formatSI(v, unit = '', digits = 3) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const tab = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
  if (a === 0) return `0${unit}`;
  for (const [f, p] of tab) {
    if (a >= f * 0.9995) return `${+(v / f).toPrecision(digits)}${p}${unit}`;
  }
  return `${+(v / 1e-12).toPrecision(digits)}p${unit}`;
}
