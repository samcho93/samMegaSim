// ATmega device definitions: pinouts, register maps, interrupt vectors.
// Addresses are data-space addresses (I/O address + 0x20).

const DIV_T01 = { 0: 0, 1: 1, 2: 8, 3: 64, 4: 256, 5: 1024, 6: 0, 7: 0 };
const DIV_T2 = { 0: 0, 1: 1, 2: 8, 3: 32, 4: 64, 5: 128, 6: 256, 7: 1024 };
// ATmega128 Timer0 (async) / Timer2 use swapped prescaler tables
const DIV_128_T0 = DIV_T2;
const DIV_128_T2 = DIV_T01;

const REF = { AREF: 1, AVCC: 0, V11: 2, V256: 3, RES: 4 }; // matches avr8js ADCReference

// ---------------------------------------------------------------------------
// Pin tables: [pinNumber, primaryName, ...alternateFunctions]
// ---------------------------------------------------------------------------
const PINS_DIP28_MEGA8 = [
  [1, 'PC6', 'RESET'], [2, 'PD0', 'RXD'], [3, 'PD1', 'TXD'], [4, 'PD2', 'INT0'],
  [5, 'PD3', 'INT1'], [6, 'PD4', 'XCK', 'T0'], [7, 'VCC'], [8, 'GND'],
  [9, 'PB6', 'XTAL1'], [10, 'PB7', 'XTAL2'], [11, 'PD5', 'T1'], [12, 'PD6', 'AIN0'],
  [13, 'PD7', 'AIN1'], [14, 'PB0', 'ICP1'], [15, 'PB1', 'OC1A'], [16, 'PB2', 'SS', 'OC1B'],
  [17, 'PB3', 'MOSI', 'OC2'], [18, 'PB4', 'MISO'], [19, 'PB5', 'SCK'], [20, 'AVCC'],
  [21, 'AREF'], [22, 'GND'], [23, 'PC0', 'ADC0'], [24, 'PC1', 'ADC1'], [25, 'PC2', 'ADC2'],
  [26, 'PC3', 'ADC3'], [27, 'PC4', 'ADC4', 'SDA'], [28, 'PC5', 'ADC5', 'SCL'],
];

const PINS_DIP28_MEGAx8 = [
  [1, 'PC6', 'RESET', 'PCINT14'], [2, 'PD0', 'RXD', 'PCINT16'], [3, 'PD1', 'TXD', 'PCINT17'],
  [4, 'PD2', 'INT0', 'PCINT18'], [5, 'PD3', 'INT1', 'OC2B'], [6, 'PD4', 'XCK', 'T0'],
  [7, 'VCC'], [8, 'GND'], [9, 'PB6', 'XTAL1', 'PCINT6'], [10, 'PB7', 'XTAL2', 'PCINT7'],
  [11, 'PD5', 'OC0B', 'T1'], [12, 'PD6', 'OC0A', 'AIN0'], [13, 'PD7', 'AIN1'],
  [14, 'PB0', 'ICP1', 'CLKO'], [15, 'PB1', 'OC1A'], [16, 'PB2', 'SS', 'OC1B'],
  [17, 'PB3', 'MOSI', 'OC2A'], [18, 'PB4', 'MISO'], [19, 'PB5', 'SCK'], [20, 'AVCC'],
  [21, 'AREF'], [22, 'GND'], [23, 'PC0', 'ADC0'], [24, 'PC1', 'ADC1'], [25, 'PC2', 'ADC2'],
  [26, 'PC3', 'ADC3'], [27, 'PC4', 'ADC4', 'SDA'], [28, 'PC5', 'ADC5', 'SCL'],
];

const PINS_DIP40_M16 = [
  [1, 'PB0', 'XCK', 'T0'], [2, 'PB1', 'T1'], [3, 'PB2', 'INT2', 'AIN0'], [4, 'PB3', 'OC0', 'AIN1'],
  [5, 'PB4', 'SS'], [6, 'PB5', 'MOSI'], [7, 'PB6', 'MISO'], [8, 'PB7', 'SCK'], [9, 'RESET'],
  [10, 'VCC'], [11, 'GND'], [12, 'XTAL2'], [13, 'XTAL1'], [14, 'PD0', 'RXD'], [15, 'PD1', 'TXD'],
  [16, 'PD2', 'INT0'], [17, 'PD3', 'INT1'], [18, 'PD4', 'OC1B'], [19, 'PD5', 'OC1A'],
  [20, 'PD6', 'ICP1'], [21, 'PD7', 'OC2'], [22, 'PC0', 'SCL'], [23, 'PC1', 'SDA'],
  [24, 'PC2', 'TCK'], [25, 'PC3', 'TMS'], [26, 'PC4', 'TDO'], [27, 'PC5', 'TDI'],
  [28, 'PC6', 'TOSC1'], [29, 'PC7', 'TOSC2'], [30, 'AVCC'], [31, 'GND'], [32, 'AREF'],
  [33, 'PA7', 'ADC7'], [34, 'PA6', 'ADC6'], [35, 'PA5', 'ADC5'], [36, 'PA4', 'ADC4'],
  [37, 'PA3', 'ADC3'], [38, 'PA2', 'ADC2'], [39, 'PA1', 'ADC1'], [40, 'PA0', 'ADC0'],
];

const PINS_DIP40_M644 = [
  [1, 'PB0', 'XCK0', 'T0'], [2, 'PB1', 'T1', 'CLKO'], [3, 'PB2', 'INT2', 'AIN0'],
  [4, 'PB3', 'OC0A', 'AIN1'], [5, 'PB4', 'SS', 'OC0B'], [6, 'PB5', 'MOSI'], [7, 'PB6', 'MISO'],
  [8, 'PB7', 'SCK'], [9, 'RESET'], [10, 'VCC'], [11, 'GND'], [12, 'XTAL2'], [13, 'XTAL1'],
  [14, 'PD0', 'RXD0'], [15, 'PD1', 'TXD0'], [16, 'PD2', 'RXD1', 'INT0'], [17, 'PD3', 'TXD1', 'INT1'],
  [18, 'PD4', 'XCK1', 'OC1B'], [19, 'PD5', 'OC1A'], [20, 'PD6', 'ICP1', 'OC2B'], [21, 'PD7', 'OC2A'],
  [22, 'PC0', 'SCL'], [23, 'PC1', 'SDA'], [24, 'PC2', 'TCK'], [25, 'PC3', 'TMS'], [26, 'PC4', 'TDO'],
  [27, 'PC5', 'TDI'], [28, 'PC6', 'TOSC1'], [29, 'PC7', 'TOSC2'], [30, 'AVCC'], [31, 'GND'],
  [32, 'AREF'], [33, 'PA7', 'ADC7'], [34, 'PA6', 'ADC6'], [35, 'PA5', 'ADC5'], [36, 'PA4', 'ADC4'],
  [37, 'PA3', 'ADC3'], [38, 'PA2', 'ADC2'], [39, 'PA1', 'ADC1'], [40, 'PA0', 'ADC0'],
];

const PINS_TQFP64_M128 = [
  [1, 'PEN'], [2, 'PE0', 'RXD0', 'PDI'], [3, 'PE1', 'TXD0', 'PDO'], [4, 'PE2', 'XCK0', 'AIN0'],
  [5, 'PE3', 'OC3A', 'AIN1'], [6, 'PE4', 'OC3B', 'INT4'], [7, 'PE5', 'OC3C', 'INT5'],
  [8, 'PE6', 'T3', 'INT6'], [9, 'PE7', 'ICP3', 'INT7'], [10, 'PB0', 'SS'], [11, 'PB1', 'SCK'],
  [12, 'PB2', 'MOSI'], [13, 'PB3', 'MISO'], [14, 'PB4', 'OC0'], [15, 'PB5', 'OC1A'],
  [16, 'PB6', 'OC1B'], [17, 'PB7', 'OC2', 'OC1C'], [18, 'PG3', 'TOSC2'], [19, 'PG4', 'TOSC1'],
  [20, 'RESET'], [21, 'VCC'], [22, 'GND'], [23, 'XTAL2'], [24, 'XTAL1'],
  [25, 'PD0', 'SCL', 'INT0'], [26, 'PD1', 'SDA', 'INT1'], [27, 'PD2', 'RXD1', 'INT2'],
  [28, 'PD3', 'TXD1', 'INT3'], [29, 'PD4', 'ICP1'], [30, 'PD5', 'XCK1'], [31, 'PD6', 'T1'],
  [32, 'PD7', 'T2'], [33, 'PG0', 'WR'], [34, 'PG1', 'RD'], [35, 'PC0', 'A8'], [36, 'PC1', 'A9'],
  [37, 'PC2', 'A10'], [38, 'PC3', 'A11'], [39, 'PC4', 'A12'], [40, 'PC5', 'A13'], [41, 'PC6', 'A14'],
  [42, 'PC7', 'A15'], [43, 'PG2', 'ALE'], [44, 'PA7', 'AD7'], [45, 'PA6', 'AD6'], [46, 'PA5', 'AD5'],
  [47, 'PA4', 'AD4'], [48, 'PA3', 'AD3'], [49, 'PA2', 'AD2'], [50, 'PA1', 'AD1'], [51, 'PA0', 'AD0'],
  [52, 'VCC'], [53, 'GND'], [54, 'PF7', 'ADC7', 'TDI'], [55, 'PF6', 'ADC6', 'TDO'],
  [56, 'PF5', 'ADC5', 'TMS'], [57, 'PF4', 'ADC4', 'TCK'], [58, 'PF3', 'ADC3'], [59, 'PF2', 'ADC2'],
  [60, 'PF1', 'ADC1'], [61, 'PF0', 'ADC0'], [62, 'AREF'], [63, 'GND'], [64, 'AVCC'],
];

const PINS_TQFP100_M2560 = [
  [1, 'PG5', 'OC0B'], [2, 'PE0', 'RXD0', 'PCINT8'], [3, 'PE1', 'TXD0'], [4, 'PE2', 'XCK0', 'AIN0'],
  [5, 'PE3', 'OC3A', 'AIN1'], [6, 'PE4', 'OC3B', 'INT4'], [7, 'PE5', 'OC3C', 'INT5'],
  [8, 'PE6', 'T3', 'INT6'], [9, 'PE7', 'ICP3', 'INT7'], [10, 'VCC'], [11, 'GND'],
  [12, 'PH0', 'RXD2'], [13, 'PH1', 'TXD2'], [14, 'PH2', 'XCK2'], [15, 'PH3', 'OC4A'],
  [16, 'PH4', 'OC4B'], [17, 'PH5', 'OC4C'], [18, 'PH6', 'OC2B'], [19, 'PB0', 'SS', 'PCINT0'],
  [20, 'PB1', 'SCK', 'PCINT1'], [21, 'PB2', 'MOSI', 'PCINT2'], [22, 'PB3', 'MISO', 'PCINT3'],
  [23, 'PB4', 'OC2A', 'PCINT4'], [24, 'PB5', 'OC1A', 'PCINT5'], [25, 'PB6', 'OC1B', 'PCINT6'],
  [26, 'PB7', 'OC0A', 'OC1C'], [27, 'PH7', 'T4'], [28, 'PG3', 'TOSC2'], [29, 'PG4', 'TOSC1'],
  [30, 'RESET'], [31, 'VCC'], [32, 'GND'], [33, 'XTAL2'], [34, 'XTAL1'], [35, 'PL0', 'ICP4'],
  [36, 'PL1', 'ICP5'], [37, 'PL2', 'T5'], [38, 'PL3', 'OC5A'], [39, 'PL4', 'OC5B'], [40, 'PL5', 'OC5C'],
  [41, 'PL6'], [42, 'PL7'], [43, 'PD0', 'SCL', 'INT0'], [44, 'PD1', 'SDA', 'INT1'],
  [45, 'PD2', 'RXD1', 'INT2'], [46, 'PD3', 'TXD1', 'INT3'], [47, 'PD4', 'ICP1'], [48, 'PD5', 'XCK1'],
  [49, 'PD6', 'T1'], [50, 'PD7', 'T0'], [51, 'PG0', 'WR'], [52, 'PG1', 'RD'], [53, 'PC0', 'A8'],
  [54, 'PC1', 'A9'], [55, 'PC2', 'A10'], [56, 'PC3', 'A11'], [57, 'PC4', 'A12'], [58, 'PC5', 'A13'],
  [59, 'PC6', 'A14'], [60, 'PC7', 'A15'], [61, 'VCC'], [62, 'GND'], [63, 'PJ0', 'RXD3', 'PCINT9'],
  [64, 'PJ1', 'TXD3', 'PCINT10'], [65, 'PJ2', 'XCK3'], [66, 'PJ3'], [67, 'PJ4'], [68, 'PJ5'],
  [69, 'PJ6'], [70, 'PG2', 'ALE'], [71, 'PA7', 'AD7'], [72, 'PA6', 'AD6'], [73, 'PA5', 'AD5'],
  [74, 'PA4', 'AD4'], [75, 'PA3', 'AD3'], [76, 'PA2', 'AD2'], [77, 'PA1', 'AD1'], [78, 'PA0', 'AD0'],
  [79, 'PJ7'], [80, 'VCC'], [81, 'GND'], [82, 'PK7', 'ADC15', 'PCINT23'], [83, 'PK6', 'ADC14', 'PCINT22'],
  [84, 'PK5', 'ADC13', 'PCINT21'], [85, 'PK4', 'ADC12', 'PCINT20'], [86, 'PK3', 'ADC11', 'PCINT19'],
  [87, 'PK2', 'ADC10', 'PCINT18'], [88, 'PK1', 'ADC9', 'PCINT17'], [89, 'PK0', 'ADC8', 'PCINT16'],
  [90, 'PF7', 'ADC7'], [91, 'PF6', 'ADC6'], [92, 'PF5', 'ADC5'], [93, 'PF4', 'ADC4'], [94, 'PF3', 'ADC3'],
  [95, 'PF2', 'ADC2'], [96, 'PF1', 'ADC1'], [97, 'PF0', 'ADC0'], [98, 'AREF'], [99, 'GND'], [100, 'AVCC'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function modernTimer8(name, base, vec, o) {
  // base: {TCCRA, TCNT, OCRA, OCRB, TIMSK, TIFR}
  return {
    name, kind: 'modern', bits: 8,
    regs: { TCCRA: base.TCCRA, TCCRB: base.TCCRA + 1, TCNT: base.TCNT, OCRA: base.OCRA, OCRB: base.OCRB, TIMSK: base.TIMSK, TIFR: base.TIFR },
    masks: { TOV: 1, OCFA: 2, OCFB: 4, OCFC: 0, TOIE: 1, OCIEA: 2, OCIEB: 4, OCIEC: 0 },
    vec, ...o,
  };
}

function modernTimer16(name, a, vec, o) {
  // a = TCCRnA address; standard layout: A,B,C, _, TCNT(+4), ICR(+6), OCRA(+8), OCRB(+10), OCRC(+12)
  const hasC = !!o.oc?.C;
  return {
    name, kind: 'modern', bits: 16,
    regs: {
      TCCRA: a, TCCRB: a + 1, TCCRC: a + 2, TCNT: a + 4, ICR: a + 6, OCRA: a + 8, OCRB: a + 10,
      OCRC: hasC ? a + 12 : 0, TIMSK: o.TIMSK, TIFR: o.TIFR,
    },
    masks: { TOV: 1, OCFA: 2, OCFB: 4, OCFC: hasC ? 8 : 0, TOIE: 1, OCIEA: 2, OCIEB: 4, OCIEC: hasC ? 8 : 0 },
    vec, ...o,
  };
}

const v2 = (n) => n * 2; // 2-word (JMP) vector table
const v1 = (n) => n; // 1-word (RJMP) vector table

// ---------------------------------------------------------------------------
// ATmega48/88/168/328 family
// ---------------------------------------------------------------------------
function megaX8(id, name, flash, ram, eeprom) {
  const v = v2;
  return {
    id, name, gccMcu: id, package: 'DIP-28', flash, ramStart: 0x100, ramEnd: 0x100 + ram - 1, eeprom,
    pins: PINS_DIP28_MEGAx8,
    ports: {
      B: { PIN: 0x23, DDR: 0x24, PORT: 0x25, pcint: { PCIE: 0, PCICR: 0x68, PCIFR: 0x3b, PCMSK: 0x6b, vec: v(3) } },
      C: { PIN: 0x26, DDR: 0x27, PORT: 0x28, pcint: { PCIE: 1, PCICR: 0x68, PCIFR: 0x3b, PCMSK: 0x6c, vec: v(4) } },
      D: {
        PIN: 0x29, DDR: 0x2a, PORT: 0x2b, pcint: { PCIE: 2, PCICR: 0x68, PCIFR: 0x3b, PCMSK: 0x6d, vec: v(5) },
        ext: { 2: { EICR: 0x69, EIMSK: 0x3d, EIFR: 0x3c, iscOffset: 0, index: 0, vec: v(1) }, 3: { EICR: 0x69, EIMSK: 0x3d, EIFR: 0x3c, iscOffset: 2, index: 1, vec: v(2) } },
      },
    },
    timers: [
      modernTimer8('Timer0', { TCCRA: 0x44, TCNT: 0x46, OCRA: 0x47, OCRB: 0x48, TIMSK: 0x6e, TIFR: 0x35 },
        { ovf: v(16), compA: v(14), compB: v(15) }, { dividers: DIV_T01, oc: { A: 'PD6', B: 'PD5' }, extClk: 'PD4' }),
      modernTimer16('Timer1', 0x80, { ovf: v(13), compA: v(11), compB: v(12), capt: v(10) },
        { TIMSK: 0x6f, TIFR: 0x36, dividers: DIV_T01, oc: { A: 'PB1', B: 'PB2' }, extClk: 'PD5' }),
      modernTimer8('Timer2', { TCCRA: 0xb0, TCNT: 0xb2, OCRA: 0xb3, OCRB: 0xb4, TIMSK: 0x70, TIFR: 0x37 },
        { ovf: v(9), compA: v(7), compB: v(8) }, { dividers: DIV_T2, oc: { A: 'PB3', B: 'PD3' } }),
    ],
    usarts: [{ name: 'USART0', regs: { UCSRA: 0xc0, UCSRB: 0xc1, UCSRC: 0xc2, UBRRL: 0xc4, UBRRH: 0xc5, UDR: 0xc6 }, vec: { rx: v(18), udre: v(19), tx: v(20) }, rxd: 'PD0', txd: 'PD1' }],
    adc: {
      regs: { ADMUX: 0x7c, ADCSRA: 0x7a, ADCSRB: 0x7b, ADCL: 0x78, ADCH: 0x79 }, vec: v(21),
      refs: [REF.AREF, REF.AVCC, REF.RES, REF.V11], muxMask: 0x0f,
      channels: { 0: 'PC0', 1: 'PC1', 2: 'PC2', 3: 'PC3', 4: 'PC4', 5: 'PC5' }, consts: { 14: 1.1, 15: 0 }, temp: 8,
    },
    spi: { regs: { SPCR: 0x4c, SPSR: 0x4d, SPDR: 0x4e }, vec: v(17), pins: { SS: 'PB2', MOSI: 'PB3', MISO: 'PB4', SCK: 'PB5' } },
    twi: { regs: { TWBR: 0xb8, TWSR: 0xb9, TWAR: 0xba, TWDR: 0xbb, TWCR: 0xbc, TWAMR: 0xbd }, vec: v(24), pins: { SCL: 'PC5', SDA: 'PC4' } },
    eepromRegs: { EECR: 0x3f, EEDR: 0x40, EEARL: 0x41, EEARH: 0x42, vec: v(22) },
    defaultClock: 16000000,
  };
}

// ---------------------------------------------------------------------------
// Classic ATmega8 / 16 / 32
// ---------------------------------------------------------------------------
const CLASSIC_TIMSK = 0x59, CLASSIC_TIFR = 0x58;

function classicPorts(withA) {
  const p = {
    B: { PIN: 0x36, DDR: 0x37, PORT: 0x38 },
    C: { PIN: 0x33, DDR: 0x34, PORT: 0x35 },
    D: { PIN: 0x30, DDR: 0x31, PORT: 0x32 },
  };
  if (withA) p.A = { PIN: 0x39, DDR: 0x3a, PORT: 0x3b };
  return p;
}

function atmega8() {
  const v = v1;
  const ports = classicPorts(false);
  ports.D.ext = {
    2: { EICR: 0x55, EIMSK: 0x5b, EIFR: 0x5a, iscOffset: 0, index: 6, vec: v(1) },
    3: { EICR: 0x55, EIMSK: 0x5b, EIFR: 0x5a, iscOffset: 2, index: 7, vec: v(2) },
  };
  return {
    id: 'atmega8', name: 'ATmega8', gccMcu: 'atmega8', package: 'DIP-28', flash: 8192, ramStart: 0x60, ramEnd: 0x45f, eeprom: 512,
    pins: PINS_DIP28_MEGA8, ports,
    timers: [
      { name: 'Timer0', kind: 'classic8', bits: 8, csOnly: true, regs: { TCCR: 0x53, TCNT: 0x52, TIMSK: CLASSIC_TIMSK, TIFR: CLASSIC_TIFR },
        masks: { TOV: 0x01, OCFA: 0, TOIE: 0x01, OCIEA: 0 }, vec: { ovf: v(9) }, dividers: DIV_T01, oc: {}, extClk: 'PD4' },
      { name: 'Timer1', kind: 'modern', bits: 16,
        regs: { TCCRA: 0x4f, TCCRB: 0x4e, TCNT: 0x4c, ICR: 0x46, OCRA: 0x4a, OCRB: 0x48, TIMSK: CLASSIC_TIMSK, TIFR: CLASSIC_TIFR },
        masks: { TOV: 0x04, OCFA: 0x10, OCFB: 0x08, OCFC: 0, TOIE: 0x04, OCIEA: 0x10, OCIEB: 0x08, OCIEC: 0 },
        vec: { ovf: v(8), compA: v(6), compB: v(7), capt: v(5) }, dividers: DIV_T01, oc: { A: 'PB1', B: 'PB2' }, extClk: 'PD5', focInB: true },
      { name: 'Timer2', kind: 'classic8', bits: 8, regs: { TCCR: 0x45, TCNT: 0x44, OCR: 0x43, TIMSK: CLASSIC_TIMSK, TIFR: CLASSIC_TIFR },
        masks: { TOV: 0x40, OCFA: 0x80, TOIE: 0x40, OCIEA: 0x80 }, vec: { ovf: v(4), compA: v(3) }, dividers: DIV_T2, oc: { A: 'PB3' } },
    ],
    usarts: [{ name: 'USART', regs: { UDR: 0x2c, UCSRA: 0x2b, UCSRB: 0x2a, UBRRL: 0x29, UBRRH_UCSRC: 0x40 }, ursel: true, vec: { rx: v(11), udre: v(12), tx: v(13) }, rxd: 'PD0', txd: 'PD1' }],
    adc: {
      regs: { ADMUX: 0x27, ADCSRA: 0x26, ADCL: 0x24, ADCH: 0x25 }, vec: v(14),
      refs: [REF.AREF, REF.AVCC, REF.RES, REF.V256], muxMask: 0x0f,
      channels: { 0: 'PC0', 1: 'PC1', 2: 'PC2', 3: 'PC3', 4: 'PC4', 5: 'PC5' }, consts: { 14: 1.3, 15: 0 },
    },
    spi: { regs: { SPCR: 0x2d, SPSR: 0x2e, SPDR: 0x2f }, vec: v(10), pins: { SS: 'PB2', MOSI: 'PB3', MISO: 'PB4', SCK: 'PB5' } },
    twi: { regs: { TWBR: 0x20, TWSR: 0x21, TWAR: 0x22, TWDR: 0x23, TWCR: 0x56 }, vec: v(17), pins: { SCL: 'PC5', SDA: 'PC4' } },
    eepromRegs: { EECR: 0x3c, EEDR: 0x3d, EEARL: 0x3e, EEARH: 0x3f, vec: v(15) },
    defaultClock: 8000000,
  };
}

function atmega16_32(id, name, flash, ram, eeprom) {
  const v = v2;
  // ATmega32 has a different vector order than ATmega16 (INT2 moved to #3)
  const N = id === 'atmega32'
    ? { INT2: 3, T2C: 4, T2O: 5, T1CAP: 6, T1A: 7, T1B: 8, T1O: 9, T0C: 10, T0O: 11, SPI: 12, RX: 13, UDRE: 14, TX: 15, ADC: 16, EE: 17, TWI: 19 }
    : { INT2: 18, T2C: 3, T2O: 4, T1CAP: 5, T1A: 6, T1B: 7, T1O: 8, T0C: 19, T0O: 9, SPI: 10, RX: 11, UDRE: 12, TX: 13, ADC: 14, EE: 15, TWI: 17 };
  const ports = classicPorts(true);
  const G = { EIMSK: 0x5b, EIFR: 0x5a };
  ports.D.ext = {
    2: { EICR: 0x55, ...G, iscOffset: 0, index: 6, vec: v(1) },
    3: { EICR: 0x55, ...G, iscOffset: 2, index: 7, vec: v(2) },
  };
  // INT2 is edge-only (ISC2 in MCUCSR bit6: 0=falling, 1=rising). Mapped via virtual EICR in avr.js
  ports.B.ext = { 2: { EICR: 0x54, ...G, iscOffset: 6, index: 5, vec: v(N.INT2), int2: true } };
  return {
    id, name, gccMcu: id, package: 'DIP-40', flash, ramStart: 0x60, ramEnd: 0x60 + ram - 1, eeprom,
    pins: PINS_DIP40_M16, ports,
    timers: [
      { name: 'Timer0', kind: 'classic8', bits: 8, regs: { TCCR: 0x53, TCNT: 0x52, OCR: 0x5c, TIMSK: CLASSIC_TIMSK, TIFR: CLASSIC_TIFR },
        masks: { TOV: 0x01, OCFA: 0x02, TOIE: 0x01, OCIEA: 0x02 }, vec: { ovf: v(N.T0O), compA: v(N.T0C) }, dividers: DIV_T01, oc: { A: 'PB3' }, extClk: 'PB0' },
      { name: 'Timer1', kind: 'modern', bits: 16,
        regs: { TCCRA: 0x4f, TCCRB: 0x4e, TCNT: 0x4c, ICR: 0x46, OCRA: 0x4a, OCRB: 0x48, TIMSK: CLASSIC_TIMSK, TIFR: CLASSIC_TIFR },
        masks: { TOV: 0x04, OCFA: 0x10, OCFB: 0x08, OCFC: 0, TOIE: 0x04, OCIEA: 0x10, OCIEB: 0x08, OCIEC: 0 },
        vec: { ovf: v(N.T1O), compA: v(N.T1A), compB: v(N.T1B), capt: v(N.T1CAP) }, dividers: DIV_T01, oc: { A: 'PD5', B: 'PD4' }, extClk: 'PB1', focInB: true },
      { name: 'Timer2', kind: 'classic8', bits: 8, regs: { TCCR: 0x45, TCNT: 0x44, OCR: 0x43, TIMSK: CLASSIC_TIMSK, TIFR: CLASSIC_TIFR },
        masks: { TOV: 0x40, OCFA: 0x80, TOIE: 0x40, OCIEA: 0x80 }, vec: { ovf: v(N.T2O), compA: v(N.T2C) }, dividers: DIV_T2, oc: { A: 'PD7' } },
    ],
    usarts: [{ name: 'USART', regs: { UDR: 0x2c, UCSRA: 0x2b, UCSRB: 0x2a, UBRRL: 0x29, UBRRH_UCSRC: 0x40 }, ursel: true, vec: { rx: v(N.RX), udre: v(N.UDRE), tx: v(N.TX) }, rxd: 'PD0', txd: 'PD1' }],
    adc: {
      regs: { ADMUX: 0x27, ADCSRA: 0x26, ADCL: 0x24, ADCH: 0x25 }, vec: v(N.ADC),
      refs: [REF.AREF, REF.AVCC, REF.RES, REF.V256], muxMask: 0x1f,
      channels: { 0: 'PA0', 1: 'PA1', 2: 'PA2', 3: 'PA3', 4: 'PA4', 5: 'PA5', 6: 'PA6', 7: 'PA7' }, consts: { 30: 1.22, 31: 0 },
    },
    spi: { regs: { SPCR: 0x2d, SPSR: 0x2e, SPDR: 0x2f }, vec: v(N.SPI), pins: { SS: 'PB4', MOSI: 'PB5', MISO: 'PB6', SCK: 'PB7' } },
    twi: { regs: { TWBR: 0x20, TWSR: 0x21, TWAR: 0x22, TWDR: 0x23, TWCR: 0x56 }, vec: v(N.TWI), pins: { SCL: 'PC0', SDA: 'PC1' } },
    eepromRegs: { EECR: 0x3c, EEDR: 0x3d, EEARL: 0x3e, EEARH: 0x3f, vec: v(N.EE) },
    defaultClock: 16000000,
  };
}

// ---------------------------------------------------------------------------
// ATmega644P / 1284P
// ---------------------------------------------------------------------------
function atmega644_1284(id, name, flash, ram, eeprom, withT3) {
  const v = v2;
  const E = { EICR: 0x69, EIMSK: 0x3d, EIFR: 0x3c };
  const pc = (PCIE, PCMSK, n) => ({ PCIE, PCICR: 0x68, PCIFR: 0x3b, PCMSK, vec: v(n) });
  const timers = [
    modernTimer8('Timer0', { TCCRA: 0x44, TCNT: 0x46, OCRA: 0x47, OCRB: 0x48, TIMSK: 0x6e, TIFR: 0x35 },
      { ovf: v(18), compA: v(16), compB: v(17) }, { dividers: DIV_T01, oc: { A: 'PB3', B: 'PB4' }, extClk: 'PB0' }),
    modernTimer16('Timer1', 0x80, { ovf: v(15), compA: v(13), compB: v(14), capt: v(12) },
      { TIMSK: 0x6f, TIFR: 0x36, dividers: DIV_T01, oc: { A: 'PD5', B: 'PD4' }, extClk: 'PB1' }),
    modernTimer8('Timer2', { TCCRA: 0xb0, TCNT: 0xb2, OCRA: 0xb3, OCRB: 0xb4, TIMSK: 0x70, TIFR: 0x37 },
      { ovf: v(11), compA: v(9), compB: v(10) }, { dividers: DIV_T2, oc: { A: 'PD7', B: 'PD6' } }),
  ];
  if (withT3) {
    timers.push(modernTimer16('Timer3', 0x90, { ovf: v(34), compA: v(32), compB: v(33), capt: v(31) },
      { TIMSK: 0x71, TIFR: 0x38, dividers: DIV_T01, oc: { A: 'PB6', B: 'PB7' } }));
  }
  return {
    id, name, gccMcu: id, package: 'DIP-40', flash, ramStart: 0x100, ramEnd: 0x100 + ram - 1, eeprom,
    pins: PINS_DIP40_M644,
    ports: {
      A: { PIN: 0x20, DDR: 0x21, PORT: 0x22, pcint: pc(0, 0x6b, 4) },
      B: { PIN: 0x23, DDR: 0x24, PORT: 0x25, pcint: pc(1, 0x6c, 5), ext: { 2: { ...E, iscOffset: 4, index: 2, vec: v(3) } } },
      C: { PIN: 0x26, DDR: 0x27, PORT: 0x28, pcint: pc(2, 0x6d, 6) },
      D: {
        PIN: 0x29, DDR: 0x2a, PORT: 0x2b, pcint: pc(3, 0x73, 7),
        ext: { 2: { ...E, iscOffset: 0, index: 0, vec: v(1) }, 3: { ...E, iscOffset: 2, index: 1, vec: v(2) } },
      },
    },
    timers,
    usarts: [
      { name: 'USART0', regs: { UCSRA: 0xc0, UCSRB: 0xc1, UCSRC: 0xc2, UBRRL: 0xc4, UBRRH: 0xc5, UDR: 0xc6 }, vec: { rx: v(20), udre: v(21), tx: v(22) }, rxd: 'PD0', txd: 'PD1' },
      { name: 'USART1', regs: { UCSRA: 0xc8, UCSRB: 0xc9, UCSRC: 0xca, UBRRL: 0xcc, UBRRH: 0xcd, UDR: 0xce }, vec: { rx: v(28), udre: v(29), tx: v(30) }, rxd: 'PD2', txd: 'PD3' },
    ],
    adc: {
      regs: { ADMUX: 0x7c, ADCSRA: 0x7a, ADCSRB: 0x7b, ADCL: 0x78, ADCH: 0x79 }, vec: v(24),
      refs: [REF.AREF, REF.AVCC, REF.V11, REF.V256], muxMask: 0x1f,
      channels: { 0: 'PA0', 1: 'PA1', 2: 'PA2', 3: 'PA3', 4: 'PA4', 5: 'PA5', 6: 'PA6', 7: 'PA7' }, consts: { 30: 1.1, 31: 0 },
    },
    spi: { regs: { SPCR: 0x4c, SPSR: 0x4d, SPDR: 0x4e }, vec: v(19), pins: { SS: 'PB4', MOSI: 'PB5', MISO: 'PB6', SCK: 'PB7' } },
    twi: { regs: { TWBR: 0xb8, TWSR: 0xb9, TWAR: 0xba, TWDR: 0xbb, TWCR: 0xbc, TWAMR: 0xbd }, vec: v(26), pins: { SCL: 'PC0', SDA: 'PC1' } },
    eepromRegs: { EECR: 0x3f, EEDR: 0x40, EEARL: 0x41, EEARH: 0x42, vec: v(25) },
    defaultClock: 16000000,
  };
}

// ---------------------------------------------------------------------------
// ATmega128
// ---------------------------------------------------------------------------
function atmega128() {
  const v = v2;
  const EA = { EICR: 0x6a, EIMSK: 0x59, EIFR: 0x58 };
  const EB = { EICR: 0x5a, EIMSK: 0x59, EIFR: 0x58 };
  const TIMSK = 0x57, TIFR = 0x56, ETIMSK = 0x7d, ETIFR = 0x7c;
  return {
    id: 'atmega128', name: 'ATmega128', gccMcu: 'atmega128', package: 'TQFP-64', flash: 131072, ramStart: 0x100, ramEnd: 0x10ff, eeprom: 4096,
    pins: PINS_TQFP64_M128,
    ports: {
      A: { PIN: 0x39, DDR: 0x3a, PORT: 0x3b },
      B: { PIN: 0x36, DDR: 0x37, PORT: 0x38 },
      C: { PIN: 0x33, DDR: 0x34, PORT: 0x35 },
      D: {
        PIN: 0x30, DDR: 0x31, PORT: 0x32,
        ext: {
          0: { ...EA, iscOffset: 0, index: 0, vec: v(1) }, 1: { ...EA, iscOffset: 2, index: 1, vec: v(2) },
          2: { ...EA, iscOffset: 4, index: 2, vec: v(3) }, 3: { ...EA, iscOffset: 6, index: 3, vec: v(4) },
        },
      },
      E: {
        PIN: 0x21, DDR: 0x22, PORT: 0x23,
        ext: {
          4: { ...EB, iscOffset: 0, index: 4, vec: v(5) }, 5: { ...EB, iscOffset: 2, index: 5, vec: v(6) },
          6: { ...EB, iscOffset: 4, index: 6, vec: v(7) }, 7: { ...EB, iscOffset: 6, index: 7, vec: v(8) },
        },
      },
      F: { PIN: 0x20, DDR: 0x61, PORT: 0x62 },
      G: { PIN: 0x63, DDR: 0x64, PORT: 0x65, width: 5 },
    },
    timers: [
      { name: 'Timer0', kind: 'classic8', bits: 8, regs: { TCCR: 0x53, TCNT: 0x52, OCR: 0x51, TIMSK, TIFR },
        masks: { TOV: 0x01, OCFA: 0x02, TOIE: 0x01, OCIEA: 0x02 }, vec: { ovf: v(16), compA: v(15) }, dividers: DIV_128_T0, oc: { A: 'PB4' } },
      { name: 'Timer1', kind: 'modern', bits: 16,
        regs: { TCCRA: 0x4f, TCCRB: 0x4e, TCCRC: 0x7a, TCNT: 0x4c, ICR: 0x46, OCRA: 0x4a, OCRB: 0x48, OCRC: 0x78, TIMSK, TIFR },
        masks: { TOV: 0x04, OCFA: 0x10, OCFB: 0x08, OCFC: 0x01, TOIE: 0x04, OCIEA: 0x10, OCIEB: 0x08, OCIEC: 0x01 },
        compCRegs: { TIMSK: ETIMSK, TIFR: ETIFR },
        vec: { ovf: v(14), compA: v(12), compB: v(13), compC: v(24), capt: v(11) }, dividers: DIV_T01, oc: { A: 'PB5', B: 'PB6', C: 'PB7' }, extClk: 'PD6' },
      { name: 'Timer2', kind: 'classic8', bits: 8, regs: { TCCR: 0x45, TCNT: 0x44, OCR: 0x43, TIMSK, TIFR },
        masks: { TOV: 0x40, OCFA: 0x80, TOIE: 0x40, OCIEA: 0x80 }, vec: { ovf: v(10), compA: v(9) }, dividers: DIV_128_T2, oc: { A: 'PB7' }, extClk: 'PD7' },
      { name: 'Timer3', kind: 'modern', bits: 16,
        regs: { TCCRA: 0x8b, TCCRB: 0x8a, TCCRC: 0x8c, TCNT: 0x88, ICR: 0x80, OCRA: 0x86, OCRB: 0x84, OCRC: 0x82, TIMSK: ETIMSK, TIFR: ETIFR },
        masks: { TOV: 0x04, OCFA: 0x10, OCFB: 0x08, OCFC: 0x02, TOIE: 0x04, OCIEA: 0x10, OCIEB: 0x08, OCIEC: 0x02 },
        vec: { ovf: v(29), compA: v(26), compB: v(27), compC: v(28), capt: v(25) }, dividers: DIV_T01, oc: { A: 'PE3', B: 'PE4', C: 'PE5' }, extClk: 'PE6' },
    ],
    usarts: [
      { name: 'USART0', regs: { UDR: 0x2c, UCSRA: 0x2b, UCSRB: 0x2a, UBRRL: 0x29, UBRRH: 0x90, UCSRC: 0x95 }, vec: { rx: v(18), udre: v(19), tx: v(20) }, rxd: 'PE0', txd: 'PE1' },
      { name: 'USART1', regs: { UDR: 0x9c, UCSRA: 0x9b, UCSRB: 0x9a, UBRRL: 0x99, UBRRH: 0x98, UCSRC: 0x9d }, vec: { rx: v(30), udre: v(31), tx: v(32) }, rxd: 'PD2', txd: 'PD3' },
    ],
    adc: {
      regs: { ADMUX: 0x27, ADCSRA: 0x26, ADCL: 0x24, ADCH: 0x25 }, vec: v(21),
      refs: [REF.AREF, REF.AVCC, REF.RES, REF.V256], muxMask: 0x1f,
      channels: { 0: 'PF0', 1: 'PF1', 2: 'PF2', 3: 'PF3', 4: 'PF4', 5: 'PF5', 6: 'PF6', 7: 'PF7' }, consts: { 30: 1.23, 31: 0 },
    },
    spi: { regs: { SPCR: 0x2d, SPSR: 0x2e, SPDR: 0x2f }, vec: v(17), pins: { SS: 'PB0', SCK: 'PB1', MOSI: 'PB2', MISO: 'PB3' } },
    twi: { regs: { TWBR: 0x70, TWSR: 0x71, TWAR: 0x72, TWDR: 0x73, TWCR: 0x74 }, vec: v(33), pins: { SCL: 'PD0', SDA: 'PD1' } },
    eepromRegs: { EECR: 0x3c, EEDR: 0x3d, EEARL: 0x3e, EEARH: 0x3f, vec: v(22) },
    defaultClock: 16000000,
  };
}

// ---------------------------------------------------------------------------
// ATmega2560
// ---------------------------------------------------------------------------
function atmega2560() {
  const v = v2;
  const EA = { EICR: 0x69, EIMSK: 0x3d, EIFR: 0x3c };
  const EB = { EICR: 0x6a, EIMSK: 0x3d, EIFR: 0x3c };
  const ext = (EI, off, idx) => ({ ...EI, iscOffset: off, index: idx, vec: v(idx + 1) });
  const t16 = (name, a, n, TIMSK, TIFR, oc, extClk) => modernTimer16(name, a,
    { capt: v(n), compA: v(n + 1), compB: v(n + 2), compC: v(n + 3), ovf: v(n + 4) },
    { TIMSK, TIFR, dividers: DIV_T01, oc, extClk });
  const ports = {
    A: { PIN: 0x20, DDR: 0x21, PORT: 0x22 },
    B: { PIN: 0x23, DDR: 0x24, PORT: 0x25, pcint: { PCIE: 0, PCICR: 0x68, PCIFR: 0x3b, PCMSK: 0x6b, vec: v(9) } },
    C: { PIN: 0x26, DDR: 0x27, PORT: 0x28 },
    D: { PIN: 0x29, DDR: 0x2a, PORT: 0x2b, ext: { 0: ext(EA, 0, 0), 1: ext(EA, 2, 1), 2: ext(EA, 4, 2), 3: ext(EA, 6, 3) } },
    E: { PIN: 0x2c, DDR: 0x2d, PORT: 0x2e, ext: { 4: ext(EB, 0, 4), 5: ext(EB, 2, 5), 6: ext(EB, 4, 6), 7: ext(EB, 6, 7) } },
    F: { PIN: 0x2f, DDR: 0x30, PORT: 0x31 },
    G: { PIN: 0x32, DDR: 0x33, PORT: 0x34, width: 6 },
    H: { PIN: 0x100, DDR: 0x101, PORT: 0x102 },
    J: { PIN: 0x103, DDR: 0x104, PORT: 0x105, pcint: { PCIE: 1, PCICR: 0x68, PCIFR: 0x3b, PCMSK: 0x6c, vec: v(10), mask: 0x7f, offset: 1 } },
    K: { PIN: 0x106, DDR: 0x107, PORT: 0x108, pcint: { PCIE: 2, PCICR: 0x68, PCIFR: 0x3b, PCMSK: 0x6d, vec: v(11) } },
    L: { PIN: 0x109, DDR: 0x10a, PORT: 0x10b },
  };
  const adcCh = {};
  for (let i = 0; i < 8; i++) { adcCh[i] = 'PF' + i; adcCh[0x20 + i] = 'PK' + i; }
  return {
    id: 'atmega2560', name: 'ATmega2560', gccMcu: 'atmega2560', package: 'TQFP-100', flash: 262144, ramStart: 0x200, ramEnd: 0x21ff, eeprom: 4096,
    pins: PINS_TQFP100_M2560, ports,
    timers: [
      modernTimer8('Timer0', { TCCRA: 0x44, TCNT: 0x46, OCRA: 0x47, OCRB: 0x48, TIMSK: 0x6e, TIFR: 0x35 },
        { ovf: v(23), compA: v(21), compB: v(22) }, { dividers: DIV_T01, oc: { A: 'PB7', B: 'PG5' }, extClk: 'PD7' }),
      t16('Timer1', 0x80, 16, 0x6f, 0x36, { A: 'PB5', B: 'PB6', C: 'PB7' }, 'PD6'),
      modernTimer8('Timer2', { TCCRA: 0xb0, TCNT: 0xb2, OCRA: 0xb3, OCRB: 0xb4, TIMSK: 0x70, TIFR: 0x37 },
        { ovf: v(15), compA: v(13), compB: v(14) }, { dividers: DIV_T2, oc: { A: 'PB4', B: 'PH6' } }),
      t16('Timer3', 0x90, 31, 0x71, 0x38, { A: 'PE3', B: 'PE4', C: 'PE5' }, 'PE6'),
      t16('Timer4', 0xa0, 41, 0x72, 0x39, { A: 'PH3', B: 'PH4', C: 'PH5' }, 'PH7'),
      t16('Timer5', 0x120, 46, 0x73, 0x3a, { A: 'PL3', B: 'PL4', C: 'PL5' }, 'PL2'),
    ],
    usarts: [
      { name: 'USART0', regs: { UCSRA: 0xc0, UCSRB: 0xc1, UCSRC: 0xc2, UBRRL: 0xc4, UBRRH: 0xc5, UDR: 0xc6 }, vec: { rx: v(25), udre: v(26), tx: v(27) }, rxd: 'PE0', txd: 'PE1' },
      { name: 'USART1', regs: { UCSRA: 0xc8, UCSRB: 0xc9, UCSRC: 0xca, UBRRL: 0xcc, UBRRH: 0xcd, UDR: 0xce }, vec: { rx: v(36), udre: v(37), tx: v(38) }, rxd: 'PD2', txd: 'PD3' },
      { name: 'USART2', regs: { UCSRA: 0xd0, UCSRB: 0xd1, UCSRC: 0xd2, UBRRL: 0xd4, UBRRH: 0xd5, UDR: 0xd6 }, vec: { rx: v(51), udre: v(52), tx: v(53) }, rxd: 'PH0', txd: 'PH1' },
      { name: 'USART3', regs: { UCSRA: 0x130, UCSRB: 0x131, UCSRC: 0x132, UBRRL: 0x134, UBRRH: 0x135, UDR: 0x136 }, vec: { rx: v(54), udre: v(55), tx: v(56) }, rxd: 'PJ0', txd: 'PJ1' },
    ],
    adc: {
      regs: { ADMUX: 0x7c, ADCSRA: 0x7a, ADCSRB: 0x7b, ADCL: 0x78, ADCH: 0x79 }, vec: v(29),
      refs: [REF.AREF, REF.AVCC, REF.V11, REF.V256], muxMask: 0x3f, mux5: true,
      channels: adcCh, consts: { 30: 1.1, 31: 0 },
    },
    spi: { regs: { SPCR: 0x4c, SPSR: 0x4d, SPDR: 0x4e }, vec: v(24), pins: { SS: 'PB0', SCK: 'PB1', MOSI: 'PB2', MISO: 'PB3' } },
    twi: { regs: { TWBR: 0xb8, TWSR: 0xb9, TWAR: 0xba, TWDR: 0xbb, TWCR: 0xbc, TWAMR: 0xbd }, vec: v(39), pins: { SCL: 'PD0', SDA: 'PD1' } },
    eepromRegs: { EECR: 0x3f, EEDR: 0x40, EEARL: 0x41, EEARH: 0x42, vec: v(30) },
    defaultClock: 16000000,
  };
}

export const DEVICES = {};
for (const d of [
  atmega8(),
  atmega16_32('atmega16', 'ATmega16', 16384, 1024, 512),
  atmega16_32('atmega32', 'ATmega32', 32768, 2048, 1024),
  atmega128(),
  megaX8('atmega168', 'ATmega168', 16384, 1024, 512),
  megaX8('atmega328p', 'ATmega328P', 32768, 2048, 1024),
  atmega644_1284('atmega644p', 'ATmega644P', 65536, 4096, 2048, false),
  atmega644_1284('atmega1284p', 'ATmega1284P', 131072, 16384, 4096, true),
  atmega2560(),
]) {
  DEVICES[d.id] = d;
}

export function getDevice(id) {
  return DEVICES[id] || DEVICES.atmega328p;
}

/** Parse 'PB5' -> {port:'B', bit:5} */
export function parsePortPin(name) {
  const m = /^P([A-L])([0-7])$/.exec(name || '');
  return m ? { port: m[1], bit: +m[2] } : null;
}

/** Display label for a pin row, e.g. "PB1 (OC1A)" */
export function pinLabel(row) {
  const [, name, ...alt] = row;
  return alt.length ? `${name} (${alt.join('/')})` : name;
}
