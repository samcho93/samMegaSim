// Shared helpers for building example schematics programmatically
import { LIB, partPins } from './parts/kit.js';

export class Builder {
  constructor() { this.parts = []; this.wires = []; this.n = 0; this.refs = {}; }
  add(type, x, y, props = {}, o = {}) {
    const def = LIB[type];
    const p = { id: `p${++this.n}`, type, x, y, rot: o.rot || 0, mirror: !!o.mirror, ref: '', props: {} };
    for (const pr of def.props || []) p.props[pr.key] = pr.default;
    Object.assign(p.props, props);
    const pre = def.prefix || 'U';
    this.refs[pre] = (this.refs[pre] || 0) + 1;
    p.ref = pre + (pre.startsWith('#') ? String(this.refs[pre]).padStart(2, '0') : this.refs[pre]);
    this.parts.push(p);
    return p;
  }
  pin(p, id) {
    const q = partPins(p).find((x) => x.id === String(id));
    if (!q) throw new Error(`pin ${id} not found on ${p.type}`);
    return [q.wx, q.wy];
  }
  /** Pin tip of an MCU by port name, e.g. 'PB5' */
  mpin(mcu, name) {
    const dev = mcu._dev;
    const row = dev.pins.find((r) => r[1] === name);
    return this.pin(mcu, row[0]);
  }
  wire(...pts) { this.wires.push({ id: `w${++this.n}`, points: pts.map((p) => [p[0], p[1]]) }); }
  /** L-shaped connection: horizontal first ('h') or vertical first ('v') */
  link(a, b, first = 'h') {
    if (a[0] === b[0] || a[1] === b[1]) this.wire(a, b);
    else this.wire(a, first === 'h' ? [b[0], a[1]] : [a[0], b[1]], b);
  }
  /** Z-shaped connection with a vertical segment at x */
  linkX(a, b, x) { this.wire(a, [x, a[1]], [x, b[1]], b); }
  /** Net label with a stub wire; dir = side the label extends to */
  label(at, name, dir = 'R', stub = 20) {
    const d = { R: [1, 0], L: [-1, 0], U: [0, -1], D: [0, 1] }[dir];
    const end = [at[0] + d[0] * stub, at[1] + d[1] * stub];
    if (stub) this.wire(at, end);
    const o = { R: {}, L: { mirror: true }, D: { rot: 1 }, U: { rot: 3 } }[dir];
    this.add('label', end[0], end[1], { name }, o);
  }
  gnd(at, stub = 0) {
    const g = [at[0], at[1] + stub];
    if (stub) this.wire(at, g);
    this.add('gnd', g[0], g[1]);
  }
  vcc(at, stub = 0) {
    const g = [at[0], at[1] - stub];
    if (stub) this.wire(at, g);
    this.add('vcc', g[0], g[1]);
  }
  /** Power symbol at a point, rotated (rot 1/3 = pointing right/left for GND/VCC) */
  power(type, at, rot = 0) { return this.add(type, at[0], at[1], {}, { rot }); }
  /** Oscilloscope with preset time/div (seconds) */
  scope(x, y, tdiv, level = 2.5) {
    const osc = this.add('scope', x, y);
    osc.props.cfg = {
      tdiv, run: true,
      ch: [{ on: true, vdiv: 2, pos: 1 }, { on: true, vdiv: 2, pos: -1 }, { on: true, vdiv: 2, pos: -3 }, { on: true, vdiv: 2, pos: -4 }],
      trig: { src: 0, edge: 'rise', level, mode: 'auto' },
    };
    return osc;
  }
  mcu(device, x, y, clock = '16MHz') {
    const m = this.add('mcu', x, y, { device, clock });
    m._dev = null;
    return m;
  }
  /** Name an MCU so per-MCU source files can target it */
  role(name, part) { (this.roles ||= {})[name] = part.id; return part; }
  done() {
    for (const p of this.parts) delete p._dev;
    return { parts: this.parts, wires: this.wires, roles: this.roles || {} };
  }
}

export async function devices() { return (await import('./mcu/devices.js')).DEVICES; }

export function mcuWithPower(b, DEV, device, x, y, clock) {
  const m = b.mcu(device, x, y, clock);
  m._dev = DEV[device];
  // power pins
  for (const row of DEV[device].pins) {
    if (row[1] === 'VCC' || row[1] === 'AVCC') b.vcc(b.pin(m, row[0]), 10);
    if (row[1] === 'GND') b.gnd(b.pin(m, row[0]), 10);
  }
  return m;
}

/** LED + series resistor from a pin going right, cathode to GND */
export function ledRight(b, from, color = 'red', r = '330', len = 40) {
  const R = b.add('resistor', from[0] + len + 30, from[1], { value: r }, { rot: 1 });
  b.wire(from, b.pin(R, '2'));
  const L = b.add('led', b.pin(R, '1')[0] + 40, from[1], { color });
  b.wire(b.pin(R, '1'), b.pin(L, 'A'));
  const k = b.pin(L, 'K');
  b.wire(k, [k[0] + 20, k[1]]);
  b.gnd([k[0] + 20, k[1]], 20);
  return { R, L };
}

// ---------------------------------------------------------------------------
/** 8 pins on the LEFT side of the MCU -> 8x resistor array -> LED bar graph (mirrored, cathodes to GND) */
export function barLeft(b, froms, color = 'green', r = '330') {
  const X = froms[0][0], y0 = froms[0][1];
  const rn = b.add('resarray', X - 160, y0 - 50, { value: r }, { mirror: true });
  froms.forEach((f, i) => {
    const to = b.pin(rn, String(i + 1));
    const xi = X - 30 - 10 * i;
    b.wire(f, [xi, f[1]], [xi, to[1]], to);
  });
  const bar = b.add('bargraph', rn.x - 90, rn.y, { color }, { mirror: true });
  for (let i = 0; i < 8; i++) {
    b.wire(b.pin(rn, String(16 - i)), b.pin(bar, 'A' + (i + 1)));
    const k = b.pin(bar, 'K' + (i + 1));
    b.wire(k, [k[0] - 20, k[1]]);
  }
  const k1 = b.pin(bar, 'K1'), k8 = b.pin(bar, 'K8');
  b.wire([k1[0] - 20, k1[1]], [k8[0] - 20, k8[1]], [k8[0] - 20, k8[1] + 40]);
  b.gnd([k8[0] - 20, k8[1] + 40]);
  return { rn, bar };
}

/** Single LED + resistor from a LEFT-side pin */
export function ledLeft(b, from, color = 'red', r = '330') {
  const R = b.add('resistor', from[0] - 70, from[1], { value: r }, { rot: 1 });
  b.wire(from, b.pin(R, '1'));
  const L = b.add('led', b.pin(R, '2')[0] - 40, from[1], { color }, { rot: 2 });
  b.wire(b.pin(R, '2'), b.pin(L, 'A'));
  const k = b.pin(L, 'K');
  b.wire(k, [k[0] - 20, k[1]]);
  b.power('gnd', [k[0] - 20, k[1]], 1);
  return { R, L };
}

/** Push button from a RIGHT-side pin to GND */
export function buttonRight(b, from, dx = 80) {
  const sw = b.add('button', from[0] + dx, from[1]);
  b.wire(from, b.pin(sw, '1'));
  const s2 = b.pin(sw, '2');
  b.wire(s2, [s2[0] + 20, s2[1]]);
  b.gnd([s2[0] + 20, s2[1]], 20);
  return sw;
}

/** Oscilloscope below-left of a LEFT-side pin wire, channel A tapped at 20 units from the pin */
export function scopeLeftBelow(b, from, tdiv) {
  const osc = b.scope(from[0] - 250, from[1] + 120, tdiv);
  osc.mirror = true;
  const a = b.pin(osc, 'A');
  b.wire([from[0] - 20, from[1]], [from[0] - 20, a[1]], a);
  return osc;
}

export function pa(b, m) { return Array.from({ length: 8 }, (_, i) => b.mpin(m, 'PA' + i)); }


// ---------------------------------------------------------------------------
// Self-contained blocks fed by a net label (for larger, label-based sheets)
// ---------------------------------------------------------------------------

/** label(net) -> resistor -> LED -> GND, going right from (x, y) */
export function ledBlock(b, x, y, net, color = 'red', r = '330') {
  const R = b.add('resistor', x + 30, y, { value: r }, { rot: 1 }); // pin2 at x, pin1 at x+60
  b.label(b.pin(R, '2'), net, 'L', 20);
  const L = b.add('led', x + 100, y, { color });
  b.wire(b.pin(R, '1'), b.pin(L, 'A'));
  const k = b.pin(L, 'K');
  b.wire(k, [k[0] + 20, k[1]]);
  b.gnd([k[0] + 20, k[1]], 20);
  return { R, L };
}

/** label(net) -> push button -> GND */
export function buttonBlock(b, x, y, net) {
  const sw = b.add('button', x + 20, y);
  b.label(b.pin(sw, '1'), net, 'L', 20);
  const s2 = b.pin(sw, '2');
  b.wire(s2, [s2[0] + 20, s2[1]]);
  b.gnd([s2[0] + 20, s2[1]], 20);
  return sw;
}

/** label(net) -> buzzer(+), buzzer(-) -> GND */
export function buzzerBlock(b, x, y, net, kind = 'active') {
  const bz = b.add('buzzer', x + 20, y + 10, { kind });
  b.label(b.pin(bz, '+'), net, 'L', 20);
  const m = b.pin(bz, '-');
  b.wire(m, [m[0] - 10, m[1]], [m[0] - 10, m[1] + 20]);
  b.gnd([m[0] - 10, m[1] + 20]);
  return bz;
}

/** label(net) -> servo SIG, V+ -> VCC, GND */
export function servoBlock(b, x, y, net) {
  const sv = b.add('servo', x + 40, y + 10);
  b.label(b.pin(sv, 'SIG'), net, 'L', 20);
  const vp = b.pin(sv, 'V+'), gp = b.pin(sv, 'GND');
  b.wire(gp, [gp[0] - 10, gp[1]], [gp[0] - 10, gp[1] + 20]);
  b.gnd([gp[0] - 10, gp[1] + 20]);
  b.wire(vp, [vp[0] - 30, vp[1]], [vp[0] - 30, vp[1] + 40]);
  b.power('vcc', [vp[0] - 30, vp[1] + 40], 2);
  return sv;
}

/** Potentiometer divider VCC-GND, wiper -> label(net) */
export function potBlock(b, x, y, net, pos = '50') {
  const pot = b.add('pot', x, y, { value: '10k', pos });
  b.vcc(b.pin(pot, '1'), 10);
  b.gnd(b.pin(pot, '2'), 10);
  b.label(b.pin(pot, 'W'), net, 'R', 20);
  return pot;
}

/** LM35 with Vout -> label(net) */
export function lm35Block(b, x, y, net, temp = '25') {
  const lm = b.add('lm35', x, y, { temp });
  b.vcc(b.pin(lm, 'VS'), 10);
  b.gnd(b.pin(lm, 'GND'), 10);
  b.label(b.pin(lm, 'OUT'), net, 'R', 20);
  return lm;
}

/** VCC - LDR - node - 10k - GND, node -> label(net) */
export function ldrBlock(b, x, y, net, light = '50') {
  const ldr = b.add('ldr', x, y, { light });
  b.vcc(b.pin(ldr, '1'), 10);
  const r = b.add('resistor', x, y + 60, { value: '10k' });
  b.gnd(b.pin(r, '2'), 10);
  b.label(b.pin(ldr, '2'), net, 'R', 30);
  return ldr;
}

/** I2C LCD backpack with GND/VCC and SDA/SCL labels */
export function i2cLcdBlock(b, x, y, addr = '0x27', color = 'blue') {
  const lcd = b.add('lcd_i2c', x, y, { addr, size: '16x2', color });
  const g = b.pin(lcd, 'GND'), v = b.pin(lcd, 'VCC');
  b.wire(g, [g[0] - 20, g[1]]);
  b.power('gnd', [g[0] - 20, g[1]], 1);
  b.wire(v, [v[0] - 60, v[1]]);
  b.power('vcc', [v[0] - 60, v[1]], 3);
  b.label(b.pin(lcd, 'SDA'), 'SDA', 'L', 20);
  b.label(b.pin(lcd, 'SCL'), 'SCL', 'L', 40);
  return lcd;
}

/** Two 4.7k I2C pull-ups */
export function i2cPullups(b, x, y) {
  const r1 = b.add('resistor', x, y, { value: '4.7k' });
  const r2 = b.add('resistor', x + 60, y, { value: '4.7k' });
  b.vcc(b.pin(r1, '1'), 10);
  b.vcc(b.pin(r2, '1'), 10);
  b.label(b.pin(r1, '2'), 'SDA', 'D', 20);
  b.label(b.pin(r2, '2'), 'SCL', 'D', 20);
}

/** Virtual terminal with RXD/TXD labels */
export function terminalBlock(b, x, y, rxNet, txNet, baud = '9600') {
  const vt = b.add('terminal', x, y, { baud });
  if (rxNet) b.label(b.pin(vt, 'RXD'), rxNet, 'L', 30);
  if (txNet) b.label(b.pin(vt, 'TXD'), txNet, 'L', 60);
  return vt;
}

/** Relay-switched DC motor (fan) driven by an NPN from label(net); (x,y) = base resistor input */
export function relayMotorBlock(b, x, y, net, supply = 'p12v') {
  const rb = b.add('resistor', x + 30, y, { value: '1k' }, { rot: 1 });
  b.label(b.pin(rb, '2'), net, 'L', 20);
  const q = b.add('npn', x + 80, y, { beta: '150' });
  b.gnd(b.pin(q, 'E'), 20);
  const c = b.pin(q, 'C');
  const k = b.add('relay', c[0] + 30, c[1] - 30);
  const p1 = b.pin(k, '1');
  b.vcc(p1, 10);
  const d = b.add('diode', c[0] - 30, c[1] - 30, {}, { rot: 3 });
  b.link(c, b.pin(d, 'A'), 'h');
  b.link(b.pin(d, 'K'), p1, 'v');
  const com = b.pin(k, 'COM');
  b.wire(com, [com[0] + 50, com[1]]);
  b.power(supply, [com[0] + 50, com[1]]);
  const no = b.pin(k, 'NO');
  const mot = b.add('motor', no[0] + 120, no[1], { r: '20', rpm: '600' });
  b.wire(no, [no[0], no[1] - 30], [no[0] + 120, no[1] - 30]);
  b.gnd(b.pin(mot, '-'), 10);
  return { q, k, mot };
}
