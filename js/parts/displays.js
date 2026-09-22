// Display parts: 7-segment, LCD (HD44780), LED bar graph, LED matrix
import { register, Sym, esc, logicLevel, getSymbol } from './kit.js';
import { ledElement, LED_COLORS, hexA } from './basic.js';

const CAT = 'Displays';
const SEGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];

/** Seven segment polygons for a digit with top-left (x,y), width w, height h */
function segPolys(x, y, w, h) {
  const t = Math.max(2, w * 0.16), sk = w * 0.12;
  const hh = h / 2;
  const P = (pts) => pts.map(([px, py]) => `${(px + sk * (1 - (py - y) / h)).toFixed(1)},${py.toFixed(1)}`).join(' ');
  const hbar = (yy) => P([[x + t * 0.6, yy], [x + t, yy - t / 2], [x + w - t, yy - t / 2], [x + w - t * 0.6, yy], [x + w - t, yy + t / 2], [x + t, yy + t / 2]]);
  const vbar = (xx, y0, y1) => P([[xx, y0 + t * 0.6], [xx + t / 2, y0 + t], [xx + t / 2, y1 - t], [xx, y1 - t * 0.6], [xx - t / 2, y1 - t], [xx - t / 2, y0 + t]]);
  return {
    a: hbar(y + t / 2), g: hbar(y + hh), d: hbar(y + h - t / 2),
    f: vbar(x + t / 2, y, y + hh), b: vbar(x + w - t / 2, y, y + hh),
    e: vbar(x + t / 2, y + hh, y + h), c: vbar(x + w - t / 2, y + hh, y + h),
    dp: [x + w + t * 0.9, y + h - t / 2, t * 0.6],
  };
}

function digitSvg(x, y, w, h, bright, color) {
  const p = segPolys(x, y, w, h);
  let g = '';
  for (const s of SEGS) {
    const b = bright[s] || 0;
    const fill = b > 0 ? hexA(color, 0.3 + 0.7 * b) : 'rgba(120,20,20,0.13)';
    if (s === 'dp') g += `<circle cx="${p.dp[0].toFixed(1)}" cy="${p.dp[1].toFixed(1)}" r="${p.dp[2].toFixed(1)}" style="fill:${fill}"/>`;
    else g += `<polygon points="${p[s]}" style="fill:${fill}"/>`;
  }
  return g;
}

register({
  type: 'seg7', name: '7-Segment (1 digit)', category: CAT, prefix: 'U',
  desc: '7세그먼트 1자리 (공통 캐소드/애노드)',
  props: [
    { key: 'common', label: '공통 단자', default: 'cathode', options: ['cathode', 'anode'] },
    { key: 'color', label: '색상', default: 'red', options: Object.keys(LED_COLORS) },
  ],
  valueText: (p) => (p.common === 'anode' ? '7SEG-CA' : '7SEG-CC'),
  symbol() {
    const s = new Sym();
    s.rect(-30, -50, 60, 100, 'sb');
    SEGS.forEach((nm, i) => s.pin(nm, -40, -40 + i * 10, 'R', 10, { name: nm, showName: true, nameSize: 7 }));
    s.pin('COM', 40, 40, 'L', 10, { name: 'COM', showName: true, nameSize: 7 });
    s.rect(-14, -40, 38, 64, 'lcdbg7');
    return s.ref(-30, -56).val(0, -56).build();
  },
  dyn(part, inst) {
    const col = (LED_COLORS[part.props.color] || LED_COLORS.red).rgb;
    const bright = {};
    if (inst) SEGS.forEach((s, i) => { bright[s] = inst.leds[i].bright; });
    return digitSvg(-8, -34, 22, 52, bright, col);
  },
  sim(part, n) {
    const ca = part.props.common === 'anode';
    const leds = SEGS.map((s) => (ca ? ledElement(n('COM'), n(s), part.props.color) : ledElement(n(s), n('COM'), part.props.color)));
    return { elements: leds, leds, frame() { leds.forEach((l) => l.frame()); } };
  },
});

register({
  type: 'seg7x4', name: '7-Segment (4 digit)', category: CAT, prefix: 'U',
  desc: '4자리 7세그먼트 (다이나믹 구동, D1~D4 공통 단자)',
  props: [
    { key: 'common', label: '공통 단자', default: 'cathode', options: ['cathode', 'anode'] },
    { key: 'color', label: '색상', default: 'red', options: Object.keys(LED_COLORS) },
  ],
  valueText: (p) => (p.common === 'anode' ? '7SEG-4-CA' : '7SEG-4-CC'),
  symbol() {
    const s = new Sym();
    s.rect(-70, -40, 140, 90, 'sb');
    SEGS.forEach((nm, i) => s.pin(nm, -80, -30 + i * 10, 'R', 10, { name: nm, showName: true, nameSize: 7 }));
    ['D1', 'D2', 'D3', 'D4'].forEach((nm, i) => s.pin(nm, -30 + i * 20, -50, 'D', 10, { name: nm, showName: true, nameSize: 7 }));
    s.rect(-52, -22, 118, 64, 'lcdbg7');
    return s.ref(-70, -56).val(40, -56).build();
  },
  dyn(part, inst) {
    const col = (LED_COLORS[part.props.color] || LED_COLORS.red).rgb;
    let g = '';
    for (let d = 0; d < 4; d++) {
      const bright = {};
      if (inst) SEGS.forEach((s, i) => { bright[s] = inst.leds[d * 8 + i].bright; });
      g += digitSvg(-46 + d * 28, -16, 18, 50, bright, col);
    }
    return g;
  },
  sim(part, n) {
    const ca = part.props.common === 'anode';
    const leds = [];
    for (let d = 0; d < 4; d++) {
      for (const s of SEGS) {
        const com = n(`D${d + 1}`);
        leds.push(ca ? ledElement(com, n(s), part.props.color) : ledElement(n(s), com, part.props.color));
      }
    }
    return { elements: leds, leds, frame() { leds.forEach((l) => l.frame()); } };
  },
});

register({
  type: 'bargraph', name: 'LED Bar Graph (10)', category: CAT, prefix: 'U',
  desc: '10단 LED 바 그래프 (A1~A10 애노드, K1~K10 캐소드)',
  props: [{ key: 'color', label: '색상', default: 'green', options: Object.keys(LED_COLORS) }],
  valueText: () => 'LED-BAR10',
  symbol() {
    const s = new Sym();
    s.rect(-20, -50, 40, 110, 'sb');
    for (let i = 0; i < 10; i++) {
      s.pin(`A${i + 1}`, -30, -40 + i * 10, 'R', 10, { num: i + 1, showNum: true });
      s.pin(`K${i + 1}`, 30, -40 + i * 10, 'L', 10, { num: 20 - i, showNum: true });
    }
    return s.ref(-20, -56).val(-20, 70).build();
  },
  dyn(part, inst) {
    const col = (LED_COLORS[part.props.color] || LED_COLORS.green).rgb;
    let g = '';
    for (let i = 0; i < 10; i++) {
      const b = inst ? inst.leds[i].bright : 0;
      g += `<rect x="-12" y="${-44 + i * 10}" width="24" height="8" style="fill:${b > 0 ? hexA(col, 0.3 + 0.7 * b) : 'rgba(60,60,60,.2)'}" class="sl"/>`;
    }
    return g;
  },
  sim(part, n) {
    const leds = [];
    for (let i = 0; i < 10; i++) leds.push(ledElement(n(`A${i + 1}`), n(`K${i + 1}`), part.props.color));
    return { elements: leds, leds, frame() { leds.forEach((l) => l.frame()); } };
  },
});

register({
  type: 'ledmatrix', name: 'LED Matrix 8x8', category: CAT, prefix: 'U',
  desc: '8x8 도트 매트릭스 (행 R1~R8 = 애노드, 열 C1~C8 = 캐소드)',
  props: [{ key: 'color', label: '색상', default: 'red', options: Object.keys(LED_COLORS) }],
  valueText: () => 'MATRIX-8x8',
  symbol() {
    const s = new Sym();
    s.rect(-60, -60, 120, 120, 'sb');
    for (let i = 0; i < 8; i++) {
      s.pin(`R${i + 1}`, -70, -40 + i * 10, 'R', 10, { name: `R${i + 1}`, showName: true, nameSize: 6 });
      s.pin(`C${i + 1}`, -40 + i * 10, 70, 'U', 10, { name: `C${i + 1}`, showName: true, nameSize: 6 });
    }
    s.rect(-37, -52, 84, 84, 'lcdbg7');
    return s.ref(-60, -66).val(10, -66).build();
  },
  dyn(part, inst) {
    const col = (LED_COLORS[part.props.color] || LED_COLORS.red).rgb;
    let g = '';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const b = inst ? inst.leds[r * 8 + c].bright : 0;
      g += `<circle cx="${-30 + c * 10}" cy="${-45 + r * 10}" r="4" style="fill:${b > 0 ? hexA(col, 0.3 + 0.7 * b) : 'rgba(120,120,120,.25)'}"/>`;
    }
    return g;
  },
  sim(part, n) {
    const leds = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) leds.push(ledElement(n(`R${r + 1}`), n(`C${c + 1}`), part.props.color));
    return { elements: leds, leds, frame() { leds.forEach((l) => l.frame()); } };
  },
});

// ---------------------------------------------------------------------------
// HD44780 character LCD
// ---------------------------------------------------------------------------
export class HD44780 {
  constructor(cols, rows) {
    this.cols = cols; this.rows = rows;
    this.reset();
  }
  reset() {
    this.ddram = new Uint8Array(128).fill(0x20);
    this.cgram = new Uint8Array(64);
    this.ac = 0; this.cg = false; this.id = 1; this.sh = 0;
    this.display = false; this.cursor = false; this.blink = false;
    this.dl8 = true; this.lines2 = false; this.shift = 0;
    this.nibble = null; this.readNibble = 0;
  }
  rowAddr(r) { return [0x00, 0x40, this.cols, 0x40 + this.cols][r]; }
  _incAC() {
    if (this.cg) { this.ac = (this.ac + (this.id ? 1 : -1)) & 0x3f; return; }
    let a = this.ac + (this.id ? 1 : -1);
    if (this.lines2) {
      if (a === 0x28) a = 0x40; else if (a === 0x68) a = 0x00;
      else if (a === 0x3f) a = 0x27; else if (a === -1) a = 0x67;
    } else a = (a + 80) % 80;
    this.ac = a;
  }
  command(c) {
    if (c & 0x80) { this.ac = c & 0x7f; this.cg = false; }
    else if (c & 0x40) { this.ac = c & 0x3f; this.cg = true; }
    else if (c & 0x20) { this.dl8 = !!(c & 0x10); this.lines2 = !!(c & 0x08); }
    else if (c & 0x10) {
      const right = !!(c & 0x04);
      if (c & 0x08) this.shift += right ? -1 : 1;
      else { const keep = this.id; this.id = right ? 1 : 0; this._incAC(); this.id = keep; }
    } else if (c & 0x08) { this.display = !!(c & 4); this.cursor = !!(c & 2); this.blink = !!(c & 1); }
    else if (c & 0x04) { this.id = (c >> 1) & 1; this.sh = c & 1; }
    else if (c & 0x02) { this.ac = 0; this.cg = false; this.shift = 0; }
    else if (c & 0x01) { this.ddram.fill(0x20); this.ac = 0; this.cg = false; this.id = 1; this.shift = 0; }
  }
  data(d) {
    if (this.cg) this.cgram[this.ac & 0x3f] = d & 0x1f;
    else this.ddram[this.ac & 0x7f] = d;
    this._incAC();
    if (!this.cg && this.sh) this.shift += this.id ? 1 : -1;
  }
  read(rs) {
    if (!rs) return this.ac & 0x7f; // busy flag always 0
    const v = this.cg ? this.cgram[this.ac & 0x3f] : this.ddram[this.ac & 0x7f];
    this._incAC();
    return v;
  }
  /** character code at display row/col */
  charAt(r, c) {
    const width = this.lines2 ? 40 : 80;
    const base = this.rowAddr(r);
    let off = (c + this.shift) % width;
    if (off < 0) off += width;
    if (!this.lines2 && r > 0) return 0x20;
    return this.ddram[base + off] ?? 0x20;
  }
}

function lcdCharText(code) {
  if (code >= 0x20 && code < 0x7f) {
    if (code === 0x5c) return '¥';
    return String.fromCharCode(code);
  }
  if (code === 0x7e) return '→';
  if (code === 0x7f) return '←';
  if (code >= 0xa1 && code <= 0xdf) return String.fromCharCode(0xff61 + code - 0xa1);
  if (code === 0xdf) return '°';
  return ' ';
}

/** Render LCD glass + characters (local coords, display area above y=0) */
export function renderLcd(geo, lcd, powered, lit, color) {
  const { cols, rows, dispW, dispH, H, cw, chh } = geo;
  const x0 = -dispW / 2, y0 = -H + 8;
  const blue = color === 'blue';
  const bg = blue ? (lit ? '#2a4bd7' : '#1a2a6a') : (lit ? '#b6d84a' : '#8a9a50');
  const fg = blue ? '#e8f0ff' : '#1c2a10';
  let g = `<rect x="${x0}" y="${y0}" width="${dispW}" height="${dispH}" rx="3" style="fill:${bg}" class="lcdframe"/>`;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = x0 + 6 + c * cw, cy = y0 + 5 + r * (chh + 3);
      g += `<rect x="${cx}" y="${cy}" width="${cw - 1.5}" height="${chh}" style="fill:${blue ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)'}"/>`;
      if (!lcd || !powered || !lcd.display) continue;
      const code = lcd.charAt(r, c);
      if (code < 16) {
        const base = (code & 7) * 8;
        const px = (cw - 1.5) / 5, py = chh / 8;
        for (let yy = 0; yy < 8; yy++) {
          const row = lcd.cgram[base + yy];
          for (let xx = 0; xx < 5; xx++) {
            if (row & (0x10 >> xx)) g += `<rect x="${(cx + xx * px).toFixed(2)}" y="${(cy + yy * py).toFixed(2)}" width="${(px * 0.9).toFixed(2)}" height="${(py * 0.9).toFixed(2)}" style="fill:${fg}"/>`;
          }
        }
      } else {
        const ch = lcdCharText(code);
        if (ch !== ' ') g += `<text x="${cx + (cw - 1.5) / 2}" y="${cy + chh - 3}" text-anchor="middle" class="lcdch" style="fill:${fg}">${esc(ch)}</text>`;
      }
      if (lcd.cursor && !lcd.cg) {
        const addr = lcd.rowAddr(r) + c + lcd.shift;
        if (addr === lcd.ac) g += `<rect x="${cx}" y="${cy + chh - 1.5}" width="${cw - 1.5}" height="1.5" style="fill:${fg}"/>`;
      }
    }
  }
  return g;
}

export function lcdGeometry(size) {
  const [cols, rows] = (size || '16x2').split('x').map(Number);
  const cw = 9, chh = 14;
  const dispW = cols * cw + 12, dispH = rows * (chh + 3) + 10;
  const W = Math.max(180, Math.ceil((dispW + 20) / 20) * 20);
  const H = Math.ceil((dispH + 40) / 10) * 10;
  return { cols, rows, dispW, dispH, W, H, cw, chh };
}

const LCD_PINS = ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K'];

register({
  type: 'lcd', name: 'LCD 16x2 (HD44780)', category: CAT, prefix: 'LCD',
  desc: 'HD44780 호환 문자 LCD (4/8비트 모드, CGRAM 사용자 문자 지원)',
  props: [
    { key: 'size', label: '크기', default: '16x2', options: ['16x2', '20x4', '16x1', '20x2'] },
    { key: 'color', label: '백라이트', default: 'green', options: ['green', 'blue'] },
  ],
  valueText: (p) => `LM0${p.size === '20x4' ? '44L' : '16L'} ${p.size}`,
  symbolKey: (p) => p.size,
  symbol(p) {
    const geo = lcdGeometry(p.size);
    const { W, H } = geo;
    const s = new Sym();
    s.rect(-W / 2, -H, W, H, 'sb');
    LCD_PINS.forEach((nm, i) => s.pin(nm, -80 + i * 10, 10, 'U', 10, { name: nm, showName: true, nameSize: 6, num: i + 1 }));
    return s.ref(-W / 2, -H - 6).val(-W / 2 + 40, -H - 6).build({ lcd: geo });
  },
  dyn(part, inst) {
    return renderLcd(getSymbol(part).lcd, inst?.lcd, inst ? inst.powered : false, inst ? inst.backlight : false, part.props.color);
  },
  sim(part, n, S) {
    const [cols, rows] = (part.props.size || '16x2').split('x').map(Number);
    const lcd = new HD44780(cols, rows);
    const N = Object.fromEntries(LCD_PINS.map((p) => [p, n(p)]));
    const inst = { lcd, backlight: false, powered: false, lastE: 0, drive: null, driveMask: 0 };
    const vcc = () => S.vcc;
    const el = {
      stamp(St) {
        if (inst.drive != null) {
          for (let i = 0; i < 8; i++) {
            if (!(inst.driveMask & (1 << i))) continue;
            St.norton(N['D' + i], N.VSS, 1 / 200, (inst.drive >> i) & 1 ? vcc() : 0);
          }
        }
        St.G(N.VDD, N.VSS, 1 / 5000);
      },
      post(c) {
        const vdd = c.V(N.VDD) - c.V(N.VSS);
        const powered = vdd > 2.7;
        if (powered && !inst.powered) lcd.reset();
        inst.powered = powered;
        if (!powered) { inst.lastE = 0; return false; }
        const L = (node) => logicLevel(c.V(node) - c.V(N.VSS), vdd);
        const e = L(N.E);
        let changed = false;
        if (e !== inst.lastE) {
          const rs = L(N.RS), rw = L(N.RW);
          if (e === 1 && rw === 1) {
            // read: drive data bus
            let v;
            if (lcd.dl8) { v = lcd.read(rs); inst.drive = v; inst.driveMask = 0xff; }
            else {
              if (inst.readNibble === 0) { inst.readVal = lcd.read(rs); v = inst.readVal >> 4; inst.readNibble = 1; }
              else { v = inst.readVal & 0xf; inst.readNibble = 0; }
              inst.drive = v << 4; inst.driveMask = 0xf0;
            }
            changed = true;
          } else if (e === 0) {
            if (inst.drive != null) { inst.drive = null; changed = true; }
            else if (rw === 0) {
              let byte = 0;
              for (let i = 0; i < 8; i++) byte |= L(N['D' + i]) << i;
              if (lcd.dl8) {
                if (rs) lcd.data(byte); else lcd.command(byte);
                inst.readNibble = 0;
              } else {
                const nib = byte >> 4;
                if (lcd.nibble == null) lcd.nibble = nib;
                else {
                  const v = (lcd.nibble << 4) | nib;
                  lcd.nibble = null;
                  if (rs) lcd.data(v); else lcd.command(v);
                }
              }
            }
          }
          inst.lastE = e;
        }
        return changed;
      },
    };
    // Function-set command while in 4-bit mode resets nibble phase when switching modes
    const origCmd = lcd.command.bind(lcd);
    lcd.command = (c) => { const was8 = lcd.dl8; origCmd(c); if (was8 !== lcd.dl8) lcd.nibble = null; };
    const bl = ledElement(N.A, N.K, 'white', 0.005);
    inst.elements = [el, bl];
    inst.frame = () => {
      bl.frame();
      inst.backlight = bl.bright > 0.05 || S.isUnconnected?.(part.id, 'A');
    };
    return inst;
  },
});
