// ATmega MCU schematic part: KiCad-style symbol generated from the device pin table
import { register, Sym, logicLevel } from './kit.js';
import { DEVICES, getDevice, parsePortPin } from '../mcu/devices.js';
import { AVRMcu } from '../mcu/avr.js';
import { parseSI } from '../sim/circuit.js';

const POWER_TOP = new Set(['VCC', 'AVCC']);
const POWER_BOT = new Set(['GND']);

function label(row) {
  const [, name, ...alt] = row;
  return alt.length ? `${name} (${alt.join('/')})` : name;
}

export function mcuLayout(device) {
  const top = [], bottom = [], misc = [];
  const ports = {};
  for (const row of device.pins) {
    const name = row[1];
    if (POWER_TOP.has(name)) top.push(row);
    else if (POWER_BOT.has(name)) bottom.push(row);
    else {
      const pp = parsePortPin(name);
      if (pp) (ports[pp.port] ||= []).push({ row, bit: pp.bit });
      else misc.push(row);
    }
  }
  const order = ['RESET', 'PEN', 'XTAL1', 'XTAL2', 'AREF'];
  misc.sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1]));
  const groups = Object.keys(ports).sort().map((k) => ports[k].sort((a, b) => a.bit - b.bit).map((x) => x.row));
  const rowsOf = (gs) => gs.reduce((s, g) => s + g.length, 0) + Math.max(0, gs.length - 1);
  const miscRows = misc.length;
  let best = null;
  for (let k = 0; k <= groups.length; k++) {
    const L = groups.slice(0, k), R = groups.slice(k);
    const lh = miscRows + (L.length ? 1 + rowsOf(L) : 0), rh = rowsOf(R);
    const score = Math.max(lh, rh) + (k === 0 && miscRows + rowsOf(R) < 32 ? -100 : 0);
    if (!best || score < best.score) best = { score, k, lh, rh };
  }
  // Prefer all ports on the right for small packages
  const k = rowsOf(groups) + miscRows <= 34 ? 0 : best.k;
  const left = [...misc];
  const leftGroups = groups.slice(0, k), rightGroups = groups.slice(k);
  if (leftGroups.length && misc.length) left.push(null);
  leftGroups.forEach((g, i) => { if (i) left.push(null); left.push(...g); });
  const right = [];
  rightGroups.forEach((g, i) => { if (i) right.push(null); right.push(...g); });
  return { top, bottom, left, right };
}

function buildMcuSymbol(device) {
  const { top, bottom, left, right } = mcuLayout(device);
  const n = Math.max(left.length, right.length);
  const H = (n + 1) * 20;
  const cw = 5.4;
  const maxL = Math.max(0, ...left.filter(Boolean).map((r) => label(r).length));
  const maxR = Math.max(0, ...right.filter(Boolean).map((r) => label(r).length));
  const nameW = device.name.length * 8 + 16;
  let W = Math.ceil((maxL * cw + maxR * cw + nameW + 24) / 20) * 20;
  W = Math.max(W, 140, (Math.max(top.length, bottom.length) + 1) * 20);
  // centre the chip name in the free space between the two label columns
  const nameX = Math.round(((-W / 2 + maxL * cw + 6) + (W / 2 - maxR * cw - 6)) / 2);
  const s = new Sym();
  s.rect(-W / 2, -H / 2, W, H, 'sb');
  const PL = 30;
  const opt = (row) => ({ name: label(row), showName: true, num: row[0], showNum: true, nameSize: 8 });
  left.forEach((row, i) => { if (row) s.pin(String(row[0]), -W / 2 - PL, -H / 2 + 20 * (i + 1), 'R', PL, opt(row)); });
  right.forEach((row, i) => { if (row) s.pin(String(row[0]), W / 2 + PL, -H / 2 + 20 * (i + 1), 'L', PL, opt(row)); });
  const place = (rows, y, side) => {
    const x0 = -((rows.length - 1) * 20) / 2;
    rows.forEach((row, i) => s.pin(String(row[0]), x0 + i * 20, y, side, PL, { name: row[1], showName: true, num: row[0], showNum: true, nameSize: 8 }));
  };
  place(top, -H / 2 - PL, 'D');
  place(bottom, H / 2 + PL, 'U');
  s.text(nameX, 0, device.name, { a: 'middle', size: 12, cls: 'chipname', bold: true });
  s.text(nameX, 14, device.package, { a: 'middle', size: 8, cls: 'chippkg' });
  return s.ref(W / 2 + 4, -H / 2 - PL - 8).val(W / 2 + 4, H / 2 + PL + 14).build({ W, H });
}

register({
  type: 'mcu', name: 'ATmega MCU', category: 'Microcontrollers', prefix: 'U', isMcu: true,
  desc: 'ATmega 마이크로컨트롤러 — 더블클릭하여 칩 종류/클럭/펌웨어 설정',
  props: [
    { key: 'device', label: 'MCU', default: 'atmega328p', options: Object.keys(DEVICES), optionLabels: Object.values(DEVICES).map((d) => d.name) },
    { key: 'clock', label: '클럭 (F_CPU)', default: '16MHz', options: ['1MHz', '4MHz', '8MHz', '11.0592MHz', '12MHz', '14.7456MHz', '16MHz', '20MHz'] },
  ],
  valueText: (p) => getDevice(p.device).name,
  symbolKey: (p) => p.device,
  symbol: (p) => buildMcuSymbol(getDevice(p.device)),
  sim(part, n, S) {
    const device = getDevice(part.props.device);
    const clock = parseSI(String(part.props.clock || '16MHz').replace(/Hz$/i, ''), 16e6);
    const mcu = new AVRMcu(device, clock, { vcc: S.vcc });
    const inst = { mcu, part, device, clock, held: false, error: null };
    if (part.fw?.hex) {
      try { mcu.loadHex(part.fw.hex); } catch (e) { inst.error = e.message; }
    }
    // Pin table
    const pins = [];
    let resetNode = null, arefNode = null;
    for (const row of device.pins) {
      const id = String(row[0]);
      const name = row[1];
      const node = S.isUnconnected(part.id, id) ? null : n(id);
      if (name === 'RESET') resetNode = node;
      if (name === 'AREF') arefNode = node;
      if (parsePortPin(name)) pins.push({ id, name, node, lvl: 0 });
    }
    // PC6/RESET on DIP-28 parts behaves as RESET unless fuses changed
    const resetPin = pins.find((p) => p.name === 'PC6' && device.pins.find((r) => r[1] === 'PC6' && r.includes('RESET')));
    if (resetPin) { resetNode = resetPin.node; pins.splice(pins.indexOf(resetPin), 1); }
    const byName = new Map(pins.map((p) => [p.name, p]));
    const vcc = S.vcc;
    mcu.analogReader = (pinName) => {
      const p = byName.get(pinName);
      return p?.node != null ? S.circuit.V(p.node) : 0;
    };
    mcu.arefReader = () => (arefNode != null ? S.circuit.V(arefNode) : null);
    mcu.misoReader = (pinName) => {
      const p = byName.get(pinName);
      if (!p || p.node == null) return 1;
      return logicLevel(S.circuit.V(p.node), vcc, 1);
    };
    // Only re-solve the circuit when a connected pin's drive actually changes
    const portPins = {};
    for (const p of pins) (portPins[p.name[1]] ||= []).push(p);
    const driveCode = (p) => {
      const d = mcu.pinDrive(p.name);
      return !d ? 3 : d.mode === 'out' ? d.level : d.mode === 'pullup' ? 2 : 3;
    };
    const refresh = (list) => {
      let changed = false;
      for (const p of list) {
        const code = driveCode(p);
        if (code === p.code) continue;
        p.code = code;
        if (p.node == null) {
          const l = code === 1 || code === 2 ? 1 : 0;
          if (l !== p.lvl) { p.lvl = l; mcu.setPinInput(p.name, l); }
        } else changed = true;
      }
      return changed;
    };
    mcu.listeners.add((letter) => {
      const list = portPins[letter];
      if (list && refresh(list)) S.solveAt(mcu.time);
    });
    for (const p of pins) p.code = -1;
    refresh(pins);
    const el = {
      stamp(St) {
        for (const p of pins) {
          if (p.node == null) continue;
          const c = p.code;
          if (c === 0 || c === 1) St.norton(p.node, -1, 1 / 25, c ? vcc : 0);
          else if (c === 2) St.norton(p.node, -1, 1 / 35000, vcc);
        }
        if (resetNode != null) St.norton(resetNode, -1, 1 / 40000, vcc);
      },
      post(c) {
        for (const p of pins) {
          if (p.node == null) continue;
          const l = logicLevel(c.V(p.node), vcc, p.lvl);
          if (l !== p.lvl) { p.lvl = l; mcu.setPinInput(p.name, l); }
        }
        if (resetNode != null) {
          const low = c.V(resetNode) < vcc * 0.3;
          if (low && !inst.held) { inst.held = true; }
          else if (!low && inst.held) { inst.held = false; inst.pendingReset = true; }
        }
        return false;
      },
    };
    inst.refreshPins = () => { for (const p of pins) p.code = -1; refresh(pins); };
    // Initial pin input values
    inst.initInputs = () => { for (const p of pins) mcu.setPinInput(p.name, p.lvl); };
    inst.elements = [el];
    inst.pins = pins;
    inst.pinByName = byName;
    S.registerMcu(inst);
    return inst;
  },
});
