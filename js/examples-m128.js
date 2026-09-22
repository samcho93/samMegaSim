// ATmega128 example projects (typical ATmega128 training-kit labs)
import { Builder, devices, mcuWithPower } from './examples.js';

const DEVICE = 'atmega128';

/** 8 pins on the LEFT side of the MCU -> 8x resistor array -> LED bar graph (mirrored, cathodes to GND) */
function barLeft(b, froms, color = 'green', r = '330') {
  const X = froms[0][0], y0 = froms[0][1];
  const rn = b.add('resarray', X - 160, y0 - 50, { value: r }, { mirror: true });
  froms.forEach((f, i) => {
    const to = b.pin(rn, String(i + 1));
    const xi = X - 30 - 10 * i;
    b.wire(f, [xi, f[1]], [xi, to[1]], to);
  });
  const bar = b.add('bargraph', rn.x - 90, rn.y, { color }, { mirror: true });
  for (let i = 0; i < 8; i++) {
    b.wire(b.pin(rn, String(16 - i)), b.pin(bar, 'A' + (i + 1)));
    const k = b.pin(bar, 'K' + (i + 1));
    b.wire(k, [k[0] - 20, k[1]]);
  }
  const k1 = b.pin(bar, 'K1'), k8 = b.pin(bar, 'K8');
  b.wire([k1[0] - 20, k1[1]], [k8[0] - 20, k8[1]], [k8[0] - 20, k8[1] + 40]);
  b.gnd([k8[0] - 20, k8[1] + 40]);
  return { rn, bar };
}

/** Single LED + resistor from a LEFT-side pin */
function ledLeft(b, from, color = 'red', r = '330') {
  const R = b.add('resistor', from[0] - 70, from[1], { value: r }, { rot: 1 });
  b.wire(from, b.pin(R, '1'));
  const L = b.add('led', b.pin(R, '2')[0] - 40, from[1], { color }, { rot: 2 });
  b.wire(b.pin(R, '2'), b.pin(L, 'A'));
  const k = b.pin(L, 'K');
  b.wire(k, [k[0] - 20, k[1]]);
  b.power('gnd', [k[0] - 20, k[1]], 1);
  return { R, L };
}

/** Push button from a RIGHT-side pin to GND */
function buttonRight(b, from, dx = 80) {
  const sw = b.add('button', from[0] + dx, from[1]);
  b.wire(from, b.pin(sw, '1'));
  const s2 = b.pin(sw, '2');
  b.wire(s2, [s2[0] + 20, s2[1]]);
  b.gnd([s2[0] + 20, s2[1]], 20);
  return sw;
}

/** Oscilloscope below-left of a LEFT-side pin wire, channel A tapped at 20 units from the pin */
function scopeLeftBelow(b, from, tdiv) {
  const osc = b.scope(from[0] - 250, from[1] + 120, tdiv);
  osc.mirror = true;
  const a = b.pin(osc, 'A');
  b.wire([from[0] - 20, from[1]], [from[0] - 20, a[1]], a);
  return osc;
}

function pa(b, m) { return Array.from({ length: 8 }, (_, i) => b.mpin(m, 'PA' + i)); }

const UART0_INIT = `static int uart_putchar(char c, FILE *s)
{
    if (c == '\\n') uart_putchar('\\r', s);
    while (!(UCSR0A & (1 << UDRE0)));
    UDR0 = c;
    return 0;
}
static FILE uart_out = FDEV_SETUP_STREAM(uart_putchar, NULL, _FDEV_SETUP_WRITE);

static void uart0_init(void)
{
    UBRR0H = 0;
    UBRR0L = 103;                                   // 9600bps @ 16MHz
    UCSR0B = (1 << TXEN0) | (1 << RXEN0);
    UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);
    stdout = &uart_out;
}`;

export const M128_EXAMPLES = [
  // -------------------------------------------------------------------------
  {
    id: 'm128int', name: 'ATmega128 외부 인터럽트 카운터 (INT4/INT5)', device: DEVICE,
    desc: 'PE4(INT4) 버튼으로 카운트 증가, PE5(INT5) 버튼으로 리셋, PORTA LED에 2진수 표시',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, DEVICE, 1050, 800);
      barLeft(b, pa(b, m), 'red');
      const pe4 = b.mpin(m, 'PE4');
      buttonRight(b, pe4);
      const pe5 = b.mpin(m, 'PE5');
      const sw2 = b.add('button', pe5[0] + 80, pe5[1] + 60);
      b.wire(pe5, [pe5[0] + 40, pe5[1]], [pe5[0] + 40, pe5[1] + 60], b.pin(sw2, '1'));
      const s2 = b.pin(sw2, '2');
      b.wire(s2, [s2[0] + 20, s2[1]]);
      b.gnd([s2[0] + 20, s2[1]], 20);
      return b.done();
    },
    code: `/*
 * ATmega128 외부 인터럽트 카운터
 *  - PE4(INT4) 버튼: 카운트 +1 (하강 에지)
 *  - PE5(INT5) 버튼: 카운트 리셋
 *  - PORTA: 카운트 값을 LED(바 그래프)에 2진수로 표시
 */
#include <avr/io.h>
#include <avr/interrupt.h>

volatile uint8_t count = 0;

ISR(INT4_vect)
{
    count++;
    PORTA = count;
}

ISR(INT5_vect)
{
    count = 0;
    PORTA = 0;
}

int main(void)
{
    DDRA = 0xFF;                                    // LED 출력
    PORTE |= (1 << PE4) | (1 << PE5);               // 내부 풀업

    EICRB = (1 << ISC41) | (1 << ISC51);            // INT4, INT5 하강 에지
    EIMSK = (1 << INT4) | (1 << INT5);
    sei();

    while (1) {
        /* 모든 동작은 인터럽트에서 처리 */
    }
}
`,
  },
  // -------------------------------------------------------------------------
  {
    id: 'm128fnd', name: 'ATmega128 4자리 FND 스톱워치 (Timer0 CTC)', device: DEVICE,
    desc: 'Timer0 비교일치 인터럽트(1ms)로 4자리 FND 다이나믹 구동, PE4 버튼으로 시작/정지',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, DEVICE, 700, 800);
      const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
      const pd0 = b.mpin(m, 'PD0');
      const rn = b.add('resarray', pd0[0] + 170, pd0[1] - 40, { value: '470' });
      segs.forEach((sg, i) => {
        const from = b.mpin(m, 'PD' + i);
        const to = b.pin(rn, String(i + 1));
        b.wire(from, [pd0[0] + 30 + i * 10, from[1]], [pd0[0] + 30 + i * 10, to[1]], to);
      });
      const r16 = b.pin(rn, '16');
      const fnd = b.add('seg7x4', r16[0] + 110, r16[1] + 30, { common: 'cathode', color: 'red' });
      segs.forEach((sg, i) => b.wire(b.pin(rn, String(16 - i)), b.pin(fnd, sg)));
      for (let i = 0; i < 4; i++) {
        b.label(b.pin(fnd, 'D' + (i + 1)), 'DIG' + (i + 1), 'U', 20);
        b.label(b.mpin(m, 'PG' + i), 'DIG' + (i + 1), 'R', 30);
      }
      buttonRight(b, b.mpin(m, 'PE4'));
      return b.done();
    },
    code: `/*
 * ATmega128 4자리 FND 스톱워치 (공통 캐소드)
 *  - PORTD : 세그먼트 a~g, dp
 *  - PG0~PG3 : 자리 선택 (LOW = 해당 자리 ON)
 *  - Timer0 CTC 1ms 인터럽트에서 한 자리씩 순서대로 표시 (다이나믹 구동)
 *  - PE4(INT4) 버튼 : 시작 / 정지
 *  표시 형식: 초.1/100초 (SS.hh)
 */
#include <avr/io.h>
#include <avr/interrupt.h>

static const uint8_t font[10] = {
    0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F
};

volatile uint16_t time10ms = 0;     // 0 ~ 9999 (단위 10ms)
volatile uint8_t running = 1;

ISR(TIMER0_COMP_vect)               // 1ms 마다
{
    static uint8_t digit = 0, sub = 0;
    uint16_t v = time10ms;
    uint8_t d[4];
    d[0] = v / 1000 % 10;
    d[1] = v / 100 % 10;
    d[2] = v / 10 % 10;
    d[3] = v % 10;

    PORTG |= 0x0F;                                  // 모든 자리 OFF
    PORTD = font[d[digit]] | (digit == 1 ? 0x80 : 0); // 2번째 자리 뒤에 점
    PORTG &= ~(1 << digit);                         // 현재 자리 ON
    digit = (digit + 1) & 3;

    if (running && ++sub >= 10) {
        sub = 0;
        if (++time10ms >= 10000) time10ms = 0;
    }
}

ISR(INT4_vect)
{
    running = !running;
}

int main(void)
{
    DDRD = 0xFF;
    DDRG = 0x0F;
    PORTG = 0x0F;
    PORTE |= (1 << PE4);                            // 버튼 풀업

    TCCR0 = (1 << WGM01) | (1 << CS02);             // CTC, 분주 64 (ATmega128 Timer0)
    OCR0 = 249;                                     // 16MHz / 64 / 250 = 1kHz
    TIMSK = (1 << OCIE0);

    EICRB = (1 << ISC41);                           // INT4 하강 에지
    EIMSK = (1 << INT4);
    sei();

    while (1) {
    }
}
`,
  },
  // -------------------------------------------------------------------------
  {
    id: 'm128lcd', name: 'ATmega128 ADC + LCD (가변저항 / LM35)', device: DEVICE,
    desc: 'ADC0 가변저항 전압과 ADC1 LM35 온도를 16x2 LCD에 표시 (PORTD 4비트 모드)',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, DEVICE, 700, 820);
      const pd0 = b.mpin(m, 'PD0');
      const lcd = b.add('lcd', pd0[0] + 260, pd0[1] - 130, { size: '16x2', color: 'green' });
      for (const [mp, lp] of [['PD0', 'RS'], ['PD1', 'E'], ['PD4', 'D4'], ['PD5', 'D5'], ['PD6', 'D6'], ['PD7', 'D7']]) {
        b.link(b.mpin(m, mp), b.pin(lcd, lp), 'h');
      }
      b.gnd(b.pin(lcd, 'VSS'), 10);
      const vdd = b.pin(lcd, 'VDD');
      b.wire(vdd, [vdd[0], vdd[1] + 30]);
      b.power('vcc', [vdd[0], vdd[1] + 30], 2);
      b.gnd(b.pin(lcd, 'V0'), 50);
      b.gnd(b.pin(lcd, 'RW'), 10);
      const a = b.pin(lcd, 'A'), k = b.pin(lcd, 'K');
      const rbl = b.add('resistor', a[0], a[1] + 30, { value: '100' });
      b.power('vcc', b.pin(rbl, '2'), 2);
      b.gnd(k, 70);
      const pf0 = b.mpin(m, 'PF0');
      const pot = b.add('pot', pf0[0] + 140, pf0[1] - 60, { value: '10k', pos: '60' });
      b.link(pf0, b.pin(pot, 'W'), 'h');
      b.vcc(b.pin(pot, '1'), 10);
      b.gnd(b.pin(pot, '2'), 10);
      const pf1 = b.mpin(m, 'PF1');
      const lm = b.add('lm35', pf1[0] + 300, pf1[1] + 60, { temp: '23' });
      b.link(pf1, b.pin(lm, 'OUT'), 'h');
      b.vcc(b.pin(lm, 'VS'), 10);
      b.gnd(b.pin(lm, 'GND'), 10);
      return b.done();
    },
    code: `/*
 * ATmega128 ADC + 문자 LCD
 *  LCD : RS=PD0, E=PD1, D4~D7=PD4~PD7, RW=GND (4비트 모드)
 *  ADC0(PF0) : 가변저항 → 전압 표시
 *  ADC1(PF1) : LM35 (10mV/°C) → 온도 표시
 *  시뮬레이션 중 가변저항/LM35의 ▲▼ 또는 마우스 휠로 값을 바꿔 보세요.
 */
#include <avr/io.h>
#include <util/delay.h>
#include <stdio.h>

#define LCD_RS PD0
#define LCD_E  PD1

static void lcd_nibble(uint8_t n)
{
    PORTD = (PORTD & 0x0F) | (n << 4);
    PORTD |= (1 << LCD_E);
    _delay_us(1);
    PORTD &= ~(1 << LCD_E);
    _delay_us(50);
}

static void lcd_write(uint8_t v, uint8_t rs)
{
    if (rs) PORTD |= (1 << LCD_RS); else PORTD &= ~(1 << LCD_RS);
    lcd_nibble(v >> 4);
    lcd_nibble(v & 0x0F);
    if (!rs && v < 4) _delay_ms(2);
}

static void lcd_init(void)
{
    DDRD = 0xF3;
    _delay_ms(20);
    PORTD &= ~(1 << LCD_RS);
    lcd_nibble(3); _delay_ms(5);
    lcd_nibble(3); _delay_us(150);
    lcd_nibble(3);
    lcd_nibble(2);
    lcd_write(0x28, 0);     // 4비트, 2줄
    lcd_write(0x0C, 0);     // 표시 ON
    lcd_write(0x06, 0);
    lcd_write(0x01, 0);     // 지우기
}

static void lcd_print(uint8_t row, const char *s)
{
    lcd_write(0x80 | (row ? 0x40 : 0), 0);
    while (*s) lcd_write(*s++, 1);
}

static uint16_t adc_read(uint8_t ch)
{
    ADMUX = (1 << REFS0) | (ch & 0x07);             // AVCC 기준
    ADCSRA |= (1 << ADSC);
    while (ADCSRA & (1 << ADSC));
    return ADC;
}

int main(void)
{
    char buf[17];
    lcd_init();
    ADCSRA = (1 << ADEN) | 7;                       // 분주 128

    while (1) {
        uint16_t pot = adc_read(0);
        uint16_t mv = (uint32_t)pot * 5000 / 1024;
        sprintf(buf, "ADC0 %4u %u.%02uV", pot, mv / 1000, (mv % 1000) / 10);
        lcd_print(0, buf);

        uint16_t t = (uint32_t)adc_read(1) * 5000 / 1024;   // mV → 0.1도
        sprintf(buf, "TEMP  %2u.%u C   ", t / 10, t % 10);
        lcd_print(1, buf);
        _delay_ms(200);
    }
}
`,
  },
  // -------------------------------------------------------------------------
  {
    id: 'm128pwm', name: 'ATmega128 PWM 밝기 + LED 레벨미터 (ADC 자유 실행)', device: DEVICE,
    desc: 'ADC 자유 실행 모드로 가변저항을 읽어 Timer0 PWM(OC0=PB4) 밝기와 PORTA 레벨미터로 표시',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, DEVICE, 1050, 800);
      barLeft(b, pa(b, m), 'green');
      const pb4 = b.mpin(m, 'PB4');
      ledLeft(b, pb4, 'blue', '220');
      scopeLeftBelow(b, pb4, 0.001);
      const pf0 = b.mpin(m, 'PF0');
      const pot = b.add('pot', pf0[0] + 140, pf0[1] - 60, { value: '10k', pos: '50' });
      b.link(pf0, b.pin(pot, 'W'), 'h');
      b.vcc(b.pin(pot, '1'), 10);
      b.gnd(b.pin(pot, '2'), 10);
      const vm = b.add('voltmeter', pf0[0] + 250, pf0[1] - 140);
      b.link(b.pin(pot, 'W'), b.pin(vm, '+'), 'h');
      b.gnd(b.pin(vm, '-'), 10);
      return b.done();
    },
    code: `/*
 * ATmega128 PWM 밝기 제어 + 레벨미터
 *  - ADC0(PF0) 가변저항 : ADC 자유 실행 모드 (ADFR), 왼쪽 정렬(ADLAR)
 *  - Timer0 Fast PWM, OC0(PB4) : LED 밝기 = ADC 값
 *  - PORTA : 8단 레벨미터
 */
#include <avr/io.h>

int main(void)
{
    DDRA = 0xFF;
    DDRB |= (1 << PB4);                                         // OC0

    TCCR0 = (1 << WGM01) | (1 << WGM00) | (1 << COM01) | (1 << CS02); // Fast PWM, 분주 64

    ADMUX = (1 << REFS0) | (1 << ADLAR);                        // AVCC, ADC0, 왼쪽 정렬
    ADCSRA = (1 << ADEN) | (1 << ADFR) | (1 << ADSC) | 7;       // 자유 실행 시작

    while (1) {
        uint8_t v = ADCH;                                       // 상위 8비트
        OCR0 = v;
        uint8_t n = (v + 16) / 32;                              // 0 ~ 8
        PORTA = (n >= 8) ? 0xFF : (uint8_t)((1 << n) - 1);
    }
}
`,
  },
  // -------------------------------------------------------------------------
  {
    id: 'm128buzz', name: 'ATmega128 부저 멜로디 (Timer1 CTC)', device: DEVICE,
    desc: 'Timer1 CTC 토글 출력(OC1A=PB5)으로 수동 부저에 "학교종" 연주, 음 이름을 터미널에 출력 (🔊 소리 켜기)',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, DEVICE, 1050, 800);
      const pb5 = b.mpin(m, 'PB5');
      const bz = b.add('buzzer', pb5[0] - 100, pb5[1] + 10, { kind: 'passive' }, { mirror: true });
      b.wire(pb5, b.pin(bz, '+'));
      const minus = b.pin(bz, '-');
      b.wire(minus, [minus[0] + 20, minus[1]], [minus[0] + 20, minus[1] + 20]);
      b.gnd([minus[0] + 20, minus[1] + 20]);
      scopeLeftBelow(b, pb5, 0.002);
      const pe1 = b.mpin(m, 'PE1');
      const vt = b.add('terminal', pe1[0] + 200, pe1[1] + 20, { baud: '9600' });
      b.wire(pe1, b.pin(vt, 'RXD'));
      return b.done();
    },
    code: `/*
 * ATmega128 부저 멜로디 - "학교종이 땡땡땡"
 *  Timer1 CTC 모드, OC1A(PB5) 토글 출력 → 수동(passive) 부저
 *  주파수 f = F_CPU / (2 * 8 * (OCR1A + 1))
 *  음 이름을 USART0(9600bps) 가상 터미널에 출력합니다.
 *  오른쪽 패널의 🔊 버튼으로 소리를 켜고 끌 수 있습니다.
 */
#include <avr/io.h>
#include <util/delay.h>
#include <stdio.h>

${UART0_INIT}

#define DO  262
#define RE  294
#define MI  330
#define SOL 392
#define LA  440

static const uint16_t melody[] = {
    SOL, SOL, LA, LA, SOL, SOL, MI, 0,
    SOL, SOL, MI, MI, RE, 0,
    SOL, SOL, LA, LA, SOL, SOL, MI, 0,
    SOL, MI, RE, MI, DO, 0
};

static const char *name(uint16_t f)
{
    switch (f) {
    case DO: return "도";
    case RE: return "레";
    case MI: return "미";
    case SOL: return "솔";
    case LA: return "라";
    default: return "(쉼)";
    }
}

static void tone(uint16_t f)
{
    if (f == 0) {                                   // 소리 끔
        TCCR1A = 0;
        PORTB &= ~(1 << PB5);
        return;
    }
    OCR1A = F_CPU / 8 / 2 / f - 1;
    TCNT1 = 0;
    TCCR1A = (1 << COM1A0);                         // 비교일치 시 OC1A 토글
}

static void wait_ms(uint16_t ms)
{
    while (ms--) _delay_ms(1);
}

int main(void)
{
    DDRB |= (1 << PB5);
    TCCR1B = (1 << WGM12) | (1 << CS11);            // CTC(OCR1A), 분주 8
    uart0_init();

    while (1) {
        printf("\\n학교종이 땡땡땡: ");
        for (uint8_t i = 0; i < sizeof(melody) / sizeof(melody[0]); i++) {
            uint16_t f = melody[i];
            printf("%s ", name(f));
            tone(f);
            wait_ms(f ? 350 : 300);
            tone(0);
            wait_ms(50);
        }
        wait_ms(800);
    }
}
`,
  },
  // -------------------------------------------------------------------------
  {
    id: 'm128key', name: 'ATmega128 4x4 키패드 스캔', device: DEVICE,
    desc: '키패드(PORTD: 행 PD0~3 출력, 열 PD4~7 입력)를 스캔해 누른 키를 터미널과 PORTA LED로 표시',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, DEVICE, 1050, 800);
      barLeft(b, pa(b, m), 'yellow');
      const pd0 = b.mpin(m, 'PD0');
      const kp = b.add('keypad', pd0[0] + 170, pd0[1] - 120);
      const map = ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'];
      map.forEach((kpPin, i) => b.link(b.mpin(m, 'PD' + i), b.pin(kp, kpPin), 'h'));
      const vt = b.add('terminal', 1550, 1000, { baud: '9600' });
      b.label(b.mpin(m, 'PE1'), 'TXD0', 'R', 40);
      b.label(b.mpin(m, 'PE0'), 'RXD0', 'R', 110);
      b.label(b.pin(vt, 'RXD'), 'TXD0', 'L', 30);
      b.label(b.pin(vt, 'TXD'), 'RXD0', 'L', 60);
      return b.done();
    },
    code: `/*
 * ATmega128 4x4 키패드 스캔
 *  행(R1~R4) = PD0~PD3 (출력, 한 행씩 LOW)
 *  열(C1~C4) = PD4~PD7 (입력, 내부 풀업)
 *  누른 키를 USART0 터미널로 출력하고, PORTA LED에 키 번호(1~16)를 2진수로 표시
 *  시뮬레이션 중 키패드의 키를 마우스로 누르세요.
 */
#include <avr/io.h>
#include <util/delay.h>
#include <stdio.h>

${UART0_INIT}

static const char keymap[16] = {
    '1', '2', '3', 'A',
    '4', '5', '6', 'B',
    '7', '8', '9', 'C',
    '*', '0', '#', 'D'
};

static int8_t key_scan(void)
{
    for (uint8_t r = 0; r < 4; r++) {
        PORTD = 0xFF & ~(1 << r);                   // r번째 행만 LOW, 열 풀업 유지
        _delay_us(5);
        uint8_t cols = PIND >> 4;
        for (uint8_t c = 0; c < 4; c++) {
            if (!(cols & (1 << c))) return r * 4 + c;
        }
    }
    return -1;
}

int main(void)
{
    int8_t last = -1;
    DDRA = 0xFF;
    DDRD = 0x0F;                                    // 행 출력, 열 입력
    PORTD = 0xFF;
    uart0_init();
    printf("Keypad ready. Press a key...\\n");

    while (1) {
        int8_t k = key_scan();
        if (k >= 0 && k != last) {
            printf("Key: %c\\n", keymap[k]);
            PORTA = k + 1;
        }
        last = k;
        _delay_ms(20);
    }
}
`,
  },
  // -------------------------------------------------------------------------
  {
    id: 'm128servo', name: 'ATmega128 서보 제어 (Timer3 PWM)', device: DEVICE,
    desc: 'Timer3 Fast PWM(OC3A=PE3) 50Hz로 서보 각도 제어, ADC0 가변저항으로 각도 설정',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, DEVICE, 900, 800);
      const pe3 = b.mpin(m, 'PE3');
      const sv = b.add('servo', pe3[0] + 200, pe3[1] + 10);
      b.link(pe3, b.pin(sv, 'SIG'), 'h');
      const vp = b.pin(sv, 'V+'), gp = b.pin(sv, 'GND');
      b.wire(vp, [vp[0] - 20, vp[1]]);
      b.power('vcc', [vp[0] - 20, vp[1]], 3);
      b.wire(gp, [gp[0] - 20, gp[1]], [gp[0] - 20, gp[1] + 20]);
      b.gnd([gp[0] - 20, gp[1] + 20]);
      const osc = b.scope(pe3[0] + 420, pe3[1] - 150, 0.005);
      const a = b.pin(osc, 'A');
      b.wire([pe3[0] + 60, pe3[1]], [pe3[0] + 60, a[1]], a);
      const pf0 = b.mpin(m, 'PF0');
      const pot = b.add('pot', pf0[0] + 300, pf0[1] - 90, { value: '10k', pos: '50' });
      b.link(pf0, b.pin(pot, 'W'), 'h');
      b.vcc(b.pin(pot, '1'), 10);
      b.gnd(b.pin(pot, '2'), 10);
      return b.done();
    },
    code: `/*
 * ATmega128 서보 모터 - Timer3 Fast PWM (모드 14, TOP = ICR3)
 *  OC3A = PE3, 주기 20ms(50Hz), 펄스폭 1.0ms(0도) ~ 2.0ms(180도)
 *  ADC0(PF0) 가변저항으로 각도 설정
 */
#include <avr/io.h>
#include <util/delay.h>

int main(void)
{
    DDRE |= (1 << PE3);                                     // OC3A
    TCCR3A = (1 << COM3A1) | (1 << WGM31);
    TCCR3B = (1 << WGM33) | (1 << WGM32) | (1 << CS31);     // 분주 8 → 0.5us
    ICR3 = 39999;                                           // 20ms

    ADMUX = (1 << REFS0);                                   // ADC0
    ADCSRA = (1 << ADEN) | 7;

    while (1) {
        ADCSRA |= (1 << ADSC);
        while (ADCSRA & (1 << ADSC));
        OCR3A = 2000 + ((uint32_t)ADC * 2000) / 1023;       // 1ms ~ 2ms
        _delay_ms(20);
    }
}
`,
  },
  // -------------------------------------------------------------------------
  {
    id: 'm128cmd', name: 'ATmega128 UART 명령으로 LED 제어 (USART1)', device: DEVICE,
    desc: 'USART1(PD2/PD3) 터미널에서 0~7(토글), a(전체 ON), c(전체 OFF), s(상태) 명령으로 PORTA LED 제어',
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, DEVICE, 1050, 800);
      barLeft(b, pa(b, m), 'red');
      const vt = b.add('terminal', 1600, 500, { baud: '9600' });
      b.label(b.mpin(m, 'PD3'), 'TXD1', 'R', 40);
      b.label(b.mpin(m, 'PD2'), 'RXD1', 'R', 110);
      b.label(b.pin(vt, 'RXD'), 'TXD1', 'L', 30);
      b.label(b.pin(vt, 'TXD'), 'RXD1', 'L', 60);
      return b.done();
    },
    code: `/*
 * ATmega128 USART1 명령 처리 (9600bps)
 *  터미널 입력 명령
 *   0~7 : 해당 LED 토글
 *   a   : 전체 ON
 *   c   : 전체 OFF
 *   s   : 현재 상태 출력
 */
#include <avr/io.h>
#include <avr/interrupt.h>
#include <stdio.h>

static int uart1_putchar(char c, FILE *s)
{
    if (c == '\\n') uart1_putchar('\\r', s);
    while (!(UCSR1A & (1 << UDRE1)));
    UDR1 = c;
    return 0;
}
static FILE out1 = FDEV_SETUP_STREAM(uart1_putchar, NULL, _FDEV_SETUP_WRITE);

volatile uint8_t rx_buf[16], rx_head, rx_tail;

ISR(USART1_RX_vect)
{
    rx_buf[rx_head] = UDR1;
    rx_head = (rx_head + 1) & 15;
}

static void show(void)
{
    printf("LED = ");
    for (int8_t i = 7; i >= 0; i--) putchar(PORTA & (1 << i) ? '1' : '0');
    printf(" (0x%02X)\\n", PORTA);
}

int main(void)
{
    DDRA = 0xFF;
    UBRR1H = 0;
    UBRR1L = 103;
    UCSR1B = (1 << RXEN1) | (1 << TXEN1) | (1 << RXCIE1);
    UCSR1C = (1 << UCSZ11) | (1 << UCSZ10);
    stdout = &out1;
    sei();

    printf("ATmega128 USART1 LED control\\n");
    printf("commands: 0-7 toggle, a all on, c clear, s status\\n");

    while (1) {
        if (rx_tail == rx_head) continue;
        uint8_t c = rx_buf[rx_tail];
        rx_tail = (rx_tail + 1) & 15;
        if (c >= '0' && c <= '7') { PORTA ^= 1 << (c - '0'); show(); }
        else if (c == 'a') { PORTA = 0xFF; show(); }
        else if (c == 'c') { PORTA = 0x00; show(); }
        else if (c == 's') show();
        else if (c != '\\r' && c != '\\n') printf("? unknown command '%c'\\n", c);
    }
}
`,
  },
];
