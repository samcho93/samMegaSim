// Simulation orchestrator: builds the circuit from the schematic, steps MCUs,
// processes timed events and routes serial / I2C traffic.
import { LIB } from '../parts/kit.js';
import { buildNetlist } from './netlist.js';
import { Circuit } from './circuit.js';

class EventQueue {
  constructor() { this.h = []; this.seq = 0; }
  push(t, fn) {
    const h = this.h;
    h.push({ t, fn, s: this.seq++ });
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._lt(h[i], h[p])) { [h[i], h[p]] = [h[p], h[i]]; i = p; } else break;
    }
  }
  _lt(a, b) { return a.t < b.t || (a.t === b.t && a.s < b.s); }
  peek() { return this.h.length ? this.h[0].t : Infinity; }
  pop() {
    const h = this.h;
    const top = h[0];
    const last = h.pop();
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < h.length && this._lt(h[l], h[m])) m = l;
        if (r < h.length && this._lt(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.h.length; }
}

/** Routes the avr8js TWI master events to I2C slave devices on the same bus */
class TwiBus {
  constructor(sim, mcuInst) {
    this.sim = sim; this.inst = mcuInst; this.twi = mcuInst.mcu.twi;
    this.dev = null;
  }
  devices() {
    const { sda, scl } = this.inst.twiNodes || {};
    return this.sim.i2cDevices.filter((d) => d.sda === sda && d.scl === scl && sda != null);
  }
  start() { this.twi.completeStart(); }
  stop() { this.dev?.stop?.(); this.dev = null; this.twi.completeStop(); }
  connectToSlave(addr, write) {
    this.dev = this.devices().find((d) => (d.accepts ? d.accepts(addr) : d.address === addr)) || null;
    if (this.dev) this.dev.start?.(write, addr);
    if (!this.dev) {
      this.nacked ||= new Set();
      if (!this.nacked.has(addr)) {
        this.nacked.add(addr);
        this.sim.log?.(`I2C: 주소 0x${addr.toString(16).padStart(2, '0')} 에 응답하는 장치가 없습니다 (NACK)`, 'warn');
      }
    }
    this.twi.completeConnect(!!this.dev);
  }
  writeByte(v) { this.twi.completeWrite(this.dev ? this.dev.write(v) !== false : false); }
  readByte(ack) { this.twi.completeRead(this.dev ? this.dev.read(ack) & 0xff : 0xff); }
}

export class Simulator {
  constructor(doc, opts = {}) {
    this.doc = doc;
    this.vcc = 5;
    this.audio = opts.audio || null;
    this.log = opts.log || (() => {});
    this.events = new EventQueue();
    this.mcus = [];
    this.instruments = [];
    this.i2cDevices = [];
    this.instances = new Map();
    this.time = 0;
    this.running = false;
    this.speed = 1;
    this.stats = { speed: 0, solves: 0 };
    this._build();
  }

  _build() {
    const nl = this.netlist = buildNetlist(this.doc);
    for (const w of nl.warnings) this.log(w, 'warn');
    // nets -> circuit nodes
    const nodeOf = new Int32Array(nl.nets.length);
    let count = 0;
    for (const net of nl.nets) nodeOf[net.index] = net.isGround ? -1 : count++;
    this.nodeOf = nodeOf;
    const circuit = this.circuit = new Circuit(count);
    // Power rails (ideal sources)
    for (const net of nl.nets) {
      if (net.power && !net.isGround) {
        const node = nodeOf[net.index];
        const v = net.power.voltage;
        circuit.add({ vsCount: 1, stamp(S) { S.V(this.vsBase, node, -1, v); } });
      }
    }
    // Parts
    for (const part of this.doc.parts) {
      const def = LIB[part.type];
      if (!def?.sim) continue;
      const n = (pinId) => {
        const idx = nl.pinNet.get(`${part.id}:${pinId}`);
        return idx === undefined ? -1 : nodeOf[idx];
      };
      let inst;
      try {
        inst = def.sim(part, n, this);
      } catch (e) {
        console.error(e);
        this.log(`${part.ref}: 시뮬레이션 모델 오류 - ${e.message}`, 'error');
        continue;
      }
      if (!inst) continue;
      this.instances.set(part.id, inst);
      if (inst.stamp) circuit.add(inst);
      for (const el of inst.elements || []) if (el) circuit.add(el);
    }
    circuit.finalize();
    // TWI buses
    for (const m of this.mcus) {
      if (!m.mcu.twi || !m.device.twi) continue;
      const pins = m.device.twi.pins;
      m.twiNodes = { sda: m.pinByName.get(pins.SDA)?.node ?? null, scl: m.pinByName.get(pins.SCL)?.node ?? null };
      m.mcu.twi.eventHandler = new TwiBus(this, m);
    }
    // Serial routing MCU -> MCU (UART between chips)
    for (const m of this.mcus) {
      m.mcu.serialListeners.add((index, byte, st) => {
        const txNode = m.pinByName.get(st.def.txd)?.node;
        if (txNode == null) return;
        const baud = st.usart.baudRate;
        const delay = 10 / baud;
        this.schedule(m.mcu.time + delay, () => { this.deliverSerial(txNode, byte, baud, m); return false; });
      });
    }
    this.circuit.solve(0);
  }

  // ---------------------------------------------------------------------------
  // API used by part models
  // ---------------------------------------------------------------------------
  isUnconnected(partId, pinId) {
    const idx = this.netlist.pinNet.get(`${partId}:${pinId}`);
    if (idx === undefined) return true;
    const net = this.netlist.nets[idx];
    return net.pins.length <= 1 && !net.power;
  }
  schedule(t, fn) {
    this.events.push(t, fn);
    // make running MCUs stop at this time so the event is processed on time
    for (const m of this.mcus) m.mcu.limitTo?.(t);
  }
  solveAt(t) { this.circuit.solve(Math.max(t, this.circuit.t)); }
  registerMcu(inst) { this.mcus.push(inst); }
  registerInstrument(inst) { this.instruments.push(inst); }
  registerI2C(dev) { this.i2cDevices.push(dev); }

  /** Deliver a serial byte appearing on txNode to MCU USARTs whose RXD is on the same net */
  deliverSerial(txNode, byte, baud, fromMcu) {
    for (const m of this.mcus) {
      if (m === fromMcu) continue;
      for (const st of m.mcu.usarts) {
        const rx = m.pinByName.get(st.def.rxd);
        if (!rx || rx.node == null || rx.node !== txNode) continue;
        if (!st.usart.rxEnable) continue;
        const mb = st.usart.baudRate;
        let b = byte;
        if (Math.abs(mb - baud) / baud > 0.045) b = (byte * 0x9d + 0x3b) & 0xff; // baud mismatch -> garbage
        st.usart.writeByte(b, true);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------
  reset() {
    for (const m of this.mcus) { m.mcu.reset(); m.refreshPins(); }
    this.time = 0;
  }

  /** Advance simulation to time T, but stop early if wall-clock budget (ms) is exceeded. */
  runUntil(T, budgetMs = 30) {
    const t0 = performance.now();
    const multi = this.mcus.length > 1;
    const maxSlice = multi ? 5e-5 : 1e-3;
    let guard = 0;
    while (this.time < T) {
      let tNext = Math.min(T, this.events.peek(), this.circuit.nextReactiveT, this.time + maxSlice);
      if (tNext < this.time) tNext = this.time;
      for (const m of this.mcus) {
        const target = Math.min(tNext, this.events.peek());
        if (m.held) { m.mcu.skipTo(target); continue; }
        m.mcu.runUntil(target);
      }
      let reached = tNext;
      for (const m of this.mcus) reached = Math.min(reached, Math.max(m.mcu.time, this.time));
      if (!this.mcus.length) reached = tNext;
      this.time = Math.max(this.time, Math.min(reached, tNext));
      // timed events
      let needSolve = false;
      while (this.events.size && this.events.peek() <= this.time + 1e-15) {
        const ev = this.events.pop();
        if (ev.fn(ev.t)) needSolve = true;
      }
      if (needSolve || this.circuit.nextReactiveT <= this.time) this.circuit.solve(this.time);
      for (const m of this.mcus) {
        if (m.pendingReset) {
          m.pendingReset = false;
          m.mcu.reset(); m.mcu.skipTo(this.time); m.refreshPins();
          this.circuit.solve(this.time);
        }
      }
      if ((++guard & 15) === 0 && performance.now() - t0 > budgetMs) return false;
    }
    return true;
  }

  /** Called once per animation frame after running */
  frame(dtFrame) {
    this.circuit.advanceTo(this.time);
    for (const inst of this.instances.values()) inst.frame?.(dtFrame);
    for (const inst of this.instruments) inst.snapshot?.(this.time);
  }

  dispose() {
    for (const inst of this.instances.values()) inst.dispose?.();
  }
}
