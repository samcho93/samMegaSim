// Right panel instrument views: oscilloscope, logic analyzer, terminal, MCU state
import { esc } from '../parts/kit.js';
import { SCOPE_CH, SCOPE_COLORS } from '../parts/instruments.js';
import { formatSI } from '../sim/circuit.js';

const TDIV = [1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1, 0.2, 0.5, 1];
const VDIV = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
const fmtT = (t) => formatSI(t, 's', 3);

function defaultScopeCfg() {
  return {
    tdiv: 1e-3, run: true,
    ch: SCOPE_CH.map((c, i) => ({ on: i === 0 || true, vdiv: 2, pos: [2, 0, -2, -4][i] ?? 0 })),
    trig: { src: 0, edge: 'rise', level: 2.5, mode: 'auto' },
  };
}

function fillSelect(sel, values, fmt, cur) {
  sel.innerHTML = values.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${fmt(v)}</option>`).join('');
}

/** Draw a trace into ctx for time window [t0,t0+span] */
function drawTrace(ctx, tr, t0, span, W, yOf, tEnd) {
  if (!tr || !tr.len) return;
  const t1 = t0 + span;
  let i = tr.find(t0);
  let v = i >= 0 ? tr.v[tr.at(i)] : tr.v[tr.at(0)];
  if (i < 0) i = -1;
  const xEnd = Math.min(W, ((Math.min(tEnd, t1) - t0) / span) * W);
  ctx.beginPath();
  // count samples in the window to decide between exact and min/max drawing
  const jEnd = tr.find(t1);
  const n = jEnd - i;
  if (n > W * 3) {
    const cols = Math.ceil(xEnd);
    let j = i + 1;
    let cur = v;
    for (let x = 0; x < cols; x++) {
      const tb = t0 + ((x + 1) / W) * span;
      let mn = cur, mx = cur;
      while (j <= jEnd && tr.t[tr.at(j)] <= tb) {
        const vv = tr.v[tr.at(j)];
        if (vv < mn) mn = vv; if (vv > mx) mx = vv;
        cur = vv; j++;
      }
      if (x === 0) ctx.moveTo(x, yOf(mn));
      ctx.lineTo(x, yOf(mn)); ctx.lineTo(x, yOf(mx)); ctx.lineTo(x + 1, yOf(cur));
    }
  } else {
    ctx.moveTo(0, yOf(v));
    for (let j = i + 1; j <= jEnd; j++) {
      const k = tr.at(j);
      const x = ((tr.t[k] - t0) / span) * W;
      const nv = tr.v[k];
      ctx.lineTo(x, yOf(v));
      ctx.lineTo(x, yOf(nv));
      v = nv;
    }
    ctx.lineTo(xEnd, yOf(v));
  }
  ctx.stroke();
}

function measure(tr, t0, span) {
  if (!tr || !tr.len) return null;
  const t1 = t0 + span;
  let i = tr.find(t0);
  let v = i >= 0 ? tr.v[tr.at(i)] : tr.v[tr.at(0)];
  let tPrev = t0, sum = 0, mn = v, mx = v;
  const jEnd = tr.find(t1);
  const rising = [];
  for (let j = i + 1; j <= jEnd; j++) {
    const k = tr.at(j);
    const t = tr.t[k], nv = tr.v[k];
    sum += v * (t - tPrev);
    if (nv > mx) mx = nv; if (nv < mn) mn = nv;
    tPrev = t; v = nv;
  }
  sum += v * (t1 - tPrev);
  const mid = (mn + mx) / 2;
  if (mx - mn > 0.2) {
    let lv = null;
    let hiTime = 0, last = null;
    for (let j = Math.max(0, i); j <= jEnd; j++) {
      const k = tr.at(j);
      const b = tr.v[k] > mid;
      if (lv === false && b) rising.push(tr.t[k]);
      if (last && last.b) hiTime += Math.min(tr.t[k], t1) - Math.max(last.t, t0);
      last = { t: tr.t[k], b };
      lv = b;
    }
    if (last && last.b) hiTime += t1 - Math.max(last.t, t0);
    let freq = 0, duty = 0;
    if (rising.length >= 2) {
      const per = (rising[rising.length - 1] - rising[0]) / (rising.length - 1);
      freq = 1 / per;
      duty = hiTime / span;
    }
    return { avg: sum / span, min: mn, max: mx, freq, duty };
  }
  return { avg: sum / span, min: mn, max: mx, freq: 0, duty: 0 };
}

export class InstrumentsUI {
  constructor(app) {
    this.app = app;
    this.scopeEl = document.getElementById('scopePanel');
    this.termEl = document.getElementById('terminalPanel');
    this.logicEl = document.getElementById('logicPanel');
    this.mcuEl = document.getElementById('mcuPanel');
    this.active = 'scope';
    this.sel = { scope: null, terminal: null, logic: null, mcu: null };
    this.termBuf = new Map(); // partId -> html chunks
    this.lastMcuUpdate = 0;
  }

  setActive(tab) { this.active = tab; this.update(true); }

  /** Rebuild instrument selectors when the document or the simulation changes */
  rebuild() {
    this._buildScope();
    this._buildTerminal();
    this._buildLogic();
    this._buildMcu();
  }

  get sim() { return this.app.sim || this.app.lastSim; }

  _parts(type) { return this.app.doc.parts.filter((p) => p.type === type); }

  _selector(kind, parts) {
    if (!parts.length) return '';
    if (!this.sel[kind] || !parts.find((p) => p.id === this.sel[kind])) this.sel[kind] = parts[0].id;
    if (parts.length === 1) return `<b>${esc(parts[0].ref)}</b>`;
    return `<select data-sel="${kind}">${parts.map((p) => `<option value="${p.id}"${p.id === this.sel[kind] ? ' selected' : ''}>${esc(p.ref)}</option>`).join('')}</select>`;
  }

  _bindSelector(el, kind, rebuildFn) {
    const s = el.querySelector(`[data-sel="${kind}"]`);
    if (s) s.onchange = () => { this.sel[kind] = s.value; rebuildFn.call(this); };
  }

  // ---------------------------------------------------------------------------
  // Oscilloscope
  // ---------------------------------------------------------------------------
  _buildScope() {
    const parts = this._parts('scope');
    const el = this.scopeEl;
    if (!parts.length) {
      el.innerHTML = `<div class="inst-empty">회로도에 <b>Oscilloscope</b>를 배치하고<br>A~D 입력을 측정할 네트에 연결하세요.<br><br>(왼쪽 라이브러리 → 가상 계측기)</div>`;
      this.scope = null;
      return;
    }
    const sel = this._selector('scope', parts);
    const part = parts.find((p) => p.id === this.sel.scope);
    const cfg = part.props.cfg ||= defaultScopeCfg();
    el.innerHTML = `
      <div class="inst-head">${sel}<span class="flex"></span>
        <button class="btn sm" data-a="run">${cfg.run ? '■ 정지(홀드)' : '▶ 계속'}</button>
        <button class="btn sm" data-a="auto">자동 설정</button></div>
      <div class="scope-wrap"><canvas class="scope-canvas" height="300"></canvas></div>
      <div class="scope-row">Time/div <select data-k="tdiv"></select>
        Trig <select data-k="tsrc">${SCOPE_CH.map((c, i) => `<option value="${i}">${c}</option>`).join('')}</select>
        <select data-k="tedge"><option value="rise">↑ 상승</option><option value="fall">↓ 하강</option></select>
        <input class="inp" data-k="tlevel" type="number" step="0.1" style="width:60px"> V
        <select data-k="tmode"><option value="auto">Auto</option><option value="normal">Normal</option><option value="none">Roll</option></select></div>
      <div class="scope-ctrl">${SCOPE_CH.map((c, i) => `
        <div class="chctl" style="border-top:3px solid ${SCOPE_COLORS[i]}">
          <div class="chn"><input type="checkbox" data-ch="${i}" data-k="on"> CH ${c}</div>
          <select data-ch="${i}" data-k="vdiv"></select>
          <select data-ch="${i}" data-k="pos">${[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((v) => `<option value="${v}">pos ${v > 0 ? '+' : ''}${v}</option>`).join('')}</select>
          <div class="meas" data-meas="${i}">—</div></div>`).join('')}</div>`;
    this._bindSelector(el, 'scope', this._buildScope);
    const q = (s) => el.querySelector(s);
    fillSelect(q('[data-k="tdiv"]'), TDIV, fmtT, cfg.tdiv);
    q('[data-k="tdiv"]').onchange = (e) => { cfg.tdiv = +e.target.value; };
    q('[data-k="tsrc"]').value = cfg.trig.src;
    q('[data-k="tsrc"]').onchange = (e) => { cfg.trig.src = +e.target.value; };
    q('[data-k="tedge"]').value = cfg.trig.edge;
    q('[data-k="tedge"]').onchange = (e) => { cfg.trig.edge = e.target.value; };
    q('[data-k="tlevel"]').value = cfg.trig.level;
    q('[data-k="tlevel"]').onchange = (e) => { cfg.trig.level = +e.target.value; };
    q('[data-k="tmode"]').value = cfg.trig.mode;
    q('[data-k="tmode"]').onchange = (e) => { cfg.trig.mode = e.target.value; };
    for (const inp of el.querySelectorAll('[data-ch]')) {
      const ch = cfg.ch[+inp.dataset.ch];
      const k = inp.dataset.k;
      if (k === 'on') { inp.checked = ch.on; inp.onchange = () => { ch.on = inp.checked; }; }
      if (k === 'vdiv') { fillSelect(inp, VDIV, (v) => `${formatSI(v, 'V')}/div`, ch.vdiv); inp.onchange = () => { ch.vdiv = +inp.value; }; }
      if (k === 'pos') { inp.value = ch.pos; inp.onchange = () => { ch.pos = +inp.value; }; }
    }
    q('[data-a="run"]').onclick = (e) => { cfg.run = !cfg.run; e.target.textContent = cfg.run ? '■ 정지(홀드)' : '▶ 계속'; };
    q('[data-a="auto"]').onclick = () => this._scopeAuto(part, cfg);
    const cv = q('canvas');
    this.scope = { part, cfg, cv, ctx: cv.getContext('2d'), el, frozen: null };
    // cursor readout
    cv.onmousemove = (e) => {
      const r = cv.getBoundingClientRect();
      this.scope.cursor = (e.clientX - r.left) / r.width;
    };
    cv.onmouseleave = () => { this.scope.cursor = null; };
  }

  _scopeAuto(part, cfg) {
    const sim = this.sim;
    const inst = sim?.instances.get(part.id);
    if (!inst) return;
    const m = measure(inst.traces[cfg.trig.src], sim.time - 0.05, 0.05);
    if (m?.freq > 0) {
      const target = 3 / m.freq / 10;
      cfg.tdiv = TDIV.find((t) => t >= target) || 1;
    }
    cfg.ch.forEach((ch, i) => {
      const mm = measure(inst.traces[i], sim.time - 0.05, 0.05);
      if (mm) {
        const range = Math.max(Math.abs(mm.max), Math.abs(mm.min), 0.1);
        ch.vdiv = VDIV.find((v) => v * 3 >= range) || 10;
      }
    });
    if (m) cfg.trig.level = +((m.max + m.min) / 2).toFixed(2);
    this._buildScope();
  }

  _findTrigger(tr, cfg, tMax, span) {
    if (!tr || !tr.len) return null;
    const { level, edge } = cfg.trig;
    let j = tr.find(tMax);
    let guard = 0;
    while (j > 0 && guard++ < 200000) {
      const k = tr.at(j), kp = tr.at(j - 1);
      const t = tr.t[k];
      const a = tr.v[kp], b = tr.v[k];
      if (edge === 'rise' ? a < level && b >= level : a > level && b <= level) return t;
      j--;
    }
    return null;
  }

  _drawScope() {
    const S = this.scope;
    if (!S) return;
    const { cfg, cv, ctx } = S;
    const dpr = window.devicePixelRatio || 1;
    const cw = cv.clientWidth;
    const ch = Math.round(cw * 0.72);
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
      cv.style.height = ch + 'px';
    }
    const W = cv.width, H = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07110c';
    ctx.fillRect(0, 0, W, H);
    // grid 10 x 8
    ctx.strokeStyle = 'rgba(90,160,110,.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 10; i++) { const x = Math.round((i * W) / 10) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let i = 1; i < 8; i++) { const y = Math.round((i * H) / 8) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,200,140,.45)';
    ctx.beginPath(); ctx.moveTo(W / 2 + 0.5, 0); ctx.lineTo(W / 2 + 0.5, H); ctx.moveTo(0, H / 2 + 0.5); ctx.lineTo(W, H / 2 + 0.5); ctx.stroke();
    const sim = this.sim;
    const inst = sim?.instances.get(S.part.id);
    const span = cfg.tdiv * 10;
    let t0;
    if (inst && sim) {
      if (!cfg.run && S.frozen != null) t0 = S.frozen;
      else {
        const tNow = sim.time;
        if (cfg.trig.mode === 'none') t0 = tNow - span;
        else {
          const tt = this._findTrigger(inst.traces[cfg.trig.src], cfg, tNow - span / 2, span);
          if (tt != null) t0 = tt - span / 2;
          else if (cfg.trig.mode === 'normal' && S.lastT0 != null) t0 = S.lastT0;
          else t0 = tNow - span;
        }
        S.lastT0 = t0;
        S.frozen = t0;
      }
      ctx.lineWidth = 1.6 * dpr;
      cfg.ch.forEach((c, i) => {
        if (!c.on || inst.nodes[i] == null) return;
        ctx.strokeStyle = SCOPE_COLORS[i];
        const yOf = (v) => H / 2 - ((v / c.vdiv + c.pos) * H) / 8;
        drawTrace(ctx, inst.traces[i], t0, span, W, yOf, sim.time);
        // ground marker
        const gy = yOf(0);
        ctx.fillStyle = SCOPE_COLORS[i];
        ctx.beginPath(); ctx.moveTo(0, gy - 5 * dpr); ctx.lineTo(7 * dpr, gy); ctx.lineTo(0, gy + 5 * dpr); ctx.fill();
      });
      // trigger level marker
      const tc = cfg.ch[cfg.trig.src];
      if (cfg.trig.mode !== 'none') {
        const ty = H / 2 - ((cfg.trig.level / tc.vdiv + tc.pos) * H) / 8;
        ctx.fillStyle = '#ff9a1f';
        ctx.beginPath(); ctx.moveTo(W, ty - 5 * dpr); ctx.lineTo(W - 8 * dpr, ty); ctx.lineTo(W, ty + 5 * dpr); ctx.fill();
      }
      // measurements
      if ((this._measTick = (this._measTick || 0) + 1) % 10 === 0) {
        cfg.ch.forEach((c, i) => {
          const m = inst.nodes[i] != null ? measure(inst.traces[i], t0, span) : null;
          const mEl = S.el.querySelector(`[data-meas="${i}"]`);
          if (!mEl) return;
          if (!m) { mEl.textContent = inst.nodes[i] == null ? '미연결' : '—'; return; }
          mEl.innerHTML = `avg ${formatSI(m.avg, 'V')}<br>${m.freq ? `${formatSI(m.freq, 'Hz')} ${(m.duty * 100).toFixed(0)}%` : `pp ${formatSI(m.max - m.min, 'V')}`}`;
        });
      }
      // cursor
      if (S.cursor != null) {
        const x = S.cursor * W;
        ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]);
        const t = t0 + S.cursor * span;
        ctx.fillStyle = '#fff'; ctx.font = `${11 * dpr}px Consolas, monospace`;
        let txt = `t=${fmtT(t - (t0 + span / 2))}`;
        cfg.ch.forEach((c, i) => { if (c.on && inst.nodes[i] != null) txt += `  ${SCOPE_CH[i]}=${inst.traces[i].valueAt(t).toFixed(2)}V`; });
        ctx.fillText(txt, 6 * dpr, H - 8 * dpr);
      }
    }
    // labels
    ctx.fillStyle = 'rgba(200,255,220,.8)';
    ctx.font = `${11 * dpr}px Consolas, monospace`;
    ctx.fillText(`${fmtT(cfg.tdiv)}/div`, 6 * dpr, 14 * dpr);
    let lx = 90 * dpr;
    cfg.ch.forEach((c, i) => {
      if (!c.on) return;
      ctx.fillStyle = SCOPE_COLORS[i];
      const t = `${SCOPE_CH[i]}:${formatSI(c.vdiv, 'V')}`;
      ctx.fillText(t, lx, 14 * dpr);
      lx += ctx.measureText(t).width + 10 * dpr;
    });
    if (!inst) { ctx.fillStyle = 'rgba(200,255,220,.5)'; ctx.fillText('시뮬레이션을 실행하세요', W / 2 - 70 * dpr, H / 2 - 10 * dpr); }
  }

  // ---------------------------------------------------------------------------
  // Logic analyzer
  // ---------------------------------------------------------------------------
  _buildLogic() {
    const parts = this._parts('logic');
    const el = this.logicEl;
    if (!parts.length) {
      el.innerHTML = `<div class="inst-empty">회로도에 <b>Logic Analyzer</b>를 배치하고<br>D0~D7을 관찰할 신호에 연결하세요.</div>`;
      this.logic = null;
      return;
    }
    const sel = this._selector('logic', parts);
    const part = parts.find((p) => p.id === this.sel.logic);
    const cfg = part.props.cfg ||= { tdiv: 1e-3, run: true, trig: -1, edge: 'rise' };
    el.innerHTML = `<div class="inst-head">${sel}<span class="flex"></span><button class="btn sm" data-a="run">${cfg.run ? '■ 홀드' : '▶ 계속'}</button></div>
      <div class="scope-row">Time/div <select data-k="tdiv"></select> 트리거 <select data-k="trig"><option value="-1">없음 (Roll)</option>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<option value="${i}">D${i}</option>`).join('')}</select>
      <select data-k="edge"><option value="rise">↑</option><option value="fall">↓</option></select></div>
      <div class="scope-wrap"><canvas class="scope-canvas"></canvas></div>`;
    this._bindSelector(el, 'logic', this._buildLogic);
    const q = (s) => el.querySelector(s);
    fillSelect(q('[data-k="tdiv"]'), TDIV, fmtT, cfg.tdiv);
    q('[data-k="tdiv"]').onchange = (e) => { cfg.tdiv = +e.target.value; };
    q('[data-k="trig"]').value = cfg.trig;
    q('[data-k="trig"]').onchange = (e) => { cfg.trig = +e.target.value; };
    q('[data-k="edge"]').value = cfg.edge;
    q('[data-k="edge"]').onchange = (e) => { cfg.edge = e.target.value; };
    q('[data-a="run"]').onclick = (e) => { cfg.run = !cfg.run; e.target.textContent = cfg.run ? '■ 홀드' : '▶ 계속'; };
    const cv = q('canvas');
    this.logic = { part, cfg, cv, ctx: cv.getContext('2d') };
  }

  _drawLogic() {
    const L = this.logic;
    if (!L) return;
    const { cfg, cv, ctx, part } = L;
    const dpr = window.devicePixelRatio || 1;
    const cw = cv.clientWidth, chh = 8 * 34 + 20;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(chh * dpr)) {
      cv.width = Math.round(cw * dpr); cv.height = Math.round(chh * dpr); cv.style.height = chh + 'px';
    }
    const W = cv.width, H = cv.height;
    ctx.fillStyle = '#0a0d12'; ctx.fillRect(0, 0, W, H);
    const sim = this.sim;
    const inst = sim?.instances.get(part.id);
    const labelW = 70 * dpr;
    const PW = W - labelW;
    ctx.strokeStyle = 'rgba(120,140,170,.18)';
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) { const x = labelW + Math.round((i * PW) / 10) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    ctx.stroke();
    const span = cfg.tdiv * 10;
    let t0 = null;
    if (inst) {
      if (!cfg.run && L.frozen != null) t0 = L.frozen;
      else {
        t0 = sim.time - span;
        if (cfg.trig >= 0) {
          const tr = inst.traces[cfg.trig];
          let j = tr.find(sim.time - span / 2);
          let guard = 0;
          while (j > 0 && guard++ < 100000) {
            const a = tr.v[tr.at(j - 1)], b = tr.v[tr.at(j)];
            if (cfg.edge === 'rise' ? a < 0.5 && b > 0.5 : a > 0.5 && b < 0.5) { t0 = tr.t[tr.at(j)] - span / 2; break; }
            j--;
          }
        }
        L.frozen = t0;
      }
    }
    ctx.font = `${11 * dpr}px Consolas, monospace`;
    const netNames = [];
    if (sim) {
      for (let i = 0; i < 8; i++) {
        const idx = sim.netlist.pinNet.get(`${part.id}:D${i}`);
        const net = idx != null ? sim.netlist.nets[idx] : null;
        netNames.push(net && net.pins.length > 1 ? net.name : '');
      }
    }
    for (let i = 0; i < 8; i++) {
      const yTop = 10 * dpr + i * 34 * dpr, yHi = yTop + 6 * dpr, yLo = yTop + 26 * dpr;
      ctx.fillStyle = '#9fb3d1';
      ctx.fillText(`D${i}`, 6 * dpr, yTop + 14 * dpr);
      if (netNames[i]) { ctx.fillStyle = '#6e7f99'; ctx.fillText(netNames[i].slice(0, 8), 6 * dpr, yTop + 27 * dpr); }
      if (!inst || inst.nodes[i] == null) continue;
      const tr = inst.traces[i];
      ctx.strokeStyle = ['#5dff9e', '#ffd166', '#6ecbff', '#ff7ad9', '#b0ff5d', '#ff9a5d', '#a39dff', '#5dffe8'][i];
      ctx.lineWidth = 1.5 * dpr;
      ctx.save(); ctx.translate(labelW, 0);
      drawTrace(ctx, tr, t0, span, PW, (v) => (v > 0.5 ? yHi : yLo), sim.time);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(200,220,255,.7)';
    ctx.fillText(`${fmtT(cfg.tdiv)}/div`, W - 90 * dpr, H - 4 * dpr);
  }

  // ---------------------------------------------------------------------------
  // Terminal
  // ---------------------------------------------------------------------------
  _buildTerminal() {
    const parts = this._parts('terminal');
    const el = this.termEl;
    if (!parts.length) {
      el.innerHTML = `<div class="inst-empty">회로도에 <b>Virtual Terminal</b>을 배치하고<br>RXD ← MCU TXD, TXD → MCU RXD로 연결하세요.</div>`;
      this.term = null;
      return;
    }
    const sel = this._selector('terminal', parts);
    const part = parts.find((p) => p.id === this.sel.terminal);
    const cfg = part.props.tcfg ||= { eol: 'crlf', hex: false, echo: false };
    el.innerHTML = `<div class="inst-head">${sel}<span style="color:var(--fg2)">${esc(part.props.baud || 9600)} baud 8N1</span><span class="flex"></span>
        <label class="ct-check"><input type="checkbox" data-k="hex"> HEX</label>
        <label class="ct-check"><input type="checkbox" data-k="echo"> 로컬 에코</label>
        <button class="btn sm" data-a="clear">지우기</button></div>
      <div class="term" tabindex="0" title="클릭 후 키보드로 입력하면 바로 전송됩니다"></div>
      <div class="term-input"><input class="inp" placeholder="전송할 문자열 (Enter)"><select data-k="eol"><option value="none">없음</option><option value="cr">CR</option><option value="lf">LF</option><option value="crlf">CR+LF</option></select><button class="btn sm primary" data-a="send">전송</button></div>`;
    this._bindSelector(el, 'terminal', this._buildTerminal);
    const q = (s) => el.querySelector(s);
    const out = q('.term');
    q('[data-k="hex"]').checked = cfg.hex;
    q('[data-k="hex"]').onchange = (e) => { cfg.hex = e.target.checked; this._renderTerm(); };
    q('[data-k="echo"]').checked = cfg.echo;
    q('[data-k="echo"]').onchange = (e) => { cfg.echo = e.target.checked; };
    q('[data-k="eol"]').value = cfg.eol;
    q('[data-k="eol"]').onchange = (e) => { cfg.eol = e.target.value; };
    q('[data-a="clear"]').onclick = () => { this.termData(part.id).length = 0; this._renderTerm(); };
    const input = q('.term-input input');
    const send = () => {
      const eol = { none: '', cr: '\r', lf: '\n', crlf: '\r\n' }[cfg.eol];
      this.termSend(part.id, input.value + eol);
      input.value = '';
    };
    q('[data-a="send"]').onclick = send;
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } };
    out.onkeydown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      let s = null;
      if (e.key.length === 1) s = e.key;
      else if (e.key === 'Enter') s = { none: '\r', cr: '\r', lf: '\n', crlf: '\r\n' }[cfg.eol];
      else if (e.key === 'Backspace') s = '\b';
      else if (e.key === 'Escape') s = '\x1b';
      if (s != null) { e.preventDefault(); this.termSend(part.id, s); }
    };
    this.term = { part, cfg, out };
    this._renderTerm();
  }

  termData(partId) {
    if (!this.termBuf.has(partId)) this.termBuf.set(partId, []);
    return this.termBuf.get(partId);
  }

  /** Attach to terminal instances of a new simulation */
  attachSim(sim) {
    for (const inst of sim.instruments) {
      if (inst.kind !== 'terminal') continue;
      const buf = this.termData(inst.part.id);
      inst.listeners.add((item) => {
        buf.push({ b: item.b, err: item.err });
        if (buf.length > 30000) buf.splice(0, 10000);
        this._termDirty = true;
      });
    }
  }

  termSend(partId, str) {
    const sim = this.app.sim;
    const inst = sim?.instances.get(partId);
    if (!inst) { this.app.toast('시뮬레이션 실행 중에만 전송할 수 있습니다', 'warn'); return; }
    const bytes = [...new TextEncoder().encode(str)];
    inst.send(bytes);
    const part = this.app.doc.parts.find((p) => p.id === partId);
    if (part?.props.tcfg?.echo) {
      const buf = this.termData(partId);
      for (const b of bytes) buf.push({ b, tx: true });
      this._termDirty = true;
    }
  }

  _renderTerm() {
    const T = this.term;
    if (!T) return;
    const buf = this.termData(T.part.id);
    let h = '';
    if (T.cfg.hex) {
      h = buf.slice(-4000).map((it) => `<span class="${it.err ? 'err' : it.tx ? 'tx' : ''}">${it.b.toString(16).padStart(2, '0').toUpperCase()} </span>`).join('');
    } else {
      let line = '';
      const lines = [];
      for (const it of buf) {
        const b = it.b;
        let ch;
        if (it.err) ch = '<span class="err">�</span>';
        else if (b === 10) { lines.push(line); line = ''; continue; }
        else if (b === 13) continue;
        else if (b === 8) { line = line.replace(/(<[^>]+>[^<]*<\/span>|&[a-z]+;|.)$/, ''); continue; }
        else if (b === 12) { lines.length = 0; line = ''; continue; }
        else if (b < 32) continue;
        else ch = esc(String.fromCharCode(b));
        line += it.tx ? `<span class="tx">${ch}</span>` : ch;
      }
      lines.push(line);
      // decode UTF-8 sequences roughly by re-decoding plain lines
      h = lines.slice(-600).join('\n');
      try {
        h = h.replace(/[-ÿ]+/g, (m) => new TextDecoder().decode(Uint8Array.from([...m].map((c) => c.charCodeAt(0)))));
      } catch { /* ignore */ }
    }
    const atBottom = T.out.scrollTop + T.out.clientHeight >= T.out.scrollHeight - 30;
    T.out.innerHTML = h + '<span class="cursor"></span>';
    if (atBottom) T.out.scrollTop = T.out.scrollHeight;
  }

  // ---------------------------------------------------------------------------
  // MCU view
  // ---------------------------------------------------------------------------
  _buildMcu() {
    const parts = this._parts('mcu');
    const el = this.mcuEl;
    if (!parts.length) { el.innerHTML = '<div class="inst-empty">회로도에 MCU가 없습니다.</div>'; this.mcuV = null; return; }
    const sel = this._selector('mcu', parts);
    el.innerHTML = `<div class="inst-head">${sel}<span class="flex"></span><span class="mcu-fw" style="color:var(--fg2);font-size:12px"></span></div><div class="mcu-view"></div>`;
    this._bindSelector(el, 'mcu', this._buildMcu);
    this.mcuV = { part: parts.find((p) => p.id === this.sel.mcu), body: el.querySelector('.mcu-view'), fw: el.querySelector('.mcu-fw') };
    this._drawMcu(true);
  }

  _drawMcu() {
    const V = this.mcuV;
    if (!V) return;
    const sim = this.sim;
    const inst = sim?.instances.get(V.part.id);
    V.fw.textContent = V.part.fw ? `펌웨어: ${V.part.fw.name}` : '펌웨어 없음';
    if (!inst) {
      V.body.innerHTML = `<div class="inst-empty">시뮬레이션을 실행하면 레지스터와 포트 상태가 표시됩니다.${V.part.fw ? '' : '<br><br><b>빌드</b>하거나 HEX 파일을 로드하세요.'}</div>`;
      return;
    }
    const m = inst.mcu;
    const r = m.registers();
    const sreg = 'ITHSVNZC'.split('').map((f, i) => `<i class="${r.sreg & (0x80 >> i) ? 'on' : ''}">${f}</i>`).join('');
    let h = `<table><tr><th>장치</th><td>${esc(inst.device.name)} @ ${formatSI(inst.clock, 'Hz')}</td></tr>
      <tr><th>PC</th><td>0x${r.pc.toString(16).padStart(4, '0')}</td></tr>
      <tr><th>사이클</th><td>${m.cpu.cycles.toLocaleString()}</td></tr>
      <tr><th>SP</th><td>0x${r.sp.toString(16).padStart(4, '0')}</td></tr>
      <tr><th>SREG</th><td><span class="bits">${sreg}</span></td></tr>
      <tr><th>상태</th><td>${inst.error ? `<span style="color:var(--err)">${esc(inst.error)}</span>` : !m.programLoaded ? '프로그램 없음' : inst.held ? 'RESET' : '실행 중'}</td></tr></table>`;
    h += '<h5>포트 (■ 빨강=1, 파랑 테두리=출력)</h5><table><tr><th></th><th>7 … 0</th><th>PORT</th><th>DDR</th><th>PIN</th></tr>';
    for (const p of m.portRegisters()) {
      const bits = [];
      for (let b = 7; b >= 0; b--) {
        const out = p.DDR & (1 << b);
        const lvl = (out ? p.PORT : p.PIN) & (1 << b);
        bits.push(`<i class="${lvl ? 'on' : ''} ${out ? 'out' : ''}">${b}</i>`);
      }
      const hx = (v) => '0x' + v.toString(16).padStart(2, '0').toUpperCase();
      h += `<tr><th>P${p.port}</th><td><span class="bits">${bits.join('')}</span></td><td>${hx(p.PORT)}</td><td>${hx(p.DDR)}</td><td>${hx(p.PIN)}</td></tr>`;
    }
    h += '</table>';
    const us = m.usarts.map((st, i) => {
      const u = m.usartInfo(i);
      return u.txEnable || u.rxEnable ? `${st.def.name}: ${Math.round(u.baud)} baud ${u.txEnable ? 'TX' : ''} ${u.rxEnable ? 'RX' : ''}` : null;
    }).filter(Boolean);
    if (us.length) h += `<h5>USART</h5><div>${us.map(esc).join('<br>')}</div>`;
    h += '<h5>범용 레지스터</h5><div class="regs">';
    for (let i = 0; i < 32; i++) h += `<div><span>R${i}</span> <b>${r.r[i].toString(16).padStart(2, '0').toUpperCase()}</b></div>`;
    h += '</div>';
    V.body.innerHTML = h;
  }

  // ---------------------------------------------------------------------------
  update(force = false) {
    if (this.active === 'scope') this._drawScope();
    else if (this.active === 'logic') this._drawLogic();
    else if (this.active === 'terminal') { if (this._termDirty || force) { this._termDirty = false; this._renderTerm(); } }
    else if (this.active === 'mcu') {
      const now = performance.now();
      if (force || now - this.lastMcuUpdate > 200) { this.lastMcuUpdate = now; this._drawMcu(); }
    }
    if (this.active !== 'terminal' && this._termDirty && this.term) { /* render lazily when shown */ }
  }
}
