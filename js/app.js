// samMegaSim — main application controller
import './parts/index.js';
import { LIB, partPins, esc } from './parts/kit.js';
import { DEVICES, getDevice } from './mcu/devices.js';
import { SchematicEditor, SHEETS } from './editor/schematic.js';
import { Simulator } from './sim/simulator.js';
import { parseSI, formatSI } from './sim/circuit.js';
import { LibraryPanel } from './ui/library-panel.js';
import { CodeEditor } from './ui/code-editor.js';
import { InstrumentsUI } from './ui/instruments-ui.js';
import { AudioEngine } from './ui/audio.js';
import { applyIcons } from './ui/icons.js';
import { modal, prompt, confirmDlg, toast } from './ui/dialogs.js';
import { CompilerBridge, parseDiagnostics } from './compiler/bridge.js';
import { EXAMPLES, buildExample } from './examples.js';
import { EXAMPLE_HEX } from './examples-hex.js';
import { parseIntelHex } from './util/ihex.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const VERSION = '1.0.0';

const DEFAULT_CODE = `/*
 * samMegaSim - main.c
 * 회로도의 MCU 종류와 클럭(F_CPU)은 빌드 시 자동으로 전달됩니다.
 */
#include <avr/io.h>
#include <util/delay.h>

int main(void)
{
    DDRB = 0xFF;

    while (1) {
        PORTB ^= 0xFF;
        _delay_ms(500);
    }
}
`;

function newDoc() {
  return {
    version: 1,
    meta: { title: '새 프로젝트', author: '', sheet: 'A4', rev: '1.0', date: new Date().toISOString().slice(0, 10) },
    parts: [], wires: [],
    code: { files: [{ name: 'main.c', content: DEFAULT_CODE }], opt: '-Os' },
  };
}

class App {
  constructor() {
    this.doc = newDoc();
    this.fileName = null;
    this.dirty = false;
    this.sim = null;
    this.lastSim = null;
    this.simState = 'stopped';
    this.speed = 1;
    this.centerTab = 'schematic';
    this.bridge = new CompilerBridge();
    this.audio = new AudioEngine();
    this.logCount = { error: 0 };
  }

  async init() {
    applyIcons();
    this.editor = new SchematicEditor($('#sheet'), this);
    this.library = new LibraryPanel(this);
    this.code = new CodeEditor($('#codeHost'), this);
    this.inst = new InstrumentsUI(this);
    this._bindChrome();
    this._bindKeys();
    this._buildExamplesMenu();
    // restore autosave or load the first example
    let restored = false;
    try {
      const s = localStorage.getItem('sms.autosave');
      if (s) { this.loadDoc(JSON.parse(s), localStorage.getItem('sms.autosaveName') || null, false); restored = true; }
    } catch (e) { console.warn(e); }
    if (!restored) await this.openExample(EXAMPLES[0], false);
    this.editor.zoomFit();
    this.log(`samMegaSim v${VERSION} — ATmega 회로 시뮬레이터`, 'ok');
    this.log('도움말 → 사용법에서 단축키를 확인하세요. 컴파일은 WinAVR 브리지가 필요합니다 (도움말 → WinAVR 컴파일러 설정).', 'info');
    this.checkBridge();
    setInterval(() => { if (!this.bridge.state?.connected) this.checkBridge(true); }, 15000);
    requestAnimationFrame((t) => this._loop(t));
    window.addEventListener('beforeunload', (e) => { if (this.dirty && !this._autosaved) { e.preventDefault(); e.returnValue = ''; } });
  }

  // ---------------------------------------------------------------------------
  // Chrome / layout
  // ---------------------------------------------------------------------------
  _bindChrome() {
    // menus
    let openMenu = null;
    const closeMenus = () => { $$('.menu.open').forEach((m) => m.classList.remove('open')); openMenu = null; };
    for (const m of $$('.menu')) {
      const btn = m.querySelector(':scope > button');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const was = m.classList.contains('open');
        closeMenus();
        if (!was) { m.classList.add('open'); openMenu = m; }
      });
      btn.addEventListener('mouseenter', () => { if (openMenu && openMenu !== m) { closeMenus(); m.classList.add('open'); openMenu = m; } });
    }
    document.addEventListener('click', closeMenus);
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (b && !b.disabled) { closeMenus(); this.cmd(b.dataset.cmd, b); }
    });
    for (const b of $$('[data-mode]')) b.addEventListener('click', () => this.editor.setMode(b.dataset.mode));
    // left tabs
    for (const t of $$('[data-ltab]')) t.onclick = () => {
      $$('[data-ltab]').forEach((x) => x.classList.toggle('active', x === t));
      $$('[data-ltab-body]').forEach((x) => x.classList.toggle('hidden', x.dataset.ltabBody !== t.dataset.ltab));
      if (t.dataset.ltab === 'project') this.renderProjectPanel();
    };
    // right tabs
    for (const t of $$('[data-rtab]')) t.onclick = () => this.showRightTab(t.dataset.rtab);
    // splitters
    for (const sp of $$('.splitter')) {
      sp.addEventListener('pointerdown', (e) => {
        const side = sp.dataset.split;
        const panel = side === 'left' ? $('#left') : $('#right');
        const startX = e.clientX, startW = panel.getBoundingClientRect().width;
        sp.classList.add('drag');
        sp.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const dx = ev.clientX - startX;
          const w = Math.min(Math.max(side === 'left' ? startW + dx : startW - dx, 160), window.innerWidth * 0.6);
          document.documentElement.style.setProperty(side === 'left' ? '--left-w' : '--right-w', w + 'px');
          this.code.refresh();
        };
        const up = () => { sp.classList.remove('drag'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); };
        sp.addEventListener('pointermove', move);
        sp.addEventListener('pointerup', up);
      });
    }
    $('#simSpeed').onchange = (e) => { this.speed = +e.target.value; };
    const sb = $('#soundBtn');
    const syncSound = () => { sb.classList.toggle('off', !this.audio.enabled); sb.textContent = this.audio.enabled ? '🔊' : '🔇'; };
    sb.onclick = () => { this.audio.toggle(); syncSound(); };
    syncSound();
    $('#buildTarget').onchange = (e) => { this.doc.code.target = e.target.value; this.markDirty(); };
    $('#buildOpt').onchange = (e) => { this.doc.code.opt = e.target.value; this.markDirty(); };
    $('#buildPrintfFlt').onchange = (e) => { this.doc.code.printfFloat = e.target.checked; this.markDirty(); };
    $('#fileInput').addEventListener('change', (e) => this._onFileChosen(e));
    this.bridge.listeners.add((st) => this._renderBridgeChip(st));
    window.addEventListener('resize', () => this.code.refresh());
  }

  showRightTab(tab) {
    $$('[data-rtab]').forEach((x) => x.classList.toggle('active', x.dataset.rtab === tab));
    $$('[data-rtab-body]').forEach((x) => x.classList.toggle('hidden', x.dataset.rtabBody !== tab));
    if (tab === 'output') $('#outBadge').classList.add('hidden');
    this.inst.setActive(tab);
  }

  // Center tabs: schematic + code files
  renderCenterTabs() {
    const host = $('#centerTabs');
    let h = `<button class="ctab${this.centerTab === 'schematic' ? ' active' : ''}" data-ctab="schematic">📐 회로도</button>`;
    for (const f of this.doc.code.files) {
      const errs = (this.diags || []).some((d) => d.file === f.name && d.kind === 'error');
      h += `<button class="ctab${this.centerTab === f.name ? ' active' : ''}" data-ctab="${esc(f.name)}">📄 ${esc(f.name)}${errs ? '<span class="err-dot"></span>' : ''}</button>`;
    }
    host.innerHTML = h;
    for (const b of $$('[data-ctab]', host)) b.onclick = () => (b.dataset.ctab === 'schematic' ? this.showSchematic() : this.showCodeTab(b.dataset.ctab));
  }

  showSchematic() {
    this.centerTab = 'schematic';
    $('#schematicView').classList.remove('hidden');
    $('#codeView').classList.add('hidden');
    this.renderCenterTabs();
  }

  showCodeTab(name) {
    if (!this.doc.code.files.find((f) => f.name === name)) return;
    this.centerTab = name;
    $('#schematicView').classList.add('hidden');
    $('#codeView').classList.remove('hidden');
    this._fillBuildTarget();
    this.code.show(name);
    this.renderCenterTabs();
    this.code.refresh();
  }

  _fillBuildTarget() {
    const mcus = this.doc.parts.filter((p) => p.type === 'mcu');
    const sel = $('#buildTarget');
    if (!mcus.length) { sel.innerHTML = '<option value="">(MCU 없음)</option>'; return; }
    if (!mcus.find((m) => m.id === this.doc.code.target)) this.doc.code.target = mcus[0].id;
    sel.innerHTML = mcus.map((m) => `<option value="${m.id}"${m.id === this.doc.code.target ? ' selected' : ''}>${esc(m.ref)} — ${esc(getDevice(m.props.device).name)} @ ${esc(m.props.clock)}</option>`).join('');
    $('#buildOpt').value = this.doc.code.opt || '-Os';
    $('#buildPrintfFlt').checked = !!this.doc.code.printfFloat;
  }

  // ---------------------------------------------------------------------------
  // Document
  // ---------------------------------------------------------------------------
  loadDoc(doc, name = null, fit = true) {
    if (this.simState !== 'stopped') this.stopSim();
    doc.meta ||= {};
    doc.parts ||= [];
    doc.wires ||= [];
    doc.code ||= { files: [{ name: 'main.c', content: DEFAULT_CODE }] };
    if (!doc.code.files?.length) doc.code.files = [{ name: 'main.c', content: DEFAULT_CODE }];
    this.doc = doc;
    this.fileName = name;
    this.dirty = false;
    this.diags = [];
    this.lastSim = null;
    this.editor.sel.clear();
    this.editor.undoStack = [];
    this.editor.redoStack = [];
    this.code.setFiles(doc.code.files);
    this.code.setDiagnostics([]);
    this.editor.render();
    if (fit) this.editor.zoomFit();
    this.showSchematic();
    this.inst.termBuf.clear();
    this.inst.rebuild();
    this._fillBuildTarget();
    this._updateTitle();
    this.renderProjectPanel();
  }

  markDirty() {
    this.dirty = true;
    this._autosaved = false;
    this._updateTitle();
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this._autosave(), 800);
  }

  _autosave() {
    try {
      this.code.syncAll();
      localStorage.setItem('sms.autosave', JSON.stringify(this.doc));
      localStorage.setItem('sms.autosaveName', this.fileName || '');
      this._autosaved = true;
    } catch (e) { console.warn('autosave failed', e); }
  }

  _updateTitle() {
    const n = this.fileName || this.doc.meta?.title || '새 프로젝트';
    document.title = `${this.dirty ? '● ' : ''}${n} — samMegaSim`;
    $('#sbDoc').textContent = `${n}${this.dirty ? ' (수정됨)' : ''} · 부품 ${this.doc.parts.filter((p) => !LIB[p.type]?.isPower && p.type !== 'label').length} · 와이어 ${this.doc.wires.length}`;
  }

  // Editor callbacks
  onDocChange() {
    this.markDirty();
    this.inst.rebuild();
    this._fillBuildTarget();
    if ($('[data-ltab="project"]').classList.contains('active')) this.renderProjectPanel();
  }
  onSelectionChange(sel) {
    const n = sel.size;
    $('#sbSel').textContent = n ? `선택: ${n}개` : '';
  }
  onModeChange(m) {
    $$('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    $('#sbMode').textContent = { select: '선택', wire: '와이어 (클릭: 꺾기점, 더블클릭/핀: 완료, Esc: 종료, /: 방향전환)', place: '배치 (클릭: 배치, R: 회전, X: 반전, Esc: 종료)' }[m] || m;
    if (m !== 'place') this.hint('');
  }
  onViewChange(v) { $('#sbZoom').textContent = `${Math.round(v.z * 100)}%`; }
  onCursor(x, y) { $('#sbCoord').textContent = `X ${x} Y ${y}`; }
  onCodeChange() { this.markDirty(); }
  onPartPlaced() {}
  isSimRunning() { return this.simState !== 'stopped'; }

  hint(msg) {
    const h = $('#hint');
    h.textContent = msg;
    h.classList.toggle('show', !!msg);
  }

  toast(msg, kind) { toast(msg, kind); }

  onHover(target) {
    const sim = this.sim;
    if (!sim) return;
    const wg = target.closest?.('[data-wid]');
    let idx;
    if (wg) idx = sim.netlist.wireNet.get(wg.dataset.wid);
    if (idx === undefined) { $('#sbSim').textContent = ''; return; }
    const net = sim.netlist.nets[idx];
    const v = sim.circuit.V(sim.nodeOf[idx]);
    $('#sbSim').textContent = `네트 ${net.name}: ${v.toFixed(3)} V`;
  }

  placeFromLibrary(type, props) {
    if (this.centerTab !== 'schematic') this.showSchematic();
    this.editor.startPlace(type, props);
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------
  async cmd(name) {
    const ed = this.editor;
    const editLocked = () => { if (this.isSimRunning()) { toast('시뮬레이션 중에는 편집할 수 없습니다. 먼저 정지하세요.', 'warn'); return true; } return false; };
    switch (name) {
      case 'new':
        if (this.dirty && !(await confirmDlg('새 프로젝트', '현재 프로젝트의 변경 내용이 사라집니다. 계속할까요?', '새로 만들기'))) return;
        this.loadDoc(newDoc());
        this.editor.zoomFit(true);
        break;
      case 'open': this._pickFile('.sms,.json,.hex', 'project'); break;
      case 'save': await this.saveProject(); break;
      case 'loadHex': this._pickFile('.hex,.ihx', 'hex'); break;
      case 'exportHex': this.exportHex(); break;
      case 'exportSvg': this.exportSvg(); break;
      case 'exportPng': this.exportPng(); break;
      case 'sheetProps': this.sheetDialog(); break;
      case 'undo': if (!editLocked()) ed.undo(); break;
      case 'redo': if (!editLocked()) ed.redo(); break;
      case 'cut': if (!editLocked()) ed.cut(); break;
      case 'copy': ed.copy(); break;
      case 'paste': if (!editLocked()) ed.paste(); break;
      case 'duplicate': if (!editLocked()) ed.duplicate(); break;
      case 'delete': if (!editLocked()) ed.deleteSelection(); break;
      case 'selectAll': ed.selectAll(); break;
      case 'rotate': if (!editLocked()) ed.rotateSelection(1); break;
      case 'mirror': if (!editLocked()) ed.mirrorSelection(); break;
      case 'props': {
        const p = this.doc.parts.find((x) => ed.sel.has(x.id));
        if (p) this.editPart(p);
        break;
      }
      case 'annotate': if (!editLocked()) this.annotate(); break;
      case 'zoomFit': ed.zoomFit(); break;
      case 'zoomIn': ed.zoomAt(1.25); break;
      case 'zoomOut': ed.zoomAt(0.8); break;
      case 'toggleGrid': ed.showGrid = !ed.showGrid; ed.renderSheet(); break;
      case 'toggleNetColors': ed.netColors = !ed.netColors; if (!ed.netColors) ed.clearSimVisuals(); break;
      case 'toggleLeft': $('#left').classList.toggle('collapsed'); $('[data-split="left"]').classList.toggle('hidden'); break;
      case 'toggleRight': $('#right').classList.toggle('collapsed'); $('[data-split="right"]').classList.toggle('hidden'); break;
      case 'placeLabel': {
        if (editLocked()) return;
        const name = await prompt('네트 라벨', '라벨 이름', this._lastLabel || 'NET1');
        if (name) { this._lastLabel = name; this.placeFromLibrary('label', { name }); }
        break;
      }
      case 'placeVcc': if (!editLocked()) this.placeFromLibrary('vcc', {}); break;
      case 'placeGnd': if (!editLocked()) this.placeFromLibrary('gnd', {}); break;
      case 'build': await this.build(); break;
      case 'run': this.runSim(); break;
      case 'pause': this.pauseSim(); break;
      case 'stop': this.stopSim(); break;
      case 'step': this.stepSim(); break;
      case 'newFile': await this.newFile(); break;
      case 'renameFile': await this.renameFile(); break;
      case 'deleteFile': await this.deleteFile(); break;
      case 'compilerSetup': this.compilerDialog(); break;
      case 'help': this.helpDialog(); break;
      case 'about': this.aboutDialog(); break;
      default: console.warn('unknown command', name);
    }
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const inField = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable || e.target.closest?.('.CodeMirror') || e.target.classList?.contains('term');
      const k = e.key;
      const ctrl = e.ctrlKey || e.metaKey;
      // global function keys
      if (k === 'F5' && e.shiftKey) { e.preventDefault(); return this.cmd('stop'); }
      if (k === 'F5') { e.preventDefault(); return this.cmd('run'); }
      if (k === 'F6') { e.preventDefault(); return this.cmd('pause'); }
      if (k === 'F7') { e.preventDefault(); return this.cmd('build'); }
      if (k === 'F10') { e.preventDefault(); return this.cmd('step'); }
      if (ctrl && k.toLowerCase() === 's') { e.preventDefault(); return this.cmd('save'); }
      if (ctrl && k.toLowerCase() === 'o') { e.preventDefault(); return this.cmd('open'); }
      if (inField || document.querySelector('.modal-back')) return;
      if (this.centerTab !== 'schematic') return;
      const ed = this.editor;
      if (ctrl) {
        const m = { z: 'undo', y: 'redo', c: 'copy', x: 'cut', v: 'paste', d: 'duplicate', a: 'selectAll', n: 'new' }[k.toLowerCase()];
        if (m) { e.preventDefault(); if (k.toLowerCase() === 'z' && e.shiftKey) this.cmd('redo'); else this.cmd(m); }
        return;
      }
      switch (k) {
        case 'Delete': case 'Backspace': e.preventDefault(); this.cmd('delete'); break;
        case 'r': case 'R': this.cmd('rotate'); break;
        case 'x': case 'X': case 'y': case 'Y': this.cmd('mirror'); break;
        case 'e': case 'E': this.cmd('props'); break;
        case 'w': case 'W': if (!this.isSimRunning()) ed.setMode('wire'); break;
        case 'l': case 'L': this.cmd('placeLabel'); break;
        case 'p': case 'P': this.cmd('placeVcc'); break;
        case 'g': case 'G': this.cmd('placeGnd'); break;
        case 'Home': case 'f': case 'F': this.cmd('zoomFit'); break;
        case '+': case '=': this.cmd('zoomIn'); break;
        case '-': case '_': this.cmd('zoomOut'); break;
        case '/': if (ed.wireDraw) { ed.wireDraw.hvFirst = !ed.wireDraw.hvFirst; ed._renderWirePreview(); } break;
        case 'Escape':
          if (ed.mode === 'wire' && ed.wireDraw) ed.cancelWire();
          else if (ed.mode !== 'select') ed.setMode('select');
          else ed.clearSel();
          break;
        case ' ': ed._space = true; e.preventDefault(); break;
        default:
      }
    });
    window.addEventListener('keyup', (e) => { if (e.key === ' ') this.editor._space = false; });
  }

  // ---------------------------------------------------------------------------
  // Part properties
  // ---------------------------------------------------------------------------
  async editPart(part) {
    if (!part) return;
    if (this.isSimRunning()) { toast('시뮬레이션 중에는 속성을 변경할 수 없습니다', 'warn'); return; }
    const def = LIB[part.type];
    const isMcu = part.type === 'mcu';
    let h = '<div class="form">';
    if (!def.hideRef) h += `<label>참조 번호</label><input class="inp" data-k="__ref" value="${esc(part.ref)}">`;
    for (const pr of def.props || []) {
      const v = part.props[pr.key] ?? pr.default;
      h += `<label>${esc(pr.label)}</label>`;
      if (pr.options) {
        h += `<select data-k="${pr.key}">${pr.options.map((o, i) => `<option value="${esc(o)}"${String(o) === String(v) ? ' selected' : ''}>${esc(pr.optionLabels?.[i] || o)}</option>`).join('')}</select>`;
      } else h += `<input class="inp" data-k="${pr.key}" value="${esc(v)}">`;
    }
    h += '</div>';
    if (isMcu) {
      const fw = part.fw;
      h += `<h4 style="margin:16px 0 6px">펌웨어</h4>
        <div class="note ${fw ? 'ok' : 'warn'}" id="fwInfo">${fw ? `<b>${esc(fw.name)}</b> — ${fw.size || '?'} bytes${fw.time ? ` · ${esc(fw.time)}` : ''}` : '로드된 펌웨어가 없습니다. 코드를 <b>빌드</b>하거나 HEX 파일을 불러오세요.'}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="fwLoad">HEX 파일 불러오기…</button><button class="btn" id="fwBuild">코드 빌드하여 로드</button><button class="btn danger" id="fwClear">펌웨어 제거</button></div>
        <p class="note" style="margin-top:12px">전원 핀(VCC/AVCC/GND)은 시뮬레이션에서 자동으로 전원이 공급됩니다. 클럭은 빌드 시 <code>F_CPU</code>로 전달되며, 크리스탈 부품은 표시용입니다.</p>`;
    }
    const res = await modal({
      title: `${esc(part.ref || '')} ${esc(def.name)} 속성`,
      body: h,
      width: 520,
      onOpen: (b, close) => {
        if (!isMcu) return;
        b.querySelector('#fwLoad').onclick = () => { close(null); this._hexTarget = part; this._pickFile('.hex,.ihx', 'hex'); };
        b.querySelector('#fwBuild').onclick = () => { close(null); this.doc.code.target = part.id; this.build(); };
        b.querySelector('#fwClear').onclick = () => { this.editor.checkpoint(); delete part.fw; this.markDirty(); close(null); toast('펌웨어를 제거했습니다'); };
      },
      buttons: [{ label: '취소', value: null }, {
        label: '적용', cls: 'primary', value: (b) => {
          const o = {};
          for (const el of b.querySelectorAll('[data-k]')) o[el.dataset.k] = el.value;
          return o;
        },
      }],
    });
    if (!res) return;
    this.editor.checkpoint();
    if (res.__ref != null) { part.ref = res.__ref.trim() || part.ref; delete res.__ref; }
    const devChanged = isMcu && res.device !== part.props.device;
    Object.assign(part.props, res);
    if (devChanged && part.fw) { delete part.fw; toast('MCU 종류가 변경되어 펌웨어를 제거했습니다. 다시 빌드하세요.', 'warn'); }
    if (devChanged) this._reattachAfterSymbolChange(part);
    this.editor.changed();
  }

  /** When a symbol's pin layout changes (e.g. other MCU), drop wires whose ends no longer hit a pin */
  _reattachAfterSymbolChange() {
    // Wires stay as they are; the user can re-route. Nothing else to do.
  }

  annotate() {
    this.editor.checkpoint();
    const counters = {};
    const parts = [...this.doc.parts].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const p of parts) {
      const def = LIB[p.type];
      const pre = def?.prefix || 'U';
      counters[pre] = (counters[pre] || 0) + 1;
      p.ref = pre + (pre.startsWith('#') ? String(counters[pre]).padStart(2, '0') : counters[pre]);
    }
    this.editor.changed();
    toast('부품 번호를 위→아래, 왼쪽→오른쪽 순서로 다시 매겼습니다', 'ok');
  }

  async sheetDialog() {
    const m = this.doc.meta;
    const res = await modal({
      title: '시트 설정',
      body: `<div class="form">
        <label>제목</label><input class="inp" data-k="title" value="${esc(m.title || '')}">
        <label>작성자</label><input class="inp" data-k="author" value="${esc(m.author || '')}">
        <label>회사/소속</label><input class="inp" data-k="company" value="${esc(m.company || '')}">
        <label>리비전</label><input class="inp" data-k="rev" value="${esc(m.rev || '1.0')}">
        <label>날짜</label><input class="inp" data-k="date" value="${esc(m.date || '')}">
        <label>용지 크기</label><select data-k="sheet">${Object.keys(SHEETS).map((s) => `<option${s === (m.sheet || 'A4') ? ' selected' : ''}>${s}</option>`).join('')}</select></div>`,
      buttons: [{ label: '취소', value: null }, { label: '적용', cls: 'primary', value: (b) => Object.fromEntries([...b.querySelectorAll('[data-k]')].map((e) => [e.dataset.k, e.value])) }],
    });
    if (!res) return;
    Object.assign(this.doc.meta, res);
    this.editor.render();
    this.markDirty();
  }

  renderProjectPanel() {
    const el = $('#projectInfo');
    const m = this.doc.meta;
    const parts = this.doc.parts.filter((p) => !LIB[p.type]?.isPower && p.type !== 'label');
    const mcus = parts.filter((p) => p.type === 'mcu');
    let h = `<h4>프로젝트</h4><table>
      <tr><td>제목</td><td>${esc(m.title || '')}</td></tr><tr><td>파일</td><td>${esc(this.fileName || '(저장 안 됨)')}</td></tr>
      <tr><td>용지</td><td>${esc(m.sheet || 'A4')}</td></tr><tr><td>부품 수</td><td>${parts.length}</td></tr>
      <tr><td>와이어</td><td>${this.doc.wires.length}</td></tr><tr><td>소스 파일</td><td>${this.doc.code.files.map((f) => esc(f.name)).join(', ')}</td></tr></table>`;
    h += '<h4>MCU / 펌웨어</h4><table>';
    for (const p of mcus) h += `<tr class="bom-row" data-id="${p.id}"><td>${esc(p.ref)}</td><td>${esc(getDevice(p.props.device).name)} @ ${esc(p.props.clock)}<br><span style="color:var(--fg2)">${p.fw ? `${esc(p.fw.name)} (${p.fw.size || '?'} B)` : '펌웨어 없음'}</span></td></tr>`;
    if (!mcus.length) h += '<tr><td colspan="2">MCU 없음</td></tr>';
    h += '</table><h4>부품 목록 (BOM)</h4><table>';
    for (const p of [...parts].sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))) {
      const def = LIB[p.type];
      const v = def.valueText ? def.valueText(p.props) : p.props.value ?? '';
      h += `<tr class="bom-row" data-id="${p.id}"><td>${esc(p.ref)}</td><td>${esc(def.name)}${v ? ` <span style="color:var(--fg2)">${esc(v)}</span>` : ''}</td></tr>`;
    }
    h += '</table>';
    el.innerHTML = h;
    for (const r of $$('.bom-row', el)) r.onclick = () => {
      this.showSchematic();
      this.editor.sel = new Set([r.dataset.id]);
      this.editor.render();
    };
    for (const r of $$('.bom-row', el)) r.ondblclick = () => this.editPart(this.doc.parts.find((p) => p.id === r.dataset.id));
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------
  _pickFile(accept, purpose) {
    const fi = $('#fileInput');
    fi.accept = accept;
    fi.dataset.purpose = purpose;
    fi.value = '';
    fi.click();
  }

  async _onFileChosen(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    const purpose = e.target.dataset.purpose;
    if (purpose === 'hex' || /\.(hex|ihx)$/i.test(f.name)) { this.loadHexText(text, f.name); return; }
    try {
      const doc = JSON.parse(text);
      if (!doc.parts || !doc.wires) throw new Error('samMegaSim 프로젝트 파일이 아닙니다');
      this.loadDoc(doc, f.name);
      toast(`${esc(f.name)} 을(를) 열었습니다`, 'ok');
    } catch (err) {
      toast(`열기 실패: ${esc(err.message)}`, 'err', 5000);
    }
  }

  loadHexText(text, name) {
    const mcus = this.doc.parts.filter((p) => p.type === 'mcu');
    const target = this._hexTarget || mcus.find((m) => this.editor.sel.has(m.id)) || mcus.find((m) => m.id === this.doc.code.target) || mcus[0];
    this._hexTarget = null;
    if (!target) { toast('회로도에 MCU가 없습니다', 'err'); return; }
    try {
      const { maxAddr } = parseIntelHex(text, getDevice(target.props.device).flash);
      this.editor.checkpoint();
      target.fw = { name, hex: text, size: maxAddr, time: new Date().toLocaleString() };
      this.markDirty();
      this.log(`${target.ref}: ${name} 로드 (${maxAddr} bytes)`, 'ok');
      toast(`${esc(target.ref)}에 ${esc(name)} 로드 완료`, 'ok');
      if (this.isSimRunning()) this.restartSim();
      this.inst.rebuild();
    } catch (err) {
      toast(`HEX 로드 실패: ${esc(err.message)}`, 'err');
    }
  }

  async saveProject() {
    this.code.syncAll();
    const name = (this.fileName || `${(this.doc.meta.title || 'project').replace(/[\\/:*?"<>|]+/g, '_')}.sms`).replace(/\.json$/i, '.sms');
    const blob = new Blob([JSON.stringify(this.doc, null, 1)], { type: 'application/json' });
    if (window.showSaveFilePicker) {
      try {
        const h = this._fileHandle || await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'samMegaSim Project', accept: { 'application/json': ['.sms'] } }] });
        const w = await h.createWritable();
        await w.write(blob);
        await w.close();
        this._fileHandle = h;
        this.fileName = h.name;
      } catch (err) {
        if (err.name === 'AbortError') return;
        this._download(blob, name);
        this.fileName = name;
      }
    } else {
      this._download(blob, name);
      this.fileName = name;
    }
    this.dirty = false;
    this._autosave();
    this._updateTitle();
    toast(`${esc(this.fileName)} 저장 완료`, 'ok');
  }

  _download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  exportHex() {
    const m = this.doc.parts.find((p) => p.type === 'mcu' && p.fw && (this.editor.sel.has(p.id) || p.id === this.doc.code.target)) || this.doc.parts.find((p) => p.type === 'mcu' && p.fw);
    if (!m) { toast('내보낼 펌웨어가 없습니다. 먼저 빌드하세요.', 'warn'); return; }
    this._download(new Blob([m.fw.hex], { type: 'text/plain' }), (m.fw.name || 'firmware.hex').replace(/\s.*$/, ''));
  }

  async _svgString() {
    let css = '';
    try { css = await (await fetch('css/app.css')).text(); } catch { /* ignore */ }
    const [W, H] = this.editor.sheetSize();
    const clone = this.editor.world.cloneNode(true);
    clone.removeAttribute('transform');
    clone.querySelectorAll('.hovbox,.selbox,.wire-hit').forEach((e) => e.remove());
    clone.querySelectorAll('.sel').forEach((e) => e.classList.remove('sel'));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><style>${css.replace(/<\//g, '<\\/')}</style>${this.editor.svg.querySelector('defs').outerHTML}${clone.outerHTML}</svg>`;
  }

  async exportSvg() {
    const s = await this._svgString();
    this._download(new Blob([s], { type: 'image/svg+xml' }), `${this.doc.meta.title || 'schematic'}.svg`);
  }

  async exportPng() {
    const s = await this._svgString();
    const [W, H] = this.editor.sheetSize();
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = W * 2; c.height = H * 2;
      const ctx = c.getContext('2d');
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      c.toBlob((b) => this._download(b, `${this.doc.meta.title || 'schematic'}.png`));
    };
    img.onerror = () => toast('PNG 변환 실패', 'err');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  }

  // code files
  async newFile() {
    const name = await prompt('새 파일', '파일 이름 (.c 또는 .h)', 'util.c');
    if (!name) return;
    if (!/^[\w.-]+\.(c|h|S)$/.test(name)) { toast('파일 이름은 영문/숫자와 .c/.h/.S 확장자만 가능합니다', 'err'); return; }
    if (this.doc.code.files.some((f) => f.name === name)) { toast('같은 이름의 파일이 있습니다', 'err'); return; }
    const content = name.endsWith('.h')
      ? `#ifndef ${name.replace(/\W/g, '_').toUpperCase()}\n#define ${name.replace(/\W/g, '_').toUpperCase()}\n\n\n#endif\n`
      : `#include <avr/io.h>\n\n`;
    this.doc.code.files.push({ name, content });
    this.markDirty();
    this.showCodeTab(name);
  }

  async renameFile() {
    const cur = this.centerTab;
    if (cur === 'schematic') return;
    const name = await prompt('파일 이름 변경', '새 이름', cur);
    if (!name || name === cur) return;
    if (!/^[\w.-]+\.(c|h|S)$/.test(name) || this.doc.code.files.some((f) => f.name === name)) { toast('사용할 수 없는 이름입니다', 'err'); return; }
    this.code.syncAll();
    this.doc.code.files.find((f) => f.name === cur).name = name;
    this.code.renameDoc(cur, name);
    this.markDirty();
    this.showCodeTab(name);
  }

  async deleteFile() {
    const cur = this.centerTab;
    if (cur === 'schematic') return;
    if (this.doc.code.files.length <= 1) { toast('마지막 파일은 삭제할 수 없습니다', 'warn'); return; }
    if (!(await confirmDlg('파일 삭제', `${esc(cur)} 파일을 삭제할까요?`, '삭제'))) return;
    this.doc.code.files = this.doc.code.files.filter((f) => f.name !== cur);
    this.code.removeDoc(cur);
    this.code.files = this.doc.code.files;
    this.markDirty();
    this.showCodeTab(this.doc.code.files[0].name);
  }

  // ---------------------------------------------------------------------------
  // Examples
  // ---------------------------------------------------------------------------
  _buildExamplesMenu() {
    const host = $('#examplesMenu');
    host.innerHTML = '<div class="grp">예제 프로젝트</div>' + EXAMPLES.map((ex, i) =>
      `<button data-ex="${i}"><span>${esc(ex.name)}</span><span class="ex-desc">${esc(DEVICES[ex.device].name)}</span></button>`).join('');
    for (const b of $$('[data-ex]', host)) {
      b.title = EXAMPLES[+b.dataset.ex].desc;
      b.onclick = async () => {
        $$('.menu.open').forEach((m) => m.classList.remove('open'));
        if (this.dirty && !(await confirmDlg('예제 열기', '현재 프로젝트의 변경 내용이 사라집니다. 예제를 열까요?', '열기'))) return;
        await this.openExample(EXAMPLES[+b.dataset.ex]);
      };
    }
  }

  async openExample(ex, notify = true) {
    const doc = await buildExample(ex);
    const hex = EXAMPLE_HEX[ex.id];
    const mcu = doc.parts.find((p) => p.type === 'mcu');
    if (hex && mcu) {
      mcu.fw = { name: 'main.hex (예제 사전 빌드)', hex, size: parseIntelHex(hex).maxAddr, time: 'WinAVR 20100110' };
      doc.code.target = mcu.id;
    }
    this.loadDoc(doc, null);
    if (notify) {
      toast(`예제: <b>${esc(ex.name)}</b><br>${esc(ex.desc)}<br>▶ 실행(F5)을 눌러 시뮬레이션하세요.`, 'ok', 5000);
      this.log(`예제 열기: ${ex.name} — ${ex.desc}`, 'info');
    }
    this._autosave();
  }

  // ---------------------------------------------------------------------------
  // Compiler
  // ---------------------------------------------------------------------------
  async checkBridge(silent = false) {
    const st = await this.bridge.status();
    if (!silent && st.connected) this.log(`컴파일러 브리지 연결됨: ${st.winavr?.found ? `avr-gcc ${st.winavr.version || ''} (${st.winavr.path})` : 'WinAVR 미설치'}`, st.winavr?.found ? 'ok' : 'warn');
    return st;
  }

  _renderBridgeChip(st) {
    const chip = $('#compilerChip');
    chip.classList.remove('ok', 'warn', 'err');
    const txt = chip.querySelector('.txt');
    if (!st?.connected) { chip.classList.add('err'); txt.textContent = 'WinAVR 브리지 미연결'; }
    else if (!st.winavr?.found) { chip.classList.add('warn'); txt.textContent = 'WinAVR 미설치'; }
    else {
      chip.classList.add('ok');
      const v = /\(([^)]+)\)\s*([\d.]+)/.exec(st.winavr.version || '');
      txt.textContent = v ? `${v[1]} · gcc ${v[2]}` : 'avr-gcc 연결됨';
    }
  }

  async build() {
    this.code.syncAll();
    const mcus = this.doc.parts.filter((p) => p.type === 'mcu');
    if (!mcus.length) { toast('회로도에 MCU를 먼저 배치하세요', 'warn'); return; }
    const target = mcus.find((m) => m.id === this.doc.code.target) || mcus[0];
    this.doc.code.target = target.id;
    const dev = getDevice(target.props.device);
    const fcpu = Math.round(parseSI(String(target.props.clock).replace(/Hz$/i, ''), 16e6));
    const st = await this.checkBridge(true);
    if (!st.connected || !st.winavr?.found) {
      this.compilerDialog();
      return;
    }
    const btns = $$('[data-cmd="build"]');
    btns.forEach((b) => { b.disabled = true; });
    this.showRightTab('output');
    this.log(`빌드 시작: ${target.ref} ${dev.name} (-mmcu=${dev.gccMcu}, F_CPU=${fcpu})`, 'cmd');
    const t0 = performance.now();
    try {
      const res = await this.bridge.compile({
        mcu: dev.gccMcu, fcpu, opt: this.doc.code.opt || '-Os', printfFloat: !!this.doc.code.printfFloat,
        files: this.doc.code.files.map((f) => ({ name: f.name, content: f.content })),
      });
      if (res.cmd) this.log(res.cmd, 'cmd');
      const diags = parseDiagnostics(res.log);
      this.diags = diags;
      this.code.setDiagnostics(diags);
      if (res.log) this._logCompiler(res.log);
      if (res.ok && res.hex) {
        const { maxAddr } = parseIntelHex(res.hex, dev.flash);
        this.editor.checkpoint();
        target.fw = { name: `main.hex (빌드)`, hex: res.hex, size: maxAddr, time: new Date().toLocaleString() };
        this.markDirty();
        const pct = ((maxAddr / dev.flash) * 100).toFixed(1);
        this.log(`빌드 성공 (${((performance.now() - t0) / 1000).toFixed(1)}s) — Flash ${maxAddr} / ${dev.flash} bytes (${pct}%)${res.size ? `\n${res.size}` : ''}`, 'ok');
        toast(`빌드 성공 · ${maxAddr} bytes → ${esc(target.ref)}에 로드됨`, 'ok');
        if (this.isSimRunning()) this.restartSim();
        this.inst.rebuild();
      } else {
        const n = diags.filter((d) => d.kind === 'error').length;
        this.log(`빌드 실패 — 오류 ${n || '?'}개`, 'error');
        toast(`빌드 실패: 오류 ${n || '?'}개 (출력 탭 확인)`, 'err', 4500);
        const first = diags.find((d) => d.kind === 'error' && d.line);
        if (first) this.code.gotoLine(first.file, first.line);
      }
      this.renderCenterTabs();
    } catch (err) {
      this.log(`빌드 요청 실패: ${err.message}`, 'error');
      toast(`컴파일러 브리지 오류: ${esc(err.message)}`, 'err', 5000);
    } finally {
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  _logCompiler(log) {
    const el = $('#outputLog');
    for (const line of log.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const m = /^(?:.*[\\/])?([^\\/:]+\.(?:c|h|S)):(\d+)(?::\d+)?:\s*(fatal error|error|warning|note)/.exec(line);
      const kind = m ? (m[3].includes('error') ? 'error' : m[3] === 'warning' ? 'warn' : 'info') : /error/i.test(line) ? 'error' : 'info';
      const div = document.createElement('div');
      div.className = 'l-' + kind;
      if (m) {
        const a = document.createElement('a');
        a.className = 'jump';
        a.textContent = `${m[1]}:${m[2]}`;
        a.onclick = () => this.code.gotoLine(m[1], +m[2]);
        div.appendChild(a);
        div.appendChild(document.createTextNode(line.slice(line.indexOf(m[1]) + m[1].length + 1 + m[2].length)));
      } else div.textContent = line;
      el.appendChild(div);
    }
    el.scrollTop = el.scrollHeight;
  }

  log(msg, kind = 'info') {
    const el = $('#outputLog');
    const div = document.createElement('div');
    div.className = 'l-' + kind;
    const t = new Date();
    div.innerHTML = `<span class="l-time">${t.toTimeString().slice(0, 8)}</span>`;
    div.appendChild(document.createTextNode(msg));
    el.appendChild(div);
    while (el.childNodes.length > 2000) el.firstChild.remove();
    el.scrollTop = el.scrollHeight;
    if ((kind === 'error' || kind === 'warn') && !$('[data-rtab="output"]').classList.contains('active')) {
      const b = $('#outBadge');
      b.classList.remove('hidden');
      b.textContent = '!';
    }
  }

  compilerDialog() {
    const base = new URL('.', location.href).href;
    const body = document.createElement('div');
    const render = (st, inst) => {
      const conn = st?.connected;
      const wa = st?.winavr;
      body.innerHTML = `
        <div class="note ${conn ? 'ok' : 'warn'}"><b>1. 컴파일러 브리지</b> — ${conn ? `연결됨 (v${esc(st.version || '?')}, ${esc(st.platform || '')})` : `연결 안 됨 (${esc(st?.error || '확인 중')})`}</div>
        ${conn ? '' : `
        <p>웹 브라우저는 PC의 프로그램을 직접 실행할 수 없으므로, 작은 로컬 브리지 프로그램이 WinAVR(avr-gcc)를 대신 실행합니다.</p>
        <ol class="steps">
          <li><a class="btn sm primary" href="${base}bridge/samMegaSim-bridge.cmd" download>samMegaSim-bridge.cmd 다운로드</a> (Windows)</li>
          <li>다운로드한 파일을 더블클릭하여 실행 (PowerShell 창이 열리고 <code>Listening on http://127.0.0.1:8787</code> 표시)</li>
          <li>Windows SmartScreen 경고가 나오면 <b>추가 정보 → 실행</b>을 선택하세요.</li>
          <li>이 창에서 <b>다시 확인</b>을 누르세요. 브라우저가 로컬 네트워크 접근 권한을 물으면 <b>허용</b>하세요.</li>
        </ol>
        <p style="color:var(--fg2);font-size:12px">Linux / macOS: <a href="${base}bridge/sms_bridge.py" download>sms_bridge.py</a> 다운로드 후 <code>python3 sms_bridge.py</code> (avr-gcc 필요: <code>sudo apt install gcc-avr avr-libc</code> / <code>brew install avr-gcc</code>)</p>`}
        ${conn ? `<div class="note ${wa?.found ? 'ok' : 'warn'}"><b>2. WinAVR</b> — ${wa?.found ? `설치됨: <code>${esc(wa.path)}</code><br>${esc(wa.version || '')}` : 'WinAVR(avr-gcc)를 찾지 못했습니다.'}</div>` : ''}
        ${conn && !wa?.found ? `
          <p>브리지가 WinAVR-20100110 설치 파일(약 28MB)을 SourceForge에서 내려받아 설치할 수 있습니다. 설치 중 관리자 권한(UAC) 확인 창이 표시됩니다.</p>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn success" id="doInstall"${inst && /download|install/.test(inst.state) ? ' disabled' : ''}>WinAVR 자동 다운로드 &amp; 설치</button>
          <a class="btn" href="https://sourceforge.net/projects/winavr/files/WinAVR/20100110/" target="_blank" rel="noopener">수동 다운로드 페이지</a></div>
          ${inst && inst.state !== 'idle' ? `<div class="note ${inst.state === 'error' ? 'warn' : ''}" style="margin-top:10px">설치 상태: <b>${esc(inst.state)}</b> ${esc(inst.message || '')}<div class="progress"><div style="width:${inst.progress || 0}%"></div></div></div>` : ''}
          <div class="form" style="margin-top:12px"><label>WinAVR 경로 직접 지정</label><div style="display:flex;gap:6px"><input class="inp" id="waPath" placeholder="C:\\WinAVR-20100110"><button class="btn" id="setPath">적용</button></div></div>` : ''}
        <div class="form" style="margin-top:14px"><label>브리지 주소</label><div style="display:flex;gap:6px"><input class="inp" id="brUrl" value="${esc(this.bridge.url)}"><button class="btn" id="recheck">다시 확인</button></div></div>`;
      body.querySelector('#recheck').onclick = async () => { this.bridge.setUrl(body.querySelector('#brUrl').value); render(await this.checkBridge()); };
      body.querySelector('#doInstall')?.addEventListener('click', async () => {
        try {
          await this.bridge.install();
          this.log('WinAVR 설치를 시작했습니다…', 'info');
          poll();
        } catch (err) { toast(`설치 요청 실패: ${esc(err.message)}`, 'err'); }
      });
      body.querySelector('#setPath')?.addEventListener('click', async () => {
        try {
          const r = await this.bridge.setWinavrPath(body.querySelector('#waPath').value.trim());
          if (!r.ok) toast(r.error || '경로에서 avr-gcc를 찾지 못했습니다', 'err');
          render(await this.checkBridge());
        } catch (err) { toast(err.message, 'err'); }
      });
    };
    let timer = null;
    const poll = async () => {
      clearTimeout(timer);
      try {
        const inst = await this.bridge.installStatus();
        const st = await this.checkBridge(true);
        render(st, inst);
        if (/download|install/.test(inst.state)) timer = setTimeout(poll, 1000);
        else if (inst.state === 'done') { this.log('WinAVR 설치 완료', 'ok'); toast('WinAVR 설치 완료!', 'ok'); }
        else if (inst.state === 'error') this.log(`WinAVR 설치 실패: ${inst.message}`, 'error');
      } catch { /* ignore */ }
    };
    render(this.bridge.state);
    this.checkBridge(true).then((st) => { render(st); if (st.connected && !st.winavr?.found) poll(); });
    modal({ title: 'WinAVR 컴파일러 설정', body, width: 640, buttons: [{ label: '닫기', value: null }] }).then(() => clearTimeout(timer));
  }

  helpDialog() {
    const k = (a, b) => `<kbd>${a}</kbd><span>${b}</span>`;
    modal({
      title: 'samMegaSim 사용법',
      width: 720,
      body: `
        <div class="note">① 왼쪽 라이브러리에서 부품을 클릭(또는 드래그)하여 배치 → ② 핀 끝을 클릭하거나 <b>W</b>로 와이어 연결 → ③ 코드 탭에서 C 코드 작성 후 <b>빌드(F7)</b> → ④ <b>실행(F5)</b></div>
        <div class="help-grid">
          ${k('클릭 / 드래그', '선택 / 이동 (연결된 와이어가 따라옴)')}
          ${k('핀 끝 클릭', '와이어 그리기 시작')}
          ${k('W', '와이어 모드 · 클릭으로 꺾기, 핀/와이어에 닿거나 더블클릭하면 완료, / 키로 꺾는 방향 전환')}
          ${k('L / P / G', '네트 라벨 / VCC / GND 배치')}
          ${k('R / X', '회전 / 좌우 반전 (배치 중에도 가능)')}
          ${k('E / 더블클릭', '속성 편집 (MCU: 칩 종류·클럭·펌웨어)')}
          ${k('Del', '삭제')}
          ${k('Ctrl+Z / Ctrl+Y', '실행 취소 / 다시 실행')}
          ${k('Ctrl+C / X / V / D', '복사 / 잘라내기 / 붙여넣기 / 복제')}
          ${k('휠 / 가운데·오른쪽 드래그 / Space+드래그', '확대·축소 / 화면 이동')}
          ${k('Home 또는 F', '전체 보기')}
          ${k('드래그 (왼→오 / 오→왼)', '영역 선택 (완전 포함 / 걸침)')}
          ${k('F5 / F6 / Shift+F5', '시뮬레이션 실행 / 일시정지 / 정지')}
          ${k('F7', '빌드 (WinAVR avr-gcc)')}
          ${k('F10', '1ms 진행')}
          ${k('Ctrl+S / Ctrl+O', '저장 / 열기')}
        </div>
        <h4>시뮬레이션</h4>
        <p style="line-height:1.7">실행 중에는 버튼·스위치·키패드를 클릭하여 조작하고, 가변저항·LDR·온도센서는 ▲▼ 또는 마우스 휠로 조절합니다.
        와이어 색상은 전압을 표시합니다 (<span style="color:#d42020">■ HIGH</span> <span style="color:#1f4fd6">■ LOW</span>). MCU 핀의 작은 사각형은 핀 상태입니다.
        같은 이름의 네트 라벨과 전원 심볼(VCC, GND …)은 서로 연결됩니다. MCU 전원 핀은 자동으로 전원이 공급됩니다.</p>
        <p style="line-height:1.7">가상 계측기: <b>Oscilloscope</b>(4채널, 트리거·측정), <b>Logic Analyzer</b>(8채널), <b>Virtual Terminal</b>(UART, 비트 단위 디코딩), <b>DC Voltmeter/Ammeter</b>, <b>Voltage Probe</b>, <b>Logic State/Probe</b>.</p>`,
    });
  }

  aboutDialog() {
    modal({
      title: 'samMegaSim 정보',
      body: `<p><b>samMegaSim</b> v${VERSION} — 웹 기반 ATmega 회로도 작성 및 시뮬레이터</p>
        <p>지원 MCU: ${Object.values(DEVICES).map((d) => d.name).join(', ')}</p>
        <p style="color:var(--fg2);line-height:1.7">AVR CPU 코어: <a href="https://github.com/wokwi/avr8js" target="_blank" rel="noopener">avr8js</a> (MIT) · 코드 에디터: CodeMirror 5 (MIT)<br>
        회로 해석: 이벤트 구동 MNA(수정 절점 해석) + 구간 선형 소자 모델<br>
        컴파일러: WinAVR 20100110 (avr-gcc 4.3.3) — 로컬 브리지 경유</p>`,
    });
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------
  _createSim() {
    const sim = new Simulator(this.doc, { audio: this.audio, log: (m, k) => this.log(m, k === 'i2c' ? 'i2c' : k) });
    for (const m of sim.mcus) {
      if (!m.mcu.programLoaded) this.log(`${m.part.ref} (${m.device.name}): 펌웨어가 없습니다 — 코드를 빌드하거나 HEX를 로드하세요`, 'warn');
      if (m.error) this.log(`${m.part.ref}: ${m.error}`, 'error');
    }
    if (!sim.mcus.length) this.log('MCU가 없는 회로를 시뮬레이션합니다', 'info');
    this.inst.termBuf.clear();
    this.inst.attachSim(sim);
    return sim;
  }

  runSim() {
    if (this.simState === 'running') return;
    this.audio.ensure();
    if (this.simState === 'stopped') {
      this.editor.setMode('select');
      try { this.sim = this._createSim(); } catch (e) {
        console.error(e);
        this.log(`시뮬레이션 생성 실패: ${e.message}`, 'error');
        toast(`시뮬레이션 오류: ${esc(e.message)}`, 'err');
        return;
      }
      this.editor.simInst = this.sim;
      this.editor.renderJunctions();
      this.inst.rebuild();
      this.log('시뮬레이션 시작', 'ok');
    }
    this.simState = 'running';
    this._lastFrame = performance.now();
    this._updateSimUi();
  }

  pauseSim() {
    if (this.simState !== 'running') return;
    this.simState = 'paused';
    this.audio.stopAll();
    this._updateSimUi();
  }

  stepSim() {
    if (this.simState === 'stopped') { this.runSim(); this.simState = 'paused'; }
    if (!this.sim) return;
    this.simState = 'paused';
    this.sim.runUntil(this.sim.time + 0.001, 500);
    this.sim.frame(0.001);
    this.editor.renderDyn(this.sim);
    this.inst.update(true);
    this._updateSimUi();
  }

  stopSim() {
    if (this.simState === 'stopped') return;
    this.sim?.dispose();
    this.audio.stopAll();
    this.lastSim = this.sim;
    this.sim = null;
    this.simState = 'stopped';
    this.editor.simInst = null;
    this.editor.clearSimVisuals();
    this._updateSimUi();
    this.log('시뮬레이션 정지', 'info');
  }

  restartSim() {
    const was = this.simState;
    this.stopSim();
    this.runSim();
    if (was === 'paused') this.pauseSim();
    toast('새 펌웨어로 시뮬레이션을 다시 시작했습니다', 'ok');
  }

  simAction(part, act, phase, ev) {
    const sim = this.sim;
    if (!sim) return;
    if (act === 'inc' || act === 'dec') { if (phase === 'down') this.simAdjust(part, act === 'inc' ? 1 : -1); return; }
    const inst = sim.instances.get(part.id);
    if (inst?.action && inst.action(act, phase, ev)) {
      sim.circuit.kickReactive();
      sim.solveAt(sim.time);
      this.editor.renderDyn(sim);
    }
  }

  simAdjust(part, dir) {
    const def = LIB[part.type];
    const a = def?.adjust;
    if (!a) return;
    const cur = parseFloat(part.props[a.key]) || 0;
    const v = Math.min(a.max, Math.max(a.min, cur + dir * a.step));
    if (v === cur) return;
    if (!this.sim) this.editor.checkpoint();
    part.props[a.key] = String(v);
    if (this.sim) {
      this.sim.circuit.kickReactive();
      this.sim.solveAt(this.sim.time);
      this.editor.renderDyn(this.sim);
      this.markDirty();
    } else {
      this.editor.changed();
    }
  }

  _updateSimUi() {
    const st = this.simState;
    const el = $('#simState');
    el.className = 'state ' + st;
    el.textContent = { stopped: '정지됨', running: '실행 중', paused: '일시정지' }[st];
    $('#simBanner').classList.toggle('hidden', st === 'stopped');
    $$('.tb.run').forEach((b) => b.classList.toggle('running', st === 'running'));
    const mcus = this.sim?.mcus || [];
    $('#simMcuInfo').textContent = mcus.length ? mcus.map((m) => `${m.part.ref}:${m.device.name}`).join(', ') : '—';
    if (st === 'stopped') $('#sbSim').textContent = '';
  }

  _loop(now) {
    requestAnimationFrame((t) => this._loop(t));
    const sim = this.sim;
    if (!sim) return;
    const dt = Math.min(0.05, Math.max(0, (now - (this._lastFrame || now)) / 1000));
    this._lastFrame = now;
    if (this.simState === 'running' && dt > 0) {
      const t0 = sim.time;
      const target = t0 + dt * this.speed;
      try {
        sim.runUntil(target, this.speed >= 100 ? 28 : 14);
      } catch (e) {
        console.error(e);
        this.log(`시뮬레이션 오류: ${e.message}`, 'error');
        this.pauseSim();
      }
      const adv = sim.time - t0;
      this._speedAvg = (this._speedAvg ?? 1) * 0.9 + (adv / dt) * 0.1;
      sim.frame(dt);
    }
    this.editor.renderDyn(sim);
    this.inst.update();
    if (!this._uiT || now - this._uiT > 120) {
      this._uiT = now;
      $('#simTime').textContent = `${sim.time.toFixed(6)} s`;
      $('#simSpeedPct').textContent = this.simState === 'running' ? `${(this._speedAvg * 100).toFixed(0)}%` : '—';
      $('#simSolves').textContent = sim.circuit.solveCount.toLocaleString();
    }
  }
}

const app = new App();
window.samMegaSim = app;
app.init().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;inset:auto 20px 40px 20px;background:#400;color:#fff;padding:12px;border-radius:8px;z-index:999">초기화 오류: ${e.message}</div>`);
});
