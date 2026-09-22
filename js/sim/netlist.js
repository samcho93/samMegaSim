// Netlist extraction from the schematic document
import { LIB, partPins } from '../parts/kit.js';

class UF {
  constructor() { this.p = new Map(); }
  find(a) {
    let p = this.p.get(a);
    if (p === undefined) { this.p.set(a, a); return a; }
    if (p === a) return a;
    const r = this.find(p);
    this.p.set(a, r);
    return r;
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.p.set(ra, rb);
  }
}

const pk = (x, y) => `${Math.round(x)},${Math.round(y)}`;

export function onSegment(px, py, ax, ay, bx, by) {
  if (ax === bx) return px === ax && py >= Math.min(ay, by) && py <= Math.max(ay, by);
  if (ay === by) return py === ay && px >= Math.min(ax, bx) && px <= Math.max(ax, bx);
  // diagonal segment
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (Math.abs(cross) > 1e-6) return false;
  return px >= Math.min(ax, bx) && px <= Math.max(ax, bx) && py >= Math.min(ay, by) && py <= Math.max(ay, by);
}

/** Collect all pin tips of all parts: [{part, pin, x, y}] */
export function allPins(doc) {
  const out = [];
  for (const part of doc.parts) {
    for (const p of partPins(part)) out.push({ part, pin: p, x: p.wx, y: p.wy });
  }
  return out;
}

export function buildNetlist(doc) {
  const uf = new UF();
  const pins = allPins(doc);
  const pointSet = new Map(); // key -> [x,y]
  for (const w of doc.wires) for (const [x, y] of w.points) pointSet.set(pk(x, y), [x, y]);
  for (const p of pins) pointSet.set(pk(p.x, p.y), [p.x, p.y]);

  for (const w of doc.wires) {
    const pts = w.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const ka = pk(ax, ay);
      uf.union(ka, pk(bx, by));
      for (const [key, [x, y]] of pointSet) {
        if (onSegment(x, y, ax, ay, bx, by)) uf.union(key, ka);
      }
    }
  }
  for (const p of pins) uf.union(`P:${p.part.id}:${p.pin.id}`, pk(p.x, p.y));

  // Global nets: labels and power symbols
  for (const part of doc.parts) {
    const def = LIB[part.type];
    if (!def) continue;
    const gname = def.globalNet?.(part.props || {});
    if (gname) {
      for (const p of partPins(part)) uf.union(`P:${part.id}:${p.id}`, `N:${gname}`);
    }
  }

  // Group
  const groups = new Map();
  const nets = [];
  const pinNet = new Map();
  const getNet = (root) => {
    let idx = groups.get(root);
    if (idx === undefined) {
      idx = nets.length;
      groups.set(root, idx);
      nets.push({ index: idx, name: null, pins: [], power: null, keys: [] });
    }
    return nets[idx];
  };
  for (const p of pins) {
    const key = `P:${p.part.id}:${p.pin.id}`;
    const net = getNet(uf.find(key));
    net.pins.push({ partId: p.part.id, pinId: p.pin.id, part: p.part, pin: p.pin });
    pinNet.set(`${p.part.id}:${p.pin.id}`, net.index);
  }
  // Names + power info
  const warnings = [];
  for (const part of doc.parts) {
    const def = LIB[part.type];
    const gname = def?.globalNet?.(part.props || {});
    if (!gname) continue;
    const firstPin = partPins(part)[0];
    if (!firstPin) continue;
    const net = nets[pinNet.get(`${part.id}:${firstPin.id}`)];
    if (!net) continue;
    const isPower = def.isPower;
    if (isPower) {
      const v = def.powerVoltage(part.props || {});
      if (net.power && Math.abs(net.power.voltage - v) > 1e-9 && net.power.name !== gname) {
        warnings.push(`전원 단락: ${net.power.name} ↔ ${gname}`);
      }
      if (!net.power) net.power = { name: gname, voltage: v };
      net.name = gname;
    } else if (!net.name) {
      net.name = gname;
    }
  }
  // Wire points -> net (for highlighting)
  const wireNet = new Map();
  for (const w of doc.wires) {
    if (!w.points.length) continue;
    const root = uf.find(pk(w.points[0][0], w.points[0][1]));
    const idx = groups.get(root);
    if (idx !== undefined) wireNet.set(w.id, idx);
    else {
      const net = getNet(root);
      wireNet.set(w.id, net.index);
    }
  }
  let auto = 1;
  for (const n of nets) {
    if (!n.name) n.name = `Net-${auto++}`;
    n.isGround = !!n.power && n.power.voltage === 0;
  }
  return { nets, pinNet, wireNet, warnings };
}

/** Junction dots: points where 3+ connection ends meet */
export function computeJunctions(doc) {
  const count = new Map();
  const add = (x, y, n) => { const k = pk(x, y); count.set(k, (count.get(k) || 0) + n); };
  const pts = new Map();
  for (const w of doc.wires) {
    const p = w.points;
    p.forEach(([x, y], i) => {
      add(x, y, i === 0 || i === p.length - 1 ? 1 : 2);
      pts.set(pk(x, y), [x, y]);
    });
  }
  const pins = allPins(doc);
  for (const p of pins) { add(p.x, p.y, 1); pts.set(pk(p.x, p.y), [p.x, p.y]); }
  // points lying in the interior of a segment
  for (const w of doc.wires) {
    const p = w.points;
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      for (const [k, [x, y]] of pts) {
        if ((x === ax && y === ay) || (x === bx && y === by)) continue;
        if (onSegment(x, y, ax, ay, bx, by)) count.set(k, (count.get(k) || 0) + 2);
      }
    }
  }
  const out = [];
  for (const [k, c] of count) if (c >= 3) out.push(pts.get(k));
  // unconnected pin tips (for KiCad-like open pin markers)
  const open = [];
  for (const p of pins) if ((count.get(pk(p.x, p.y)) || 0) <= 1) open.push([p.x, p.y]);
  return { junctions: out, openPins: open };
}
