// Basic parts: power, passive, semiconductors, switches, electromechanical
import { register, Sym, esc } from './kit.js';
import { resistor, diode, capacitor, parseSI, formatSI } from '../sim/circuit.js';

const C = { R: 'Passive', S: 'Semiconductor', P: 'Power', SW: 'Switches', EM: 'Electromechanical', SEN: 'Sensors', SRC: 'Sources' };

// ---------------------------------------------------------------------------
// Power symbols
// ---------------------------------------------------------------------------
function powerDef(type, name, net, voltage, style) {
  register({
    type, name, category: C.P, prefix: '#PWR', isPower: true, hideRef: true,
    desc: `${net} 전원 심볼 (${voltage}V)`,
    props: [
      { key: 'net', label: '네트 이름', default: net },
      { key: 'voltage', label: '전압 (V)', default: String(voltage) },
    ],
    globalNet: (p) => p.net || net,
    powerVoltage: (p) => parseSI(p.voltage, voltage),
    symbolKey: (p) => p.net || net,
    symbol(p) {
      const s = new Sym();
      const label = p.net || net;
      if (style === 'gnd') {
        s.line(0, 0, 0, 6).poly([-7, 6, 7, 6, 0, 13], 'sl', true);
        s.text(0, 22, label, { a: 'middle', size: 8, cls: 'pw' });
      } else if (style === 'bar') {
        s.line(0, 0, 0, -8).line(-7, -8, 7, -8, 'sl thick');
        s.text(0, -15, label, { a: 'middle', size: 8, cls: 'pw' });
      } else {
        s.line(0, 0, 0, -9).poly([-5, -4, 0, -10, 5, -4], 'sl');
        s.text(0, -16, label, { a: 'middle', size: 8, cls: 'pw' });
      }
      s.pins.push({ id: '1', name: label, x: 0, y: 0, side: 'U', len: 0 });
      return s.build();
    },
    sim: () => null,
  });
}
powerDef('gnd', 'GND', 'GND', 0, 'gnd');
powerDef('vcc', 'VCC', 'VCC', 5, 'bar');
powerDef('p5v', '+5V', '+5V', 5, 'arrow');
powerDef('p3v3', '+3.3V', '+3.3V', 3.3, 'arrow');
powerDef('p12v', '+12V', '+12V', 12, 'arrow');

// Net label (global)
register({
  type: 'label', name: 'Net Label', category: C.P, prefix: '#LBL', hideRef: true,
  desc: '같은 이름의 라벨끼리 연결됩니다',
  props: [{ key: 'name', label: '네트 이름', default: 'NET' }],
  globalNet: (p) => p.name || 'NET',
  symbolKey: (p) => p.name,
  symbol(p) {
    const s = new Sym();
    const t = p.name || 'NET';
    const w = Math.max(20, Math.ceil((t.length * 6.2 + 8) / 10) * 10);
    s.poly([0, 0, 6, -6, 6 + w, -6, 6 + w, 6, 6, 6], 'lbl', true);
    s.text(9, 0, t, { a: 'start', size: 9, cls: 'lblt' });
    s.pins.push({ id: '1', name: t, x: 0, y: 0, side: 'R', len: 0 });
    return s.build();
  },
  sim: () => null,
});

// Battery / DC source
register({
  type: 'battery', name: 'Battery (DC)', category: C.SRC, prefix: 'BT',
  desc: '직류 전압원',
  props: [{ key: 'value', label: '전압 (V)', default: '9V' }],
  symbol() {
    const s = new Sym();
    s.pin('+', 0, -30, 'D', 24).pin('-', 0, 30, 'U', 24);
    s.line(-10, -6, 10, -6, 'sl thick').line(-5, -2, 5, -2, 'sl thick2');
    s.line(-10, 2, 10, 2, 'sl thick').line(-5, 6, 5, 6, 'sl thick2');
    s.text(-12, -14, '+', { size: 9, cls: 'pn' });
    return s.ref(14, -5).val(14, 6).build();
  },
  sim(part, n) {
    const V = parseSI(part.props.value, 9);
    return { stamp(S) { S.norton(n('+'), n('-'), 20, V); } };
  },
});

// Signal generator
register({
  type: 'siggen', name: 'Signal Generator', category: C.SRC, prefix: 'SG',
  desc: '구형파/정현파/삼각파 신호 발생기 (클럭 소스)',
  props: [
    { key: 'wave', label: '파형', default: 'square', options: ['square', 'sine', 'triangle'] },
    { key: 'freq', label: '주파수 (Hz)', default: '1k' },
    { key: 'amp', label: '진폭 Vpp', default: '5' },
    { key: 'offset', label: '오프셋 (V)', default: '0' },
    { key: 'duty', label: '듀티 (%)', default: '50' },
  ],
  symbolKey: (p) => p.wave,
  symbol(p) {
    const s = new Sym();
    s.pin('+', 0, -30, 'D', 16).pin('-', 0, 30, 'U', 16);
    s.circle(0, 0, 14, 'sb');
    if (p.wave === 'sine') s.path('M-8,0 C-5,-10 -3,-10 0,0 S5,10 8,0', 'sl');
    else if (p.wave === 'triangle') s.poly([-8, 4, -4, -5, 4, 5, 8, -4], 'sl');
    else s.poly([-8, 5, -8, -5, 0, -5, 0, 5, 8, 5, 8, -5], 'sl');
    s.text(-4, -20, '+', { size: 9, cls: 'pn', a: 'end' });
    return s.ref(18, -5).val(18, 6).build();
  },
  sim(part, n, S) {
    const p = part.props;
    const f = Math.max(0.01, parseSI(p.freq, 1000));
    const amp = parseSI(p.amp, 5), off = parseSI(p.offset, 0);
    const duty = Math.min(99, Math.max(1, parseFloat(p.duty) || 50)) / 100;
    const T = 1 / f;
    const inst = {
      v: off,
      stamp(St) { St.norton(n('+'), n('-'), 1 / 50, this.v); },
      reset() { this.v = value(0); schedule(0); },
    };
    const value = (t) => {
      const ph = (t % T) / T;
      if (p.wave === 'sine') return off + (amp / 2) * Math.sin(2 * Math.PI * ph);
      if (p.wave === 'triangle') return off + amp * (ph < 0.5 ? ph * 2 : 2 - ph * 2) - amp / 2 + amp / 2;
      return off + (ph < duty ? amp : 0);
    };
    const step = p.wave === 'square' ? null : Math.max(T / 40, 20e-6);
    const schedule = (t) => {
      let next;
      if (step) next = t + step;
      else {
        const k = Math.floor(t / T + 1e-9);
        const tHigh = k * T + duty * T;
        next = t < tHigh - 1e-12 ? tHigh : (k + 1) * T;
      }
      S.schedule(next, (tt) => { inst.v = value(tt + 1e-12); schedule(tt); return true; });
    };
    inst.v = value(0);
    schedule(0);
    return inst;
  },
});

// ---------------------------------------------------------------------------
// Passive
// ---------------------------------------------------------------------------
register({
  type: 'resistor', name: 'Resistor', category: C.R, prefix: 'R',
  desc: '저항 (예: 220, 4.7k, 4k7, 1M)',
  props: [{ key: 'value', label: '저항값 (Ω)', default: '1k' }],
  symbol() {
    const s = new Sym();
    s.pin('1', 0, -30, 'D', 10).pin('2', 0, 30, 'U', 10);
    s.rect(-4, -20, 8, 40, 'sb');
    return s.ref(8, -4).val(8, 7).build();
  },
  sim(part, n) {
    const r = resistor(n('1'), n('2'), parseSI(part.props.value, 1000));
    r.post = function (c) { this.i = (c.V(this.a) - c.V(this.b)) * this.g; return false; };
    return r;
  },
});

register({
  type: 'resarray', name: 'Resistor Array (8)', category: C.R, prefix: 'RN',
  desc: '독립 저항 8개 배열 (1~8 ↔ 16~9), LED/7세그먼트 전류 제한용',
  props: [{ key: 'value', label: '저항값 (Ω)', default: '330' }],
  symbol() {
    const s = new Sym();
    s.rect(-14, -45, 28, 90, 'sb');
    for (let i = 0; i < 8; i++) {
      const y = -40 + i * 10;
      s.pin(String(i + 1), -30, y, 'R', 16, { num: i + 1, showNum: true });
      s.pin(String(16 - i), 30, y, 'L', 16, { num: 16 - i, showNum: true });
      s.rect(-9, y - 2.5, 18, 5, 'sb');
      s.line(-14, y, -9, y).line(9, y, 14, y);
    }
    return s.ref(-14, -52).val(4, -52).build();
  },
  sim(part, n) {
    const R = parseSI(part.props.value, 330);
    return { elements: Array.from({ length: 8 }, (_, i) => resistor(n(String(i + 1)), n(String(16 - i)), R)) };
  },
});

register({
  type: 'capacitor', name: 'Capacitor', category: C.R, prefix: 'C',
  desc: '커패시터 (과도응답 모델)',
  props: [{ key: 'value', label: '용량 (F)', default: '100n' }],
  symbol() {
    const s = new Sym();
    s.pin('1', 0, -20, 'D', 17).pin('2', 0, 20, 'U', 17);
    s.line(-9, -3, 9, -3, 'sl thick').line(-9, 3, 9, 3, 'sl thick');
    return s.ref(12, -4).val(12, 7).build();
  },
  sim(part, n) { return capacitor(n('1'), n('2'), parseSI(part.props.value, 100e-9)); },
});

register({
  type: 'capacitor_pol', name: 'Capacitor (Electrolytic)', category: C.R, prefix: 'C',
  desc: '전해 커패시터',
  props: [{ key: 'value', label: '용량 (F)', default: '10u' }],
  symbol() {
    const s = new Sym();
    s.pin('+', 0, -20, 'D', 17).pin('-', 0, 20, 'U', 17);
    s.rect(-9, -4, 18, 3, 'sb');
    s.rect(-9, 2, 18, 3, 'sf');
    s.text(-12, -10, '+', { size: 9, cls: 'pn', a: 'middle' });
    return s.ref(13, -4).val(13, 7).build();
  },
  sim(part, n) { return capacitor(n('+'), n('-'), parseSI(part.props.value, 10e-6)); },
});

register({
  type: 'inductor', name: 'Inductor', category: C.R, prefix: 'L',
  desc: '인덕터 (DC 저항 모델)',
  props: [{ key: 'value', label: '인덕턴스 (H)', default: '10u' }, { key: 'dcr', label: 'DC 저항 (Ω)', default: '0.1' }],
  symbol() {
    const s = new Sym();
    s.pin('1', 0, -30, 'D', 10).pin('2', 0, 30, 'U', 10);
    s.path('M0,-20 a5,5 0 0 1 0,10 a5,5 0 0 1 0,10 a5,5 0 0 1 0,10 a5,5 0 0 1 0,10', 'sl', [0, -20, 6, 20]);
    return s.ref(10, -4).val(10, 7).build();
  },
  sim(part, n) { return resistor(n('1'), n('2'), Math.max(parseSI(part.props.dcr, 0.1), 0.01)); },
});

register({
  type: 'crystal', name: 'Crystal', category: C.R, prefix: 'Y',
  desc: '수정 발진자 (표시용, MCU 클럭은 MCU 속성에서 설정)',
  props: [{ key: 'value', label: '주파수', default: '16MHz' }],
  symbol() {
    const s = new Sym();
    s.pin('1', -20, 0, 'R', 12).pin('2', 20, 0, 'L', 12);
    s.line(-8, -8, -8, 8, 'sl thick').line(8, -8, 8, 8, 'sl thick');
    s.rect(-5, -10, 10, 20, 'sb');
    return s.ref(-10, -16).val(-10, 20).build();
  },
  sim: () => null,
});

function adjustable(key, def, min, max, stepv) {
  return { key, def, min, max, step: stepv };
}

// Potentiometer
register({
  type: 'pot', name: 'Potentiometer', category: C.R, prefix: 'RV',
  desc: '가변저항 — 시뮬레이션 중 ▲▼ 클릭 또는 마우스 휠로 조절',
  props: [
    { key: 'value', label: '저항값 (Ω)', default: '10k' },
    { key: 'pos', label: '위치 (0~100%)', default: '50' },
  ],
  adjust: adjustable('pos', 50, 0, 100, 5),
  symbol() {
    const s = new Sym();
    s.pin('1', 0, -30, 'D', 10).pin('2', 0, 30, 'U', 10).pin('W', 20, 0, 'L', 8);
    s.rect(-4, -20, 8, 40, 'sb');
    s.poly([12, 0, 6, -3, 6, 3], 'sf', true);
    return s.ref(-8, -4, 'end').val(-8, 7, 'end').build();
  },
  dyn(part) {
    const pos = +part.props.pos;
    return `<g class="adj"><polygon data-act="inc" points="14,-18 20,-10 8,-10" class="adjbtn"/><polygon data-act="dec" points="14,18 20,10 8,10" class="adjbtn"/></g>` +
      `<text x="24" y="-14" class="dyntx">${Math.round(pos)}%</text>`;
  },
  sim(part, n) {
    const R = parseSI(part.props.value, 10000);
    const inst = {
      stamp(S) {
        const p = Math.min(1, Math.max(0, (+part.props.pos || 0) / 100));
        S.G(n('1'), n('W'), 1 / Math.max(R * (1 - p), 0.5));
        S.G(n('W'), n('2'), 1 / Math.max(R * p, 0.5));
      },
    };
    return inst;
  },
});

// LDR
register({
  type: 'ldr', name: 'LDR (Photoresistor)', category: C.SEN, prefix: 'R',
  desc: '조도센서 — 밝기(0~100%)에 따라 저항 변화 (어두움 100kΩ ~ 밝음 1kΩ)',
  props: [
    { key: 'light', label: '밝기 (%)', default: '50' },
    { key: 'rdark', label: '암저항 (Ω)', default: '100k' },
    { key: 'rlight', label: '명저항 (Ω)', default: '1k' },
  ],
  adjust: adjustable('light', 50, 0, 100, 5),
  symbol() {
    const s = new Sym();
    s.pin('1', 0, -30, 'D', 10).pin('2', 0, 30, 'U', 10);
    s.rect(-4, -20, 8, 40, 'sb');
    s.line(-18, -14, -8, -6).poly([-8, -6, -12, -7, -10, -10], 'sf', true);
    s.line(-18, -4, -8, 4).poly([-8, 4, -12, 3, -10, 0], 'sf', true);
    return s.ref(8, -4).val(8, 7).build();
  },
  dyn(part) {
    const l = +part.props.light;
    return `<g class="adj"><polygon data-act="inc" points="14,-18 20,-10 8,-10" class="adjbtn"/><polygon data-act="dec" points="14,18 20,10 8,10" class="adjbtn"/></g>` +
      `<text x="24" y="-14" class="dyntx">☀${Math.round(l)}%</text>`;
  },
  sim(part, n) {
    const rd = parseSI(part.props.rdark, 1e5), rl = parseSI(part.props.rlight, 1e3);
    return {
      stamp(S) {
        const l = Math.min(1, Math.max(0, (+part.props.light || 0) / 100));
        S.G(n('1'), n('2'), 1 / (rd * Math.pow(rl / rd, l)));
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Semiconductors
// ---------------------------------------------------------------------------
function diodeSymbol(s, extra) {
  s.pin('A', -20, 0, 'R', 14).pin('K', 20, 0, 'L', 14);
  s.poly([-6, -6, -6, 6, 6, 0], extra?.fill ? 'sb led' : 'sb', true);
  s.line(6, -6, 6, 6, 'sl thick');
}

register({
  type: 'diode', name: 'Diode (1N4148)', category: C.S, prefix: 'D',
  desc: '다이오드 (Vf 0.7V)',
  props: [{ key: 'value', label: '모델', default: '1N4148' }, { key: 'vf', label: 'Vf (V)', default: '0.7' }],
  symbol() {
    const s = new Sym();
    diodeSymbol(s);
    return s.ref(-8, -12).val(-8, 16).build();
  },
  sim(part, n) { return diode(n('A'), n('K'), parseSI(part.props.vf, 0.7), 0.5); },
});

register({
  type: 'zener', name: 'Zener Diode', category: C.S, prefix: 'D',
  desc: '제너 다이오드',
  props: [{ key: 'value', label: 'Vz (V)', default: '5.1' }],
  symbol() {
    const s = new Sym();
    s.pin('A', -20, 0, 'R', 14).pin('K', 20, 0, 'L', 14);
    s.poly([-6, -6, -6, 6, 6, 0], 'sb', true);
    s.poly([3, -8, 6, -6, 6, 6, 9, 8], 'sl thick');
    return s.ref(-8, -12).val(-8, 16).build();
  },
  sim(part, n) {
    const f = diode(n('A'), n('K'), 0.7, 0.5);
    const r = diode(n('K'), n('A'), parseSI(part.props.value, 5.1), 1);
    return { elements: [f, r] };
  },
});

export const LED_COLORS = {
  red: { vf: 1.8, rgb: '#ff2a1a', name: '빨강' },
  green: { vf: 2.1, rgb: '#22e03a', name: '초록' },
  yellow: { vf: 2.0, rgb: '#ffd21a', name: '노랑' },
  orange: { vf: 2.0, rgb: '#ff8c1a', name: '주황' },
  blue: { vf: 3.0, rgb: '#2a7dff', name: '파랑' },
  white: { vf: 3.0, rgb: '#f4f4ff', name: '흰색' },
};

/** LED element with brightness averaging */
export function ledElement(a, k, color = 'red', imax = 0.005) {
  const c = LED_COLORS[color] || LED_COLORS.red;
  const d = diode(a, k, c.vf, 10);
  d.q = 0; d.tAcc = 0; d.i = 0; d.bright = 0; d.imax = imax; d.peak = 0;
  d.post = function (cir) { this.i = this.current(cir); return false; };
  d.integrate = function (dt) { this.q += this.i * dt; this.tAcc += dt; if (this.i > this.peak) this.peak = this.i; };
  d.frame = function () {
    const avg = this.tAcc > 0 ? this.q / this.tAcc : this.i;
    this.avgI = avg;
    // perceptual brightness: ~1mA already clearly visible
    this.bright = avg > 2e-5 ? Math.min(1, Math.sqrt(avg / this.imax)) : 0;
    this.burn = this.peak > 0.1;
    this.q = 0; this.tAcc = 0; this.peak = this.i;
  };
  return d;
}

export function hexA(color, a) {
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

register({
  type: 'led', name: 'LED', category: C.S, prefix: 'D',
  desc: '발광 다이오드 — 색상별 Vf, 전류에 따라 밝기 표시',
  props: [{ key: 'color', label: '색상', default: 'red', options: Object.keys(LED_COLORS) }],
  valueText: (p) => `LED_${(p.color || 'red').toUpperCase()}`,
  symbol() {
    const s = new Sym();
    s.pin('A', -20, 0, 'R', 14).pin('K', 20, 0, 'L', 14);
    s.line(6, -6, 6, 6, 'sl thick');
    s.line(0, -9, 5, -15).poly([5, -15, 1, -14, 4, -11], 'sf', true);
    s.line(5, -8, 10, -14).poly([10, -14, 6, -13, 9, -10], 'sf', true);
    return s.ref(-8, -14).val(-8, 16).build();
  },
  dyn(part, inst) {
    const c = LED_COLORS[part.props.color] || LED_COLORS.red;
    const b = inst?.el?.bright || 0;
    const fill = b > 0 ? hexA(c.rgb, 0.35 + 0.65 * b) : '#ffffc2';
    let g = '';
    if (b > 0) g += `<circle cx="0" cy="0" r="${10 + 6 * b}" fill="${hexA(c.rgb, 0.18 + 0.3 * b)}" class="glow"/>`;
    g += `<polygon points="-6,-6 -6,6 6,0" style="fill:${fill}" class="sl"/>`;
    if (inst?.el?.burn) g += `<text x="0" y="18" class="warn" text-anchor="middle">과전류!</text>`;
    return g;
  },
  sim(part, n) {
    const el = ledElement(n('A'), n('K'), part.props.color);
    return { elements: [el], el, frame() { el.frame(); } };
  },
});

// RGB LED (common cathode)
register({
  type: 'rgbled', name: 'RGB LED (Common Cathode)', category: C.S, prefix: 'D',
  desc: 'RGB LED 공통 캐소드',
  props: [{ key: 'common', label: '공통 단자', default: 'cathode', options: ['cathode', 'anode'] }],
  symbolKey: (p) => p.common,
  symbol(p) {
    const s = new Sym();
    const ca = p.common === 'anode';
    s.pin('R', -30, -20, 'R', 10, { name: 'R', showName: false }).pin('G', -30, 0, 'R', 10).pin('B', -30, 20, 'R', 10);
    s.pin(ca ? 'A' : 'K', 30, 0, 'L', 10);
    s.rect(-20, -30, 40, 60, 'sb');
    s.text(-17, -20, 'R', { size: 8, cls: 'pn' }).text(-17, 0, 'G', { size: 8, cls: 'pn' }).text(-17, 20, 'B', { size: 8, cls: 'pn' });
    s.text(17, 0, ca ? 'A' : 'K', { size: 8, cls: 'pn', a: 'end' });
    return s.ref(-20, -36).val(-20, 40).build();
  },
  valueText: (p) => (p.common === 'anode' ? 'RGB_CA' : 'RGB_CC'),
  dyn(part, inst) {
    const els = inst?.leds || [];
    const [r, g, b] = [0, 1, 2].map((i) => els[i]?.bright || 0);
    const fill = `rgb(${Math.round(60 + 195 * r)},${Math.round(60 + 195 * g)},${Math.round(60 + 195 * b)})`;
    const on = r + g + b > 0;
    return `<circle cx="2" cy="0" r="11" style="fill:${on ? fill : '#ffffc2'}" class="sl"/>` +
      (on ? `<circle cx="2" cy="0" r="17" style="fill:${fill};opacity:.35"/>` : '');
  },
  sim(part, n) {
    const ca = part.props.common === 'anode';
    const colors = ['red', 'green', 'blue'];
    const leds = ['R', 'G', 'B'].map((pin, i) => (ca ? ledElement(n('A'), n(pin), colors[i]) : ledElement(n(pin), n('K'), colors[i])));
    return { elements: leds, leds, frame() { leds.forEach((l) => l.frame()); } };
  },
});

// BJT
function bjtModel(type, nb, nc, ne, beta) {
  // piecewise-linear: BE diode + CE (off / active VCCS / saturated switch)
  const npn = type === 'npn';
  const s = npn ? 1 : -1;
  const el = {
    state: 0, // 0 off, 1 active, 2 saturation
    stamp(S) {
      const gbe = 1 / 100;
      const vbe0 = 0.65 * s;
      if (this.state === 0) {
        S.G(nb, ne, 1e-12); S.G(nc, ne, 1e-12);
        return;
      }
      // B-E junction
      S.norton(nb, ne, gbe, vbe0);
      if (this.state === 1) {
        // Ic = beta * Ib = beta*gbe*(Vbe - vbe0) flowing C->E (npn)
        S.VCCS(nc, ne, nb, ne, beta * gbe);
        S.I(nc, beta * gbe * vbe0);
        S.I(ne, -beta * gbe * vbe0);
        S.G(nc, ne, 1e-7);
      } else {
        S.norton(nc, ne, 1 / 2, 0.1 * s);
      }
    },
    updateNL(c) {
      const vbe = (c.V(nb) - c.V(ne)) * s;
      const vce = (c.V(nc) - c.V(ne)) * s;
      const ib = (vbe - 0.65) / 100;
      if (this.state === 0) {
        if (vbe > 0.65 + 1e-6) { this.state = 1; return true; }
        return false;
      }
      if (ib < -1e-9) { this.state = 0; return true; }
      if (this.state === 1 && vce < 0.1) { this.state = 2; return true; }
      if (this.state === 2) {
        const ic = (vce - 0.1) * 2;
        if (ic > beta * ib * 1.001 + 1e-9) { this.state = 1; return true; }
      }
      return false;
    },
  };
  return el;
}

function bjtSymbol(type) {
  return () => {
    const s = new Sym();
    const npn = type === 'npn';
    s.pin('B', -20, 0, 'R', 14);
    s.pin(npn ? 'C' : 'E', 10, -20, 'D', 8);
    s.pin(npn ? 'E' : 'C', 10, 20, 'U', 8);
    s.circle(3, 0, 13, 'sb');
    s.line(-6, -8, -6, 8, 'sl thick');
    s.line(-6, -3, 10, -12).line(-6, 3, 10, 12);
    if (npn) s.poly([10, 12, 3, 11, 6, 6], 'sf', true);
    else s.poly([-6, -3, 1, -4, -2, -9], 'sf', true);
    return s.ref(18, -4).val(18, 7).build();
  };
}
register({
  type: 'npn', name: 'NPN Transistor', category: C.S, prefix: 'Q',
  desc: 'NPN 트랜지스터 (BC547/2N2222 유사, hFE 설정)',
  props: [{ key: 'value', label: '모델', default: 'BC547' }, { key: 'beta', label: 'hFE', default: '200' }],
  symbol: bjtSymbol('npn'),
  sim(part, n) { return bjtModel('npn', n('B'), n('C'), n('E'), parseSI(part.props.beta, 200)); },
});
register({
  type: 'pnp', name: 'PNP Transistor', category: C.S, prefix: 'Q',
  desc: 'PNP 트랜지스터 (BC557 유사)',
  props: [{ key: 'value', label: '모델', default: 'BC557' }, { key: 'beta', label: 'hFE', default: '200' }],
  symbol: bjtSymbol('pnp'),
  sim(part, n) { return bjtModel('pnp', n('B'), n('C'), n('E'), parseSI(part.props.beta, 200)); },
});

function mosSymbol(type) {
  return () => {
    const s = new Sym();
    const nch = type === 'nmos';
    s.pin('G', -20, 0, 'R', 12).pin('D', 10, -20, 'D', 12).pin('S', 10, 20, 'U', 12);
    s.circle(3, 0, 13, 'sb');
    s.line(-8, -7, -8, 7, 'sl');
    s.line(-4, -9, -4, -4, 'sl thick').line(-4, -2, -4, 2, 'sl thick').line(-4, 4, -4, 9, 'sl thick');
    s.line(-4, -7, 10, -7).line(10, -7, 10, -8);
    s.line(-4, 7, 10, 7).line(10, 7, 10, 8);
    s.line(-4, 0, 10, 0).line(10, 0, 10, 7);
    if (nch) s.poly([-4, 0, 1, -3, 1, 3], 'sf', true);
    else s.poly([4, 0, -1, -3, -1, 3], 'sf', true);
    return s.ref(18, -4).val(18, 7).build();
  };
}
function mosModel(type, g, d, src, vth, ron) {
  const nch = type === 'nmos';
  return {
    on: false,
    stamp(S) { S.G(d, src, this.on ? 1 / ron : 1e-10); },
    updateNL(c) {
      const vgs = c.V(g) - c.V(src);
      const on = nch ? vgs > vth : vgs < -vth;
      if (on !== this.on) { this.on = on; return true; }
      return false;
    },
  };
}
register({
  type: 'nmos', name: 'N-MOSFET', category: C.S, prefix: 'Q',
  desc: 'N채널 MOSFET (스위치 모델)',
  props: [{ key: 'value', label: '모델', default: '2N7000' }, { key: 'vth', label: 'Vth (V)', default: '2' }, { key: 'ron', label: 'Rds(on) (Ω)', default: '0.5' }],
  symbol: mosSymbol('nmos'),
  sim(part, n) { return mosModel('nmos', n('G'), n('D'), n('S'), parseSI(part.props.vth, 2), parseSI(part.props.ron, 0.5)); },
});
register({
  type: 'pmos', name: 'P-MOSFET', category: C.S, prefix: 'Q',
  desc: 'P채널 MOSFET (스위치 모델)',
  props: [{ key: 'value', label: '모델', default: 'IRF9540' }, { key: 'vth', label: '|Vth| (V)', default: '2' }, { key: 'ron', label: 'Rds(on) (Ω)', default: '0.5' }],
  symbol: mosSymbol('pmos'),
  sim(part, n) { return mosModel('pmos', n('G'), n('D'), n('S'), parseSI(part.props.vth, 2), parseSI(part.props.ron, 0.5)); },
});

// ---------------------------------------------------------------------------
// Switches
// ---------------------------------------------------------------------------
function switchEl(a, b, getClosed, ron = 0.05) {
  return { stamp(S) { S.G(a, b, getClosed() ? 1 / ron : 1e-10); } };
}

register({
  type: 'button', name: 'Push Button', category: C.SW, prefix: 'SW',
  desc: '푸시 버튼 (누르는 동안 ON). Ctrl+클릭으로 고정',
  props: [{ key: 'value', label: '이름', default: 'BUTTON' }],
  symbol() {
    const s = new Sym();
    s.pin('1', -20, 0, 'R', 8).pin('2', 20, 0, 'L', 8);
    s.circle(-10, 0, 2, 'sl').circle(10, 0, 2, 'sl');
    return s.ref(-10, -22).val(-10, 14).build();
  },
  dyn(part, inst) {
    const on = inst?.pressed;
    const y = on ? -3 : -9;
    return `<g data-act="press" class="clk"><rect x="-14" y="-24" width="28" height="26" class="hit"/>` +
      `<line x1="-13" y1="${y}" x2="13" y2="${y}" class="sl thick"/><line x1="0" y1="${y}" x2="0" y2="${y - 7}" class="sl"/>` +
      `<line x1="-4" y1="${y - 7}" x2="4" y2="${y - 7}" class="sl"/></g>`;
  },
  sim(part, n, S) {
    const inst = { pressed: false, latched: false };
    inst.elements = [switchEl(n('1'), n('2'), () => inst.pressed)];
    inst.action = (act, phase, ev) => {
      if (phase === 'down') {
        if (ev?.ctrlKey) { inst.latched = !inst.latched; inst.pressed = inst.latched; }
        else inst.pressed = true;
      } else if (phase === 'up' && !inst.latched) inst.pressed = false;
      return true;
    };
    return inst;
  },
});

register({
  type: 'switch', name: 'Toggle Switch (SPST)', category: C.SW, prefix: 'SW',
  desc: '토글 스위치 — 클릭하여 ON/OFF',
  props: [{ key: 'closed', label: '초기 상태', default: 'off', options: ['off', 'on'] }],
  symbol() {
    const s = new Sym();
    s.pin('1', -20, 0, 'R', 8).pin('2', 20, 0, 'L', 8);
    s.circle(-10, 0, 2, 'sl').circle(10, 0, 2, 'sl');
    return s.ref(-10, -18).val(-10, 14).build();
  },
  valueText: () => 'SPST',
  dyn(part, inst) {
    const on = inst ? inst.closed : part.props.closed === 'on';
    const end = on ? '10,-2' : '8,-11';
    return `<g data-act="toggle" class="clk"><rect x="-14" y="-16" width="28" height="18" class="hit"/>` +
      `<polyline points="-9,-1 ${end}" class="sl thick"/></g>`;
  },
  sim(part, n) {
    const inst = { closed: part.props.closed === 'on' };
    inst.elements = [switchEl(n('1'), n('2'), () => inst.closed)];
    inst.action = (act, phase) => { if (phase === 'down') inst.closed = !inst.closed; return true; };
    return inst;
  },
});

register({
  type: 'spdt', name: 'Switch (SPDT)', category: C.SW, prefix: 'SW',
  desc: '전환 스위치 — 클릭하여 A/B 전환',
  props: [{ key: 'pos', label: '초기 위치', default: 'A', options: ['A', 'B'] }],
  symbol() {
    const s = new Sym();
    s.pin('C', -20, 0, 'R', 8).pin('A', 20, -10, 'L', 8).pin('B', 20, 10, 'L', 8);
    s.circle(-10, 0, 2, 'sl').circle(10, -10, 2, 'sl').circle(10, 10, 2, 'sl');
    return s.ref(-10, -18).val(-10, 22).build();
  },
  valueText: () => 'SPDT',
  dyn(part, inst) {
    const a = inst ? inst.pos === 'A' : part.props.pos !== 'B';
    return `<g data-act="toggle" class="clk"><rect x="-14" y="-16" width="28" height="32" class="hit"/>` +
      `<polyline points="-9,-1 ${a ? '9,-9' : '9,9'}" class="sl thick"/></g>`;
  },
  sim(part, n) {
    const inst = { pos: part.props.pos === 'B' ? 'B' : 'A' };
    inst.elements = [switchEl(n('C'), n('A'), () => inst.pos === 'A'), switchEl(n('C'), n('B'), () => inst.pos === 'B')];
    inst.action = (act, phase) => { if (phase === 'down') inst.pos = inst.pos === 'A' ? 'B' : 'A'; return true; };
    return inst;
  },
});

register({
  type: 'dipsw', name: 'DIP Switch', category: C.SW, prefix: 'SW',
  desc: 'DIP 스위치 (4/8 채널) — 각 스위치 클릭으로 토글',
  props: [{ key: 'n', label: '채널 수', default: '4', options: ['4', '8'] }, { key: 'state', label: '초기 상태 (1=ON)', default: '0000' }],
  symbolKey: (p) => p.n,
  symbol(p) {
    const s = new Sym();
    const N = +p.n || 4;
    const h = Math.ceil((N * 10 + 10) / 20) * 20;
    s.rect(-16, -h / 2, 32, h, 'sb');
    for (let i = 0; i < N; i++) {
      const y = -h / 2 + 10 + i * 10;
      s.pin(String(i + 1), -30, y, 'R', 14, { num: i + 1, showNum: true });
      s.pin(String(2 * N - i), 30, y, 'L', 14, { num: 2 * N - i, showNum: true });
    }
    return s.ref(-16, -h / 2 - 6).val(-16, h / 2 + 10).build();
  },
  valueText: (p) => `DIP-${p.n || 4}`,
  dyn(part, inst) {
    const N = +part.props.n || 4;
    const h = Math.ceil((N * 10 + 10) / 20) * 20;
    let g = '';
    for (let i = 0; i < N; i++) {
      const y = -h / 2 + 10 + i * 10;
      const on = inst ? inst.st[i] : (part.props.state || '')[i] === '1';
      g += `<g data-act="sw${i}" class="clk"><rect x="-10" y="${y - 4}" width="20" height="8" class="dipbg"/>` +
        `<rect x="${on ? 1 : -9}" y="${y - 3}" width="8" height="6" class="dipk${on ? ' on' : ''}"/></g>`;
    }
    return g;
  },
  sim(part, n) {
    const N = +part.props.n || 4;
    const inst = { st: Array.from({ length: N }, (_, i) => (part.props.state || '')[i] === '1') };
    inst.elements = inst.st.map((_, i) => switchEl(n(String(i + 1)), n(String(2 * N - i)), () => inst.st[i]));
    inst.action = (act, phase) => {
      if (phase !== 'down') return false;
      const i = +act.slice(2);
      inst.st[i] = !inst.st[i];
      return true;
    };
    return inst;
  },
});

const KEYS = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'];
register({
  type: 'keypad', name: 'Keypad 4x4', category: C.SW, prefix: 'KP',
  desc: '4x4 매트릭스 키패드 (R1~R4 행, C1~C4 열)',
  props: [],
  symbol() {
    const s = new Sym();
    s.rect(-45, -60, 90, 110, 'sb');
    const names = ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'];
    names.forEach((nm, i) => s.pin(nm, -40 + i * 10, 60, 'U', 10, { name: nm, showName: true, nameSize: 7 }));
    return s.ref(-45, -66).val(10, -66).build();
  },
  valueText: () => 'KEYPAD-4x4',
  dyn(part, inst) {
    let g = '';
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const x = -41 + c * 21, y = -56 + r * 21;
        const k = r * 4 + c;
        const on = inst?.keys[k];
        g += `<g data-act="k${k}" class="clk"><rect x="${x}" y="${y}" width="19" height="19" rx="3" class="key${on ? ' on' : ''}"/>` +
          `<text x="${x + 9.5}" y="${y + 13}" text-anchor="middle" class="keyt">${esc(KEYS[k])}</text></g>`;
      }
    }
    return g;
  },
  sim(part, n) {
    const inst = { keys: new Array(16).fill(false) };
    inst.elements = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const k = r * 4 + c;
      inst.elements.push(switchEl(n(`R${r + 1}`), n(`C${c + 1}`), () => inst.keys[k], 1));
    }
    inst.action = (act, phase) => {
      const k = +act.slice(1);
      if (phase === 'down') inst.keys[k] = true;
      else if (phase === 'up') inst.keys.fill(false);
      return true;
    };
    return inst;
  },
});

// ---------------------------------------------------------------------------
// Electromechanical
// ---------------------------------------------------------------------------
register({
  type: 'relay', name: 'Relay (SPDT)', category: C.EM, prefix: 'K',
  desc: '릴레이 — 코일 전류가 임계값 이상이면 COM-NO 연결',
  props: [{ key: 'coil', label: '코일 저항 (Ω)', default: '70' }, { key: 'ion', label: '동작 전류 (A)', default: '0.03' }],
  symbol() {
    const s = new Sym();
    s.pin('1', -30, -30, 'D', 12).pin('2', -30, 30, 'U', 12);
    s.rect(-38, -18, 16, 36, 'sb').line(-38, 8, -22, -8);
    s.pin('COM', 30, 30, 'U', 12).pin('NO', 20, -30, 'D', 14).pin('NC', 40, -30, 'D', 14);
    s.line(-22, 0, 10, 0, 'sl dash');
    s.circle(20, -14, 2, 'sl').circle(40, -14, 2, 'sl').circle(30, 16, 2, 'sl');
    return s.ref(-40, -38).val(-40, 42).build();
  },
  valueText: () => 'RELAY',
  dyn(part, inst) {
    const on = inst?.on;
    return `<polyline points="30,14 ${on ? '21,-12' : '39,-12'}" class="sl thick"/>`;
  },
  sim(part, n) {
    const R = parseSI(part.props.coil, 70), ion = parseSI(part.props.ion, 0.03);
    const inst = { on: false };
    const coil = resistor(n('1'), n('2'), R);
    coil.post = (c) => {
      const i = Math.abs(c.V(n('1')) - c.V(n('2'))) / R;
      const on = inst.on ? i > ion * 0.6 : i > ion;
      if (on !== inst.on) { inst.on = on; return true; }
      return false;
    };
    inst.elements = [coil, switchEl(n('COM'), n('NO'), () => inst.on), switchEl(n('COM'), n('NC'), () => !inst.on)];
    return inst;
  },
});

/** Tracks toggling frequency + average of a voltage across two nodes */
function acMeter(a, b) {
  return {
    v: 0, sum: 0, tAcc: 0, edges: 0, last: 0, avg: 0, freq: 0, high: 0,
    stamp() {},
    post(c) {
      const v = c.V(a) - c.V(b);
      const lvl = v > 1.5 ? 1 : 0;
      if (lvl !== this.last) { this.edges++; this.last = lvl; }
      this.v = v;
      return false;
    },
    integrate(dt) { this.sum += this.v * dt; this.tAcc += dt; if (this.v > 1.5) this.high += dt; },
    frame() {
      this.avg = this.tAcc > 0 ? this.sum / this.tAcc : this.v;
      this.freq = this.tAcc > 0 ? this.edges / 2 / this.tAcc : 0;
      this.duty = this.tAcc > 0 ? this.high / this.tAcc : 0;
      this.sum = 0; this.tAcc = 0; this.edges = 0; this.high = 0;
    },
  };
}

register({
  type: 'buzzer', name: 'Buzzer', category: C.EM, prefix: 'BZ',
  desc: '부저 — 능동형(DC 인가 시 소리) / 수동형(PWM 주파수로 소리). 소리는 우측 패널에서 켜기',
  props: [{ key: 'kind', label: '종류', default: 'active', options: ['active', 'passive'] }, { key: 'r', label: '저항 (Ω)', default: '100' }],
  valueText: (p) => (p.kind === 'passive' ? 'BUZZER(P)' : 'BUZZER'),
  symbol() {
    const s = new Sym();
    s.pin('+', -20, -10, 'R', 10).pin('-', -20, 10, 'R', 10);
    s.rect(-10, -16, 10, 32, 'sb');
    s.poly([0, -16, 12, -24, 12, 24, 0, 16], 'sb', true);
    s.text(-14, -16, '+', { size: 8, cls: 'pn', a: 'middle' });
    return s.ref(16, -8).val(16, 4).build();
  },
  dyn(part, inst) {
    if (!inst?.sounding) return '';
    return `<path d="M17,-8 a10,10 0 0 1 0,16 M21,-13 a16,16 0 0 1 0,26" class="wave"/>`;
  },
  sim(part, n, S) {
    const R = parseSI(part.props.r, 100);
    const m = acMeter(n('+'), n('-'));
    const inst = { sounding: false, elements: [resistor(n('+'), n('-'), R), m] };
    inst.frame = () => {
      m.frame();
      const passive = part.props.kind === 'passive';
      let f = 0;
      if (m.freq > 20 && m.freq < 20000) f = m.freq;
      else if (!passive && m.avg > 2) f = 2400;
      inst.sounding = f > 0;
      S.audio?.set(part.id, f, inst.sounding ? 0.12 : 0);
    };
    inst.dispose = () => S.audio?.set(part.id, 0, 0);
    return inst;
  },
});

register({
  type: 'motor', name: 'DC Motor', category: C.EM, prefix: 'M',
  desc: 'DC 모터 — 평균 전압에 비례한 회전 (PWM 속도 제어 확인)',
  props: [{ key: 'r', label: '권선 저항 (Ω)', default: '20' }, { key: 'rpm', label: '정격 RPM (5V)', default: '300' }],
  valueText: () => 'MOTOR',
  symbol() {
    const s = new Sym();
    s.pin('+', 0, -30, 'D', 14).pin('-', 0, 30, 'U', 14);
    s.circle(0, 0, 16, 'sb');
    return s.ref(20, -6).val(20, 6).build();
  },
  dyn(part, inst) {
    const a = inst?.angle || 0;
    const rpm = inst?.rpm || 0;
    let g = `<g transform="rotate(${a.toFixed(1)})"><line x1="-11" y1="0" x2="11" y2="0" class="sl thick"/><line x1="0" y1="-11" x2="0" y2="11" class="sl thick"/></g><circle r="4" class="sb"/>`;
    g += `<text x="0" y="3" text-anchor="middle" class="mt">M</text>`;
    if (inst) g += `<text x="20" y="18" class="dyntx">${Math.round(rpm)} rpm</text>`;
    return g;
  },
  sim(part, n) {
    const R = parseSI(part.props.r, 20), rated = parseSI(part.props.rpm, 300);
    const m = acMeter(n('+'), n('-'));
    const inst = { angle: 0, rpm: 0, elements: [resistor(n('+'), n('-'), R), m] };
    inst.frame = (dtFrame) => {
      m.frame();
      const target = (m.avg / 5) * rated;
      inst.rpm += (target - inst.rpm) * 0.25;
      inst.angle = (inst.angle + inst.rpm * 6 * dtFrame) % 360;
    };
    return inst;
  },
});

register({
  type: 'servo', name: 'Servo Motor', category: C.EM, prefix: 'M',
  desc: '서보 모터 — SIG 펄스폭(기본 1~2ms)을 0~180°로 변환 (50Hz)',
  props: [{ key: 'minp', label: '최소 펄스 (ms)', default: '1.0' }, { key: 'maxp', label: '최대 펄스 (ms)', default: '2.0' }],
  valueText: () => 'SERVO',
  symbol() {
    const s = new Sym();
    s.pin('SIG', -40, -10, 'R', 10, { name: 'SIG', showName: true, nameSize: 7 });
    s.pin('V+', -40, 0, 'R', 10, { name: 'V+', showName: true, nameSize: 7 });
    s.pin('GND', -40, 10, 'R', 10, { name: 'GND', showName: true, nameSize: 7 });
    s.rect(-30, -24, 60, 48, 'sb');
    s.circle(12, 0, 14, 'sl');
    return s.ref(-30, -30).val(10, -30).build();
  },
  dyn(part, inst) {
    const ang = inst ? inst.angle : 90;
    const r = (ang - 90) * Math.PI / 180;
    const x = 12 + 13 * Math.sin(r), y = -13 * Math.cos(r);
    return `<line x1="12" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="arm"/><circle cx="12" cy="0" r="3" class="sf"/>` +
      (inst ? `<text x="-2" y="20" class="dyntx">${Math.round(ang)}°</text>` : '');
  },
  sim(part, n, S) {
    const minp = parseSI(part.props.minp, 1) / 1000, maxp = parseSI(part.props.maxp, 2) / 1000;
    const sig = n('SIG');
    const inst = { angle: 90, target: 90, last: 0, rise: 0 };
    const mon = {
      stamp(St) { St.G(sig, -1, 1e-7); },
      post(c) {
        const lvl = c.V(sig) > 2.5 ? 1 : 0;
        if (lvl !== inst.last) {
          if (lvl) inst.rise = c.t;
          else {
            const pw = c.t - inst.rise;
            if (pw > 0.0003 && pw < 0.003) {
              inst.target = Math.min(180, Math.max(0, ((pw - minp) / (maxp - minp)) * 180));
            }
          }
          inst.last = lvl;
        }
        return false;
      },
    };
    inst.elements = [resistor(n('V+'), n('GND'), 100), mon];
    inst.frame = (dt) => {
      const d = inst.target - inst.angle;
      const maxStep = 600 * dt; // ~0.1s/60°
      inst.angle += Math.max(-maxStep, Math.min(maxStep, d));
    };
    return inst;
  },
});

// ---------------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------------
register({
  type: 'lm35', name: 'LM35 Temperature Sensor', category: C.SEN, prefix: 'U',
  desc: '온도센서 LM35 — 10mV/°C 출력, ▲▼로 온도 조절',
  props: [{ key: 'temp', label: '온도 (°C)', default: '25' }],
  adjust: adjustable('temp', 25, -40, 150, 1),
  valueText: () => 'LM35',
  symbol() {
    const s = new Sym();
    s.pin('VS', 0, -40, 'D', 20, { name: '+Vs', showName: true, num: 1, showNum: true });
    s.pin('OUT', 40, 0, 'L', 20, { name: 'Vout', showName: true, num: 2, showNum: true });
    s.pin('GND', 0, 40, 'U', 20, { name: 'GND', showName: true, num: 3, showNum: true });
    s.rect(-20, -20, 40, 40, 'sb');
    return s.ref(-20, -26).val(24, -26).build();
  },
  dyn(part) {
    const t = +part.props.temp;
    return `<g class="adj"><polygon data-act="inc" points="-30,-12 -24,-4 -36,-4" class="adjbtn"/><polygon data-act="dec" points="-30,12 -24,4 -36,4" class="adjbtn"/></g>` +
      `<text x="-30" y="26" text-anchor="middle" class="dyntx">${t}°C</text>`;
  },
  sim(part, n) {
    return {
      stamp(S) {
        const t = parseFloat(part.props.temp) || 0;
        S.norton(n('OUT'), n('GND'), 1 / 50, Math.max(0, t * 0.01));
        S.G(n('VS'), n('GND'), 1 / 80000);
      },
    };
  },
});

register({
  type: 'hcsr04', name: 'Ultrasonic HC-SR04', category: C.SEN, prefix: 'U',
  desc: '초음파 거리센서 — TRIG 10µs 펄스 후 ECHO 펄스(거리×58µs), ▲▼로 거리 조절',
  props: [{ key: 'dist', label: '거리 (cm)', default: '100' }],
  adjust: adjustable('dist', 100, 2, 400, 5),
  valueText: () => 'HC-SR04',
  symbol() {
    const s = new Sym();
    s.rect(-40, -20, 80, 40, 'sb');
    s.circle(-20, -2, 11, 'sl').circle(20, -2, 11, 'sl');
    ['VCC', 'TRIG', 'ECHO', 'GND'].forEach((nm, i) => s.pin(nm, -30 + i * 20, 40, 'U', 20, { name: nm, showName: true, nameSize: 6 }));
    return s.ref(-40, -26).val(10, -26).build();
  },
  dyn(part) {
    const d = +part.props.dist;
    return `<g class="adj"><polygon data-act="inc" points="50,-12 56,-4 44,-4" class="adjbtn"/><polygon data-act="dec" points="50,12 56,4 44,4" class="adjbtn"/></g>` +
      `<text x="0" y="-24" text-anchor="middle" class="dyntx">${d}cm</text>`;
  },
  sim(part, n, S) {
    const trig = n('TRIG'), echo = n('ECHO');
    const inst = { level: 0, lastTrig: 0, rise: 0 };
    const el = {
      stamp(St) { St.norton(echo, n('GND'), 1 / 100, inst.level ? 5 : 0); St.G(trig, -1, 1e-7); },
      post(c) {
        const t = c.V(trig) > 2.5 ? 1 : 0;
        if (t !== inst.lastTrig) {
          if (t) inst.rise = c.t;
          else if (c.t - inst.rise >= 8e-6) {
            const d = Math.max(2, parseFloat(part.props.dist) || 100);
            const start = c.t + 0.0002;
            S.schedule(start, () => { inst.level = 1; return true; });
            S.schedule(start + d * 58e-6, () => { inst.level = 0; return true; });
          }
          inst.lastTrig = t;
        }
        return false;
      },
    };
    inst.elements = [el, resistor(n('VCC'), n('GND'), 1000)];
    return inst;
  },
});

export { formatSI };
