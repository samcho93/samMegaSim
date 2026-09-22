// Modal dialogs, prompts and toasts
import { esc } from '../parts/kit.js';

const root = () => document.getElementById('modalRoot');

export function modal({ title, body, buttons = [{ label: '닫기', value: null }], width, onOpen, dismissable = true }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" style="${width ? `width:${width}px` : ''}">
      <div class="modal-head"><span>${title}</span><button class="x" title="닫기">×</button></div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div></div>`;
    const bodyEl = back.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    const foot = back.querySelector('.modal-foot');
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '');
      btn.textContent = b.label;
      btn.onclick = async () => {
        if (b.action) { const r = await b.action(bodyEl, close); if (r === false) return; }
        close(typeof b.value === 'function' ? b.value(bodyEl) : b.value);
      };
      foot.appendChild(btn);
    }
    if (!buttons.length) foot.remove();
    back.querySelector('.x').onclick = () => close(null);
    if (dismissable) back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
        const primary = buttons.find((b) => /primary/.test(b.cls || ''));
        if (primary) { e.preventDefault(); e.stopPropagation(); foot.querySelector('.primary')?.click(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    root().appendChild(back);
    onOpen?.(bodyEl, close);
    setTimeout(() => bodyEl.querySelector('input,select,textarea')?.focus(), 30);
  });
}

export function prompt(title, label, value = '') {
  return modal({
    title,
    body: `<div class="form"><label>${esc(label)}</label><input class="inp" id="pv" value="${esc(value)}"></div>`,
    buttons: [{ label: '취소', value: null }, { label: '확인', cls: 'primary', value: (b) => b.querySelector('#pv').value }],
    onOpen: (b) => setTimeout(() => b.querySelector('#pv').select(), 40),
  });
}

export function confirmDlg(title, msg, okLabel = '확인') {
  return modal({ title, body: `<p>${msg}</p>`, buttons: [{ label: '취소', value: false }, { label: okLabel, cls: 'primary', value: true }] });
}

export function toast(msg, kind = 'info', ms = 3200) {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = msg;
  document.getElementById('toastRoot').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms);
}
