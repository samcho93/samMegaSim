// AVR MCU runtime built on avr8js. Builds peripherals from a device definition
// (see devices.js), including register remapping for classic ATmega parts.
import {
  CPU, avrInstruction, AVRIOPort, AVRTimer, AVRUSART, AVRADC, AVRSPI, AVRTWI, AVREEPROM,
  EEPROMMemoryBackend, PinState, ADCMuxInputType,
} from '../../vendor/avr8js.mjs';
import { parsePortPin } from './devices.js';
import { parseIntelHex } from '../util/ihex.js';

const ADSC = 0x40, ADATE = 0x20, ADEN = 0x80;

export class AVRMcu {
  constructor(device, clockHz, opts = {}) {
    this.device = device;
    this.clockHz = clockHz || device.defaultClock;
    this.vcc = opts.vcc ?? 5;
    // data space: registers + SRAM + a spare area used for virtual registers
    const dataSize = device.ramEnd + 1 + 0x100;
    this.cpu = new CPU(new Uint16Array(device.flash / 2), dataSize - 0x100);
    this._virt = device.ramEnd + 0x10;
    this.ports = {};
    this.timers = [];
    this.usarts = [];
    this.listeners = new Set(); // (portLetter) => void
    this.serialListeners = new Set(); // (usartIndex, byte) => void
    this.spiHandler = null; // (byte) => byte
    this.twiHandler = null; // TWI event handler object
    this.analogReader = null; // (pinName) => volts
    this.arefReader = null; // () => volts|null
    this.programLoaded = false;
    this.programInfo = null;
    this._target = 0;
    this.misoReader = null;
    this._resetInits = [];
    this._build();
    for (const f of this._resetInits) f();
  }

  virt() { return this._virt++; }

  _build() {
    const { cpu, device } = this;
    // --- GPIO ports ---
    for (const [letter, p] of Object.entries(device.ports)) {
      const cfg = { PIN: p.PIN, DDR: p.DDR, PORT: p.PORT, externalInterrupts: [] };
      if (p.pcint) {
        cfg.pinChange = {
          PCIE: p.pcint.PCIE, PCICR: p.pcint.PCICR, PCIFR: p.pcint.PCIFR, PCMSK: p.pcint.PCMSK,
          pinChangeInterrupt: p.pcint.vec, mask: p.pcint.mask ?? 0xff, offset: p.pcint.offset ?? 0,
        };
      }
      if (p.ext) {
        for (const [bit, e] of Object.entries(p.ext)) {
          let EICR = e.EICR, iscOffset = e.iscOffset;
          if (e.int2) {
            // ATmega16/32 INT2: single ISC2 bit (MCUCSR.6), 0 = falling, 1 = rising edge
            const virtEICR = this.virt();
            const real = e.EICR;
            this._resetInits.push(() => { cpu.data[virtEICR] = 2; });
            const prev = cpu.writeHooks[real];
            cpu.writeHooks[real] = (value, old, addr, mask) => {
              cpu.data[virtEICR] = value & 0x40 ? 3 : 2;
              return prev ? prev(value, old, addr, mask) : false;
            };
            EICR = virtEICR; iscOffset = 0;
          }
          cfg.externalInterrupts[+bit] = { EICR, EIMSK: e.EIMSK, EIFR: e.EIFR, iscOffset, index: e.index, interrupt: e.vec };
        }
      }
      const port = new AVRIOPort(cpu, cfg);
      port.addListener(() => this._notify(letter));
      this.ports[letter] = port;
    }

    // --- Timers ---
    const addr = (pinName) => {
      const pp = parsePortPin(pinName);
      return pp ? { port: device.ports[pp.port].PORT, pin: pp.bit } : { port: 0, pin: 0 };
    };
    for (const t of device.timers) {
      const r = t.regs, m = t.masks;
      const ocA = addr(t.oc?.A), ocB = addr(t.oc?.B), ocC = addr(t.oc?.C), ext = addr(t.extClk);
      const cfg = {
        bits: t.bits, dividers: t.dividers,
        captureInterrupt: t.vec.capt || 0, compAInterrupt: t.vec.compA || 0, compBInterrupt: t.vec.compB || 0,
        compCInterrupt: t.vec.compC || 0, ovfInterrupt: t.vec.ovf || 0,
        TIFR: r.TIFR, TIMSK: r.TIMSK, TCNT: r.TCNT,
        OCRA: 0, OCRB: 0, OCRC: 0, ICR: 0, TCCRA: 0, TCCRB: 0, TCCRC: 0,
        TOV: m.TOV, OCFA: m.OCFA || 0, OCFB: m.OCFB || 0, OCFC: m.OCFC || 0,
        TOIE: m.TOIE, OCIEA: m.OCIEA || 0, OCIEB: m.OCIEB || 0, OCIEC: m.OCIEC || 0,
        compPortA: ocA.port, compPinA: ocA.pin, compPortB: ocB.port, compPinB: ocB.pin,
        compPortC: ocC.port, compPinC: ocC.pin, externalClockPort: ext.port, externalClockPin: ext.pin,
      };
      if (t.kind === 'modern') {
        Object.assign(cfg, {
          TCCRA: r.TCCRA, TCCRB: r.TCCRB, OCRA: r.OCRA, OCRB: r.OCRB || this.virt(),
          OCRC: r.OCRC || 0, ICR: t.bits === 16 ? r.ICR : 0,
          TCCRC: r.TCCRC || (t.bits === 16 ? this.virt() : 0),
        });
        const timer = new AVRTimer(cpu, cfg);
        if (t.compCRegs) {
          timer.OCFC.enableRegister = t.compCRegs.TIMSK;
          timer.OCFC.flagRegister = t.compCRegs.TIFR;
        }
        this.timers.push({ def: t, timer });
      } else {
        // classic single-register 8-bit timer: TCCRn -> virtual TCCRA/TCCRB
        const vA = this.virt(), vB = this.virt();
        const vOCRB = this.virt();
        Object.assign(cfg, { TCCRA: vA, TCCRB: vB, OCRA: r.OCR || this.virt(), OCRB: vOCRB });
        const timer = new AVRTimer(cpu, cfg);
        cpu.writeHooks[r.TCCR] = (value) => {
          cpu.data[r.TCCR] = value & 0x7f;
          let a = 0, b = value & 7;
          if (!t.csOnly) {
            a = (((value >> 4) & 3) << 6) | ((value >> 6) & 1) | (((value >> 3) & 1) << 1);
            if (value & 0x80) b |= 0x80; // FOCn -> FOCnA
          }
          cpu.writeData(vA, a);
          cpu.writeData(vB, b);
          return true;
        };
        this.timers.push({ def: t, timer });
      }
    }
    // Unified TIFR / TIMSK hooks (registers may be shared between timers on classic parts)
    const flagGroups = new Map(), maskGroups = new Map();
    for (const { timer } of this.timers) {
      for (const irq of [timer.OVF, timer.OCFA, timer.OCFB, timer.OCFC]) {
        if (!irq.flagMask || !irq.address) continue;
        if (!flagGroups.has(irq.flagRegister)) flagGroups.set(irq.flagRegister, []);
        flagGroups.get(irq.flagRegister).push(irq);
        if (!maskGroups.has(irq.enableRegister)) maskGroups.set(irq.enableRegister, []);
        maskGroups.get(irq.enableRegister).push(irq);
      }
    }
    for (const [reg, irqs] of flagGroups) {
      cpu.writeHooks[reg] = (value) => {
        for (const irq of irqs) cpu.clearInterruptByFlag(irq, value);
        return true;
      };
    }
    for (const [reg, irqs] of maskGroups) {
      cpu.writeHooks[reg] = (value) => {
        cpu.data[reg] = value;
        for (const irq of irqs) cpu.updateInterruptEnable(irq, value);
        return true;
      };
    }

    // --- USARTs ---
    device.usarts.forEach((u, index) => {
      const r = u.regs;
      const cfg = {
        rxCompleteInterrupt: u.vec.rx, dataRegisterEmptyInterrupt: u.vec.udre, txCompleteInterrupt: u.vec.tx,
        UCSRA: r.UCSRA, UCSRB: r.UCSRB, UCSRC: r.UCSRC, UBRRL: r.UBRRL, UBRRH: r.UBRRH, UDR: r.UDR,
      };
      if (u.ursel) {
        cfg.UCSRC = this.virt();
        cfg.UBRRH = this.virt();
      }
      const usart = new AVRUSART(cpu, cfg, this.clockHz);
      if (u.ursel) {
        const shared = r.UBRRH_UCSRC;
        cpu.writeHooks[shared] = (value) => {
          if (value & 0x80) cpu.writeData(cfg.UCSRC, value & 0x7f);
          else cpu.writeData(cfg.UBRRH, value & 0x0f);
          cpu.data[shared] = value;
          return true;
        };
      }
      // TXEN/RXEN override the pin direction: tell the circuit when they change
      const ucsrbHook = cpu.writeHooks[cfg.UCSRB];
      cpu.writeHooks[cfg.UCSRB] = (value, old, addr, mask) => {
        const r = ucsrbHook(value, old, addr, mask);
        if ((value ^ old) & 0x18) { this._notifyPin(u.txd); this._notifyPin(u.rxd); }
        return r;
      };
      const st = { def: u, usart, index, txLevel: 1, txBusyUntil: 0 };
      usart.onByteTransmit = (value) => this._onUsartTx(st, value);
      this.usarts.push(st);
    });

    // --- ADC ---
    if (device.adc) {
      const a = device.adc;
      const muxChannels = {};
      for (const k of Object.keys(a.channels)) muxChannels[k] = { type: ADCMuxInputType.SingleEnded, channel: +k };
      for (const [k, v] of Object.entries(a.consts || {})) muxChannels[k] = { type: ADCMuxInputType.Constant, voltage: v };
      if (a.temp != null) muxChannels[a.temp] = { type: ADCMuxInputType.Temperature };
      const cfg = {
        ADMUX: a.regs.ADMUX, ADCSRA: a.regs.ADCSRA, ADCSRB: a.regs.ADCSRB || this.virt(),
        ADCL: a.regs.ADCL, ADCH: a.regs.ADCH, DIDR0: this.virt(), adcInterrupt: a.vec,
        numChannels: 64, muxInputMask: a.muxMask, muxChannels, adcReferences: a.refs,
      };
      const adc = new AVRADC(cpu, cfg);
      adc.avcc = this.vcc;
      adc.aref = this.vcc;
      const readInput = (input) => {
        switch (input.type) {
          case ADCMuxInputType.Constant: return input.voltage;
          case ADCMuxInputType.SingleEnded: {
            const pin = a.channels[input.channel];
            return pin && this.analogReader ? this.analogReader(pin) : 0;
          }
          case ADCMuxInputType.Temperature: return 0.314;
          default: return 0;
        }
      };
      adc.onADCRead = (input) => {
        const ar = this.arefReader?.();
        adc.aref = ar != null && ar > 0.1 ? ar : this.vcc;
        adc.avcc = this.vcc;
        const voltage = readInput(input);
        const raw = (voltage / adc.referenceVoltage) * 1024;
        const result = Math.min(Math.max(Math.floor(raw), 0), 1023);
        cpu.addClockEvent(() => adc.completeADCRead(result), adc.sampleCycles);
      };
      // Free-running mode (ADFR / ADATE with ADTS = 0)
      const origComplete = adc.completeADCRead.bind(adc);
      adc.completeADCRead = (value) => {
        origComplete(value);
        const sra = cpu.data[cfg.ADCSRA];
        const freeRun = (sra & ADATE) && (sra & ADEN) &&
          (!a.regs.ADCSRB || (cpu.data[a.regs.ADCSRB] & 7) === 0);
        if (freeRun) {
          let ch = cpu.data[cfg.ADMUX] & 0x1f;
          if (a.mux5 && cpu.data[cfg.ADCSRB] & 0x08) ch |= 0x20;
          ch &= cfg.muxInputMask;
          cpu.data[cfg.ADCSRA] |= ADSC;
          adc.converting = true;
          adc.onADCRead(muxChannels[ch] || { type: ADCMuxInputType.Constant, voltage: 0 });
        }
      };
      this.adc = adc;
    }

    // --- SPI ---
    if (device.spi) {
      const s = device.spi;
      const spi = new AVRSPI(cpu, { spiInterrupt: s.vec, SPCR: s.regs.SPCR, SPSR: s.regs.SPSR, SPDR: s.regs.SPDR }, this.clockHz);
      this.spi = spi;
      const spcrHook = cpu.writeHooks[s.regs.SPCR];
      cpu.writeHooks[s.regs.SPCR] = (value, old, addr, mask) => {
        const r = spcrHook(value, old, addr, mask);
        if ((value ^ old) & 0x5c) { this._notifyPin(s.pins.SCK); this._notifyPin(s.pins.MOSI); }
        return r;
      };
      // Bit-level SPI master: generate SCK/MOSI waveforms and sample MISO from the circuit
      const st = this._spi = { active: false, sck: 0, mosi: 0 };
      spi.onByte = (value) => {
        const spcr = cpu.data[s.regs.SPCR];
        if (!(spcr & 0x10)) { // slave mode: not driven by us
          cpu.addClockEvent(() => spi.completeTransfer(0xff), spi.transferCycles);
          return;
        }
        const cpol = (spcr >> 3) & 1, cpha = (spcr >> 2) & 1, lsb = (spcr >> 5) & 1;
        const h = Math.max(1, spi.clockDivider / 2);
        const bit = (i) => (lsb ? (value >> i) & 1 : (value >> (7 - i)) & 1);
        let rx = 0;
        const sample = () => {
          const b = this.misoReader ? this.misoReader(s.pins.MISO) : 1;
          rx = lsb ? (rx >> 1) | (b << 7) : ((rx << 1) | b) & 0xff;
        };
        const setMosi = (v) => { if (st.mosi !== v) { st.mosi = v; this._notifyPin(s.pins.MOSI); } };
        const setSck = (v) => { if (st.sck !== v) { st.sck = v; this._notifyPin(s.pins.SCK); } };
        st.active = true; st.sck = cpol;
        if (!cpha) setMosi(bit(0));
        for (let i = 0; i < 8; i++) {
          const e1 = (2 * i + 1) * h, e2 = (2 * i + 2) * h;
          cpu.addClockEvent(() => { if (cpha) setMosi(bit(i)); setSck(cpol ^ 1); if (!cpha) sample(); }, e1);
          cpu.addClockEvent(() => {
            setSck(cpol);
            if (cpha) sample();
            else if (i < 7) setMosi(bit(i + 1));
            if (i === 7) { st.active = false; spi.completeTransfer(rx); }
          }, e2);
        }
      };
    }

    // --- TWI ---
    if (device.twi) {
      const t = device.twi;
      const twi = new AVRTWI(cpu, {
        twiInterrupt: t.vec, TWBR: t.regs.TWBR, TWSR: t.regs.TWSR, TWAR: t.regs.TWAR,
        TWDR: t.regs.TWDR, TWCR: t.regs.TWCR, TWAMR: t.regs.TWAMR || this.virt(),
      }, this.clockHz);
      this.twi = twi;
    }

    // --- EEPROM ---
    if (device.eepromRegs) {
      const e = device.eepromRegs;
      this.eepromBackend = new EEPROMMemoryBackend(device.eeprom);
      const cyc = Math.round(this.clockHz * 0.0034);
      this.eeprom = new AVREEPROM(cpu, this.eepromBackend, {
        eepromReadyInterrupt: e.vec, EECR: e.EECR, EEDR: e.EEDR, EEARL: e.EEARL, EEARH: e.EEARH,
        eraseCycles: cyc, writeCycles: cyc,
      });
    }

    // Map pin name -> USART override info
    this._txdPins = new Map();
    this._rxdPins = new Map();
    for (const st of this.usarts) {
      this._txdPins.set(st.def.txd, st);
      this._rxdPins.set(st.def.rxd, st);
    }
  }

  // ---------------------------------------------------------------------------
  loadHex(hexText) {
    const { data, maxAddr } = parseIntelHex(hexText, this.device.flash);
    this.cpu.progBytes.fill(0xff);
    this.cpu.progBytes.set(data.subarray(0, Math.min(data.length, this.cpu.progBytes.length)));
    this.programLoaded = true;
    this.programInfo = { bytes: maxAddr };
    this.reset();
  }

  reset() {
    const { cpu } = this;
    cpu.data.fill(0);
    cpu.reset();
    cpu.cycles = 0;
    for (const f of this._resetInits) f();
    for (const { timer } of this.timers) timer.reset?.();
    if (this.adc) this.adc.converting = false;
    for (const st of this.usarts) { st.usart.reset(); st.txLevel = 1; }
    // Re-apply port state (all inputs)
    for (const port of Object.values(this.ports)) {
      cpu.writeData(port.portConfig.DDR, 0);
      cpu.writeData(port.portConfig.PORT, 0);
    }
    this.cpu.SP = this.device.ramEnd;
  }

  get time() { return this.cpu.cycles / this.clockHz; }

  /** Execute until the given simulation time (seconds). */
  runUntil(t) {
    const { cpu } = this;
    this._target = Math.ceil(t * this.clockHz - 1e-6);
    if (!this.programLoaded) { if (cpu.cycles < this._target) cpu.cycles = this._target; return; }
    while (cpu.cycles < this._target) {
      avrInstruction(cpu);
      cpu.tick();
    }
  }

  /** Stop the current runUntil() early at time t (used when events get scheduled) */
  limitTo(t) {
    const c = Math.ceil(t * this.clockHz);
    if (c < this._target) this._target = Math.max(c, this.cpu.cycles);
  }

  skipTo(t) {
    const c = Math.ceil(t * this.clockHz - 1e-6);
    if (this.cpu.cycles < c) this.cpu.cycles = c;
  }

  step() {
    avrInstruction(this.cpu);
    this.cpu.tick();
  }

  // ---------------------------------------------------------------------------
  // Pin interface
  // ---------------------------------------------------------------------------
  /** Returns {mode:'out'|'in'|'pullup', level:0|1} for a port pin name like "PB5" */
  pinDrive(pinName) {
    const tx = this._txdPins.get(pinName);
    if (tx && (this.cpu.data[tx.def.regs.UCSRB] & 0x08)) {
      return { mode: 'out', level: tx.txLevel };
    }
    const pp = parsePortPin(pinName);
    if (!pp) return null;
    const port = this.ports[pp.port];
    if (!port) return null;
    if (this._spi && (this.cpu.data[this.device.spi.regs.SPCR] & 0x50) === 0x50) {
      const sp = this.device.spi.pins;
      const isOut = this.cpu.data[port.portConfig.DDR] & (1 << pp.bit);
      if (isOut && pinName === sp.SCK) return { mode: 'out', level: this._spi.active ? this._spi.sck : (this.cpu.data[this.device.spi.regs.SPCR] >> 3) & 1 };
      if (isOut && pinName === sp.MOSI) return { mode: 'out', level: this._spi.mosi };
    }
    const rx = this._rxdPins.get(pinName);
    let st = port.pinState(pp.bit);
    if (rx && (this.cpu.data[rx.def.regs.UCSRB] & 0x10)) {
      st = this.cpu.data[port.portConfig.PORT] & (1 << pp.bit) ? PinState.InputPullUp : PinState.Input;
    }
    switch (st) {
      case PinState.High: return { mode: 'out', level: 1 };
      case PinState.Low: return { mode: 'out', level: 0 };
      case PinState.InputPullUp: return { mode: 'pullup', level: 1 };
      default: return { mode: 'in', level: 0 };
    }
  }

  setPinInput(pinName, value) {
    const pp = parsePortPin(pinName);
    if (!pp) return;
    this.ports[pp.port]?.setPin(pp.bit, !!value);
  }

  _notify(letter) {
    for (const l of this.listeners) l(letter);
  }

  // ---------------------------------------------------------------------------
  // USART
  // ---------------------------------------------------------------------------
  _onUsartTx(st, value) {
    for (const l of this.serialListeners) l(st.index, value, st);
    // Generate the TXD waveform (start bit, 8 data bits LSB first, stop bit)
    const { usart } = st;
    const bits = usart.bitsPerChar;
    const frame = [0];
    for (let i = 0; i < Math.min(bits, 8); i++) frame.push((value >> i) & 1);
    if (usart.parityEnabled) {
      let p = 0;
      for (let i = 0; i < bits; i++) p ^= (value >> i) & 1;
      frame.push(usart.parityOdd ? p ^ 1 : p);
    }
    frame.push(1);
    if (usart.stopBits === 2) frame.push(1);
    const bitCycles = Math.max(1, Math.round(this.clockHz / usart.baudRate));
    const txPin = st.def.txd;
    frame.forEach((lvl, i) => {
      this.cpu.addClockEvent(() => {
        if (st.txLevel !== lvl) {
          st.txLevel = lvl;
          this._notifyPin(txPin);
        }
      }, 1 + i * bitCycles);
    });
  }

  _notifyPin(pinName) {
    const pp = parsePortPin(pinName);
    if (pp) this._notify(pp.port);
  }

  serialWrite(index, byte) {
    const st = this.usarts[index];
    if (!st) return false;
    return st.usart.writeByte(byte);
  }

  usartInfo(index) {
    const st = this.usarts[index];
    if (!st) return null;
    const { usart } = st;
    return { baud: usart.baudRate, rxEnable: usart.rxEnable, txEnable: usart.txEnable, bits: usart.bitsPerChar };
  }

  // ---------------------------------------------------------------------------
  // Debug views
  // ---------------------------------------------------------------------------
  get pc() { return this.cpu.pc * 2; }

  registers() {
    const d = this.cpu.data;
    return { r: Array.from(d.subarray(0, 32)), sreg: d[0x5f], sp: this.cpu.SP, pc: this.pc };
  }

  portRegisters() {
    const out = [];
    for (const [letter, port] of Object.entries(this.ports)) {
      const c = port.portConfig;
      out.push({ port: letter, PORT: this.cpu.data[c.PORT], DDR: this.cpu.data[c.DDR], PIN: this.cpu.data[c.PIN] });
    }
    return out;
  }
}
