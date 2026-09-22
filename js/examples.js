// Example projects (schematic built programmatically + C source)
import { LIB, partPins } from './parts/kit.js';

class Builder {
  constructor() { this.parts = []; this.wires = []; this.n = 0; this.refs = {}; }
  add(type, x, y, props = {}, o = {}) {
    const def = LIB[type];
    const p = { id: `p${++this.n}`, type, x, y, rot: o.rot || 0, mirror: !!o.mirror, ref: '', props: {} };
    for (const pr of def.props || []) p.props[pr.key] = pr.default;
    Object.assign(p.props, props);
    const pre = def.prefix || 'U';
    this.refs[pre] = (this.refs[pre] || 0) + 1;
    p.ref = pre + (pre.startsWith('#') ? String(this.refs[pre]).padStart(2, '0') : this.refs[pre]);
    this.parts.push(p);
    return p;
  }
  pin(p, id) {
    const q = partPins(p).find((x) => x.id === String(id));
    if (!q) throw new Error(`pin ${id} not found on ${p.type}`);
    return [q.wx, q.wy];
  }
  /** Pin tip of an MCU by port name, e.g. 'PB5' */
  mpin(mcu, name) {
    const dev = mcu._dev;
    const row = dev.pins.find((r) => r[1] === name);
    return this.pin(mcu, row[0]);
  }
  wire(...pts) { this.wires.push({ id: `w${++this.n}`, points: pts.map((p) => [p[0], p[1]]) }); }
  /** L-shaped connection: horizontal first ('h') or vertical first ('v') */
  link(a, b, first = 'h') {
    if (a[0] === b[0] || a[1] === b[1]) this.wire(a, b);
    else this.wire(a, first === 'h' ? [b[0], a[1]] : [a[0], b[1]], b);
  }
  /** Z-shaped connection with a vertical segment at x */
  linkX(a, b, x) { this.wire(a, [x, a[1]], [x, b[1]], b); }
  /** Net label with a stub wire; dir = side the label extends to */
  label(at, name, dir = 'R', stub = 20) {
    const d = { R: [1, 0], L: [-1, 0], U: [0, -1], D: [0, 1] }[dir];
    const end = [at[0] + d[0] * stub, at[1] + d[1] * stub];
    if (stub) this.wire(at, end);
    const o = { R: {}, L: { mirror: true }, D: { rot: 1 }, U: { rot: 3 } }[dir];
    this.add('label', end[0], end[1], { name }, o);
  }
  gnd(at, stub = 0) {
    const g = [at[0], at[1] + stub];
    if (stub) this.wire(at, g);
    this.add('gnd', g[0], g[1]);
  }
  vcc(at, stub = 0) {
    const g = [at[0], at[1] - stub];
    if (stub) this.wire(at, g);
    this.add('vcc', g[0], g[1]);
  }
  /** Power symbol at a point, rotated (rot 1/3 = pointing right/left for GND/VCC) */
  power(type, at, rot = 0) { return this.add(type, at[0], at[1], {}, { rot }); }
  mcu(device, x, y, clock = '16MHz') {
    const m = this.add('mcu', x, y, { device, clock });
    m._dev = null;
    return m;
  }
  done() {
    for (const p of this.parts) delete p._dev;
    return { parts: this.parts, wires: this.wires };
  }
}

async function devices() { return (await import('./mcu/devices.js')).DEVICES; }

function mcuWithPower(b, DEV, device, x, y, clock) {
  const m = b.mcu(device, x, y, clock);
  m._dev = DEV[device];
  // power pins
  for (const row of DEV[device].pins) {
    if (row[1] === 'VCC' || row[1] === 'AVCC') b.vcc(b.pin(m, row[0]), 10);
    if (row[1] === 'GND') b.gnd(b.pin(m, row[0]), 10);
  }
  return m;
}

/** LED + series resistor from a pin going right, cathode to GND */
function ledRight(b, from, color = 'red', r = '330', len = 40) {
  const R = b.add('resistor', from[0] + len + 30, from[1], { value: r }, { rot: 1 });
  b.wire(from, b.pin(R, '2'));
  const L = b.add('led', b.pin(R, '1')[0] + 40, from[1], { color });
  b.wire(b.pin(R, '1'), b.pin(L, 'A'));
  const k = b.pin(L, 'K');
  b.wire(k, [k[0] + 20, k[1]]);
  b.gnd([k[0] + 20, k[1]], 20);
  return { R, L };
}

// ---------------------------------------------------------------------------
export const EXAMPLES = [
  {
    id: 'blink', name: 'LED 깜빡이기 (Blink)', device: 'atmega328p',
    desc: 'PB5 핀의 LED를 0.5초 간격으로 점멸 + 오실로스코프로 파형 확인',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega328p', 600, 600);
      const pb5 = b.mpin(m, 'PB5');
      ledRight(b, pb5, 'red', '330', 60);
      const osc = b.add('scope', 1250, 330);
      b.linkX(pb5, b.pin(osc, 'A'), pb5[0] + 50);
      return b.done();
    },
    code: `/*
 * LED 깜빡이기 (Blink) - ATmega328P @ 16MHz
 * PB5 에 연결된 LED를 500ms 간격으로 켜고 끕니다.
 */
#include <avr/io.h>
#include <util/delay.h>

int main(void)
{
    DDRB |= (1 << PB5);          // PB5 출력 설정

    while (1) {
        PORTB ^= (1 << PB5);     // LED 토글
        _delay_ms(500);
    }
}
`,
  },
  {
    id: 'button', name: '버튼 입력 (외부 인터럽트)', device: 'atmega328p',
    desc: 'INT0(PD2) 버튼을 누를 때마다 LED 토글, 내부 풀업 사용',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega328p', 600, 600);
      const pd2 = b.mpin(m, 'PD2');
      const sw = b.add('button', pd2[0] + 100, pd2[1]);
      b.wire(pd2, b.pin(sw, '1'));
      const s2 = b.pin(sw, '2');
      b.wire(s2, [s2[0] + 20, s2[1]]);
      b.gnd([s2[0] + 20, s2[1]], 20);
      const pb0 = b.mpin(m, 'PB0');
      ledRight(b, pb0, 'green', '330', 60);
      const pb1 = b.mpin(m, 'PB1');
      ledRight(b, pb1, 'yellow', '330', 60);
      return b.done();
    },
    code: `/*
 * 버튼 + 외부 인터럽트 INT0 - ATmega328P
 * PD2(INT0) 버튼을 누르면(하강 에지) PB0 LED 토글
 * PB1 LED는 메인 루프에서 계속 점멸합니다.
 */
#include <avr/io.h>
#include <avr/interrupt.h>
#include <util/delay.h>

ISR(INT0_vect)
{
    PORTB ^= (1 << PB0);
}

int main(void)
{
    DDRB |= (1 << PB0) | (1 << PB1);
    PORTD |= (1 << PD2);            // 내부 풀업 저항 사용

    EICRA = (1 << ISC01);            // INT0 하강 에지
    EIMSK = (1 << INT0);             // INT0 허용
    sei();

    while (1) {
        PORTB ^= (1 << PB1);
        _delay_ms(250);
    }
}
`,
  },
  {
    id: 'pwm', name: 'PWM LED 밝기 조절 (Timer0)', device: 'atmega328p',
    desc: 'Timer0 Fast PWM(OC0A=PD6)으로 LED 밝기를 서서히 변화, 스코프로 듀티 확인',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega328p', 600, 600);
      const pd6 = b.mpin(m, 'PD6');
      ledRight(b, pd6, 'blue', '220', 60);
      const osc = b.add('scope', 1250, 780);
      b.linkX(pd6, b.pin(osc, 'A'), pd6[0] + 40);
      return b.done();
    },
    code: `/*
 * PWM 밝기 조절 - Timer0 Fast PWM, OC0A(PD6)
 * 오실로스코프 CH A에서 듀티비가 변하는 것을 확인하세요.
 */
#include <avr/io.h>
#include <util/delay.h>

int main(void)
{
    DDRD |= (1 << PD6);                              // OC0A 출력
    TCCR0A = (1 << COM0A1) | (1 << WGM01) | (1 << WGM00); // Fast PWM, 비반전
    TCCR0B = (1 << CS01) | (1 << CS00);              // 분주 64 -> 약 976Hz

    uint8_t duty = 0;
    int8_t step = 5;
    while (1) {
        OCR0A = duty;
        duty += step;
        if (duty == 0 || duty == 255) step = -step;
        _delay_ms(20);
    }
}
`,
  },
  {
    id: 'adc', name: 'ADC 가변저항 + UART 출력', device: 'atmega328p',
    desc: 'ADC0 가변저항 값과 LM35 온도를 가상 터미널로 출력 (printf)',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega328p', 600, 600);
      const pc0 = b.mpin(m, 'PC0');
      const pot = b.add('pot', pc0[0] + 140, pc0[1] - 60, { value: '10k', pos: '40' }, { });
      b.link(pc0, b.pin(pot, 'W'), 'h');
      b.vcc(b.pin(pot, '1'), 10);
      b.gnd(b.pin(pot, '2'), 10);
      const pc1 = b.mpin(m, 'PC1');
      const lm = b.add('lm35', pc1[0] + 300, pc1[1] + 60, { temp: '25' });
      b.link(pc1, b.pin(lm, 'OUT'), 'h');
      b.vcc(b.pin(lm, 'VS'), 10);
      b.gnd(b.pin(lm, 'GND'), 10);
      const txd = b.mpin(m, 'PD1');
      const rxd = b.mpin(m, 'PD0');
      const vt = b.add('terminal', 1300, 700, { baud: '9600' });
      b.linkX(txd, b.pin(vt, 'RXD'), 800);
      b.linkX(rxd, b.pin(vt, 'TXD'), 780);
      const vm = b.add('voltmeter', pc0[0] + 250, pc0[1] - 140);
      b.link(b.pin(pot, 'W'), b.pin(vm, '+'), 'h');
      b.gnd(b.pin(vm, '-'), 10);
      return b.done();
    },
    code: `/*
 * ADC + UART 출력 - ATmega328P @ 16MHz, 9600bps
 * ADC0 : 가변저항 (시뮬레이션 중 ▲▼ 또는 마우스 휠로 조절)
 * ADC1 : LM35 온도센서 (10mV/°C)
 */
#include <avr/io.h>
#include <stdio.h>
#include <util/delay.h>

#define BAUD 9600
#define UBRR_VAL ((F_CPU / 16 / BAUD) - 1)

static int uart_putchar(char c, FILE *stream)
{
    if (c == '\\n') uart_putchar('\\r', stream);
    while (!(UCSR0A & (1 << UDRE0)));
    UDR0 = c;
    return 0;
}
static FILE uart_out = FDEV_SETUP_STREAM(uart_putchar, NULL, _FDEV_SETUP_WRITE);

static uint16_t adc_read(uint8_t ch)
{
    ADMUX = (1 << REFS0) | (ch & 0x0F);   // AVCC 기준전압
    ADCSRA |= (1 << ADSC);
    while (ADCSRA & (1 << ADSC));
    return ADC;
}

int main(void)
{
    UBRR0 = UBRR_VAL;
    UCSR0B = (1 << TXEN0) | (1 << RXEN0);
    UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);
    stdout = &uart_out;

    ADCSRA = (1 << ADEN) | (1 << ADPS2) | (1 << ADPS1) | (1 << ADPS0); // 분주 128

    printf("ATmega328P ADC demo\\n");
    while (1) {
        uint16_t pot = adc_read(0);
        uint16_t tmp = adc_read(1);
        uint16_t mv = (uint32_t)pot * 5000 / 1024;
        uint16_t temp10 = (uint32_t)tmp * 5000 / 1024;   // mV = 0.1 도 단위
        printf("POT=%4u (%u.%03uV)  TEMP=%u.%u C\\n", pot, mv / 1000, mv % 1000, temp10 / 10, temp10 % 10);
        _delay_ms(300);
    }
}
`,
  },
  {
    id: 'lcd', name: 'LCD 16x2 (4비트 모드)', device: 'atmega328p',
    desc: 'HD44780 LCD에 문자열과 카운터 표시, 사용자 정의 문자(CGRAM)',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega328p', 500, 650);
      const lcd = b.add('lcd', 1180, 520, { size: '16x2', color: 'green' });
      const map = { RS: 'PD2', E: 'PD3', D4: 'PD4', D5: 'PD5', D6: 'PD6', D7: 'PD7' };
      for (const [lp, mp] of Object.entries(map)) {
        b.label(b.mpin(m, mp), 'LCD_' + lp, 'R', 30);
        b.label(b.pin(lcd, lp), 'LCD_' + lp, 'D', 30);
      }
      const vss = b.pin(lcd, 'VSS');
      b.gnd(vss, 40);
      const rw = b.pin(lcd, 'RW');
      b.wire(rw, [rw[0], rw[1] + 40]);
      b.gnd([rw[0], rw[1] + 40]);
      const vdd = b.pin(lcd, 'VDD');
      b.wire(vdd, [vdd[0], vdd[1] + 30]);
      b.power('vcc', [vdd[0], vdd[1] + 30], 2);
      const v0 = b.pin(lcd, 'V0');
      b.gnd([v0[0], v0[1] + 40]);
      b.wire(v0, [v0[0], v0[1] + 40]);
      const a = b.pin(lcd, 'A'), k = b.pin(lcd, 'K');
      const rbl = b.add('resistor', a[0], a[1] + 60, { value: '100' });
      b.wire(a, b.pin(rbl, '1'));
      b.add('vcc', b.pin(rbl, '2')[0], b.pin(rbl, '2')[1], {}, { rot: 2 });
      b.wire(k, [k[0], k[1] + 40]);
      b.gnd([k[0], k[1] + 40]);
      return b.done();
    },
    code: `/*
 * HD44780 LCD 16x2 - 4비트 모드
 * RS=PD2, E=PD3, D4~D7=PD4~PD7, RW=GND
 */
#include <avr/io.h>
#include <util/delay.h>
#include <stdio.h>

#define LCD_PORT PORTD
#define LCD_DDR  DDRD
#define LCD_RS   PD2
#define LCD_E    PD3

static void lcd_pulse(void)
{
    LCD_PORT |= (1 << LCD_E);
    _delay_us(1);
    LCD_PORT &= ~(1 << LCD_E);
    _delay_us(50);
}

static void lcd_nibble(uint8_t n)
{
    LCD_PORT = (LCD_PORT & 0x0F) | (n << 4);
    lcd_pulse();
}

static void lcd_cmd(uint8_t c)
{
    LCD_PORT &= ~(1 << LCD_RS);
    lcd_nibble(c >> 4);
    lcd_nibble(c & 0x0F);
    if (c < 4) _delay_ms(2);
}

static void lcd_data(uint8_t d)
{
    LCD_PORT |= (1 << LCD_RS);
    lcd_nibble(d >> 4);
    lcd_nibble(d & 0x0F);
}

static void lcd_goto(uint8_t col, uint8_t row)
{
    lcd_cmd(0x80 | (col + (row ? 0x40 : 0x00)));
}

static void lcd_puts(const char *s)
{
    while (*s) lcd_data(*s++);
}

static void lcd_init(void)
{
    LCD_DDR |= 0xFC;
    _delay_ms(20);
    LCD_PORT &= ~(1 << LCD_RS);
    lcd_nibble(0x03); _delay_ms(5);
    lcd_nibble(0x03); _delay_us(150);
    lcd_nibble(0x03);
    lcd_nibble(0x02);          // 4비트 모드
    lcd_cmd(0x28);             // 2줄, 5x8
    lcd_cmd(0x0C);             // 화면 ON, 커서 OFF
    lcd_cmd(0x06);             // 오른쪽으로 이동
    lcd_cmd(0x01);             // 화면 지우기
}

/* 사용자 정의 문자: 하트 */
static const uint8_t heart[8] = {0x00, 0x0A, 0x1F, 0x1F, 0x0E, 0x04, 0x00, 0x00};

int main(void)
{
    char buf[17];
    uint16_t count = 0;

    lcd_init();
    lcd_cmd(0x40);             // CGRAM 주소 0
    for (uint8_t i = 0; i < 8; i++) lcd_data(heart[i]);

    lcd_goto(0, 0);
    lcd_puts("samMegaSim ");
    lcd_data(0);               // 하트 문자

    while (1) {
        sprintf(buf, "Count: %5u", count++);
        lcd_goto(0, 1);
        lcd_puts(buf);
        _delay_ms(200);
    }
}
`,
  },
  {
    id: 'seg7', name: '7세그먼트 카운터', device: 'atmega328p',
    desc: '공통 캐소드 7세그먼트에 0~9 카운트 (PORTD = a~g)',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega328p', 500, 600);
      const seg = b.add('seg7', 1150, 560, { common: 'cathode', color: 'red' });
      const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
      segs.forEach((s, i) => {
        const from = b.mpin(m, 'PD' + i);
        const R = b.add('resistor', from[0] + 110, from[1], { value: '220' }, { rot: 1 });
        b.wire(from, b.pin(R, '2'));
        b.label(b.pin(R, '1'), 'SEG_' + s, 'R', 20);
        b.label(b.pin(seg, s), 'SEG_' + s, 'L', 20);
      });
      const com = b.pin(seg, 'COM');
      b.wire(com, [com[0] + 20, com[1]]);
      b.gnd([com[0] + 20, com[1]], 20);
      return b.done();
    },
    code: `/*
 * 7세그먼트 카운터 (공통 캐소드)
 * PD0~PD6 = a~g, PD7 = dp
 */
#include <avr/io.h>
#include <util/delay.h>

static const uint8_t font[10] = {
    0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F
};

int main(void)
{
    DDRD = 0xFF;
    uint8_t n = 0;
    while (1) {
        PORTD = font[n] | ((n & 1) ? 0x80 : 0);   // 홀수일 때 점(dp) 표시
        n = (n + 1) % 10;
        _delay_ms(500);
    }
}
`,
  },
  {
    id: 'm128', name: 'ATmega128 LED 시프트 + UART 에코', device: 'atmega128',
    desc: 'ATmega128 PORTA 8개 LED 좌우 이동, USART0 수신 문자를 대문자로 에코',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega128', 700, 750);
      for (let i = 0; i < 8; i++) {
        const from = b.mpin(m, 'PA' + i);
        const R = b.add('resistor', from[0] - 70, from[1], { value: '330' }, { rot: 1 });
        b.wire(from, b.pin(R, '1'));
        const L = b.add('led', b.pin(R, '2')[0] - 40, from[1], { color: i < 4 ? 'red' : 'yellow' }, { rot: 2 });
        b.wire(b.pin(R, '2'), b.pin(L, 'A'));
        const k = b.pin(L, 'K');
        b.wire(k, [k[0] - 20, k[1]]);
        b.power('gnd', [k[0] - 20, k[1]], 1);
      }
      const vt = b.add('terminal', 1350, 500, { baud: '9600' });
      const txd = b.mpin(m, 'PE1'), rxd = b.mpin(m, 'PE0');
      b.label(txd, 'TXD0', 'L', 30);
      b.label(rxd, 'RXD0', 'L', 30);
      b.label(b.pin(vt, 'RXD'), 'TXD0', 'L', 30);
      b.label(b.pin(vt, 'TXD'), 'RXD0', 'L', 60);
      return b.done();
    },
    code: `/*
 * ATmega128 - PORTA LED 시프트 + USART0 에코 (16MHz, 9600bps)
 * 터미널 창에 문자를 입력하면 대문자로 되돌려 보냅니다.
 */
#include <avr/io.h>
#include <avr/interrupt.h>
#include <util/delay.h>

volatile uint8_t rx_char, rx_flag;

ISR(USART0_RX_vect)
{
    rx_char = UDR0;
    rx_flag = 1;
}

static void uart_tx(uint8_t c)
{
    while (!(UCSR0A & (1 << UDRE0)));
    UDR0 = c;
}

static void uart_puts(const char *s)
{
    while (*s) uart_tx(*s++);
}

int main(void)
{
    DDRA = 0xFF;
    UBRR0H = 0;
    UBRR0L = 103;                                   // 9600bps @ 16MHz
    UCSR0B = (1 << RXEN0) | (1 << TXEN0) | (1 << RXCIE0);
    UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);
    sei();

    uart_puts("ATmega128 ready. Type something!\\r\\n");

    uint8_t pos = 0;
    int8_t dir = 1;
    while (1) {
        PORTA = (1 << pos);
        pos += dir;
        if (pos == 7 || pos == 0) dir = -dir;
        if (rx_flag) {
            rx_flag = 0;
            uint8_t c = rx_char;
            if (c >= 'a' && c <= 'z') c -= 32;
            uart_tx(c);
            if (c == '\\r') uart_tx('\\n');
        }
        _delay_ms(100);
    }
}
`,
  },
  {
    id: 'servo', name: '서보 모터 (Timer1 PWM)', device: 'atmega328p',
    desc: 'Timer1 50Hz PWM(OC1A=PB1)으로 서보 각도 제어, 가변저항으로 각도 설정',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega328p', 500, 600);
      const pb1 = b.mpin(m, 'PB1');
      const sv = b.add('servo', pb1[0] + 200, pb1[1] + 10);
      b.link(pb1, b.pin(sv, 'SIG'), 'h');
      const vp = b.pin(sv, 'V+'), gp = b.pin(sv, 'GND');
      b.wire(vp, [vp[0] - 20, vp[1]]);
      b.power('vcc', [vp[0] - 20, vp[1]], 3);
      b.wire(gp, [gp[0] - 20, gp[1]], [gp[0] - 20, gp[1] + 20]);
      b.gnd([gp[0] - 20, gp[1] + 20]);
      const pc0 = b.mpin(m, 'PC0');
      const pot = b.add('pot', pc0[0] + 140, pc0[1] - 60, { value: '10k', pos: '50' });
      b.link(pc0, b.pin(pot, 'W'), 'h');
      b.vcc(b.pin(pot, '1'), 10);
      b.gnd(b.pin(pot, '2'), 10);
      const osc = b.add('scope', pb1[0] + 380, pb1[1] - 150);
      b.linkX(pb1, b.pin(osc, 'A'), pb1[0] + 60);
      return b.done();
    },
    code: `/*
 * 서보 모터 제어 - Timer1 Fast PWM (ICR1 = TOP), 50Hz
 * 펄스폭 1.0ms(0도) ~ 2.0ms(180도), ADC0 가변저항으로 각도 조절
 */
#include <avr/io.h>
#include <util/delay.h>

int main(void)
{
    DDRB |= (1 << PB1);                                  // OC1A
    TCCR1A = (1 << COM1A1) | (1 << WGM11);               // 비반전, 모드 14
    TCCR1B = (1 << WGM13) | (1 << WGM12) | (1 << CS11);  // 분주 8 -> 0.5us
    ICR1 = 39999;                                        // 20ms 주기

    ADMUX = (1 << REFS0);
    ADCSRA = (1 << ADEN) | 7;

    while (1) {
        ADCSRA |= (1 << ADSC);
        while (ADCSRA & (1 << ADSC));
        uint16_t v = ADC;                                // 0 ~ 1023
        OCR1A = 2000 + ((uint32_t)v * 2000) / 1023;      // 1ms ~ 2ms
        _delay_ms(20);
    }
}
`,
  },
  {
    id: 'hc595', name: '74HC595 시프트 레지스터 (SPI)', device: 'atmega328p',
    desc: '하드웨어 SPI로 74HC595를 구동하여 8개 LED 카운트 표시, 로직 분석기로 SPI 파형 확인',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega328p', 450, 600);
      const u = b.add('hc595', 1000, 330);
      b.label(b.mpin(m, 'PB3'), 'MOSI', 'R', 30);
      b.label(b.mpin(m, 'PB5'), 'SCK', 'R', 30);
      b.label(b.mpin(m, 'PB2'), 'LATCH', 'R', 30);
      b.label(b.pin(u, 'DS'), 'MOSI', 'L', 30);
      b.label(b.pin(u, 'SHCP'), 'SCK', 'L', 30);
      b.label(b.pin(u, 'STCP'), 'LATCH', 'L', 30);
      const mr = b.pin(u, 'MR');
      b.wire(mr, [mr[0] - 20, mr[1]]);
      b.power('vcc', [mr[0] - 20, mr[1]], 3);
      const oe = b.pin(u, 'OE');
      b.wire(oe, [oe[0] - 20, oe[1]], [oe[0] - 20, oe[1] + 20]);
      b.gnd([oe[0] - 20, oe[1] + 20]);
      for (let i = 0; i < 8; i++) {
        const q = b.pin(u, 'Q' + i);
        ledRight(b, q, i % 2 ? 'green' : 'red', '330', 30);
      }
      const la = b.add('logic', 1000, 850);
      b.label(b.pin(la, 'D0'), 'SCK', 'L', 30);
      b.label(b.pin(la, 'D1'), 'MOSI', 'L', 30);
      b.label(b.pin(la, 'D2'), 'LATCH', 'L', 30);
      return b.done();
    },
    code: `/*
 * 74HC595 + 하드웨어 SPI (ATmega328P)
 * MOSI(PB3) -> DS, SCK(PB5) -> SHCP, PB2 -> STCP(래치)
 */
#include <avr/io.h>
#include <util/delay.h>

static void spi_init(void)
{
    DDRB |= (1 << PB2) | (1 << PB3) | (1 << PB5);   // SS(래치), MOSI, SCK 출력
    SPCR = (1 << SPE) | (1 << MSTR) | (1 << SPR0);  // 마스터, fosc/16
}

static void hc595_write(uint8_t v)
{
    SPDR = v;
    while (!(SPSR & (1 << SPIF)));
    PORTB |= (1 << PB2);                            // 래치 펄스
    PORTB &= ~(1 << PB2);
}

int main(void)
{
    uint8_t n = 0;
    spi_init();
    while (1) {
        hc595_write(n++);
        _delay_ms(150);
    }
}
`,
  },
  {
    id: 'motor', name: 'DC 모터 PWM (트랜지스터 구동)', device: 'atmega328p',
    desc: 'NPN 트랜지스터와 환류 다이오드로 DC 모터를 PWM 속도 제어, 버튼으로 속도 변경',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega328p', 450, 600);
      const pd6 = b.mpin(m, 'PD6');
      const rb = b.add('resistor', pd6[0] + 90, pd6[1], { value: '1k' }, { rot: 1 });
      b.wire(pd6, b.pin(rb, '2'));
      const q = b.add('npn', b.pin(rb, '1')[0] + 20, pd6[1], { beta: '150' });
      b.wire(b.pin(rb, '1'), b.pin(q, 'B'));
      b.gnd(b.pin(q, 'E'), 20);
      const c = b.pin(q, 'C');
      const mot = b.add('motor', c[0], c[1] - 60, { r: '20', rpm: '300' });
      b.wire(c, b.pin(mot, '-'));
      const d = b.add('diode', c[0] + 60, c[1] - 60, {}, { rot: 3 });
      b.link(b.pin(mot, '-'), b.pin(d, 'A'), 'h');
      const top = b.pin(mot, '+');
      b.link(top, b.pin(d, 'K'), 'h');
      b.add('vcc', top[0], top[1]);
      const pd2 = b.mpin(m, 'PD2');
      const sw = b.add('button', pd2[0] + 90, pd2[1] + 60);
      b.link(pd2, b.pin(sw, '1'), 'v');
      const s2 = b.pin(sw, '2');
      b.wire(s2, [s2[0] + 20, s2[1]]);
      b.gnd([s2[0] + 20, s2[1]], 20);
      const osc = b.add('scope', c[0] + 250, c[1] - 30);
      b.link(c, b.pin(osc, 'A'), 'v');
      return b.done();
    },
    code: `/*
 * DC 모터 속도 제어 - Timer0 Fast PWM (OC0A = PD6)
 * 버튼(PD2)을 누를 때마다 속도 단계 변경: 0% -> 25% -> 50% -> 75% -> 100%
 */
#include <avr/io.h>
#include <util/delay.h>

int main(void)
{
    static const uint8_t level[5] = {0, 64, 128, 192, 255};
    uint8_t idx = 2;

    DDRD |= (1 << PD6);
    PORTD |= (1 << PD2);                                  // 풀업
    TCCR0A = (1 << COM0A1) | (1 << WGM01) | (1 << WGM00);
    TCCR0B = (1 << CS01) | (1 << CS00);
    OCR0A = level[idx];

    while (1) {
        if (!(PIND & (1 << PD2))) {
            _delay_ms(20);
            if (!(PIND & (1 << PD2))) {
                idx = (idx + 1) % 5;
                OCR0A = level[idx];
                while (!(PIND & (1 << PD2)));
            }
        }
    }
}
`,
  },
  {
    id: 'i2clcd', name: 'I2C LCD + DS1307 시계 (TWI)', device: 'atmega328p',
    desc: 'TWI(I2C)로 DS1307 RTC 시간을 읽어 I2C LCD(0x27)에 표시',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega328p', 450, 600);
      const sda = b.mpin(m, 'PC4'), scl = b.mpin(m, 'PC5');
      b.label(sda, 'SDA', 'R', 40);
      b.label(scl, 'SCL', 'R', 30);
      const lcd = b.add('lcd_i2c', 1200, 520, { addr: '0x27', size: '16x2', color: 'blue' });
      b.label(b.pin(lcd, 'SDA'), 'SDA', 'L', 20);
      b.label(b.pin(lcd, 'SCL'), 'SCL', 'L', 40);
      const lg = b.pin(lcd, 'GND'), lv = b.pin(lcd, 'VCC');
      b.wire(lg, [lg[0] - 20, lg[1]]);
      b.add('gnd', lg[0] - 20, lg[1], {}, { rot: 1 });
      b.wire(lv, [lv[0] - 60, lv[1]]);
      b.add('vcc', lv[0] - 60, lv[1], {}, { rot: 3 });
      const rtc = b.add('ds1307', 1150, 780);
      b.label(b.pin(rtc, 'SDA'), 'SDA', 'R', 20);
      b.label(b.pin(rtc, 'SCL'), 'SCL', 'R', 20);
      b.vcc(b.pin(rtc, 'VCC'), 10);
      b.gnd(b.pin(rtc, 'GND'), 10);
      // pull-up resistors
      const r1 = b.add('resistor', 900, 380, { value: '4.7k' });
      const r2 = b.add('resistor', 960, 380, { value: '4.7k' });
      b.vcc(b.pin(r1, '1'), 10); b.vcc(b.pin(r2, '1'), 10);
      b.label(b.pin(r1, '2'), 'SDA', 'D', 20);
      b.label(b.pin(r2, '2'), 'SCL', 'D', 20);
      return b.done();
    },
    code: `/*
 * TWI(I2C): DS1307 RTC -> I2C LCD (PCF8574 백팩, 주소 0x27)
 * SDA = PC4, SCL = PC5, 100kHz
 */
#include <avr/io.h>
#include <util/delay.h>
#include <stdio.h>

#define LCD_ADDR 0x27
#define RTC_ADDR 0x68
#define BL 0x08
#define EN 0x04
#define RS 0x01

static void twi_init(void) { TWSR = 0; TWBR = 72; }   // 100kHz @16MHz
static void twi_start(void) { TWCR = (1<<TWINT)|(1<<TWSTA)|(1<<TWEN); while (!(TWCR & (1<<TWINT))); }
static void twi_stop(void)  { TWCR = (1<<TWINT)|(1<<TWSTO)|(1<<TWEN); }
static void twi_write(uint8_t d) { TWDR = d; TWCR = (1<<TWINT)|(1<<TWEN); while (!(TWCR & (1<<TWINT))); }
static uint8_t twi_read(uint8_t ack)
{
    TWCR = (1<<TWINT)|(1<<TWEN)|(ack ? (1<<TWEA) : 0);
    while (!(TWCR & (1<<TWINT)));
    return TWDR;
}

static void pcf_write(uint8_t v) { twi_start(); twi_write(LCD_ADDR << 1); twi_write(v | BL); twi_stop(); }
static void lcd_nib(uint8_t n, uint8_t rs)
{
    uint8_t v = (n << 4) | rs;
    pcf_write(v | EN);
    pcf_write(v);
}
static void lcd_byte(uint8_t b, uint8_t rs) { lcd_nib(b >> 4, rs); lcd_nib(b & 0x0F, rs); }
static void lcd_cmd(uint8_t c) { lcd_byte(c, 0); if (c < 4) _delay_ms(2); }
static void lcd_puts(const char *s) { while (*s) lcd_byte(*s++, RS); }
static void lcd_init(void)
{
    _delay_ms(50);
    lcd_nib(3, 0); _delay_ms(5); lcd_nib(3, 0); lcd_nib(3, 0); lcd_nib(2, 0);
    lcd_cmd(0x28); lcd_cmd(0x0C); lcd_cmd(0x06); lcd_cmd(0x01);
}

static uint8_t bcd2dec(uint8_t b) { return (b >> 4) * 10 + (b & 0x0F); }

int main(void)
{
    char buf[17];
    uint8_t t[7];

    twi_init();
    lcd_init();
    lcd_cmd(0x80);
    lcd_puts("DS1307 Clock");

    while (1) {
        twi_start(); twi_write(RTC_ADDR << 1); twi_write(0x00);
        twi_start(); twi_write((RTC_ADDR << 1) | 1);
        for (uint8_t i = 0; i < 7; i++) t[i] = twi_read(i < 6);
        twi_stop();

        sprintf(buf, "%02u:%02u:%02u %02u/%02u",
                bcd2dec(t[2] & 0x3F), bcd2dec(t[1]), bcd2dec(t[0] & 0x7F),
                bcd2dec(t[5]), bcd2dec(t[4]));
        lcd_cmd(0xC0);
        lcd_puts(buf);
        _delay_ms(200);
    }
}
`,
  },
];

export async function buildExample(ex) {
  const { parts, wires } = await ex.build();
  return {
    version: 1,
    meta: { title: ex.name, author: 'samMegaSim', sheet: parts.some((p) => p.props.device === 'atmega2560') ? 'A3' : 'A4', rev: '1.0', date: new Date().toISOString().slice(0, 10) },
    parts, wires,
    code: { files: [{ name: 'main.c', content: ex.code }], opt: '-Os' },
  };
}
