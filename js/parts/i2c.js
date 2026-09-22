// I2C (TWI) devices. Connected logically to the MCU TWI peripheral when their
// SDA/SCL pins share nets with the MCU's SDA/SCL pins.
import { register, Sym, logicLevel } from './kit.js';
import { HD44780, renderLcd, lcdGeometry } from './displays.js';
import { icBox } from './logic.js';

const CAT = 'I2C Devices';
const bcd = (v) => ((Math.floor(v / 10) << 4) | (v % 10)) & 0xff;
const unbcd = (b) => (b >> 4) * 10 + (b & 0x0f);

function addrPins(c, n, S, part, pins) {
  let a = 0;
  pins.forEach((p, i) => {
    if (!S.isUnconnected(part.id, p) && logicLevel(c.V(n(p)), S.vcc, 0)) a |= 1 << i;
  });
  return a;
}

// ---------------------------------------------------------------------------
register({
  type: 'eeprom24', name: '24Cxx I2C EEPROM', category: CAT, prefix: 'U',
  desc: 'I2C EEPROM (24C02: 256B, 24C256: 32KB). 주소 0x50 + A2..A0',
  props: [{ key: 'model', label: '모델', default: '24C02', options: ['24C02', '24C04', '24C08', '24C16', '24C32', '24C64', '24C256'] }],
  valueText: (p) => p.model || '24C02',
  symbol() {
    const { s, H } = icBox(
      [{ id: 'A0', num: 1 }, { id: 'A1', num: 2 }, { id: 'A2', num: 3 }, { id: 'WP', num: 7 }],
      [{ id: 'SDA', num: 5 }, { id: 'SCL', num: 6 }],
      { top: [{ id: 'VCC', num: 8 }], bottom: [{ id: 'GND', num: 4 }] },
    );
    return s.ref(34, -H / 2 - 12).val(34, H / 2 + 16).build();
  },
  sim(part, n, S) {
    const model = part.props.model || '24C02';
    const size = { '24C02': 256, '24C04': 512, '24C08': 1024, '24C16': 2048, '24C32': 4096, '24C64': 8192, '24C256': 32768 }[model];
    const twoByte = size > 2048;
    const mem = new Uint8Array(size).fill(0xff);
    const inst = { mem, elements: [] };
    let ptr = 0, phase = 0, block = 0;
    const blocks = !twoByte && size > 256 ? size / 256 : 1;
    const dev = {
      sda: n('SDA'), scl: n('SCL'),
      accepts(addr) {
        const hw = 0x50 | addrPins(S.circuit, n, S, part, ['A0', 'A1', 'A2']);
        return (addr & ~(blocks - 1)) === (hw & ~(blocks - 1));
      },
      start(write, addr) {
        block = blocks > 1 ? addr & (blocks - 1) : 0;
        phase = write ? (twoByte ? 2 : 1) : 0;
      },
      write(b) {
        if (phase === 2) { ptr = (b << 8) & (size - 1); phase = 1; return true; }
        if (phase === 1) { ptr = twoByte ? (ptr | b) & (size - 1) : ((block << 8) | b) & (size - 1); phase = 0; return true; }
        mem[ptr] = b;
        const page = twoByte ? 64 : 16;
        ptr = (ptr & ~(page - 1)) | ((ptr + 1) & (page - 1));
        return true;
      },
      read() { const v = mem[ptr]; ptr = (ptr + 1) % size; return v; },
      stop() {},
    };
    S.registerI2C(dev);
    return inst;
  },
});

// ---------------------------------------------------------------------------
register({
  type: 'ds1307', name: 'DS1307 RTC', category: CAT, prefix: 'U',
  desc: '실시간 시계 (I2C 0x68). 시뮬레이션 시작 시 PC 시간으로 초기화',
  props: [{ key: 'init', label: '초기 시간', default: 'pc', options: ['pc', 'zero'] }],
  valueText: () => 'DS1307',
  symbol() {
    const { s, H } = icBox(
      [{ id: 'X1', num: 1 }, { id: 'X2', num: 2 }, { id: 'VBAT', num: 3 }],
      [{ id: 'SDA', num: 5 }, { id: 'SCL', num: 6 }, { id: 'SQW', num: 7 }],
      { top: [{ id: 'VCC', num: 8 }], bottom: [{ id: 'GND', num: 4 }] },
    );
    return s.ref(34, -H / 2 - 12).val(34, H / 2 + 16).build();
  },
  sim(part, n, S) {
    const ram = new Uint8Array(64);
    const start = part.props.init === 'zero' ? new Date(2000, 0, 1) : new Date();
    let baseMs = start.getTime(), baseSim = 0, h12 = false;
    const now = () => new Date(baseMs + (S.time - baseSim) * 1000);
    const regs = () => {
      const d = now();
      let hr = d.getHours();
      let hb;
      if (h12) { const pm = hr >= 12; let h = hr % 12; if (h === 0) h = 12; hb = 0x40 | (pm ? 0x20 : 0) | bcd(h); } else hb = bcd(hr);
      return [bcd(d.getSeconds()), bcd(d.getMinutes()), hb, d.getDay() + 1, bcd(d.getDate()), bcd(d.getMonth() + 1), bcd(d.getFullYear() % 100), ram[7]];
    };
    let ptr = 0, first = false, snap = null, dirty = null;
    const dev = {
      address: 0x68, sda: n('SDA'), scl: n('SCL'),
      start(write) { first = write; snap = regs(); dirty = null; },
      write(b) {
        if (first) { ptr = b & 63; first = false; return true; }
        if (ptr < 7) { (dirty ||= regs())[ptr] = b; } else ram[ptr] = b;
        ptr = (ptr + 1) & 63;
        return true;
      },
      read() {
        const v = ptr < 8 ? (snap || regs())[ptr] : ram[ptr];
        ptr = (ptr + 1) & 63;
        return v;
      },
      stop() {
        if (dirty) {
          const r = dirty;
          h12 = !!(r[2] & 0x40);
          let hr = h12 ? unbcd(r[2] & 0x1f) % 12 + (r[2] & 0x20 ? 12 : 0) : unbcd(r[2] & 0x3f);
          const d = new Date(2000 + unbcd(r[6]), unbcd(r[5] & 0x1f) - 1, unbcd(r[4] & 0x3f), hr, unbcd(r[1] & 0x7f), unbcd(r[0] & 0x7f));
          baseMs = d.getTime(); baseSim = S.time;
          dirty = null;
        }
      },
    };
    S.registerI2C(dev);
    return { elements: [] };
  },
});

// ---------------------------------------------------------------------------
register({
  type: 'pcf8574', name: 'PCF8574 I/O Expander', category: CAT, prefix: 'U',
  desc: 'I2C 8비트 I/O 확장 (0x20 + A2..A0, PCF8574A는 0x38)',
  props: [{ key: 'model', label: '모델', default: 'PCF8574', options: ['PCF8574', 'PCF8574A'] }],
  valueText: (p) => p.model || 'PCF8574',
  symbol() {
    const { s, H } = icBox(
      [{ id: 'A0', num: 1 }, { id: 'A1', num: 2 }, { id: 'A2', num: 3 }, null, { id: 'SDA', num: 15 }, { id: 'SCL', num: 14 }, { id: 'INT', num: 13, inv: true }],
      Array.from({ length: 8 }, (_, i) => ({ id: 'P' + i, num: [4, 5, 6, 7, 9, 10, 11, 12][i] })),
    );
    return s.ref(-30, -H / 2 - 6).val(10, -H / 2 - 6).build();
  },
  sim(part, n, S) {
    let out = 0xff;
    const nodes = Array.from({ length: 8 }, (_, i) => n('P' + i));
    const base = part.props.model === 'PCF8574A' ? 0x38 : 0x20;
    let addr = base;
    const drv = {
      stamp(St) {
        nodes.forEach((node, i) => {
          if (out & (1 << i)) St.norton(node, -1, 1 / 50000, S.vcc);
          else St.norton(node, -1, 1 / 30, 0);
        });
      },
    };
    const dev = {
      get address() { return addr; },
      sda: n('SDA'), scl: n('SCL'),
      start() { addr = base | addrPins(S.circuit, n, S, part, ['A0', 'A1', 'A2']); },
      write(b) { out = b; S.solveAt(S.time); return true; },
      read() {
        let v = 0;
        nodes.forEach((node, i) => { if (logicLevel(S.circuit.V(node), S.vcc, 1)) v |= 1 << i; });
        return v;
      },
    };
    S.registerI2C(dev);
    return { elements: [drv] };
  },
});

// ---------------------------------------------------------------------------
register({
  type: 'lcd_i2c', name: 'LCD 16x2 I2C', category: CAT, prefix: 'LCD',
  desc: 'PCF8574 백팩이 달린 HD44780 LCD (기본 주소 0x27, P0=RS P1=RW P2=E P3=BL P4~7=D4~D7)',
  props: [
    { key: 'addr', label: 'I2C 주소', default: '0x27', options: ['0x20', '0x21', '0x22', '0x23', '0x24', '0x25', '0x26', '0x27', '0x3F'] },
    { key: 'size', label: '크기', default: '16x2', options: ['16x2', '20x4'] },
    { key: 'color', label: '백라이트', default: 'blue', options: ['green', 'blue'] },
  ],
  valueText: (p) => `LCD${p.size || '16x2'} I2C@${p.addr || '0x27'}`,
  symbolKey: (p) => p.size,
  symbol(p) {
    const geo = lcdGeometry(p.size);
    const { W, H } = geo;
    const s = new Sym();
    s.rect(-W / 2, -H, W, H, 'sb');
    ['GND', 'VCC', 'SDA', 'SCL'].forEach((nm, i) => s.pin(nm, -W / 2 - 20, -H + 20 + i * 10, 'R', 20, { name: nm, showName: true, nameSize: 6 }));
    return s.ref(-W / 2, -H - 6).val(-W / 2 + 40, -H - 6).build({ lcd: { ...geo, H: H - 0 } });
  },
  dyn(part, inst) {
    const geo = lcdGeometry(part.props.size);
    return renderLcd(geo, inst?.lcd, inst ? inst.powered : false, inst ? inst.bl : false, part.props.color);
  },
  sim(part, n, S) {
    const [cols, rows] = (part.props.size || '16x2').split('x').map(Number);
    const lcd = new HD44780(cols, rows);
    const inst = { lcd, powered: true, bl: false };
    let last = 0;
    const dev = {
      address: parseInt(part.props.addr || '0x27', 16),
      sda: n('SDA'), scl: n('SCL'),
      write(b) {
        inst.bl = !!(b & 0x08);
        // E falling edge latches the high nibble
        if ((last & 0x04) && !(b & 0x04) && !(b & 0x02)) {
          const nib = (last >> 4) & 0x0f;
          const rs = last & 1;
          if (lcd.dl8) {
            const v = nib << 4;
            if (rs) lcd.data(v); else lcd.command(v);
          } else if (lcd.nibble == null) lcd.nibble = nib;
          else {
            const v = (lcd.nibble << 4) | nib;
            lcd.nibble = null;
            if (rs) lcd.data(v); else lcd.command(v);
          }
        }
        last = b;
        return true;
      },
      read() { return last | 0xf0; },
    };
    const origCmd = lcd.command.bind(lcd);
    lcd.command = (c) => { const was8 = lcd.dl8; origCmd(c); if (was8 !== lcd.dl8) lcd.nibble = null; };
    S.registerI2C(dev);
    return inst;
  },
});
