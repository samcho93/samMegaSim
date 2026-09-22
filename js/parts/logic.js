// Digital logic parts (implicit VCC/GND like Proteus hidden power pins)
import { register, Sym, logicLevel } from './kit.js';

const CAT = 'Logic ICs';

/** Push-pull digital output driver */
export function driver(node, S, rOut = 50) {
  return {
    node, level: 0, hiZ: false,
    stamp(St) { if (!this.hiZ) St.norton(this.node, -1, 1 / rOut, this.level ? S.vcc : 0); },
  };
}

function inputProbe(node) {
  return { stamp(St) { St.G(node, -1, 1e-8); } };
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------
const GATES = {
  and: { name: 'AND', fn: (a, b) => a & b },
  nand: { name: 'NAND', fn: (a, b) => (a & b) ^ 1, inv: true },
  or: { name: 'OR', fn: (a, b) => a | b },
  nor: { name: 'NOR', fn: (a, b) => (a | b) ^ 1, inv: true },
  xor: { name: 'XOR', fn: (a, b) => a ^ b },
  xnor: { name: 'XNOR', fn: (a, b) => (a ^ b) ^ 1, inv: true },
  not: { name: 'NOT', fn: (a) => a ^ 1, inv: true, one: true },
  buf: { name: 'BUFFER', fn: (a) => a, one: true },
};

function gateSymbol(kind) {
  return () => {
    const g = GATES[kind];
    const s = new Sym();
    const base = kind.replace(/^n(?!ot)/, '').replace(/^x?n?/, (m) => m); // not used
    void base;
    const isOr = /or/.test(kind), isX = /^x/.test(kind), isAnd = /and/.test(kind);
    if (g.one) {
      s.pin('A', -30, 0, 'R', 18);
      s.poly([-12, -11, -12, 11, 8, 0], 'sb', true);
      s.pin('Y', 30, 0, 'L', g.inv ? 16 : 22);
      if (g.inv) s.circle(11, 0, 3, 'sl');
    } else {
      s.pin('A', -30, -10, 'R', isOr ? 22 : 18).pin('B', -30, 10, 'R', isOr ? 22 : 18);
      if (isAnd) s.path('M-12,-15 H0 A15,15 0 0 1 0,15 H-12 Z', 'sb', [-12, -15, 15, 15]);
      else s.path('M-12,-15 Q4,-15 15,0 Q4,15 -12,15 Q-5,0 -12,-15 Z', 'sb', [-12, -15, 15, 15]);
      if (isX) s.path('M-17,-15 Q-10,0 -17,15', 'sl');
      if (g.inv) { s.circle(18, 0, 3, 'sl'); s.pin('Y', 30, 0, 'L', 9); } else s.pin('Y', 30, 0, 'L', 15);
    }
    return s.ref(-12, -20).val(-12, 26).build();
  };
}

for (const [kind, g] of Object.entries(GATES)) {
  register({
    type: `gate_${kind}`, name: `${g.name} Gate`, category: CAT, prefix: 'U',
    desc: `${g.name} 논리 게이트 (74HC 계열, 전원 핀 생략)`,
    props: [],
    valueText: () => ({ and: '74HC08', nand: '74HC00', or: '74HC32', nor: '74HC02', xor: '74HC86', xnor: '74HC266', not: '74HC04', buf: '74HC125' }[kind]),
    symbol: gateSymbol(kind),
    sim(part, n, S) {
      const out = driver(n('Y'), S);
      const a = n('A'), b = g.one ? -1 : n('B');
      let la = 0, lb = 0;
      out.level = g.one ? g.fn(0) : g.fn(0, 0);
      const inst = {
        elements: [out, inputProbe(a), ...(g.one ? [] : [inputProbe(b)])],
      };
      inst.elements.push({
        stamp() {},
        post(c) {
          la = logicLevel(c.V(a), S.vcc, la);
          if (!g.one) lb = logicLevel(c.V(b), S.vcc, lb);
          const y = g.one ? g.fn(la) : g.fn(la, lb);
          if (y !== out.level) { out.level = y; return true; }
          return false;
        },
      });
      return inst;
    },
  });
}

// ---------------------------------------------------------------------------
// Generic IC box helper
// ---------------------------------------------------------------------------
function icBox(left, right, { top = [], bottom = [], width = 60 } = {}) {
  const s = new Sym();
  const n = Math.max(left.length, right.length);
  const H = Math.ceil(((n + 1) * 10) / 20) * 20; // keeps every pin on the 10-unit grid
  const W = width;
  s.rect(-W / 2, -H / 2, W, H, 'sb');
  left.forEach((p, i) => { if (p) s.pin(p.id, -W / 2 - 20, -H / 2 + 10 + i * 10, 'R', 20, { name: p.name ?? p.id, showName: true, num: p.num, showNum: true, inv: p.inv, clk: p.clk, nameSize: 7 }); });
  right.forEach((p, i) => { if (p) s.pin(p.id, W / 2 + 20, -H / 2 + 10 + i * 10, 'L', 20, { name: p.name ?? p.id, showName: true, num: p.num, showNum: true, inv: p.inv, nameSize: 7 }); });
  top.forEach((p, i) => s.pin(p.id, -((top.length - 1) * 20) / 2 + i * 20, -H / 2 - 20, 'D', 20, { name: p.name ?? p.id, showName: true, num: p.num, showNum: true, nameSize: 7 }));
  bottom.forEach((p, i) => s.pin(p.id, -((bottom.length - 1) * 20) / 2 + i * 20, H / 2 + 20, 'U', 20, { name: p.name ?? p.id, showName: true, num: p.num, showNum: true, nameSize: 7 }));
  return { s, W, H };
}

// ---------------------------------------------------------------------------
// 74HC595 shift register
// ---------------------------------------------------------------------------
register({
  type: 'hc595', name: '74HC595 Shift Register', category: CAT, prefix: 'U',
  desc: '8비트 시프트 레지스터 (직렬→병렬). 소프트웨어/하드웨어 SPI 모두 지원',
  props: [],
  valueText: () => '74HC595',
  symbol() {
    const { s, H } = icBox(
      [{ id: 'DS', num: 14 }, null, { id: 'SHCP', num: 11, clk: true }, { id: 'STCP', num: 12, clk: true }, null, { id: 'MR', num: 10, inv: true }, { id: 'OE', num: 13, inv: true }],
      [{ id: 'Q0', num: 15 }, { id: 'Q1', num: 1 }, { id: 'Q2', num: 2 }, { id: 'Q3', num: 3 }, { id: 'Q4', num: 4 }, { id: 'Q5', num: 5 }, { id: 'Q6', num: 6 }, { id: 'Q7', num: 7 }, null, { id: 'Q7S', name: "Q7'", num: 9 }],
      { width: 60 },
    );
    return s.ref(-30, -H / 2 - 6).val(0, -H / 2 - 6).build();
  },
  sim(part, n, S) {
    const outs = Array.from({ length: 8 }, (_, i) => driver(n('Q' + i), S));
    const q7s = driver(n('Q7S'), S);
    const ins = ['DS', 'SHCP', 'STCP', 'MR', 'OE'].map((p) => inputProbe(n(p)));
    const st = { sr: 0, latch: 0, sh: 0, stc: 0, lv: {} };
    const L = (c, pin, def) => {
      const node = n(pin);
      if (S.isUnconnected(part.id, pin)) return def;
      return (st.lv[pin] = logicLevel(c.V(node), S.vcc, st.lv[pin]));
    };
    const logic = {
      stamp() {},
      post(c) {
        const mr = L(c, 'MR', 1), oe = L(c, 'OE', 0), sh = L(c, 'SHCP', 0), stc = L(c, 'STCP', 0);
        if (!mr) st.sr = 0;
        else if (sh && !st.sh) st.sr = ((st.sr << 1) | L(c, 'DS', 0)) & 0xff;
        if (stc && !st.stc) st.latch = st.sr;
        st.sh = sh; st.stc = stc;
        let changed = false;
        outs.forEach((o, i) => {
          const lvl = (st.latch >> i) & 1;
          if (o.level !== lvl || o.hiZ !== !!oe) { o.level = lvl; o.hiZ = !!oe; changed = true; }
        });
        const s7 = (st.sr >> 7) & 1;
        if (q7s.level !== s7) { q7s.level = s7; changed = true; }
        return changed;
      },
    };
    return { elements: [...outs, q7s, ...ins, logic], st };
  },
});

// ---------------------------------------------------------------------------
// 74HC138 3-to-8 decoder
// ---------------------------------------------------------------------------
register({
  type: 'hc138', name: '74HC138 Decoder', category: CAT, prefix: 'U',
  desc: '3→8 디코더 (출력 액티브 LOW)',
  props: [],
  valueText: () => '74HC138',
  symbol() {
    const { s, H } = icBox(
      [{ id: 'A0', num: 1 }, { id: 'A1', num: 2 }, { id: 'A2', num: 3 }, null, { id: 'E1', num: 4, inv: true }, { id: 'E2', num: 5, inv: true }, { id: 'E3', num: 6 }],
      Array.from({ length: 8 }, (_, i) => ({ id: 'Y' + i, num: [15, 14, 13, 12, 11, 10, 9, 7][i], inv: true })),
    );
    return s.ref(-30, -H / 2 - 6).val(0, -H / 2 - 6).build();
  },
  sim(part, n, S) {
    const outs = Array.from({ length: 8 }, (_, i) => { const d = driver(n('Y' + i), S); d.level = 1; return d; });
    const lv = {};
    const L = (c, pin, def) => (S.isUnconnected(part.id, pin) ? def : (lv[pin] = logicLevel(c.V(n(pin)), S.vcc, lv[pin])));
    return {
      elements: [...outs, ...['A0', 'A1', 'A2', 'E1', 'E2', 'E3'].map((p) => inputProbe(n(p))), {
        stamp() {},
        post(c) {
          const en = !L(c, 'E1', 0) && !L(c, 'E2', 0) && L(c, 'E3', 1);
          const a = L(c, 'A0', 0) | (L(c, 'A1', 0) << 1) | (L(c, 'A2', 0) << 2);
          let changed = false;
          outs.forEach((o, i) => { const v = en && i === a ? 0 : 1; if (o.level !== v) { o.level = v; changed = true; } });
          return changed;
        },
      }],
    };
  },
});

// ---------------------------------------------------------------------------
// Proteus-style LOGICSTATE (clickable source) and LOGICPROBE
// ---------------------------------------------------------------------------
register({
  type: 'logicstate', name: 'Logic State (0/1)', category: 'Debug Tools', prefix: 'L',
  desc: '클릭하여 0/1을 출력하는 논리 입력원 (Proteus LOGICSTATE)',
  props: [{ key: 'state', label: '초기값', default: '0', options: ['0', '1'] }],
  valueText: () => 'LOGICSTATE',
  hideRef: false,
  symbol() {
    const s = new Sym();
    s.rect(-24, -9, 18, 18, 'sb');
    s.pin('Q', 10, 0, 'L', 16);
    return s.ref(-24, -14).val(-24, 22).build();
  },
  dyn(part, inst) {
    const v = inst ? inst.level : +part.props.state;
    return `<g data-act="toggle" class="clk"><rect x="-22" y="-7" width="14" height="14" class="lstate ${v ? 'hi' : 'lo'}"/>` +
      `<text x="-15" y="3.5" text-anchor="middle" class="lstatet">${v}</text></g>`;
  },
  sim(part, n, S) {
    const d = driver(n('Q'), S, 10);
    d.level = +part.props.state ? 1 : 0;
    const inst = { elements: [d] };
    Object.defineProperty(inst, 'level', { get: () => d.level });
    inst.action = (act, phase) => { if (phase === 'down') { d.level ^= 1; return true; } return false; };
    return inst;
  },
});

register({
  type: 'logicprobe', name: 'Logic Probe', category: 'Debug Tools', prefix: 'L',
  desc: '논리 레벨 표시기 (Proteus LOGICPROBE)',
  props: [],
  valueText: () => 'LOGICPROBE',
  symbol() {
    const s = new Sym();
    s.pin('A', -20, 0, 'R', 10);
    s.rect(-10, -9, 18, 18, 'sb');
    return s.ref(-10, -14).val(-10, 22).build();
  },
  dyn(part, inst) {
    const v = inst ? inst.level : null;
    const cls = v == null ? 'na' : v === 1 ? 'hi' : v === 0 ? 'lo' : 'na';
    const t = v == null ? '?' : v === 2 ? '?' : String(v);
    return `<rect x="-8" y="-7" width="14" height="14" class="lstate ${cls}"/><text x="-1" y="3.5" text-anchor="middle" class="lstatet">${t}</text>`;
  },
  sim(part, n, S) {
    const a = n('A');
    const inst = { level: 2 };
    inst.elements = [inputProbe(a), {
      stamp() {},
      post(c) {
        const v = c.V(a);
        inst.level = S.isUnconnected(part.id, 'A') ? 2 : v >= S.vcc * 0.6 ? 1 : v <= S.vcc * 0.3 ? 0 : 2;
        return false;
      },
    }];
    return inst;
  },
});

export { icBox };
