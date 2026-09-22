// Left panel: parts library tree, search and symbol preview
import { LIB, getSymbol, esc, worldText } from '../parts/kit.js';
import { DEVICES } from '../mcu/devices.js';

const CAT_NAMES = {
  Microcontrollers: 'MCU (ATmega)',
  Power: '전원 / 네트 라벨',
  Sources: '전원 / 신호원',
  Passive: '수동 소자 (R/L/C)',
  Semiconductor: '반도체 (다이오드/LED/TR)',
  Switches: '스위치 / 입력 장치',
  Displays: '디스플레이',
  Electromechanical: '모터 / 부저 / 릴레이',
  Sensors: '센서',
  'Logic ICs': '논리 IC (74HC)',
  'I2C Devices': 'I2C 장치',
  Instruments: '가상 계측기',
  'Debug Tools': '디버그 도구',
};
const CAT_ORDER = ['Microcontrollers', 'Power', 'Sources', 'Passive', 'Semiconductor', 'Switches', 'Displays', 'Electromechanical', 'Sensors', 'Logic ICs', 'I2C Devices', 'Instruments', 'Debug Tools'];

function buildItems() {
  const items = [];
  for (const d of Object.values(DEVICES)) {
    items.push({ type: 'mcu', props: { device: d.id, clock: d.defaultClock === 8000000 ? '8MHz' : '16MHz' }, name: d.name, desc: `${d.package} · Flash ${d.flash / 1024}KB · SRAM ${(d.ramEnd - d.ramStart + 1) / 1024}KB · EEPROM ${d.eeprom}B`, cat: 'Microcontrollers', key: d.name + ' atmega avr mcu' });
  }
  for (const def of Object.values(LIB)) {
    if (def.type === 'mcu' || def.hidden) continue;
    if (def.type === 'led') {
      for (const [c, n] of [['red', '빨강'], ['green', '초록'], ['yellow', '노랑'], ['blue', '파랑'], ['white', '흰색']]) {
        items.push({ type: 'led', props: { color: c }, name: `LED (${n})`, desc: def.desc, cat: def.category, key: `led ${c} ${n} 발광` });
      }
      continue;
    }
    items.push({ type: def.type, props: {}, name: def.name, desc: def.desc || '', cat: def.category, key: `${def.name} ${def.type} ${def.desc || ''} ${def.valueText ? def.valueText({}) : ''}` });
  }
  return items;
}

/** Render a part symbol as a standalone SVG string fitted to its bbox */
export function symbolPreviewSvg(type, props = {}, withText = true) {
  const def = LIB[type];
  const p = { id: 'pv', type, x: 0, y: 0, rot: 0, mirror: false, ref: def.prefix + '?', props: {} };
  for (const pr of def.props || []) p.props[pr.key] = pr.default;
  Object.assign(p.props, props);
  const sym = getSymbol(p);
  let t = '';
  if (withText) {
    for (const tx of sym.texts) {
      const w = worldText(p, tx);
      t += `<text x="${w.x}" y="${w.y}" text-anchor="${w.anchor}" dominant-baseline="central" font-size="${tx.size}" class="${tx.cls}"${w.rotate ? ` transform="rotate(${w.rotate} ${w.x} ${w.y})"` : ''}>${esc(tx.s)}</text>`;
    }
  }
  const dyn = def.dyn ? def.dyn(p, null) : '';
  const [x1, y1, x2, y2] = sym.bbox;
  const pad = 6;
  return { vb: `${x1 - pad} ${y1 - pad} ${x2 - x1 + pad * 2} ${y2 - y1 + pad * 2}`, body: `${sym.shapes}<g>${dyn}</g>${t}` };
}

export class LibraryPanel {
  constructor(app) {
    this.app = app;
    this.items = buildItems();
    this.tree = document.getElementById('partTree');
    this.search = document.getElementById('partSearch');
    this.pvSvg = document.getElementById('previewSvg');
    this.pvName = document.querySelector('#partPreview .pv-name');
    this.pvDesc = document.querySelector('#partPreview .pv-desc');
    this.closed = new Set();
    try { JSON.parse(localStorage.getItem('sms.libClosed') || '[]').forEach((c) => this.closed.add(c)); } catch { /* ignore */ }
    this.search.addEventListener('input', () => this.render());
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = this.tree.querySelector('.item'); first?.click(); }
      if (e.key === 'Escape') { this.search.value = ''; this.render(); this.search.blur(); }
    });
    this.render();
    this.preview(this.items.find((i) => i.name === 'ATmega328P'));
  }

  render() {
    const q = this.search.value.trim().toLowerCase();
    const cats = new Map();
    for (const it of this.items) {
      if (q && !(it.name.toLowerCase().includes(q) || it.key.toLowerCase().includes(q))) continue;
      if (!cats.has(it.cat)) cats.set(it.cat, []);
      cats.get(it.cat).push(it);
    }
    const order = [...CAT_ORDER, ...[...cats.keys()].filter((c) => !CAT_ORDER.includes(c))];
    let h = '';
    for (const c of order) {
      const list = cats.get(c);
      if (!list) continue;
      const closed = !q && this.closed.has(c);
      h += `<div class="cat${closed ? ' closed' : ''}" data-cat="${esc(c)}"><div class="cat-head"><span class="arrow">▼</span>${esc(CAT_NAMES[c] || c)}<span class="count">${list.length}</span></div><div class="cat-items">`;
      for (const it of list) {
        const idx = this.items.indexOf(it);
        const pv = symbolPreviewSvg(it.type, it.props, false);
        h += `<div class="item" draggable="true" data-idx="${idx}" title="${esc(it.desc)}"><svg class="ib" viewBox="${pv.vb}" preserveAspectRatio="xMidYMid meet">${pv.body}</svg><span class="nm">${esc(it.name)}</span></div>`;
      }
      h += '</div></div>';
    }
    this.tree.innerHTML = h || '<div class="inst-empty">검색 결과가 없습니다</div>';
    for (const head of this.tree.querySelectorAll('.cat-head')) {
      head.onclick = () => {
        const cat = head.parentElement;
        cat.classList.toggle('closed');
        const c = cat.dataset.cat;
        if (cat.classList.contains('closed')) this.closed.add(c); else this.closed.delete(c);
        try { localStorage.setItem('sms.libClosed', JSON.stringify([...this.closed])); } catch { /* ignore */ }
      };
    }
    for (const el of this.tree.querySelectorAll('.item')) {
      const it = this.items[+el.dataset.idx];
      el.onclick = () => {
        this.tree.querySelectorAll('.item.sel').forEach((x) => x.classList.remove('sel'));
        el.classList.add('sel');
        this.preview(it);
        this.app.placeFromLibrary(it.type, it.props);
      };
      el.onmouseenter = () => this.preview(it);
      el.ondragstart = (e) => {
        e.dataTransfer.setData('text/sms-part', it.type);
        e.dataTransfer.setData('text/sms-props', JSON.stringify(it.props));
        this.app.dragProps = it.props;
      };
    }
  }

  preview(it) {
    if (!it) return;
    const pv = symbolPreviewSvg(it.type, it.props, true);
    this.pvSvg.setAttribute('viewBox', pv.vb);
    this.pvSvg.innerHTML = pv.body;
    this.pvName.textContent = it.name;
    this.pvDesc.textContent = it.desc;
  }
}
