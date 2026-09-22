// Complex system examples combining several composite devices
import {
  Builder, devices, mcuWithPower, barLeft, ledLeft,
  ledBlock, buttonBlock, buzzerBlock, servoBlock, potBlock, lm35Block, ldrBlock,
  i2cLcdBlock, i2cPullups, terminalBlock, relayMotorBlock,
} from './examples-lib.js';

// ---------------------------------------------------------------------------
// Reusable C snippets
// ---------------------------------------------------------------------------
const TWI_C = `/* ---------- TWI (I2C) 100kHz ---------- */
static void twi_init(void) { TWSR = 0; TWBR = 72; }
static void twi_wait(void) { while (!(TWCR & (1 << TWINT))); }
static uint8_t twi_start(uint8_t sla)          /* START + 주소, ACK면 1 */
{
    TWCR = (1 << TWINT) | (1 << TWSTA) | (1 << TWEN); twi_wait();
    TWDR = sla; TWCR = (1 << TWINT) | (1 << TWEN); twi_wait();
    uint8_t st = TWSR & 0xF8;
    return st == 0x18 || st == 0x40;
}
static void twi_stop(void) { TWCR = (1 << TWINT) | (1 << TWSTO) | (1 << TWEN); }
static void twi_write(uint8_t d) { TWDR = d; TWCR = (1 << TWINT) | (1 << TWEN); twi_wait(); }
static uint8_t twi_read(uint8_t ack)
{
    TWCR = (1 << TWINT) | (1 << TWEN) | (ack ? (1 << TWEA) : 0); twi_wait();
    return TWDR;
}`;

const I2C_LCD_C = `/* ---------- I2C LCD (PCF8574 백팩 0x27: P0=RS P2=E P3=BL P4~7=D4~7) ---------- */
#define LCD_ADDR 0x27
static void pcf_write(uint8_t v) { twi_start(LCD_ADDR << 1); twi_write(v | 0x08); twi_stop(); }
static void lcd_nib(uint8_t n, uint8_t rs) { uint8_t v = (n << 4) | rs; pcf_write(v | 0x04); pcf_write(v); }
static void lcd_byte(uint8_t b, uint8_t rs) { lcd_nib(b >> 4, rs); lcd_nib(b & 0x0F, rs); }
static void lcd_cmd(uint8_t c) { lcd_byte(c, 0); if (c < 4) _delay_ms(2); }
static void lcd_init(void)
{
    _delay_ms(50);
    lcd_nib(3, 0); _delay_ms(5); lcd_nib(3, 0); lcd_nib(3, 0); lcd_nib(2, 0);
    lcd_cmd(0x28); lcd_cmd(0x0C); lcd_cmd(0x06); lcd_cmd(0x01);
}
static void lcd_print(uint8_t row, const char *s)
{
    lcd_cmd(0x80 | (row ? 0x40 : 0));
    while (*s) lcd_byte(*s++, 1);
}`;

const LCD_PORTD_C = `/* ---------- 문자 LCD (PORTD: RS=PD0, E=PD1, D4~D7=PD4~PD7, RW=GND) ---------- */
static void lcd_nibble(uint8_t n)
{
    PORTD = (PORTD & 0x0F) | (n << 4);
    PORTD |= (1 << PD1); _delay_us(1); PORTD &= ~(1 << PD1);
    _delay_us(50);
}
static void lcd_write(uint8_t v, uint8_t rs)
{
    if (rs) PORTD |= (1 << PD0); else PORTD &= ~(1 << PD0);
    lcd_nibble(v >> 4); lcd_nibble(v & 0x0F);
    if (!rs && v < 4) _delay_ms(2);
}
static void lcd_init(void)
{
    DDRD |= 0xF3;
    _delay_ms(20);
    PORTD &= ~(1 << PD0);
    lcd_nibble(3); _delay_ms(5); lcd_nibble(3); _delay_us(150); lcd_nibble(3); lcd_nibble(2);
    lcd_write(0x28, 0); lcd_write(0x0C, 0); lcd_write(0x06, 0); lcd_write(0x01, 0);
}
static void lcd_print(uint8_t row, const char *s)
{
    lcd_write(0x80 | (row ? 0x40 : 0), 0);
    while (*s) lcd_write(*s++, 1);
}`;

const UART0_C = `/* ---------- USART0 9600bps + printf ---------- */
static int uart_putchar(char c, FILE *s)
{
    if (c == '\\n') uart_putchar('\\r', s);
    while (!(UCSR0A & (1 << UDRE0)));
    UDR0 = c;
    return 0;
}
static FILE uart_out = FDEV_SETUP_STREAM(uart_putchar, NULL, _FDEV_SETUP_WRITE);
static void uart0_init(void)
{
    UBRR0H = 0; UBRR0L = 103;
    UCSR0B = (1 << TXEN0) | (1 << RXEN0);
    UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);
    stdout = &uart_out;
}
static int uart0_getc(void) { return (UCSR0A & (1 << RXC0)) ? UDR0 : -1; }`;

const ADC_C = `static uint16_t adc_read(uint8_t ch)
{
    ADMUX = (1 << REFS0) | (ch & 0x07);           /* AVCC 기준 */
    ADCSRA |= (1 << ADSC);
    while (ADCSRA & (1 << ADSC));
    return ADC;
}`;

/** LCD (parallel) above-right of an MCU's PORTD pins: RS=PD0 E=PD1 D4..D7=PD4..PD7 */
function lcdOnPortD(b, m, dx = 260) {
  const pd0 = b.mpin(m, 'PD0');
  const lcd = b.add('lcd', pd0[0] + dx, pd0[1] - 130, { size: '16x2', color: 'green' });
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
  return lcd;
}

/** Label several MCU pins: [[pin, net, dir]] */
function labels(b, m, list) {
  for (const [pin, net, dir = 'R'] of list) b.label(b.mpin(m, pin), net, dir, 30);
}

export const ADV_EXAMPLES = [
  // =========================================================================
  {
    id: 'adv_temp', group: '종합 시스템', name: '[종합] 온도 경보 & 팬 제어 시스템', device: 'atmega128',
    desc: 'LM35 온도를 LCD에 표시하고, 가변저항으로 설정한 온도를 넘으면 릴레이로 팬(DC 모터)을 켜고 부저·경고 LED 동작 (LM35, LCD, 릴레이+모터, 부저)',
    simTime: 2,
    script: [{ t: 0.6, adjust: 'lm35', key: 'temp', value: 35 }],
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega128', 700, 820);
      lcdOnPortD(b, m);
      labels(b, m, [['PF0', 'TEMP'], ['PF1', 'SET'], ['PE3', 'FAN'], ['PE4', 'BUZ']]);
      ledLeft(b, b.mpin(m, 'PB0'), 'green');
      ledLeft(b, b.mpin(m, 'PB2'), 'red');
      lm35Block(b, 1400, 700, 'TEMP', '26');
      potBlock(b, 1620, 700, 'SET', '50');
      buzzerBlock(b, 1400, 900, 'BUZ', 'active');
      relayMotorBlock(b, 1400, 1150, 'FAN');
      return b.done();
    },
    code: `/*
 * [종합] 온도 경보 & 팬 제어 시스템 - ATmega128 @ 16MHz
 *  - ADC0(PF0) : LM35 온도센서 (10mV/°C)
 *  - ADC1(PF1) : 가변저항 → 설정 온도 20.0 ~ 40.0 °C
 *  - LCD(PORTD): 현재/설정 온도, 상태 표시
 *  - PE3 : NPN → 릴레이 → 12V 팬(DC 모터)
 *  - PE4 : 능동 부저 (경보 시 단속음)
 *  - PB0 : 정상(초록) LED, PB2 : 경보(빨강) LED
 *  시뮬레이션 중 LM35의 ▲ 버튼으로 온도를 올려 보세요.
 */
#include <avr/io.h>
#include <util/delay.h>
#include <stdio.h>

${LCD_PORTD_C}

${ADC_C}

int main(void)
{
    char buf[17];
    uint8_t alarm = 0, tick = 0;

    DDRB |= (1 << PB0) | (1 << PB2);
    DDRE |= (1 << PE3) | (1 << PE4);
    lcd_init();
    ADCSRA = (1 << ADEN) | 7;
    lcd_print(0, "Temp Controller");

    while (1) {
        uint16_t t = (uint32_t)adc_read(0) * 5000 / 1024;          /* 0.1 °C 단위 */
        uint16_t set = 200 + (uint32_t)adc_read(1) * 200 / 1023;   /* 20.0 ~ 40.0 °C */

        if (!alarm && t > set) alarm = 1;
        else if (alarm && t + 5 < set) alarm = 0;                  /* 0.5 °C 히스테리시스 */

        if (alarm) {
            PORTE |= (1 << PE3);                                   /* 팬 ON */
            PORTB = (PORTB & ~(1 << PB0)) | (1 << PB2);
            if ((tick / 3) & 1) PORTE |= (1 << PE4); else PORTE &= ~(1 << PE4);
        } else {
            PORTE &= ~((1 << PE3) | (1 << PE4));
            PORTB = (PORTB & ~(1 << PB2)) | (1 << PB0);
        }

        sprintf(buf, "T%2u.%uC  S%2u.%uC ", t / 10, t % 10, set / 10, set % 10);
        lcd_print(0, buf);
        lcd_print(1, alarm ? "FAN ON  !ALARM! " : "FAN OFF  normal ");
        tick++;
        _delay_ms(100);
    }
}
`,
  },
  // =========================================================================
  {
    id: 'adv_lock', group: '종합 시스템', name: '[종합] 디지털 도어락 (키패드 + I2C LCD + 서보)', device: 'atmega128',
    desc: '4x4 키패드로 비밀번호(1234#) 입력, I2C LCD에 표시, 맞으면 서보로 잠금 해제·초록 LED, 틀리면 경고음 (키패드, I2C LCD, 서보, 부저)',
    simTime: 3,
    script: [
      ...[['k0', 0.8], ['k1', 1.0], ['k2', 1.2], ['k4', 1.4], ['k14', 1.6]].flatMap(([k, t]) => [
        { t, part: 'keypad', act: k, phase: 'down' }, { t: t + 0.1, part: 'keypad', act: k, phase: 'up' }]),
    ],
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega128', 700, 820);
      // keypad on PORTF (rows PF0..3, cols PF4..7)
      const pf0 = b.mpin(m, 'PF0');
      const kp = b.add('keypad', pf0[0] + 180, pf0[1] - 120);
      ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'].forEach((p, i) => b.link(b.mpin(m, 'PF' + i), b.pin(kp, p), 'h'));
      labels(b, m, [['PD0', 'SCL'], ['PD1', 'SDA'], ['PE3', 'SERVO'], ['PE4', 'BUZ']]);
      ledLeft(b, b.mpin(m, 'PB0'), 'green');
      ledLeft(b, b.mpin(m, 'PB2'), 'red');
      i2cPullups(b, 1250, 330);
      i2cLcdBlock(b, 1560, 470);
      buzzerBlock(b, 1350, 1050, 'BUZ', 'active');
      servoBlock(b, 1350, 1250, 'SERVO');
      return b.done();
    },
    code: `/*
 * [종합] 디지털 도어락 - ATmega128 @ 16MHz
 *  - 4x4 키패드 : PORTF (행 PF0~3 출력, 열 PF4~7 입력 풀업)
 *  - I2C LCD(0x27) : SCL=PD0, SDA=PD1
 *  - 서보(잠금장치) : Timer3 PWM, OC3A=PE3  (0도 = 잠김, 90도 = 열림)
 *  - 능동 부저 : PE4,  LED : PB0(초록), PB2(빨강)
 *  숫자 입력 후 # = 확인, * = 지우기.  비밀번호: 1234
 */
#include <avr/io.h>
#include <util/delay.h>
#include <string.h>

${TWI_C}

${I2C_LCD_C}

#define PASSWORD "1234"

static const char keymap[16] = {
    '1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'
};

static char key_scan(void)
{
    for (uint8_t r = 0; r < 4; r++) {
        PORTF = 0xFF & ~(1 << r);
        _delay_us(5);
        uint8_t cols = PINF >> 4;
        for (uint8_t c = 0; c < 4; c++)
            if (!(cols & (1 << c))) return keymap[r * 4 + c];
    }
    return 0;
}

static void servo_angle(uint8_t deg) { OCR3A = 2000 + (uint32_t)deg * 2000 / 180; }

static void beep(uint16_t ms)
{
    PORTE |= (1 << PE4);
    while (ms--) _delay_ms(1);
    PORTE &= ~(1 << PE4);
}

static void show_input(uint8_t n)
{
    char line[17] = "PW: ____        ";
    for (uint8_t i = 0; i < n; i++) line[4 + i] = '*';
    lcd_print(1, line);
}

int main(void)
{
    char input[5];
    uint8_t n = 0;
    char last = 0;

    MCUCSR |= (1 << JTD); MCUCSR |= (1 << JTD);     /* JTAG 끄기 (PF4~7 사용) */
    DDRF = 0x0F; PORTF = 0xFF;
    DDRB |= (1 << PB0) | (1 << PB2);
    DDRE |= (1 << PE3) | (1 << PE4);

    TCCR3A = (1 << COM3A1) | (1 << WGM31);           /* Fast PWM, TOP=ICR3 */
    TCCR3B = (1 << WGM33) | (1 << WGM32) | (1 << CS31);
    ICR3 = 39999;                                   /* 20ms */
    servo_angle(0);

    twi_init();
    lcd_init();
    lcd_print(0, " DOOR LOCKED    ");
    show_input(0);

    while (1) {
        char k = key_scan();
        if (k && k != last) {
            beep(20);
            if (k >= '0' && k <= '9' && n < 4) { input[n++] = k; show_input(n); }
            else if (k == '*') { n = 0; show_input(0); }
            else if (k == '#') {
                input[n] = 0;
                if (strcmp(input, PASSWORD) == 0) {
                    lcd_print(0, " ACCESS GRANTED ");
                    PORTB |= (1 << PB0);
                    servo_angle(90);
                    beep(100);
                    for (uint8_t i = 0; i < 25; i++) _delay_ms(100);   /* 2.5초 열림 */
                    servo_angle(0);
                    PORTB &= ~(1 << PB0);
                } else {
                    lcd_print(0, " WRONG PASSWORD ");
                    PORTB |= (1 << PB2);
                    for (uint8_t i = 0; i < 3; i++) { beep(150); _delay_ms(100); }
                    PORTB &= ~(1 << PB2);
                }
                lcd_print(0, " DOOR LOCKED    ");
                n = 0; show_input(0);
            }
        }
        last = k;
        _delay_ms(20);
    }
}
`,
  },
  // =========================================================================
  {
    id: 'adv_traffic', group: '종합 시스템', name: '[종합] 보행자 신호등 + 카운트다운 (74HC595 FND)', device: 'atmega328p',
    desc: '차량/보행자 신호등 상태 머신, 보행자 버튼(INT0), 74HC595(SPI)로 FND 카운트다운, 보행 신호 중 부저음 (LED 5개, 버튼, 74HC595+FND, 부저)',
    simTime: 6,
    script: [{ t: 0.5, part: 'button', act: 'press', phase: 'down' }, { t: 0.6, part: 'button', act: 'press', phase: 'up' }],
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega328p', 500, 700);
      labels(b, m, [['PB2', 'LATCH'], ['PB3', 'MOSI'], ['PB5', 'SCK'],
        ['PC0', 'CAR_R'], ['PC1', 'CAR_Y'], ['PC2', 'CAR_G'], ['PC3', 'PED_R'], ['PC4', 'PED_G'],
        ['PD2', 'BTN'], ['PD4', 'BUZ']]);
      const x = 950;
      ledBlock(b, x, 560, 'CAR_R', 'red');
      ledBlock(b, x, 620, 'CAR_Y', 'yellow');
      ledBlock(b, x, 680, 'CAR_G', 'green');
      ledBlock(b, x, 760, 'PED_R', 'red');
      ledBlock(b, x, 820, 'PED_G', 'green');
      buttonBlock(b, x, 920, 'BTN');
      buzzerBlock(b, x, 1010, 'BUZ', 'active');
      // 74HC595 -> resistor array -> 7-segment
      const u = b.add('hc595', 1450, 420);
      b.label(b.pin(u, 'DS'), 'MOSI', 'L', 30);
      b.label(b.pin(u, 'SHCP'), 'SCK', 'L', 30);
      b.label(b.pin(u, 'STCP'), 'LATCH', 'L', 30);
      const mr = b.pin(u, 'MR');
      b.wire(mr, [mr[0] - 20, mr[1]]);
      b.power('vcc', [mr[0] - 20, mr[1]], 3);
      const oe = b.pin(u, 'OE');
      b.wire(oe, [oe[0] - 20, oe[1]], [oe[0] - 20, oe[1] + 20]);
      b.gnd([oe[0] - 20, oe[1] + 20]);
      const q0 = b.pin(u, 'Q0');
      const rn = b.add('resarray', q0[0] + 60, q0[1] + 40, { value: '330' });
      const r16 = b.pin(rn, '16');
      const seg = b.add('seg7', r16[0] + 80, r16[1] + 40, { common: 'cathode', color: 'green' });
      const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
      for (let i = 0; i < 8; i++) {
        b.wire(b.pin(u, 'Q' + i), b.pin(rn, String(i + 1)));
        b.wire(b.pin(rn, String(16 - i)), b.pin(seg, segs[i]));
      }
      const com = b.pin(seg, 'COM');
      b.wire(com, [com[0] + 20, com[1]]);
      b.gnd([com[0] + 20, com[1]], 20);
      return b.done();
    },
    code: `/*
 * [종합] 보행자 신호등 - ATmega328P @ 16MHz
 *  차량: PC0(적) PC1(황) PC2(녹)   보행자: PC3(적) PC4(녹)
 *  보행자 버튼: PD2(INT0)   부저: PD4
 *  카운트다운 FND: 74HC595 (SPI: MOSI=PB3, SCK=PB5, LATCH=PB2), Q0~Q7 = a~dp
 *  동작: 차량 녹색(최소 2초) → 버튼 요청 시 황색 1.5초 → 전체 적색 0.5초
 *        → 보행 녹색 9초 카운트다운(마지막 3초 점멸, 매초 비프) → 차량 녹색
 */
#include <avr/io.h>
#include <avr/interrupt.h>
#include <util/delay.h>

enum { CAR_R = 0, CAR_Y, CAR_G, PED_R, PED_G };
static const uint8_t font[10] = { 0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F };

volatile uint8_t request = 0;
ISR(INT0_vect) { request = 1; }

static void lights(uint8_t mask) { PORTC = (PORTC & 0xE0) | mask; }

static void fnd(uint8_t pattern)
{
    SPDR = pattern;
    while (!(SPSR & (1 << SPIF)));
    PORTB |= (1 << PB2);
    PORTB &= ~(1 << PB2);
}

int main(void)
{
    enum { S_GREEN, S_YELLOW, S_ALLRED, S_WALK } state = S_GREEN;
    uint16_t t = 0;                                  /* 상태 경과 시간 (x100ms) */

    DDRC = 0x1F;
    DDRD |= (1 << PD4);
    PORTD |= (1 << PD2);                             /* 버튼 풀업 */
    DDRB |= (1 << PB2) | (1 << PB3) | (1 << PB5);
    SPCR = (1 << SPE) | (1 << MSTR) | (1 << SPR0);   /* SPI 마스터 */
    EICRA = (1 << ISC01); EIMSK = (1 << INT0);
    sei();
    fnd(0);

    while (1) {
        switch (state) {
        case S_GREEN:
            lights((1 << CAR_G) | (1 << PED_R));
            if (request && t >= 20) { state = S_YELLOW; t = 0; }
            break;
        case S_YELLOW:
            lights((1 << CAR_Y) | (1 << PED_R));
            if (t >= 15) { state = S_ALLRED; t = 0; }
            break;
        case S_ALLRED:
            lights((1 << CAR_R) | (1 << PED_R));
            if (t >= 5) { state = S_WALK; t = 0; }
            break;
        case S_WALK: {
            uint8_t left = 9 - t / 10;               /* 9 ~ 1 초 */
            uint8_t blink = (left <= 3) && ((t % 10) >= 5);
            lights((1 << CAR_R) | (blink ? 0 : (1 << PED_G)));
            fnd(font[left]);
            if (t % 10 == 0) PORTD |= (1 << PD4);    /* 매초 비프 */
            if (t % 10 == 1) PORTD &= ~(1 << PD4);
            if (t >= 90) { state = S_GREEN; t = 0; request = 0; fnd(0); }
            break;
        }
        }
        t++;
        _delay_ms(100);
    }
}
`,
  },
  // =========================================================================
  {
    id: 'adv_logger', group: '종합 시스템', name: '[종합] I2C 데이터 로거 (RTC + EEPROM + LCD + 터미널)', device: 'atmega328p',
    desc: 'DS1307 시각과 조도(LDR)를 1초마다 24C02 EEPROM에 기록, I2C LCD 표시, 터미널에서 d(덤프)/e(삭제) 명령 (DS1307, 24C02, I2C LCD, LDR, 터미널)',
    simTime: 3.6,
    script: [{ t: 3.2, send: 'd' }],
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega328p', 500, 700);
      labels(b, m, [['PC4', 'SDA'], ['PC5', 'SCL'], ['PC0', 'LIGHT'], ['PD1', 'TXD'], ['PD0', 'RXD'], ['PB5', 'LOG']]);
      i2cPullups(b, 1000, 330);
      i2cLcdBlock(b, 1400, 470);
      const rtc = b.add('ds1307', 1050, 720);
      const ee = b.add('eeprom24', 1400, 720, { model: '24C02' });
      for (const u of [rtc, ee]) {
        b.label(b.pin(u, 'SDA'), 'SDA', 'R', 20);
        b.label(b.pin(u, 'SCL'), 'SCL', 'R', 40);
        b.vcc(b.pin(u, 'VCC'), 10);
        b.gnd(b.pin(u, 'GND'), 10);
      }
      ldrBlock(b, 950, 950, 'LIGHT', '60');
      ledBlock(b, 1150, 1120, 'LOG', 'green');
      terminalBlock(b, 1500, 1000, 'TXD', 'RXD');
      return b.done();
    },
    code: `/*
 * [종합] I2C 데이터 로거 - ATmega328P @ 16MHz
 *  - DS1307 RTC(0x68) : 현재 시각 (시뮬레이션 시작 시 PC 시간)
 *  - 24C02 EEPROM(0x50) : 1초마다 [시, 분, 초, 조도%] 4바이트 기록 (최대 64개)
 *  - I2C LCD(0x27) : 시각, 조도, 기록 개수 표시
 *  - LDR(PC0/ADC0) : 조도 (LDR의 ▲▼로 밝기 조절)
 *  - 터미널(9600bps) : 'd' = 기록 덤프, 'e' = 기록 삭제
 *  - PB5 LED : 기록할 때마다 점멸
 */
#include <avr/io.h>
#include <util/delay.h>
#include <stdio.h>

${TWI_C}

${I2C_LCD_C}

${UART0_C}

${ADC_C}

#define RTC_ADDR 0x68
#define EE_ADDR  0x50
#define MAX_REC  64

static uint8_t bcd2dec(uint8_t b) { return (b >> 4) * 10 + (b & 0x0F); }

static void rtc_read(uint8_t *h, uint8_t *m, uint8_t *s)
{
    twi_start(RTC_ADDR << 1); twi_write(0x00);
    twi_start((RTC_ADDR << 1) | 1);
    *s = bcd2dec(twi_read(1) & 0x7F);
    *m = bcd2dec(twi_read(1));
    *h = bcd2dec(twi_read(0) & 0x3F);
    twi_stop();
}

static void ee_write(uint8_t addr, const uint8_t *d, uint8_t n)
{
    twi_start(EE_ADDR << 1); twi_write(addr);
    while (n--) twi_write(*d++);
    twi_stop();
    _delay_ms(5);                                   /* 쓰기 사이클 */
}

static void ee_read(uint8_t addr, uint8_t *d, uint8_t n)
{
    twi_start(EE_ADDR << 1); twi_write(addr);
    twi_start((EE_ADDR << 1) | 1);
    while (n--) *d++ = twi_read(n != 0);
    twi_stop();
}

int main(void)
{
    char buf[17];
    uint8_t count = 0, last_s = 0xFF;

    DDRB |= (1 << PB5);
    uart0_init();
    twi_init();
    lcd_init();
    ADCSRA = (1 << ADEN) | 7;
    printf("I2C data logger. commands: d=dump, e=erase\\n");

    while (1) {
        uint8_t h, m, s;
        rtc_read(&h, &m, &s);
        if (s != last_s) {                          /* 1초마다 기록 */
            last_s = s;
            uint8_t light = (uint32_t)adc_read(0) * 100 / 1023;
            uint8_t rec[4] = { h, m, s, light };
            ee_write((count % MAX_REC) * 4, rec, 4);
            if (count < 255) count++;
            PORTB ^= (1 << PB5);
            sprintf(buf, "%02u:%02u:%02u  #%03u", h, m, s, count);
            lcd_print(0, buf);
            sprintf(buf, "Light %3u%%      ", light);
            lcd_print(1, buf);
            printf("[%02u:%02u:%02u] light=%u%% saved #%u\\n", h, m, s, light, count);
        }
        int c = uart0_getc();
        if (c == 'd') {
            uint8_t n = count < MAX_REC ? count : MAX_REC;
            printf("--- dump %u records ---\\n", n);
            for (uint8_t i = 0; i < n; i++) {
                uint8_t r[4];
                ee_read(i * 4, r, 4);
                printf("%2u: %02u:%02u:%02u  %3u%%\\n", i + 1, r[0], r[1], r[2], r[3]);
            }
        } else if (c == 'e') {
            count = 0;
            printf("records erased\\n");
        }
        _delay_ms(50);
    }
}
`,
  },
  // =========================================================================
  {
    id: 'adv_2mcu', group: '종합 시스템', name: '[종합] 두 MCU UART 통신 (ATmega328P ↔ ATmega128)', device: 'atmega328p', sheet: 'A3',
    desc: '마스터(328P)가 가변저항 값과 모드를 UART로 전송, 슬레이브(ATmega128)가 LCD 표시·서보 구동·LED 레벨 표시 후 응답. 터미널로 통신 내용 모니터링 (MCU 2개, LCD, 서보, 터미널)',
    simTime: 2,
    script: [
      { t: 1.2, part: 'button', act: 'press', phase: 'down' }, { t: 1.3, part: 'button', act: 'press', phase: 'up' },
    ],
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const master = b.role('master', mcuWithPower(b, DEV, 'atmega328p', 450, 800));
      labels(b, master, [['PC0', 'POT'], ['PD2', 'MODE'], ['PD1', 'LINK'], ['PD0', 'ACK'], ['PB5', 'TX_LED']]);
      potBlock(b, 850, 520, 'POT', '30');
      buttonBlock(b, 850, 700, 'MODE');
      ledBlock(b, 850, 820, 'TX_LED', 'yellow');
      servoBlock(b, 900, 1050, 'SERVO');
      terminalBlock(b, 950, 1300, 'LINK', null);
      const slave = b.role('slave', mcuWithPower(b, DEV, 'atmega128', 1950, 850));
      lcdOnPortD(b, slave);
      labels(b, slave, [['PE0', 'LINK'], ['PE1', 'ACK'], ['PB5', 'SERVO', 'L']]);
      barLeft(b, Array.from({ length: 8 }, (_, i) => b.mpin(slave, 'PA' + i)), 'green');
      return b.done();
    },
    files: [
      {
        name: 'master.c', role: 'master', code: `/*
 * [종합] 두 MCU UART 통신 - 마스터 (U1: ATmega328P @ 16MHz)
 *  - ADC0(PC0) 가변저항 값을 100ms마다 "P0512 M0" 형식으로 전송 (USART0 9600bps)
 *  - PD2 버튼: 모드 전환 (M0 = 가변저항 추종, M1 = 자동 스윕)
 *  - 슬레이브의 응답("A090")을 받을 때마다 PB5 LED 토글
 *  이 파일은 U1 전용입니다. 코드 탭에서 파일을 선택하면 빌드 대상 MCU가 자동으로 바뀝니다.
 */
#include <avr/io.h>
#include <util/delay.h>
#include <stdio.h>

${UART0_C}

${ADC_C}

int main(void)
{
    uint8_t mode = 0, last_btn = 1;
    DDRB |= (1 << PB5);
    PORTD |= (1 << PD2);
    uart0_init();
    ADCSRA = (1 << ADEN) | 7;

    while (1) {
        uint8_t btn = (PIND >> PD2) & 1;
        if (!btn && last_btn) mode ^= 1;             /* 버튼 눌림 */
        last_btn = btn;

        printf("P%04u M%u\\n", adc_read(0), mode);
        for (uint8_t i = 0; i < 10; i++) {           /* 100ms 동안 응답 확인 */
            if (uart0_getc() == 'A') PORTB ^= (1 << PB5);
            _delay_ms(10);
        }
    }
}
`,
      },
      {
        name: 'slave.c', role: 'slave', code: `/*
 * [종합] 두 MCU UART 통신 - 슬레이브 (U2: ATmega128 @ 16MHz)
 *  - USART0(PE0/PE1) 수신 인터럽트로 "P0512 M0" 한 줄씩 수신
 *  - M0: 서보 각도 = 가변저항 값,  M1: 서보 자동 스윕
 *  - LCD(PORTD): 수신 값과 각도,  PORTA: 8단 레벨 LED
 *  - 서보: Timer1 Fast PWM, OC1A = PB5
 *  - 응답: "A<각도>" 전송
 *  이 파일은 U2 전용입니다.
 */
#include <avr/io.h>
#include <avr/interrupt.h>
#include <util/delay.h>
#include <stdio.h>
#include <stdlib.h>

${LCD_PORTD_C}

${UART0_C}

volatile char line[16];
volatile uint8_t line_len = 0, line_ready = 0;

ISR(USART0_RX_vect)
{
    char c = UDR0;
    if (c == '\\n') { line[line_len] = 0; line_ready = 1; line_len = 0; }
    else if (line_len < sizeof(line) - 1) line[line_len++] = c;
}

static void servo_angle(uint8_t deg) { OCR1A = 2000 + (uint32_t)deg * 2000 / 180; }

int main(void)
{
    char buf[17];
    uint8_t angle = 90, sweep = 0;
    int8_t dir = 3;

    DDRA = 0xFF;
    DDRB |= (1 << PB5);
    TCCR1A = (1 << COM1A1) | (1 << WGM11);
    TCCR1B = (1 << WGM13) | (1 << WGM12) | (1 << CS11);
    ICR1 = 39999;
    servo_angle(angle);

    lcd_init();
    lcd_print(0, "Waiting master..");
    uart0_init();
    UCSR0B |= (1 << RXCIE0);
    sei();

    while (1) {
        if (!line_ready) continue;
        line_ready = 0;
        uint16_t pot = atoi((const char *)&line[1]);
        uint8_t mode = line[7] == '1';

        if (!mode) angle = (uint32_t)pot * 180 / 1023;
        else { sweep += dir; if (sweep >= 180 || sweep < 3) dir = -dir; angle = sweep; }
        servo_angle(angle);
        uint8_t n = (uint32_t)pot * 8 / 1023;
        PORTA = (n >= 8) ? 0xFF : (uint8_t)((1 << n) - 1);

        sprintf(buf, "RX P=%04u  M%u   ", pot, mode);
        lcd_print(0, buf);
        sprintf(buf, "Servo %3u deg   ", angle);
        lcd_print(1, buf);
        printf("A%03u\\n", angle);
    }
}
`,
      },
    ],
  },
  // =========================================================================
  {
    id: 'adv_parking', group: '종합 시스템', name: '[종합] 주차 보조 & 스마트 조명 (ATmega2560)', device: 'atmega2560',
    desc: 'HC-SR04 거리 측정 → LED 바/부저 경보, LDR로 어두울 때 Timer4 PWM 조명 제어, I2C LCD 표시 (초음파, LDR, I2C LCD, LED 바, 부저)',
    simTime: 1.6,
    script: [{ t: 0.7, adjust: 'hcsr04', key: 'dist', value: 25 }],
    async build() {
      const DEV = await devices();
      const b = new Builder();
      const m = mcuWithPower(b, DEV, 'atmega2560', 1300, 1150);
      barLeft(b, Array.from({ length: 8 }, (_, i) => b.mpin(m, 'PA' + i)), 'red');
      labels(b, m, [['PD0', 'SCL', 'L'], ['PD1', 'SDA', 'L'],
        ['PF0', 'LIGHT'], ['PH3', 'LAMP'], ['PH4', 'BUZ'], ['PL0', 'TRIG'], ['PL1', 'ECHO']]);
      const us = b.add('hcsr04', 1950, 620, { dist: '120' });
      const vcc = b.pin(us, 'VCC');
      b.wire(vcc, [vcc[0], vcc[1] + 20]);
      b.power('vcc', [vcc[0], vcc[1] + 20], 2);
      b.gnd(b.pin(us, 'GND'), 20);
      b.label(b.pin(us, 'TRIG'), 'TRIG', 'D', 20);
      b.label(b.pin(us, 'ECHO'), 'ECHO', 'D', 20);
      ldrBlock(b, 1850, 900, 'LIGHT', '20');
      buzzerBlock(b, 1850, 1150, 'BUZ', 'active');
      ledBlock(b, 1850, 1300, 'LAMP', 'yellow', '150');
      i2cPullups(b, 2250, 800);
      i2cLcdBlock(b, 2550, 1000);
      return b.done();
    },
    code: `/*
 * [종합] 주차 보조 & 스마트 조명 - ATmega2560 @ 16MHz
 *  - HC-SR04 : TRIG=PL0, ECHO=PL1 (Timer1 0.5us 단위로 에코 폭 측정, 거리 = 폭/58us)
 *  - PORTA   : 거리 레벨 LED (가까울수록 많이 켜짐)
 *  - PH4     : 능동 부저 - 50cm 이내에서 가까울수록 빠르게, 10cm 이내 연속음
 *  - PF0     : LDR 조도 (ADC0) - 30% 미만이면 어두움
 *  - PH3     : 조명 LED, Timer4 Fast PWM(OC4A) - 어두울 때 켜짐, 물체가 가까우면 최대 밝기
 *  - I2C LCD : SCL=PD0, SDA=PD1 에 거리/조도 표시
 *  HC-SR04의 ▲▼로 거리를, LDR의 ▲▼로 밝기를 바꿔 보세요.
 */
#include <avr/io.h>
#include <util/delay.h>
#include <stdio.h>

${TWI_C}

${I2C_LCD_C}

${ADC_C}

static uint16_t distance_cm(void)
{
    PORTL |= (1 << PL0); _delay_us(10); PORTL &= ~(1 << PL0);   /* TRIG 10us */
    TCNT1 = 0;
    while (!(PINL & (1 << PL1))) if (TCNT1 > 60000) return 999; /* 에코 시작 대기 */
    TCNT1 = 0;
    while (PINL & (1 << PL1)) if (TCNT1 > 60000) return 999;    /* 에코 폭 측정 */
    return TCNT1 / 116;                                          /* 0.5us 단위 / 58us */
}

int main(void)
{
    char buf[17];
    uint16_t dist = 999;
    uint8_t light = 100, tick = 0, beep_t = 0;

    DDRA = 0xFF;
    DDRL |= (1 << PL0);
    DDRH |= (1 << PH3) | (1 << PH4);
    TCCR1B = (1 << CS11);                                        /* Timer1 분주 8 */
    TCCR4A = (1 << COM4A1) | (1 << WGM40);                       /* Fast PWM 8비트 */
    TCCR4B = (1 << WGM42) | (1 << CS41) | (1 << CS40);
    ADCSRA = (1 << ADEN) | 7;
    twi_init();
    lcd_init();

    while (1) {
        if (tick % 6 == 0) {                                     /* 60ms마다 측정 */
            dist = distance_cm();
            light = (uint32_t)adc_read(0) * 100 / 1023;
            uint8_t n = dist >= 80 ? 0 : 8 - dist / 10;
            PORTA = (n >= 8) ? 0xFF : (uint8_t)((1 << n) - 1);
            OCR4A = light < 30 ? (dist < 100 ? 255 : 40) : 0;    /* 스마트 조명 */
        }
        /* 부저: 거리에 비례한 주기로 단속 */
        if (dist < 10) PORTH |= (1 << PH4);
        else if (dist < 50) {
            if (++beep_t >= dist / 5 + 2) beep_t = 0;
            if (beep_t < 2) PORTH |= (1 << PH4); else PORTH &= ~(1 << PH4);
        } else PORTH &= ~(1 << PH4);

        if (tick % 20 == 0) {                                    /* 200ms마다 LCD */
            if (dist >= 999) sprintf(buf, "Dist:  --- cm   ");
            else sprintf(buf, "Dist: %3u cm %s", dist, dist < 50 ? "!!" : "  ");
            lcd_print(0, buf);
            sprintf(buf, "Light %3u%% %s", light, light < 30 ? "LAMP " : "day  ");
            lcd_print(1, buf);
        }
        tick++;
        _delay_ms(10);
    }
}
`,
  },
];
