// Minimal line icons (24x24, stroke = currentColor)
const P = {
  new: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M12 11v6M9 14h6"/>',
  open: '<path d="M3 7h6l2 2h10v10H3z"/><path d="M3 11h18"/>',
  save: '<path d="M4 4h13l3 3v13H4z"/><path d="M8 4v5h8V4"/><rect x="8" y="13" width="8" height="7"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h11a5 5 0 010 10h-3"/>',
  redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12H9a5 5 0 000 10h3"/>',
  select: '<path d="M5 3l14 8-6 2-2 6z"/>',
  wire: '<path d="M3 18h7V6h11"/><circle cx="3" cy="18" r="1.5"/><circle cx="21" cy="6" r="1.5"/>',
  label: '<path d="M3 12l4-5h14v10H7z"/><path d="M11 12h6"/>',
  vcc: '<path d="M12 22V10"/><path d="M6 10h12"/><path d="M9 5l3-3 3 3"/>',
  gnd: '<path d="M12 2v10"/><path d="M5 12h14l-7 8z"/>',
  rotate: '<path d="M20 12a8 8 0 11-3-6.3"/><path d="M20 3v6h-6"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7L3 17h6z"/><path d="M15 7l6 10h-6z"/>',
  delete: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
  zoomin: '<circle cx="10" cy="10" r="7"/><path d="M15 15l6 6M7 10h6M10 7v6"/>',
  zoomout: '<circle cx="10" cy="10" r="7"/><path d="M15 15l6 6M7 10h6"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="8" y="8" width="8" height="8"/>',
  build: '<path d="M14 6l4-4 4 4-4 4z"/><path d="M16 8L4 20"/><path d="M3 14l3 3"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
  pause: '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>',
  stop: '<rect x="5" y="5" width="14" height="14" fill="currentColor"/>',
  step: '<path d="M5 4l10 8-10 8z" fill="currentColor"/><rect x="17" y="4" width="3" height="16" fill="currentColor"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
}

export function applyIcons(root = document) {
  for (const el of root.querySelectorAll('i.ic')) {
    const m = [...el.classList].find((c) => c.startsWith('ic-'));
    if (m) el.innerHTML = icon(m.slice(3));
  }
}
