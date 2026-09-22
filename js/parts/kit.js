// Symbol drawing kit + geometry helpers (pure, no DOM)
export const GRID = 10;

export const LIB = {};
export const CATEGORIES = [];

export function register(def) {
  LIB[def.type] = def;
  if (!def.hidden && !CATEGORIES.includes(def.category)) CATEGORIES.push(def.category);
  return def;
}

// ---------------------------------------------------------------------------
// Geometry: local symbol coordinates -> sheet coordinates
// ---------------------------------------------------------------------------
export function xdir(part, x, y) {
  const lx = part.mirror ? -x : x;
  switch (part.rot & 3) {
    case 1: return [-y, lx];
    case 2: return [-lx, -y];
    case 3: return [y, -lx];
    default: return [lx, y];
  }
}
export function xform(part, x, y) {
  const [dx, dy] = xdir(part, x, y);
  return [part.x + dx, part.y + dy];
}
export function partTransform(part) {
  return `translate(${part.x},${part.y}) rotate(${(part.rot & 3) * 90})${part.mirror ? ' scale(-1,1)' : ''}`;
}

const symCache = new Map();
/** Returns the resolved symbol {pins, shapes, texts, bbox} for a part (cached by props) */
export function getSymbol(part) {
  const def = LIB[part.type];
  if (!def) return { pins: [], shapes: '', texts: [], bbox: [-10, -10, 10, 10] };
  const key = part.type + '|' + (def.symbolKey ? def.symbolKey(part.props) : '');
  let s = symCache.get(key);
  if (!s) {
    s = def.symbol(part.props || {});
    symCache.set(key, s);
  }
  return s;
}

export function partPins(part) {
  const sym = getSymbol(part);
  return sym.pins.map((p) => {
    const [x, y] = xform(part, p.x, p.y);
    return { ...p, wx: x, wy: y };
  });
}

export function partBBox(part) {
  const [x1, y1, x2, y2] = getSymbol(part).bbox;
  const a = xform(part, x1, y1), b = xform(part, x2, y2);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

// ---------------------------------------------------------------------------
// Symbol builder
// ---------------------------------------------------------------------------
export class Sym {
  constructor() {
    this.s = [];
    this.pins = [];
    this.texts = [];
    this.bb = [Infinity, Infinity, -Infinity, -Infinity];
  }
  _bb(x, y) {
    const b = this.bb;
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  }
  line(x1, y1, x2, y2, cls = 'sl') {
    this._bb(x1, y1); this._bb(x2, y2);
    this.s.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`);
    return this;
  }
  rect(x, y, w, h, cls = 'sb', extra = '') {
    this._bb(x, y); this._bb(x + w, y + h);
    this.s.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls}" ${extra}/>`);
    return this;
  }
  circle(cx, cy, r, cls = 'sl', extra = '') {
    this._bb(cx - r, cy - r); this._bb(cx + r, cy + r);
    this.s.push(`<circle cx="${cx}" cy="${cy}" r="${r}" class="${cls}" ${extra}/>`);
    return this;
  }
  poly(pts, cls = 'sl', closed = false, extra = '') {
    for (let i = 0; i < pts.length; i += 2) this._bb(pts[i], pts[i + 1]);
    const tag = closed ? 'polygon' : 'polyline';
    this.s.push(`<${tag} points="${pts.join(',')}" class="${cls}" ${extra}/>`);
    return this;
  }
  path(d, cls = 'sl', bbox = null, extra = '') {
    if (bbox) { this._bb(bbox[0], bbox[1]); this._bb(bbox[2], bbox[3]); }
    this.s.push(`<path d="${d}" class="${cls}" ${extra}/>`);
    return this;
  }
  raw(svg, bbox) {
    if (bbox) { this._bb(bbox[0], bbox[1]); this._bb(bbox[2], bbox[3]); }
    this.s.push(svg);
    return this;
  }
  /** Text in local coords; dir = reading direction; kept upright when rendered */
  text(x, y, str, { a = 'start', size = 9, cls = 'tx', dir = [1, 0], bold = false } = {}) {
    this.texts.push({ x, y, s: String(str), a, size, cls, dir, bold });
    return this;
  }
  /**
   * Pin with tip at (x,y) extending `len` toward the body. side: direction from tip into body.
   * opts: name, num, showName, showNum
   */
  pin(id, x, y, side, len = 10, opts = {}) {
    const d = { R: [1, 0], L: [-1, 0], D: [0, 1], U: [0, -1] }[side];
    const ex = x + d[0] * len, ey = y + d[1] * len;
    this._bb(x, y); this._bb(ex, ey);
    this.s.push(`<line x1="${x}" y1="${y}" x2="${ex}" y2="${ey}" class="pl"/>`);
    if (opts.inv) {
      this.s.push(`<circle cx="${ex - d[0] * 3}" cy="${ey - d[1] * 3}" r="3" class="sl"/>`);
    }
    if (opts.clk) {
      const px = -d[1], py = d[0];
      this.s.push(`<polyline points="${ex + px * 3},${ey + py * 3} ${ex + d[0] * 5},${ey + d[1] * 5} ${ex - px * 3},${ey - py * 3}" class="sl"/>`);
    }
    if (opts.showName && opts.name) {
      const off = opts.clk ? 7 : 3;
      this.text(ex + d[0] * off, ey + d[1] * off, opts.name, { a: 'start', size: opts.nameSize || 8, cls: 'pn', dir: d, over: opts.over });
    }
    if (opts.showNum && opts.num != null) {
      const horizontal = d[1] === 0;
      const mx = x + d[0] * len / 2, my = y + d[1] * len / 2;
      if (horizontal) this.text(mx, my - 3.5, opts.num, { a: 'middle', size: 7, cls: 'pnum' });
      else this.text(mx - 3.5, my, opts.num, { a: 'middle', size: 7, cls: 'pnum', dir: [0, -1] });
    }
    this.pins.push({ id: String(id), name: opts.name || String(id), num: opts.num, x, y, side, len });
    return this;
  }
  ref(x, y, a = 'start') { this.refPos = { x, y, a }; return this; }
  val(x, y, a = 'start') { this.valPos = { x, y, a }; return this; }
  build(extra = {}) {
    const b = this.bb;
    return {
      pins: this.pins, shapes: this.s.join(''), texts: this.texts,
      bbox: [b[0] - 2, b[1] - 2, b[2] + 2, b[3] + 2],
      refPos: this.refPos, valPos: this.valPos, ...extra,
    };
  }
}

/** Upright text placement in world space for a local text record */
export function worldText(part, t) {
  const [wx, wy] = xform(part, t.x, t.y);
  const [dx, dy] = xdir(part, t.dir?.[0] ?? 1, t.dir?.[1] ?? 0);
  let anchor = t.a, rotate = 0;
  const flip = (a) => (a === 'start' ? 'end' : a === 'end' ? 'start' : a);
  if (dx > 0.5) { /* normal */ } else if (dx < -0.5) anchor = flip(anchor);
  else if (dy < -0.5) rotate = -90;
  else { rotate = -90; anchor = flip(anchor); }
  return { x: wx, y: wy, anchor, rotate };
}

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function logicLevel(v, vcc, prev) {
  if (v >= vcc * 0.6) return 1;
  if (v <= vcc * 0.3) return 0;
  return prev ?? (v > vcc / 2 ? 1 : 0);
}
