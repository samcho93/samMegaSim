// KiCad-style schematic editor on SVG
import { LIB, getSymbol, partPins, partBBox, partTransform, worldText, esc, GRID } from '../parts/kit.js';
import { computeJunctions, onSegment } from '../sim/netlist.js';

const NS = 'http://www.w3.org/2000/svg';
export const SHEETS = { A4: [2340, 1650], A3: [3310, 2340], A2: [4680, 3310] };

const snap = (v) => Math.round(v / GRID) * GRID;
const uid = () => Math.random().toString(36).slice(2, 9);

export function simplifyPoints(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push([p[0], p[1]]);
  }
  // remove collinear middle points
  for (let i = 1; i + 1 < out.length;) {
    const [ax, ay] = out[i - 1], [bx, by] = out[i], [cx, cy] = out[i + 1];
    const col = (ax === bx && bx === cx) || (ay === by && by === cy);
    const between = col && ((bx - ax) * (cx - bx) >= 0) && ((by - ay) * (cy - by) >= 0);
    if (between) out.splice(i, 1); else i++;
  }
  return out;
}

/** Move one end of a polyline wire keeping it orthogonal when possible */
function dragEndpoint(orig, endIdx, dx, dy) {
  const pts = orig.map((p) => [p[0], p[1]]);
  const e = endIdx === 0 ? 0 : pts.length - 1;
  const ni = endIdx === 0 ? 1 : pts.length - 2;
  const E = pts[e], N = pts[ni];
  const nE = [E[0] + dx, E[1] + dy];
  const horiz = E[1] === N[1], vert = E[0] === N[0];
  if (pts.length >= 3) {
    const mi = endIdx === 0 ? 2 : pts.length - 3;
    const M = pts[mi];
    if (horiz && N[0] === M[0]) { N[1] = nE[1]; pts[e] = nE; return simplifyPoints(pts); }
    if (vert && N[1] === M[1]) { N[0] = nE[0]; pts[e] = nE; return simplifyPoints(pts); }
  }
  pts[e] = nE;
  if (nE[0] !== N[0] && nE[1] !== N[1]) {
    const corner = horiz ? [nE[0], N[1]] : vert ? [N[0], nE[1]] : [nE[0], N[1]];
    pts.splice(endIdx === 0 ? 1 : pts.length - 1, 0, corner);
  }
  return simplifyPoints(pts);
}

export class SchematicEditor {
  constructor(svg, app) {
    this.svg = svg;
    this.app = app;
    this.view = { x: 40, y: 40, z: 0.6 };
    this.mode = 'select';
    this.sel = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.clip = null;
    this.showGrid = true;
    this.netColors = true;
    this.placing = null; // {type, props, rot, mirror}
    this.wireDraw = null;
    this.drag = null;
    this.dynCache = new Map();
    this.simInst = null;
    this._buildDom();
    this._bindEvents();
  }

  get doc() { return this.app.doc; }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  _el(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }

  _buildDom() {
    const s = this.svg;
    s.innerHTML = '';
    const defs = this._el('defs', {}, s);
    defs.innerHTML = `
      <pattern id="gridp" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="0.75" class="grid-dot"/></pattern>
      <pattern id="gridp50" width="50" height="50" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="1.6" class="grid-dot"/></pattern>`;
    this.world = this._el('g', { id: 'world' }, s);
    this.sheetLayer = this._el('g', {}, this.world);
    this.wireLayer = this._el('g', {}, this.world);
    this.partLayer = this._el('g', {}, this.world);
    this.juncLayer = this._el('g', {}, this.world);
    this.stateLayer = this._el('g', {}, this.world);
    this.overlay = this._el('g', {}, this.world);
    this._applyView();
  }

  _applyView() {
    const { x, y, z } = this.view;
    this.world.setAttribute('transform', `translate(${x},${y}) scale(${z})`);
    if (this.gridRect) this.gridRect.setAttribute('fill', z < 0.45 ? 'url(#gridp50)' : 'url(#gridp)');
    this.app.onViewChange?.(this.view);
  }

  sheetSize() { return SHEETS[this.doc.meta?.sheet] || SHEETS.A4; }

  renderSheet() {
    const [W, H] = this.sheetSize();
    const m = this.doc.meta || {};
    const L = this.sheetLayer;
    L.innerHTML = '';
    this._el('rect', { x: 0, y: 0, width: W, height: H, class: 'sheet-bg' }, L);
    this.gridRect = this._el('rect', { x: 20, y: 20, width: W - 40, height: H - 40, fill: 'url(#gridp)', display: this.showGrid ? '' : 'none' }, L);
    this._el('rect', { x: 20, y: 20, width: W - 40, height: H - 40, class: 'sheet-frame' }, L);
    this._el('rect', { x: 30, y: 30, width: W - 60, height: H - 60, class: 'sheet-frame2' }, L);
    // zone markers
    let g = '';
    const nx = Math.round((W - 60) / 380), ny = Math.round((H - 60) / 400);
    for (let i = 0; i < nx; i++) {
      const x0 = 30 + ((W - 60) * i) / nx, x1 = 30 + ((W - 60) * (i + 1)) / nx;
      if (i) g += `<line x1="${x0}" y1="20" x2="${x0}" y2="30" class="sheet-frame2"/><line x1="${x0}" y1="${H - 30}" x2="${x0}" y2="${H - 20}" class="sheet-frame2"/>`;
      g += `<text x="${(x0 + x1) / 2}" y="28" text-anchor="middle" class="sheet-zone">${i + 1}</text><text x="${(x0 + x1) / 2}" y="${H - 22}" text-anchor="middle" class="sheet-zone">${i + 1}</text>`;
    }
    for (let i = 0; i < ny; i++) {
      const y0 = 30 + ((H - 60) * i) / ny, y1 = 30 + ((H - 60) * (i + 1)) / ny;
      const ch = String.fromCharCode(65 + i);
      if (i) g += `<line x1="20" y1="${y0}" x2="30" y2="${y0}" class="sheet-frame2"/><line x1="${W - 30}" y1="${y0}" x2="${W - 20}" y2="${y0}" class="sheet-frame2"/>`;
      g += `<text x="25" y="${(y0 + y1) / 2 + 4}" text-anchor="middle" class="sheet-zone">${ch}</text><text x="${W - 25}" y="${(y0 + y1) / 2 + 4}" text-anchor="middle" class="sheet-zone">${ch}</text>`;
    }
    // title block (bottom-right)
    const tw = 560, th = 110, tx = W - 30 - tw, ty = H - 30 - th;
    g += `<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" class="sheet-frame" style="fill:var(--k-bg)"/>`;
    g += `<line x1="${tx}" y1="${ty + 30}" x2="${tx + tw}" y2="${ty + 30}" class="sheet-frame2"/>`;
    g += `<line x1="${tx}" y1="${ty + 70}" x2="${tx + tw}" y2="${ty + 70}" class="sheet-frame2"/>`;
    g += `<line x1="${tx + 360}" y1="${ty + 70}" x2="${tx + 360}" y2="${ty + th}" class="sheet-frame2"/>`;
    g += `<line x1="${tx + 460}" y1="${ty + 70}" x2="${tx + 460}" y2="${ty + th}" class="sheet-frame2"/>`;
    g += `<text x="${tx + 8}" y="${ty + 19}" class="tb-text">${esc(m.company || 'samMegaSim')}</text>`;
    g += `<text x="${tx + tw - 8}" y="${ty + 19}" text-anchor="end" class="tb-text">samMegaSim — ATmega Schematic &amp; Simulation</text>`;
    g += `<text x="${tx + 8}" y="${ty + 42}" class="tb-text">Title:</text><text x="${tx + 50}" y="${ty + 58}" class="tb-title">${esc(m.title || 'Untitled')}</text>`;
    g += `<text x="${tx + 8}" y="${ty + 84}" class="tb-text">Author: </text><text x="${tx + 58}" y="${ty + 84}" class="tb-val">${esc(m.author || '')}</text>`;
    g += `<text x="${tx + 8}" y="${ty + 102}" class="tb-text">Date: </text><text x="${tx + 58}" y="${ty + 102}" class="tb-val">${esc(m.date || new Date().toISOString().slice(0, 10))}</text>`;
    g += `<text x="${tx + 368}" y="${ty + 84}" class="tb-text">Size: ${esc(m.sheet || 'A4')}</text><text x="${tx + 368}" y="${ty + 102}" class="tb-text">Sheet: 1/1</text>`;
    g += `<text x="${tx + 468}" y="${ty + 84}" class="tb-text">Rev: ${esc(m.rev || '1.0')}</text><text x="${tx + 468}" y="${ty + 102}" class="tb-text">KiCad style</text>`;
    L.insertAdjacentHTML('beforeend', g);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  render() {
    this.renderSheet();
    this.renderWires();
    this.renderParts();
    this.renderJunctions();
    this.dynCache.clear();
    this.renderDyn();
    this.app.onSelectionChange?.(this.sel);
  }

  partSvg(part, ghost = false) {
    const def = LIB[part.type];
    const sym = getSymbol(part);
    const sel = this.sel.has(part.id);
    let out = `<g class="part${sel ? ' sel' : ''}${ghost ? ' ghost' : ''}" data-id="${part.id}">`;
    const bb = partBBox(part);
    if (!ghost) out += `<rect class="hovbox" x="${bb[0]}" y="${bb[1]}" width="${bb[2] - bb[0]}" height="${bb[3] - bb[1]}"/>`;
    if (sel && !ghost) out += `<rect class="selbox" x="${bb[0] - 3}" y="${bb[1] - 3}" width="${bb[2] - bb[0] + 6}" height="${bb[3] - bb[1] + 6}"/>`;
    out += `<g transform="${partTransform(part)}">${sym.shapes}<g class="dyn">${def?.dyn ? def.dyn(part, null) : ''}</g></g>`;
    for (const t of sym.texts) out += this._textSvg(part, t);
    const showRef = def && !def.hideRef && sym.refPos;
    const v = def && !def.isPower && part.type !== 'label' && sym.valPos ? (def.valueText ? def.valueText(part.props) : part.props.value ?? def.name) : null;
    if (part.rot & 1) {
      // rotated 90/270: keep reference/value horizontal above and below the body (KiCad style)
      const cx = (bb[0] + bb[2]) / 2;
      if (showRef) out += `<text x="${cx}" y="${bb[1] - 6}" text-anchor="middle" font-size="10" class="ref">${esc(part.ref)}</text>`;
      if (v) out += `<text x="${cx}" y="${bb[3] + 12}" text-anchor="middle" font-size="10" class="val">${esc(v)}</text>`;
    } else {
      if (showRef) out += this._textSvg(part, { ...sym.refPos, s: part.ref, size: 10, cls: 'ref', dir: [1, 0] });
      if (v) out += this._textSvg(part, { ...sym.valPos, s: v, size: 10, cls: 'val', dir: [1, 0] });
    }
    return out + '</g>';
  }

  _textSvg(part, t) {
    const w = worldText(part, t);
    const rot = w.rotate ? ` transform="rotate(${w.rotate} ${w.x} ${w.y})"` : '';
    const bold = t.bold ? ' font-weight="700"' : '';
    return `<text x="${w.x}" y="${w.y}" text-anchor="${w.anchor}" dominant-baseline="central" font-size="${t.size}" class="${t.cls}"${bold}${rot}>${esc(t.s)}</text>`;
  }

  renderParts() {
    this.partLayer.innerHTML = this.doc.parts.map((p) => this.partSvg(p)).join('');
    this.partEls = new Map();
    for (const g of this.partLayer.children) this.partEls.set(g.dataset.id, g);
  }

  renderWires() {
    let h = '';
    for (const w of this.doc.wires) {
      const pts = w.points.map((p) => p.join(',')).join(' ');
      const sel = this.sel.has(w.id) ? ' sel' : '';
      h += `<g data-wid="${w.id}"><polyline class="wire-hit" points="${pts}"/><polyline class="wire${sel}" points="${pts}"/></g>`;
    }
    this.wireLayer.innerHTML = h;
    this.wireEls = new Map();
    for (const g of this.wireLayer.children) this.wireEls.set(g.dataset.wid, g.lastChild);
  }

  renderJunctions() {
    const { junctions, openPins } = computeJunctions(this.doc);
    let h = junctions.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.6" class="junction"/>`).join('');
    if (!this.simInst) h += openPins.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2" class="open-pin"/>`).join('');
    this.juncLayer.innerHTML = h;
  }

  /** Update dynamic (simulation) visuals */
  renderDyn(sim = this.simInst) {
    for (const part of this.doc.parts) {
      const def = LIB[part.type];
      if (!def?.dyn) continue;
      const g = this.partEls?.get(part.id);
      if (!g) continue;
      const inst = sim?.instances.get(part.id) || null;
      const html = def.dyn(part, inst);
      if (this.dynCache.get(part.id) === html) continue;
      this.dynCache.set(part.id, html);
      const dg = g.querySelector('.dyn');
      if (dg) dg.innerHTML = html;
    }
    // wire colouring by net voltage
    if (sim && this.netColors) {
      const nl = sim.netlist;
      for (const w of this.doc.wires) {
        const el = this.wireEls?.get(w.id);
        if (!el) continue;
        const idx = nl.wireNet.get(w.id);
        let cls = 'wire';
        if (idx !== undefined) {
          const node = sim.nodeOf[idx];
          const v = sim.circuit.V(node);
          cls += v >= sim.vcc * 0.6 ? ' hi' : v <= sim.vcc * 0.3 ? ' lo' : ' mid';
        }
        if (this.sel.has(w.id)) cls += ' sel';
        if (el.getAttribute('class') !== cls) el.setAttribute('class', cls);
      }
      // MCU pin state indicators (Proteus style)
      let h = '';
      for (const m of sim.mcus) {
        const pins = partPins(m.part);
        const byId = new Map(pins.map((p) => [p.id, p]));
        for (const p of m.pins) {
          const pp = byId.get(p.id);
          if (!pp) continue;
          const out = p.code === 0 || p.code === 1;
          const lvl = out ? p.code : p.lvl;
          const cls = lvl ? 'hi' : 'lo';
          h += `<rect x="${pp.wx - 3}" y="${pp.wy - 3}" width="6" height="6" class="pin-state ${cls}"${out ? '' : ' opacity=".55"'}/>`;
        }
      }
      if (this._stateHtml !== h) { this.stateLayer.innerHTML = h; this._stateHtml = h; }
    }
  }

  clearSimVisuals() {
    for (const w of this.doc.wires) {
      const el = this.wireEls?.get(w.id);
      if (el) el.setAttribute('class', 'wire' + (this.sel.has(w.id) ? ' sel' : ''));
    }
    this.stateLayer.innerHTML = '';
    this._stateHtml = '';
    this.dynCache.clear();
    this.renderDyn(null);
    this.renderJunctions();
  }

  // ---------------------------------------------------------------------------
  // Coordinates
  // ---------------------------------------------------------------------------
  toWorld(ev) {
    const r = this.svg.getBoundingClientRect();
    return [(ev.clientX - r.left - this.view.x) / this.view.z, (ev.clientY - r.top - this.view.y) / this.view.z];
  }

  zoomAt(factor, sx, sy) {
    const r = this.svg.getBoundingClientRect();
    if (sx == null) { sx = r.width / 2; sy = r.height / 2; }
    const z = Math.min(8, Math.max(0.08, this.view.z * factor));
    const k = z / this.view.z;
    this.view.x = sx - (sx - this.view.x) * k;
    this.view.y = sy - (sy - this.view.y) * k;
    this.view.z = z;
    this._applyView();
  }

  zoomFit(onlyPage = false) {
    const r = this.svg.getBoundingClientRect();
    let bb;
    if (!onlyPage && (this.doc.parts.length || this.doc.wires.length)) {
      bb = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of this.doc.parts) {
        const b = partBBox(p);
        bb = [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])];
      }
      for (const w of this.doc.wires) for (const [x, y] of w.points) bb = [Math.min(bb[0], x), Math.min(bb[1], y), Math.max(bb[2], x), Math.max(bb[3], y)];
      const pad = 60;
      bb = [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad];
    } else {
      const [W, H] = this.sheetSize();
      bb = [0, 0, W, H];
    }
    const z = Math.min(r.width / (bb[2] - bb[0]), r.height / (bb[3] - bb[1]), 3);
    this.view.z = z;
    this.view.x = (r.width - (bb[2] - bb[0]) * z) / 2 - bb[0] * z;
    this.view.y = (r.height - (bb[3] - bb[1]) * z) / 2 - bb[1] * z;
    this._applyView();
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------
  snapshot() { return JSON.stringify({ parts: this.doc.parts, wires: this.doc.wires }); }
  checkpoint() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  _restore(s) {
    const o = JSON.parse(s);
    this.doc.parts = o.parts; this.doc.wires = o.wires;
    for (const id of [...this.sel]) if (!this.findPart(id) && !this.findWire(id)) this.sel.delete(id);
    this.render();
    this.app.onDocChange?.();
  }
  undo() { if (!this.undoStack.length) return; this.redoStack.push(this.snapshot()); this._restore(this.undoStack.pop()); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(this.snapshot()); this._restore(this.redoStack.pop()); }
  changed() { this.render(); this.app.onDocChange?.(); }

  findPart(id) { return this.doc.parts.find((p) => p.id === id); }
  findWire(id) { return this.doc.wires.find((w) => w.id === id); }

  // ---------------------------------------------------------------------------
  // Part creation
  // ---------------------------------------------------------------------------
  nextRef(prefix) {
    const used = new Set(this.doc.parts.map((p) => p.ref));
    for (let i = 1; ; i++) {
      const r = prefix + (prefix.startsWith('#') ? String(i).padStart(2, '0') : i);
      if (!used.has(r)) return r;
    }
  }

  makePart(type, props = {}) {
    const def = LIB[type];
    const p = { id: 'p' + uid(), type, x: 0, y: 0, rot: 0, mirror: false, ref: '', props: {} };
    for (const pr of def.props || []) p.props[pr.key] = pr.default;
    Object.assign(p.props, props);
    return p;
  }

  startPlace(type, props = {}) {
    if (this.app.isSimRunning()) { this.app.toast('시뮬레이션 중에는 편집할 수 없습니다', 'warn'); return; }
    this.cancelWire();
    const p = this.makePart(type, props);
    this.placing = p;
    this.setMode('place');
    this._renderGhost();
    this.app.hint(`${LIB[type].name} 배치: 클릭하여 배치 · R 회전 · X 반전 · Esc 취소`);
  }

  _renderGhost() {
    this.overlay.querySelector('.ghostwrap')?.remove();
    if (!this.placing || this.placing.x == null) return;
    const g = this._el('g', { class: 'ghostwrap' }, this.overlay);
    g.innerHTML = this.partSvg(this.placing, true);
  }

  _placeAt(x, y) {
    const p = this.placing;
    this.checkpoint();
    const def = LIB[p.type];
    const np = JSON.parse(JSON.stringify(p));
    np.id = 'p' + uid();
    np.x = x; np.y = y;
    np.ref = this.nextRef(def.prefix || 'U');
    this.doc.parts.push(np);
    this.sel.clear();
    this.changed();
    this.app.onPartPlaced?.(np);
    return np;
  }

  // ---------------------------------------------------------------------------
  // Modes
  // ---------------------------------------------------------------------------
  setMode(m) {
    if (m !== 'place') { this.placing = null; this._renderGhost(); }
    if (m !== 'wire') this.cancelWire();
    this.mode = m;
    this.svg.classList.toggle('mode-wire', m === 'wire');
    this.svg.classList.toggle('mode-place', m === 'place');
    this.app.onModeChange?.(m);
  }

  // ---------------------------------------------------------------------------
  // Edit operations
  // ---------------------------------------------------------------------------
  selectAll() { this.sel = new Set([...this.doc.parts.map((p) => p.id), ...this.doc.wires.map((w) => w.id)]); this.render(); }
  clearSel() { if (this.sel.size) { this.sel.clear(); this.render(); } }

  deleteSelection() {
    if (!this.sel.size) return;
    this.checkpoint();
    this.doc.parts = this.doc.parts.filter((p) => !this.sel.has(p.id));
    this.doc.wires = this.doc.wires.filter((w) => !this.sel.has(w.id));
    this.sel.clear();
    this.changed();
  }

  rotateSelection(dir = 1) {
    if (this.mode === 'place' && this.placing) { this.placing.rot = (this.placing.rot + dir + 4) & 3; this._renderGhost(); return; }
    const parts = this.doc.parts.filter((p) => this.sel.has(p.id));
    if (!parts.length) return;
    this.checkpoint();
    if (parts.length === 1 && ![...this.sel].some((id) => this.findWire(id))) {
      const p = parts[0];
      this._withRubber([p], () => { p.rot = (p.rot + dir + 4) & 3; });
    } else {
      // rotate group around its center
      const cx = snap(parts.reduce((s, p) => s + p.x, 0) / parts.length);
      const cy = snap(parts.reduce((s, p) => s + p.y, 0) / parts.length);
      const rot = ([x, y]) => [cx - (y - cy) * dir, cy + (x - cx) * dir];
      for (const p of parts) { [p.x, p.y] = rot([p.x, p.y]); p.rot = (p.rot + dir + 4) & 3; }
      for (const w of this.doc.wires) if (this.sel.has(w.id)) w.points = w.points.map(rot);
    }
    this.changed();
  }

  mirrorSelection() {
    if (this.mode === 'place' && this.placing) { this.placing.mirror = !this.placing.mirror; this._renderGhost(); return; }
    const parts = this.doc.parts.filter((p) => this.sel.has(p.id));
    if (!parts.length) return;
    this.checkpoint();
    for (const p of parts) this._withRubber([p], () => { p.mirror = !p.mirror; });
    this.changed();
  }

  /** Apply a transformation to parts while keeping attached wire ends connected */
  _withRubber(parts, fn) {
    const before = new Map();
    for (const p of parts) before.set(p.id, partPins(p));
    fn();
    for (const p of parts) {
      const after = new Map(partPins(p).map((q) => [q.id, q]));
      for (const q of before.get(p.id)) {
        const nq = after.get(q.id);
        if (!nq) continue;
        for (const w of this.doc.wires) {
          const last = w.points.length - 1;
          for (const idx of [0, last]) {
            const [x, y] = w.points[idx];
            if (x === q.wx && y === q.wy) w.points = dragEndpoint(w.points, idx === 0 ? 0 : 1, nq.wx - x, nq.wy - y);
          }
        }
      }
    }
  }

  /**
   * Re-attach wire ends after a symbol's pinout changed.
   * moves = [{from:[x,y], to:[x,y], name, sameSide, side}]
   * Wires are rubber-banded when that is safe; otherwise matching net labels keep the connection.
   */
  moveWireEnds(moves) {
    const key = (p) => `${p[0]},${p[1]}`;
    const map = new Map(moves.map((m) => [key(m.from), m]));
    const tips = new Set();
    for (const p of this.doc.parts) for (const q of partPins(p)) tips.add(`${q.wx},${q.wy}`);
    const touchesOtherPin = (pts) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        for (const t of tips) {
          const [x, y] = t.split(',').map(Number);
          const isEnd = (x === pts[0][0] && y === pts[0][1]) || (x === pts[pts.length - 1][0] && y === pts[pts.length - 1][1]);
          if (!isEnd && onSegment(x, y, ax, ay, bx, by)) return true;
        }
      }
      return false;
    };
    // label orientation so that the flag extends along direction d
    const orient = (d) => (d[0] > 0 ? {} : d[0] < 0 ? { mirror: true } : d[1] > 0 ? { rot: 1 } : { rot: 3 });
    const addLabel = (x, y, name, o) => {
      const lp = this.makePart('label', { name });
      Object.assign(lp, { x, y, rot: o.rot || 0, mirror: !!o.mirror, ref: this.nextRef('#LBL') });
      this.doc.parts.push(lp);
    };
    const labelled = new Set();
    for (const w of this.doc.wires) {
      for (const endIdx of [0, 1]) {
        const i = endIdx === 0 ? 0 : w.points.length - 1;
        const m = map.get(key(w.points[i]));
        if (!m) continue;
        const moved = dragEndpoint(w.points, endIdx, m.to[0] - m.from[0], m.to[1] - m.from[1]);
        if (m.sameSide && !touchesOtherPin(moved)) { w.points = moved; continue; }
        // keep the wire where it is and connect it to the new pin position with a net label pair
        const prev = w.points[endIdx === 0 ? 1 : w.points.length - 2];
        let end = w.points[i];
        const dx = Math.sign(end[0] - prev[0]), dy = Math.sign(end[1] - prev[1]);
        // pull the loose end back from the (new) symbol so it cannot touch another pin
        const segLen = Math.abs(end[0] - prev[0]) + Math.abs(end[1] - prev[1]);
        if (segLen > 20) {
          end = [end[0] - dx * 20, end[1] - dy * 20];
          w.points[i] = end;
        }
        addLabel(end[0], end[1], m.name, orient([-dx, -dy]));
        if (!labelled.has(m.name)) {
          labelled.add(m.name);
          const d = m.out || [1, 0];
          const stubEnd = [m.to[0] + d[0] * 20, m.to[1] + d[1] * 20];
          this.doc.wires.push({ id: 'w' + uid(), points: [m.to, stubEnd] });
          addLabel(stubEnd[0], stubEnd[1], m.name, orient(d));
        }
      }
    }
  }

  copy() {
    const parts = this.doc.parts.filter((p) => this.sel.has(p.id));
    const wires = this.doc.wires.filter((w) => this.sel.has(w.id));
    if (!parts.length && !wires.length) return false;
    this.clip = JSON.stringify({ parts, wires });
    try { localStorage.setItem('sms.clip', this.clip); } catch { /* ignore */ }
    return true;
  }
  cut() { if (this.copy()) this.deleteSelection(); }
  paste(offset = 40) {
    let clip = this.clip;
    try { clip = clip || localStorage.getItem('sms.clip'); } catch { /* ignore */ }
    if (!clip) return;
    const { parts, wires } = JSON.parse(clip);
    this.checkpoint();
    this.sel.clear();
    for (const p of parts) {
      p.id = 'p' + uid(); p.x += offset; p.y += offset;
      p.ref = this.nextRef(LIB[p.type]?.prefix || 'U');
      this.doc.parts.push(p); this.sel.add(p.id);
    }
    for (const w of wires) {
      w.id = 'w' + uid(); w.points = w.points.map(([x, y]) => [x + offset, y + offset]);
      this.doc.wires.push(w); this.sel.add(w.id);
    }
    this.changed();
  }
  duplicate() { if (this.copy()) this.paste(40); }

  // ---------------------------------------------------------------------------
  // Wires
  // ---------------------------------------------------------------------------
  _pinAt(x, y, tol) {
    for (const p of this.doc.parts) {
      for (const q of partPins(p)) if (Math.abs(q.wx - x) <= tol && Math.abs(q.wy - y) <= tol) return { part: p, pin: q, x: q.wx, y: q.wy };
    }
    return null;
  }

  _connectableAt(x, y, excludeWire = null) {
    if (this._pinAt(x, y, 0.5)) return true;
    for (const w of this.doc.wires) {
      if (w === excludeWire) continue;
      const p = w.points;
      for (let i = 0; i + 1 < p.length; i++) if (onSegment(x, y, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1])) return true;
    }
    return false;
  }

  startWire(x, y) {
    this.wireDraw = { points: [[x, y]], cursor: [x, y], hvFirst: true };
    this._renderWirePreview();
  }

  _wireCorner(last, p, hvFirst) {
    if (last[0] === p[0] || last[1] === p[1]) return null;
    return hvFirst ? [p[0], last[1]] : [last[0], p[1]];
  }

  _renderWirePreview() {
    this.overlay.querySelector('.wire-preview')?.remove();
    const wd = this.wireDraw;
    if (!wd) return;
    const pts = [...wd.points];
    const last = pts[pts.length - 1];
    const c = this._wireCorner(last, wd.cursor, wd.hvFirst);
    if (c) pts.push(c);
    pts.push(wd.cursor);
    this._el('polyline', { class: 'wire-preview', points: pts.map((p) => p.join(',')).join(' ') }, this.overlay);
  }

  _wireClick(x, y) {
    const wd = this.wireDraw;
    if (!wd) {
      this.startWire(x, y);
      return;
    }
    const last = wd.points[wd.points.length - 1];
    if (last[0] === x && last[1] === y) { this.finishWire(); return; }
    const c = this._wireCorner(last, [x, y], wd.hvFirst);
    if (c) wd.points.push(c);
    wd.points.push([x, y]);
    if (this._connectableAt(x, y)) { this.finishWire(); return; }
    this._renderWirePreview();
  }

  finishWire() {
    const wd = this.wireDraw;
    this.wireDraw = null;
    this.overlay.querySelector('.wire-preview')?.remove();
    if (!wd) return;
    const pts = simplifyPoints(wd.points);
    if (pts.length < 2) return;
    this.checkpoint();
    this.doc.wires.push({ id: 'w' + uid(), points: pts });
    this.changed();
    if (this._autoWire) { this._autoWire = false; this.setMode('select'); }
  }

  cancelWire() {
    if (this.wireDraw && this.wireDraw.points.length >= 2) { this.finishWire(); return; }
    this.wireDraw = null;
    this.overlay?.querySelector('.wire-preview')?.remove();
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  _bindEvents() {
    const s = this.svg;
    s.addEventListener('contextmenu', (e) => e.preventDefault());
    s.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    s.addEventListener('pointerdown', (e) => this._onDown(e));
    s.addEventListener('pointermove', (e) => this._onMove(e));
    s.addEventListener('pointerup', (e) => this._onUp(e));
    s.addEventListener('pointercancel', (e) => this._onUp(e));
    s.addEventListener('dblclick', (e) => this._onDbl(e));
    s.addEventListener('pointerleave', () => { if (this.mode === 'place') { this.placing && (this.placing.x = null); this._renderGhost(); } });
    // drag & drop from library
    s.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    s.addEventListener('drop', (e) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('text/sms-part');
      if (!type || !LIB[type] || this.app.isSimRunning()) return;
      const [x, y] = this.toWorld(e);
      this.placing = this.makePart(type, this.app.dragProps || {});
      this._placeAt(snap(x), snap(y));
      this.placing = null;
      this.setMode('select');
    });
  }

  _onWheel(e) {
    e.preventDefault();
    if (this.app.isSimRunning()) {
      const act = this._adjustTarget(e);
      if (act) { this.app.simAdjust(act.part, e.deltaY < 0 ? 1 : -1); return; }
    }
    const r = this.svg.getBoundingClientRect();
    if (e.ctrlKey || !e.shiftKey) this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    else { this.view.x -= e.deltaY; this._applyView(); }
  }

  _adjustTarget(e) {
    const g = e.target.closest?.('.part');
    if (!g) return null;
    const part = this.findPart(g.dataset.id);
    if (!part || !LIB[part.type]?.adjust) return null;
    return { part };
  }

  _onDown(e) {
    const [wx, wy] = this.toWorld(e);
    const x = snap(wx), y = snap(wy);
    this.svg.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this._space)) {
      this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y, moved: false, button: e.button };
      this.svg.classList.add('panning');
      return;
    }
    if (e.button !== 0) return;
    // Simulation interaction
    if (this.app.isSimRunning()) {
      const actEl = e.target.closest?.('[data-act]');
      const g = e.target.closest?.('.part');
      if (actEl && g) {
        const part = this.findPart(g.dataset.id);
        const act = actEl.dataset.act;
        this.drag = { kind: 'simact', part, act };
        this.app.simAction(part, act, 'down', e);
      }
      return;
    }
    if (this.mode === 'place') {
      // Proteus-like: keep placing the same part until Esc / right click
      this._placeAt(x, y);
      return;
    }
    if (this.mode === 'wire') { this._wireClick(x, y); return; }

    // select mode
    const actEl = e.target.closest?.('[data-act]');
    const g = e.target.closest?.('.part');
    const wg = e.target.closest?.('[data-wid]');
    // Clicking an adjust button outside simulation edits the property
    if (actEl && g && (actEl.dataset.act === 'inc' || actEl.dataset.act === 'dec')) {
      const part = this.findPart(g.dataset.id);
      this.app.simAdjust(part, actEl.dataset.act === 'inc' ? 1 : -1);
      return;
    }
    // Start a wire from an unconnected pin end (KiCad behaviour)
    const tol = 4 / this.view.z;
    const pin = this._pinAt(wx, wy, tol);
    if (pin && !e.shiftKey) {
      const onWire = this.doc.wires.some((w) => w.points.some(([px, py]) => px === pin.x && py === pin.y));
      const near = Math.hypot(pin.x - wx, pin.y - wy) <= tol;
      if (near && (!onWire || e.altKey)) {
        this._autoWire = true;
        this.setMode('wire');
        this._autoWire = true;
        this.startWire(pin.x, pin.y);
        return;
      }
    }
    if (g || wg) {
      const id = g ? g.dataset.id : wg.dataset.wid;
      if (e.shiftKey || e.ctrlKey) {
        if (this.sel.has(id)) this.sel.delete(id); else this.sel.add(id);
        this.render();
        return;
      }
      if (!this.sel.has(id)) { this.sel = new Set([id]); this.render(); }
      this._startMove(x, y);
      return;
    }
    // empty space: rubber-band selection
    if (!e.shiftKey) this.sel.clear();
    this.drag = { kind: 'rubber', x0: wx, y0: wy, x1: wx, y1: wy, add: e.shiftKey };
    this.render();
  }

  _startMove(x, y) {
    const parts = this.doc.parts.filter((p) => this.sel.has(p.id));
    const wires = this.doc.wires.filter((w) => this.sel.has(w.id));
    const origParts = parts.map((p) => ({ p, x: p.x, y: p.y }));
    const origWires = wires.map((w) => ({ w, pts: w.points.map((q) => [...q]) }));
    // attached wire ends (rubber banding)
    const tips = new Set();
    for (const p of parts) for (const q of partPins(p)) tips.add(`${q.wx},${q.wy}`);
    const attached = [];
    for (const w of this.doc.wires) {
      if (this.sel.has(w.id)) continue;
      const last = w.points.length - 1;
      const a = tips.has(w.points[0].join(',')), b = tips.has(w.points[last].join(','));
      if (a || b) attached.push({ w, pts: w.points.map((q) => [...q]), a, b });
    }
    this.drag = { kind: 'move', x0: x, y0: y, dx: 0, dy: 0, origParts, origWires, attached, snap: this.snapshot(), moved: false };
  }

  _onMove(e) {
    const [wx, wy] = this.toWorld(e);
    const x = snap(wx), y = snap(wy);
    this.app.onCursor?.(x, y);
    const d = this.drag;
    if (d?.kind === 'pan') {
      this.view.x = d.vx + e.clientX - d.sx;
      this.view.y = d.vy + e.clientY - d.sy;
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
      this._applyView();
      return;
    }
    if (this.app.isSimRunning()) {
      this.app.onHover?.(e.target);
      return;
    }
    if (d?.kind === 'move') {
      const dx = x - d.x0, dy = y - d.y0;
      if (dx === d.dx && dy === d.dy) return;
      d.dx = dx; d.dy = dy; d.moved = true;
      for (const o of d.origParts) { o.p.x = o.x + dx; o.p.y = o.y + dy; }
      for (const o of d.origWires) o.w.points = o.pts.map(([px, py]) => [px + dx, py + dy]);
      for (const o of d.attached) {
        if (o.a && o.b) o.w.points = o.pts.map(([px, py]) => [px + dx, py + dy]);
        else {
          let pts = o.pts;
          if (o.a) pts = dragEndpoint(pts, 0, dx, dy);
          if (o.b) pts = dragEndpoint(pts, 1, dx, dy);
          o.w.points = pts;
        }
      }
      this.renderWires(); this.renderParts(); this.renderJunctions();
      this.dynCache.clear(); this.renderDyn();
      return;
    }
    if (d?.kind === 'rubber') {
      d.x1 = wx; d.y1 = wy;
      this.overlay.querySelector('.rubber')?.remove();
      const cross = d.x1 < d.x0;
      this._el('rect', {
        class: 'rubber' + (cross ? ' cross' : ''), x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1),
        width: Math.abs(d.x1 - d.x0), height: Math.abs(d.y1 - d.y0),
      }, this.overlay);
      return;
    }
    if (this.mode === 'place' && this.placing) {
      if (this.placing.x !== x || this.placing.y !== y) { this.placing.x = x; this.placing.y = y; this._renderGhost(); }
      return;
    }
    if (this.mode === 'wire' && this.wireDraw) {
      if (this.wireDraw.cursor[0] !== x || this.wireDraw.cursor[1] !== y) { this.wireDraw.cursor = [x, y]; this._renderWirePreview(); }
    }
  }

  _onUp(e) {
    const d = this.drag;
    this.drag = null;
    this.svg.classList.remove('panning');
    try { this.svg.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!d) return;
    if (d.kind === 'pan') {
      if (!d.moved && d.button === 2) {
        if (this.mode === 'wire') this.cancelWire();
        else if (this.mode === 'place') this.setMode('select');
        else if (!this.app.isSimRunning()) this.app.contextMenu?.(e);
      }
      return;
    }
    if (d.kind === 'simact') { this.app.simAction(d.part, d.act, 'up', e); return; }
    if (d.kind === 'move') {
      if (d.moved) {
        this.undoStack.push(d.snap); this.redoStack.length = 0;
        for (const w of this.doc.wires) w.points = simplifyPoints(w.points);
        this.doc.wires = this.doc.wires.filter((w) => w.points.length >= 2);
        this.changed();
      }
      return;
    }
    if (d.kind === 'rubber') {
      this.overlay.querySelector('.rubber')?.remove();
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      if (x1 - x0 < 2 && y1 - y0 < 2) return;
      const cross = d.x1 < d.x0; // right-to-left = touching selection (KiCad)
      for (const p of this.doc.parts) {
        const b = partBBox(p);
        const inside = b[0] >= x0 && b[2] <= x1 && b[1] >= y0 && b[3] <= y1;
        const touch = b[0] <= x1 && b[2] >= x0 && b[1] <= y1 && b[3] >= y0;
        if (cross ? touch : inside) this.sel.add(p.id);
      }
      for (const w of this.doc.wires) {
        const inR = ([px, py]) => px >= x0 && px <= x1 && py >= y0 && py <= y1;
        if (cross ? w.points.some(inR) : w.points.every(inR)) this.sel.add(w.id);
      }
      this.render();
    }
  }

  _onDbl(e) {
    if (this.app.isSimRunning()) return;
    if (this.mode === 'wire') { this.finishWire(); return; }
    // the DOM may have been re-rendered by the first click, so hit-test geometrically
    const part = this.partAt(...this.toWorld(e));
    if (part) this.app.editPart(part);
  }

  /** Topmost part whose bounding box contains the world point */
  partAt(x, y) {
    for (let i = this.doc.parts.length - 1; i >= 0; i--) {
      const p = this.doc.parts[i];
      const b = partBBox(p);
      if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) return p;
    }
    return null;
  }
}
