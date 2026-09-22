// package/dist/esm/cpu/interrupt.js
function avrInterrupt(cpu, addr) {
  let sp = cpu.dataView.getUint16(93, !0);
  cpu.data[sp] = cpu.pc & 255, cpu.data[sp - 1] = cpu.pc >> 8 & 255, cpu.pc22Bits && (cpu.data[sp - 2] = cpu.pc >> 16 & 255), cpu.dataView.setUint16(93, sp - (cpu.pc22Bits ? 3 : 2), !0), cpu.data[95] &= 127, cpu.cycles += 2, cpu.pc = addr;
}

// package/dist/esm/cpu/cpu.js
var registerSpace = 256, MAX_INTERRUPTS = 128, CPU = class {
  constructor(progMem, sramBytes = 8192) {
    this.progMem = progMem, this.sramBytes = sramBytes, this.data = new Uint8Array(this.sramBytes + registerSpace), this.data16 = new Uint16Array(this.data.buffer), this.dataView = new DataView(this.data.buffer), this.progBytes = new Uint8Array(this.progMem.buffer), this.readHooks = [], this.writeHooks = [], this.pendingInterrupts = new Array(MAX_INTERRUPTS), this.nextClockEvent = null, this.clockEventPool = [], this.pc22Bits = this.progBytes.length > 131072, this.gpioPorts = /* @__PURE__ */ new Set(), this.gpioByPort = [], this.onWatchdogReset = () => {
    }, this.pc = 0, this.cycles = 0, this.nextInterrupt = -1, this.maxInterrupt = 0, this.reset();
  }
  reset() {
    this.SP = this.data.length - 1, this.pc = 0, this.pendingInterrupts.fill(null), this.nextInterrupt = -1, this.nextClockEvent = null;
  }
  readData(addr) {
    return addr >= 32 && this.readHooks[addr] ? this.readHooks[addr](addr) : this.data[addr];
  }
  writeData(addr, value, mask = 255) {
    let hook = this.writeHooks[addr];
    hook && hook(value, this.data[addr], addr, mask) || (this.data[addr] = value);
  }
  get SP() {
    return this.dataView.getUint16(93, !0);
  }
  set SP(value) {
    this.dataView.setUint16(93, value, !0);
  }
  get SREG() {
    return this.data[95];
  }
  get interruptsEnabled() {
    return !!(this.SREG & 128);
  }
  setInterruptFlag(interrupt) {
    let { flagRegister, flagMask, enableRegister, enableMask } = interrupt;
    interrupt.inverseFlag ? this.data[flagRegister] &= ~flagMask : this.data[flagRegister] |= flagMask, this.data[enableRegister] & enableMask && this.queueInterrupt(interrupt);
  }
  updateInterruptEnable(interrupt, registerValue) {
    let { enableMask, flagRegister, flagMask, inverseFlag } = interrupt;
    if (registerValue & enableMask) {
      let bitSet = this.data[flagRegister] & flagMask;
      (inverseFlag ? !bitSet : bitSet) && this.queueInterrupt(interrupt);
    } else
      this.clearInterrupt(interrupt, !1);
  }
  queueInterrupt(interrupt) {
    let { address } = interrupt;
    this.pendingInterrupts[address] = interrupt, (this.nextInterrupt === -1 || this.nextInterrupt > address) && (this.nextInterrupt = address), address > this.maxInterrupt && (this.maxInterrupt = address);
  }
  clearInterrupt({ address, flagRegister, flagMask }, clearFlag = !0) {
    clearFlag && (this.data[flagRegister] &= ~flagMask);
    let { pendingInterrupts, maxInterrupt } = this;
    if (pendingInterrupts[address] && (pendingInterrupts[address] = null, this.nextInterrupt === address)) {
      this.nextInterrupt = -1;
      for (let i = address + 1; i <= maxInterrupt; i++)
        if (pendingInterrupts[i]) {
          this.nextInterrupt = i;
          break;
        }
    }
  }
  clearInterruptByFlag(interrupt, registerValue) {
    let { flagRegister, flagMask } = interrupt;
    registerValue & flagMask && (this.data[flagRegister] &= ~flagMask, this.clearInterrupt(interrupt));
  }
  addClockEvent(callback, cycles) {
    let { clockEventPool } = this;
    cycles = this.cycles + Math.max(1, cycles);
    let maybeEntry = clockEventPool.pop(), entry = maybeEntry ?? { cycles, callback, next: null };
    entry.cycles = cycles, entry.callback = callback;
    let { nextClockEvent: clockEvent } = this, lastItem = null;
    for (; clockEvent && clockEvent.cycles < cycles; )
      lastItem = clockEvent, clockEvent = clockEvent.next;
    return lastItem ? (lastItem.next = entry, entry.next = clockEvent) : (this.nextClockEvent = entry, entry.next = clockEvent), callback;
  }
  updateClockEvent(callback, cycles) {
    return this.clearClockEvent(callback) ? (this.addClockEvent(callback, cycles), !0) : !1;
  }
  clearClockEvent(callback) {
    let { nextClockEvent: clockEvent } = this;
    if (!clockEvent)
      return !1;
    let { clockEventPool } = this, lastItem = null;
    for (; clockEvent; ) {
      if (clockEvent.callback === callback)
        return lastItem ? lastItem.next = clockEvent.next : this.nextClockEvent = clockEvent.next, clockEventPool.length < 10 && clockEventPool.push(clockEvent), !0;
      lastItem = clockEvent, clockEvent = clockEvent.next;
    }
    return !1;
  }
  tick() {
    let { nextClockEvent } = this;
    nextClockEvent && nextClockEvent.cycles <= this.cycles && (nextClockEvent.callback(), this.nextClockEvent = nextClockEvent.next, this.clockEventPool.length < 10 && this.clockEventPool.push(nextClockEvent));
    let { nextInterrupt } = this;
    if (this.interruptsEnabled && nextInterrupt >= 0) {
      let interrupt = this.pendingInterrupts[nextInterrupt];
      avrInterrupt(this, interrupt.address), interrupt.constant || this.clearInterrupt(interrupt);
    }
  }
};

// package/dist/esm/cpu/instruction.js
function isTwoWordInstruction(opcode) {
  return (
    /* LDS */
    (opcode & 65039) === 36864 || /* STS */
    (opcode & 65039) === 37376 || /* CALL */
    (opcode & 65038) === 37902 || /* JMP */
    (opcode & 65038) === 37900
  );
}
function avrInstruction(cpu) {
  let opcode = cpu.progMem[cpu.pc];
  if ((opcode & 64512) === 7168) {
    let d = cpu.data[(opcode & 496) >> 4], r = cpu.data[opcode & 15 | (opcode & 512) >> 5], sum = d + r + (cpu.data[95] & 1), R = sum & 255;
    cpu.data[(opcode & 496) >> 4] = R;
    let sreg = cpu.data[95] & 192;
    sreg |= R ? 0 : 2, sreg |= 128 & R ? 4 : 0, sreg |= (R ^ r) & (d ^ R) & 128 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, sreg |= sum & 256 ? 1 : 0, sreg |= 1 & (d & r | r & ~R | ~R & d) ? 32 : 0, cpu.data[95] = sreg;
  } else if ((opcode & 64512) === 3072) {
    let d = cpu.data[(opcode & 496) >> 4], r = cpu.data[opcode & 15 | (opcode & 512) >> 5], R = d + r & 255;
    cpu.data[(opcode & 496) >> 4] = R;
    let sreg = cpu.data[95] & 192;
    sreg |= R ? 0 : 2, sreg |= 128 & R ? 4 : 0, sreg |= (R ^ r) & (R ^ d) & 128 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, sreg |= d + r & 256 ? 1 : 0, sreg |= 1 & (d & r | r & ~R | ~R & d) ? 32 : 0, cpu.data[95] = sreg;
  } else if ((opcode & 65280) === 38400) {
    let addr = 2 * ((opcode & 48) >> 4) + 24, value = cpu.dataView.getUint16(addr, !0), R = value + (opcode & 15 | (opcode & 192) >> 2) & 65535;
    cpu.dataView.setUint16(addr, R, !0);
    let sreg = cpu.data[95] & 224;
    sreg |= R ? 0 : 2, sreg |= 32768 & R ? 4 : 0, sreg |= ~value & R & 32768 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, sreg |= ~R & value & 32768 ? 1 : 0, cpu.data[95] = sreg, cpu.cycles++;
  } else if ((opcode & 64512) === 8192) {
    let R = cpu.data[(opcode & 496) >> 4] & cpu.data[opcode & 15 | (opcode & 512) >> 5];
    cpu.data[(opcode & 496) >> 4] = R;
    let sreg = cpu.data[95] & 225;
    sreg |= R ? 0 : 2, sreg |= 128 & R ? 4 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, cpu.data[95] = sreg;
  } else if ((opcode & 61440) === 28672) {
    let R = cpu.data[((opcode & 240) >> 4) + 16] & (opcode & 15 | (opcode & 3840) >> 4);
    cpu.data[((opcode & 240) >> 4) + 16] = R;
    let sreg = cpu.data[95] & 225;
    sreg |= R ? 0 : 2, sreg |= 128 & R ? 4 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, cpu.data[95] = sreg;
  } else if ((opcode & 65039) === 37893) {
    let value = cpu.data[(opcode & 496) >> 4], R = value >>> 1 | 128 & value;
    cpu.data[(opcode & 496) >> 4] = R;
    let sreg = cpu.data[95] & 224;
    sreg |= R ? 0 : 2, sreg |= 128 & R ? 4 : 0, sreg |= value & 1, sreg |= sreg >> 2 & 1 ^ sreg & 1 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, cpu.data[95] = sreg;
  } else if ((opcode & 65423) === 38024)
    cpu.data[95] &= ~(1 << ((opcode & 112) >> 4));
  else if ((opcode & 65032) === 63488) {
    let b = opcode & 7, d = (opcode & 496) >> 4;
    cpu.data[d] = ~(1 << b) & cpu.data[d] | (cpu.data[95] >> 6 & 1) << b;
  } else if ((opcode & 64512) === 62464)
    cpu.data[95] & 1 << (opcode & 7) || (cpu.pc = cpu.pc + (((opcode & 504) >> 3) - (opcode & 512 ? 64 : 0)), cpu.cycles++);
  else if ((opcode & 64512) === 61440)
    cpu.data[95] & 1 << (opcode & 7) && (cpu.pc = cpu.pc + (((opcode & 504) >> 3) - (opcode & 512 ? 64 : 0)), cpu.cycles++);
  else if ((opcode & 65423) === 37896)
    cpu.data[95] |= 1 << ((opcode & 112) >> 4);
  else if ((opcode & 65032) === 64e3) {
    let d = cpu.data[(opcode & 496) >> 4], b = opcode & 7;
    cpu.data[95] = cpu.data[95] & 191 | (d >> b & 1 ? 64 : 0);
  } else if ((opcode & 65038) === 37902) {
    let k = cpu.progMem[cpu.pc + 1] | (opcode & 1) << 16 | (opcode & 496) << 13, ret = cpu.pc + 2, sp = cpu.dataView.getUint16(93, !0), { pc22Bits } = cpu;
    cpu.data[sp] = 255 & ret, cpu.data[sp - 1] = ret >> 8 & 255, pc22Bits && (cpu.data[sp - 2] = ret >> 16 & 255), cpu.dataView.setUint16(93, sp - (pc22Bits ? 3 : 2), !0), cpu.pc = k - 1, cpu.cycles += pc22Bits ? 4 : 3;
  } else if ((opcode & 65280) === 38912) {
    let A = opcode & 248, b = opcode & 7, R = cpu.readData((A >> 3) + 32), mask = 1 << b;
    cpu.writeData((A >> 3) + 32, R & ~mask, mask);
  } else if ((opcode & 65039) === 37888) {
    let d = (opcode & 496) >> 4, R = 255 - cpu.data[d];
    cpu.data[d] = R;
    let sreg = cpu.data[95] & 225 | 1;
    sreg |= R ? 0 : 2, sreg |= 128 & R ? 4 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, cpu.data[95] = sreg;
  } else if ((opcode & 64512) === 5120) {
    let val1 = cpu.data[(opcode & 496) >> 4], val2 = cpu.data[opcode & 15 | (opcode & 512) >> 5], R = val1 - val2, sreg = cpu.data[95] & 192;
    sreg |= R ? 0 : 2, sreg |= 128 & R ? 4 : 0, sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, sreg |= val2 > val1 ? 1 : 0, sreg |= 1 & (~val1 & val2 | val2 & R | R & ~val1) ? 32 : 0, cpu.data[95] = sreg;
  } else if ((opcode & 64512) === 1024) {
    let arg1 = cpu.data[(opcode & 496) >> 4], arg2 = cpu.data[opcode & 15 | (opcode & 512) >> 5], sreg = cpu.data[95], r = arg1 - arg2 - (sreg & 1);
    sreg = sreg & 192 | (!r && sreg >> 1 & 1 ? 2 : 0) | (arg2 + (sreg & 1) > arg1 ? 1 : 0), sreg |= 128 & r ? 4 : 0, sreg |= (arg1 ^ arg2) & (arg1 ^ r) & 128 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, sreg |= 1 & (~arg1 & arg2 | arg2 & r | r & ~arg1) ? 32 : 0, cpu.data[95] = sreg;
  } else if ((opcode & 61440) === 12288) {
    let arg1 = cpu.data[((opcode & 240) >> 4) + 16], arg2 = opcode & 15 | (opcode & 3840) >> 4, r = arg1 - arg2, sreg = cpu.data[95] & 192;
    sreg |= r ? 0 : 2, sreg |= 128 & r ? 4 : 0, sreg |= (arg1 ^ arg2) & (arg1 ^ r) & 128 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, sreg |= arg2 > arg1 ? 1 : 0, sreg |= 1 & (~arg1 & arg2 | arg2 & r | r & ~arg1) ? 32 : 0, cpu.data[95] = sreg;
  } else if ((opcode & 64512) === 4096) {
    if (cpu.data[(opcode & 496) >> 4] === cpu.data[opcode & 15 | (opcode & 512) >> 5]) {
      let nextOpcode = cpu.progMem[cpu.pc + 1], skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
      cpu.pc += skipSize, cpu.cycles += skipSize;
    }
  } else if ((opcode & 65039) === 37898) {
    let value = cpu.data[(opcode & 496) >> 4], R = value - 1;
    cpu.data[(opcode & 496) >> 4] = R;
    let sreg = cpu.data[95] & 225;
    sreg |= R ? 0 : 2, sreg |= 128 & R ? 4 : 0, sreg |= value === 128 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, cpu.data[95] = sreg;
  } else if (opcode === 38169) {
    let retAddr = cpu.pc + 1, sp = cpu.dataView.getUint16(93, !0), eind = cpu.data[92];
    cpu.data[sp] = retAddr & 255, cpu.data[sp - 1] = retAddr >> 8 & 255, cpu.data[sp - 2] = retAddr >> 16 & 255, cpu.dataView.setUint16(93, sp - 3, !0), cpu.pc = (eind << 16 | cpu.dataView.getUint16(30, !0)) - 1, cpu.cycles += 3;
  } else if (opcode === 37913) {
    let eind = cpu.data[92];
    cpu.pc = (eind << 16 | cpu.dataView.getUint16(30, !0)) - 1, cpu.cycles++;
  } else if (opcode === 38360) {
    let rampz = cpu.data[91];
    cpu.data[0] = cpu.progBytes[rampz << 16 | cpu.dataView.getUint16(30, !0)], cpu.cycles += 2;
  } else if ((opcode & 65039) === 36870) {
    let rampz = cpu.data[91];
    cpu.data[(opcode & 496) >> 4] = cpu.progBytes[rampz << 16 | cpu.dataView.getUint16(30, !0)], cpu.cycles += 2;
  } else if ((opcode & 65039) === 36871) {
    let rampz = cpu.data[91], i = cpu.dataView.getUint16(30, !0);
    cpu.data[(opcode & 496) >> 4] = cpu.progBytes[rampz << 16 | i], cpu.dataView.setUint16(30, i + 1, !0), i === 65535 && (cpu.data[91] = (rampz + 1) % (cpu.progBytes.length >> 16)), cpu.cycles += 2;
  } else if ((opcode & 64512) === 9216) {
    let R = cpu.data[(opcode & 496) >> 4] ^ cpu.data[opcode & 15 | (opcode & 512) >> 5];
    cpu.data[(opcode & 496) >> 4] = R;
    let sreg = cpu.data[95] & 225;
    sreg |= R ? 0 : 2, sreg |= 128 & R ? 4 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, cpu.data[95] = sreg;
  } else if ((opcode & 65416) === 776) {
    let v1 = cpu.data[((opcode & 112) >> 4) + 16], v2 = cpu.data[(opcode & 7) + 16], R = v1 * v2 << 1;
    cpu.dataView.setUint16(0, R, !0), cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 0 : 2) | (v1 * v2 & 32768 ? 1 : 0), cpu.cycles++;
  } else if ((opcode & 65416) === 896) {
    let v1 = cpu.dataView.getInt8(((opcode & 112) >> 4) + 16), v2 = cpu.dataView.getInt8((opcode & 7) + 16), R = v1 * v2 << 1;
    cpu.dataView.setInt16(0, R, !0), cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 0 : 2) | (v1 * v2 & 32768 ? 1 : 0), cpu.cycles++;
  } else if ((opcode & 65416) === 904) {
    let v1 = cpu.dataView.getInt8(((opcode & 112) >> 4) + 16), v2 = cpu.data[(opcode & 7) + 16], R = v1 * v2 << 1;
    cpu.dataView.setInt16(0, R, !0), cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 2 : 0) | (v1 * v2 & 32768 ? 1 : 0), cpu.cycles++;
  } else if (opcode === 38153) {
    let retAddr = cpu.pc + 1, sp = cpu.dataView.getUint16(93, !0), { pc22Bits } = cpu;
    cpu.data[sp] = retAddr & 255, cpu.data[sp - 1] = retAddr >> 8 & 255, pc22Bits && (cpu.data[sp - 2] = retAddr >> 16 & 255), cpu.dataView.setUint16(93, sp - (pc22Bits ? 3 : 2), !0), cpu.pc = cpu.dataView.getUint16(30, !0) - 1, cpu.cycles += pc22Bits ? 3 : 2;
  } else if (opcode === 37897)
    cpu.pc = cpu.dataView.getUint16(30, !0) - 1, cpu.cycles++;
  else if ((opcode & 63488) === 45056) {
    let i = cpu.readData((opcode & 15 | (opcode & 1536) >> 5) + 32);
    cpu.data[(opcode & 496) >> 4] = i;
  } else if ((opcode & 65039) === 37891) {
    let d = cpu.data[(opcode & 496) >> 4], r = d + 1 & 255;
    cpu.data[(opcode & 496) >> 4] = r;
    let sreg = cpu.data[95] & 225;
    sreg |= r ? 0 : 2, sreg |= 128 & r ? 4 : 0, sreg |= d === 127 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, cpu.data[95] = sreg;
  } else if ((opcode & 65038) === 37900)
    cpu.pc = (cpu.progMem[cpu.pc + 1] | (opcode & 1) << 16 | (opcode & 496) << 13) - 1, cpu.cycles += 2;
  else if ((opcode & 65039) === 37382) {
    let r = (opcode & 496) >> 4, clear = cpu.data[r], value = cpu.readData(cpu.dataView.getUint16(30, !0));
    cpu.writeData(cpu.dataView.getUint16(30, !0), value & 255 - clear), cpu.data[r] = value;
  } else if ((opcode & 65039) === 37381) {
    let r = (opcode & 496) >> 4, set = cpu.data[r], value = cpu.readData(cpu.dataView.getUint16(30, !0));
    cpu.writeData(cpu.dataView.getUint16(30, !0), value | set), cpu.data[r] = value;
  } else if ((opcode & 65039) === 37383) {
    let r = cpu.data[(opcode & 496) >> 4], R = cpu.readData(cpu.dataView.getUint16(30, !0));
    cpu.writeData(cpu.dataView.getUint16(30, !0), r ^ R), cpu.data[(opcode & 496) >> 4] = R;
  } else if ((opcode & 61440) === 57344)
    cpu.data[((opcode & 240) >> 4) + 16] = opcode & 15 | (opcode & 3840) >> 4;
  else if ((opcode & 65039) === 36864) {
    cpu.cycles++;
    let value = cpu.readData(cpu.progMem[cpu.pc + 1]);
    cpu.data[(opcode & 496) >> 4] = value, cpu.pc++;
  } else if ((opcode & 65039) === 36876)
    cpu.cycles++, cpu.data[(opcode & 496) >> 4] = cpu.readData(cpu.dataView.getUint16(26, !0));
  else if ((opcode & 65039) === 36877) {
    let x = cpu.dataView.getUint16(26, !0);
    cpu.cycles++, cpu.data[(opcode & 496) >> 4] = cpu.readData(x), cpu.dataView.setUint16(26, x + 1, !0);
  } else if ((opcode & 65039) === 36878) {
    let x = cpu.dataView.getUint16(26, !0) - 1;
    cpu.dataView.setUint16(26, x, !0), cpu.cycles++, cpu.data[(opcode & 496) >> 4] = cpu.readData(x);
  } else if ((opcode & 65039) === 32776)
    cpu.cycles++, cpu.data[(opcode & 496) >> 4] = cpu.readData(cpu.dataView.getUint16(28, !0));
  else if ((opcode & 65039) === 36873) {
    let y = cpu.dataView.getUint16(28, !0);
    cpu.cycles++, cpu.data[(opcode & 496) >> 4] = cpu.readData(y), cpu.dataView.setUint16(28, y + 1, !0);
  } else if ((opcode & 65039) === 36874) {
    let y = cpu.dataView.getUint16(28, !0) - 1;
    cpu.dataView.setUint16(28, y, !0), cpu.cycles++, cpu.data[(opcode & 496) >> 4] = cpu.readData(y);
  } else if ((opcode & 53768) === 32776 && opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8)
    cpu.cycles++, cpu.data[(opcode & 496) >> 4] = cpu.readData(cpu.dataView.getUint16(28, !0) + (opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8));
  else if ((opcode & 65039) === 32768)
    cpu.cycles++, cpu.data[(opcode & 496) >> 4] = cpu.readData(cpu.dataView.getUint16(30, !0));
  else if ((opcode & 65039) === 36865) {
    let z = cpu.dataView.getUint16(30, !0);
    cpu.cycles++, cpu.data[(opcode & 496) >> 4] = cpu.readData(z), cpu.dataView.setUint16(30, z + 1, !0);
  } else if ((opcode & 65039) === 36866) {
    let z = cpu.dataView.getUint16(30, !0) - 1;
    cpu.dataView.setUint16(30, z, !0), cpu.cycles++, cpu.data[(opcode & 496) >> 4] = cpu.readData(z);
  } else if ((opcode & 53768) === 32768 && opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8)
    cpu.cycles++, cpu.data[(opcode & 496) >> 4] = cpu.readData(cpu.dataView.getUint16(30, !0) + (opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8));
  else if (opcode === 38344)
    cpu.data[0] = cpu.progBytes[cpu.dataView.getUint16(30, !0)], cpu.cycles += 2;
  else if ((opcode & 65039) === 36868)
    cpu.data[(opcode & 496) >> 4] = cpu.progBytes[cpu.dataView.getUint16(30, !0)], cpu.cycles += 2;
  else if ((opcode & 65039) === 36869) {
    let i = cpu.dataView.getUint16(30, !0);
    cpu.data[(opcode & 496) >> 4] = cpu.progBytes[i], cpu.dataView.setUint16(30, i + 1, !0), cpu.cycles += 2;
  } else if ((opcode & 65039) === 37894) {
    let value = cpu.data[(opcode & 496) >> 4], R = value >>> 1;
    cpu.data[(opcode & 496) >> 4] = R;
    let sreg = cpu.data[95] & 224;
    sreg |= R ? 0 : 2, sreg |= value & 1, sreg |= sreg >> 2 & 1 ^ sreg & 1 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, cpu.data[95] = sreg;
  } else if ((opcode & 64512) === 11264)
    cpu.data[(opcode & 496) >> 4] = cpu.data[opcode & 15 | (opcode & 512) >> 5];
  else if ((opcode & 65280) === 256) {
    let r2 = 2 * (opcode & 15), d2 = 2 * ((opcode & 240) >> 4);
    cpu.data[d2] = cpu.data[r2], cpu.data[d2 + 1] = cpu.data[r2 + 1];
  } else if ((opcode & 64512) === 39936) {
    let R = cpu.data[(opcode & 496) >> 4] * cpu.data[opcode & 15 | (opcode & 512) >> 5];
    cpu.dataView.setUint16(0, R, !0), cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 0 : 2) | (32768 & R ? 1 : 0), cpu.cycles++;
  } else if ((opcode & 65280) === 512) {
    let R = cpu.dataView.getInt8(((opcode & 240) >> 4) + 16) * cpu.dataView.getInt8((opcode & 15) + 16);
    cpu.dataView.setInt16(0, R, !0), cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 0 : 2) | (32768 & R ? 1 : 0), cpu.cycles++;
  } else if ((opcode & 65416) === 768) {
    let R = cpu.dataView.getInt8(((opcode & 112) >> 4) + 16) * cpu.data[(opcode & 7) + 16];
    cpu.dataView.setInt16(0, R, !0), cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 0 : 2) | (32768 & R ? 1 : 0), cpu.cycles++;
  } else if ((opcode & 65039) === 37889) {
    let d = (opcode & 496) >> 4, value = cpu.data[d], R = 0 - value;
    cpu.data[d] = R;
    let sreg = cpu.data[95] & 192;
    sreg |= R ? 0 : 2, sreg |= 128 & R ? 4 : 0, sreg |= R === 128 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, sreg |= R ? 1 : 0, sreg |= 1 & (R | value) ? 32 : 0, cpu.data[95] = sreg;
  } else if (opcode !== 0) {
    if ((opcode & 64512) === 10240) {
      let R = cpu.data[(opcode & 496) >> 4] | cpu.data[opcode & 15 | (opcode & 512) >> 5];
      cpu.data[(opcode & 496) >> 4] = R;
      let sreg = cpu.data[95] & 225;
      sreg |= R ? 0 : 2, sreg |= 128 & R ? 4 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, cpu.data[95] = sreg;
    } else if ((opcode & 61440) === 24576) {
      let R = cpu.data[((opcode & 240) >> 4) + 16] | (opcode & 15 | (opcode & 3840) >> 4);
      cpu.data[((opcode & 240) >> 4) + 16] = R;
      let sreg = cpu.data[95] & 225;
      sreg |= R ? 0 : 2, sreg |= 128 & R ? 4 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, cpu.data[95] = sreg;
    } else if ((opcode & 63488) === 47104)
      cpu.writeData((opcode & 15 | (opcode & 1536) >> 5) + 32, cpu.data[(opcode & 496) >> 4]);
    else if ((opcode & 65039) === 36879) {
      let value = cpu.dataView.getUint16(93, !0) + 1;
      cpu.dataView.setUint16(93, value, !0), cpu.data[(opcode & 496) >> 4] = cpu.data[value], cpu.cycles++;
    } else if ((opcode & 65039) === 37391) {
      let value = cpu.dataView.getUint16(93, !0);
      cpu.data[value] = cpu.data[(opcode & 496) >> 4], cpu.dataView.setUint16(93, value - 1, !0), cpu.cycles++;
    } else if ((opcode & 61440) === 53248) {
      let k = (opcode & 2047) - (opcode & 2048 ? 2048 : 0), retAddr = cpu.pc + 1, sp = cpu.dataView.getUint16(93, !0), { pc22Bits } = cpu;
      cpu.data[sp] = 255 & retAddr, cpu.data[sp - 1] = retAddr >> 8 & 255, pc22Bits && (cpu.data[sp - 2] = retAddr >> 16 & 255), cpu.dataView.setUint16(93, sp - (pc22Bits ? 3 : 2), !0), cpu.pc += k, cpu.cycles += pc22Bits ? 3 : 2;
    } else if (opcode === 38152) {
      let { pc22Bits } = cpu, i = cpu.dataView.getUint16(93, !0) + (pc22Bits ? 3 : 2);
      cpu.dataView.setUint16(93, i, !0), cpu.pc = (cpu.data[i - 1] << 8) + cpu.data[i] - 1, pc22Bits && (cpu.pc |= cpu.data[i - 2] << 16), cpu.cycles += pc22Bits ? 4 : 3;
    } else if (opcode === 38168) {
      let { pc22Bits } = cpu, i = cpu.dataView.getUint16(93, !0) + (pc22Bits ? 3 : 2);
      cpu.dataView.setUint16(93, i, !0), cpu.pc = (cpu.data[i - 1] << 8) + cpu.data[i] - 1, pc22Bits && (cpu.pc |= cpu.data[i - 2] << 16), cpu.cycles += pc22Bits ? 4 : 3, cpu.data[95] |= 128;
    } else if ((opcode & 61440) === 49152)
      cpu.pc = cpu.pc + ((opcode & 2047) - (opcode & 2048 ? 2048 : 0)), cpu.cycles++;
    else if ((opcode & 65039) === 37895) {
      let d = cpu.data[(opcode & 496) >> 4], r = d >>> 1 | (cpu.data[95] & 1) << 7;
      cpu.data[(opcode & 496) >> 4] = r;
      let sreg = cpu.data[95] & 224;
      sreg |= r ? 0 : 2, sreg |= 128 & r ? 4 : 0, sreg |= 1 & d ? 1 : 0, sreg |= sreg >> 2 & 1 ^ sreg & 1 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, cpu.data[95] = sreg;
    } else if ((opcode & 64512) === 2048) {
      let val1 = cpu.data[(opcode & 496) >> 4], val2 = cpu.data[opcode & 15 | (opcode & 512) >> 5], sreg = cpu.data[95], R = val1 - val2 - (sreg & 1);
      cpu.data[(opcode & 496) >> 4] = R, sreg = sreg & 192 | (!R && sreg >> 1 & 1 ? 2 : 0) | (val2 + (sreg & 1) > val1 ? 1 : 0), sreg |= 128 & R ? 4 : 0, sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, sreg |= 1 & (~val1 & val2 | val2 & R | R & ~val1) ? 32 : 0, cpu.data[95] = sreg;
    } else if ((opcode & 61440) === 16384) {
      let val1 = cpu.data[((opcode & 240) >> 4) + 16], val2 = opcode & 15 | (opcode & 3840) >> 4, sreg = cpu.data[95], R = val1 - val2 - (sreg & 1);
      cpu.data[((opcode & 240) >> 4) + 16] = R, sreg = sreg & 192 | (!R && sreg >> 1 & 1 ? 2 : 0) | (val2 + (sreg & 1) > val1 ? 1 : 0), sreg |= 128 & R ? 4 : 0, sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, sreg |= 1 & (~val1 & val2 | val2 & R | R & ~val1) ? 32 : 0, cpu.data[95] = sreg;
    } else if ((opcode & 65280) === 39424) {
      let target = ((opcode & 248) >> 3) + 32, mask = 1 << (opcode & 7);
      cpu.writeData(target, cpu.readData(target) | mask, mask), cpu.cycles++;
    } else if ((opcode & 65280) === 39168) {
      if (!(cpu.readData(((opcode & 248) >> 3) + 32) & 1 << (opcode & 7))) {
        let nextOpcode = cpu.progMem[cpu.pc + 1], skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
        cpu.cycles += skipSize, cpu.pc += skipSize;
      }
    } else if ((opcode & 65280) === 39680) {
      if (cpu.readData(((opcode & 248) >> 3) + 32) & 1 << (opcode & 7)) {
        let nextOpcode = cpu.progMem[cpu.pc + 1], skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
        cpu.cycles += skipSize, cpu.pc += skipSize;
      }
    } else if ((opcode & 65280) === 38656) {
      let i = 2 * ((opcode & 48) >> 4) + 24, a = cpu.dataView.getUint16(i, !0), l = opcode & 15 | (opcode & 192) >> 2, R = a - l;
      cpu.dataView.setUint16(i, R, !0);
      let sreg = cpu.data[95] & 192;
      sreg |= R ? 0 : 2, sreg |= 32768 & R ? 4 : 0, sreg |= a & ~R & 32768 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, sreg |= l > a ? 1 : 0, sreg |= 1 & (~a & l | l & R | R & ~a) ? 32 : 0, cpu.data[95] = sreg, cpu.cycles++;
    } else if ((opcode & 65032) === 64512) {
      if (!(cpu.data[(opcode & 496) >> 4] & 1 << (opcode & 7))) {
        let nextOpcode = cpu.progMem[cpu.pc + 1], skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
        cpu.cycles += skipSize, cpu.pc += skipSize;
      }
    } else if ((opcode & 65032) === 65024) {
      if (cpu.data[(opcode & 496) >> 4] & 1 << (opcode & 7)) {
        let nextOpcode = cpu.progMem[cpu.pc + 1], skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
        cpu.cycles += skipSize, cpu.pc += skipSize;
      }
    } else if (opcode !== 38280) {
      if (opcode !== 38376) {
        if (opcode !== 38392) {
          if ((opcode & 65039) === 37376) {
            let value = cpu.data[(opcode & 496) >> 4], addr = cpu.progMem[cpu.pc + 1];
            cpu.writeData(addr, value), cpu.pc++, cpu.cycles++;
          } else if ((opcode & 65039) === 37388)
            cpu.writeData(cpu.dataView.getUint16(26, !0), cpu.data[(opcode & 496) >> 4]), cpu.cycles++;
          else if ((opcode & 65039) === 37389) {
            let x = cpu.dataView.getUint16(26, !0);
            cpu.writeData(x, cpu.data[(opcode & 496) >> 4]), cpu.dataView.setUint16(26, x + 1, !0), cpu.cycles++;
          } else if ((opcode & 65039) === 37390) {
            let i = cpu.data[(opcode & 496) >> 4], x = cpu.dataView.getUint16(26, !0) - 1;
            cpu.dataView.setUint16(26, x, !0), cpu.writeData(x, i), cpu.cycles++;
          } else if ((opcode & 65039) === 33288)
            cpu.writeData(cpu.dataView.getUint16(28, !0), cpu.data[(opcode & 496) >> 4]), cpu.cycles++;
          else if ((opcode & 65039) === 37385) {
            let i = cpu.data[(opcode & 496) >> 4], y = cpu.dataView.getUint16(28, !0);
            cpu.writeData(y, i), cpu.dataView.setUint16(28, y + 1, !0), cpu.cycles++;
          } else if ((opcode & 65039) === 37386) {
            let i = cpu.data[(opcode & 496) >> 4], y = cpu.dataView.getUint16(28, !0) - 1;
            cpu.dataView.setUint16(28, y, !0), cpu.writeData(y, i), cpu.cycles++;
          } else if ((opcode & 53768) === 33288 && opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8)
            cpu.writeData(cpu.dataView.getUint16(28, !0) + (opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8), cpu.data[(opcode & 496) >> 4]), cpu.cycles++;
          else if ((opcode & 65039) === 33280)
            cpu.writeData(cpu.dataView.getUint16(30, !0), cpu.data[(opcode & 496) >> 4]), cpu.cycles++;
          else if ((opcode & 65039) === 37377) {
            let z = cpu.dataView.getUint16(30, !0);
            cpu.writeData(z, cpu.data[(opcode & 496) >> 4]), cpu.dataView.setUint16(30, z + 1, !0), cpu.cycles++;
          } else if ((opcode & 65039) === 37378) {
            let i = cpu.data[(opcode & 496) >> 4], z = cpu.dataView.getUint16(30, !0) - 1;
            cpu.dataView.setUint16(30, z, !0), cpu.writeData(z, i), cpu.cycles++;
          } else if ((opcode & 53768) === 33280 && opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8)
            cpu.writeData(cpu.dataView.getUint16(30, !0) + (opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8), cpu.data[(opcode & 496) >> 4]), cpu.cycles++;
          else if ((opcode & 64512) === 6144) {
            let val1 = cpu.data[(opcode & 496) >> 4], val2 = cpu.data[opcode & 15 | (opcode & 512) >> 5], R = val1 - val2;
            cpu.data[(opcode & 496) >> 4] = R;
            let sreg = cpu.data[95] & 192;
            sreg |= R ? 0 : 2, sreg |= 128 & R ? 4 : 0, sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, sreg |= val2 > val1 ? 1 : 0, sreg |= 1 & (~val1 & val2 | val2 & R | R & ~val1) ? 32 : 0, cpu.data[95] = sreg;
          } else if ((opcode & 61440) === 20480) {
            let val1 = cpu.data[((opcode & 240) >> 4) + 16], val2 = opcode & 15 | (opcode & 3840) >> 4, R = val1 - val2;
            cpu.data[((opcode & 240) >> 4) + 16] = R;
            let sreg = cpu.data[95] & 192;
            sreg |= R ? 0 : 2, sreg |= 128 & R ? 4 : 0, sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0, sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0, sreg |= val2 > val1 ? 1 : 0, sreg |= 1 & (~val1 & val2 | val2 & R | R & ~val1) ? 32 : 0, cpu.data[95] = sreg;
          } else if ((opcode & 65039) === 37890) {
            let d = (opcode & 496) >> 4, i = cpu.data[d];
            cpu.data[d] = (15 & i) << 4 | (240 & i) >>> 4;
          } else if (opcode === 38312)
            cpu.onWatchdogReset();
          else if ((opcode & 65039) === 37380) {
            let r = (opcode & 496) >> 4, val1 = cpu.data[r], val2 = cpu.data[cpu.dataView.getUint16(30, !0)];
            cpu.data[cpu.dataView.getUint16(30, !0)] = val1, cpu.data[r] = val2;
          }
        }
      }
    }
  }
  cpu.pc = (cpu.pc + 1) % cpu.progMem.length, cpu.cycles++;
}

// package/dist/esm/peripherals/adc.js
var ADCReference;
(function(ADCReference2) {
  ADCReference2[ADCReference2.AVCC = 0] = "AVCC", ADCReference2[ADCReference2.AREF = 1] = "AREF", ADCReference2[ADCReference2.Internal1V1 = 2] = "Internal1V1", ADCReference2[ADCReference2.Internal2V56 = 3] = "Internal2V56", ADCReference2[ADCReference2.Reserved = 4] = "Reserved";
})(ADCReference || (ADCReference = {}));
var ADCMuxInputType;
(function(ADCMuxInputType2) {
  ADCMuxInputType2[ADCMuxInputType2.SingleEnded = 0] = "SingleEnded", ADCMuxInputType2[ADCMuxInputType2.Differential = 1] = "Differential", ADCMuxInputType2[ADCMuxInputType2.Constant = 2] = "Constant", ADCMuxInputType2[ADCMuxInputType2.Temperature = 3] = "Temperature";
})(ADCMuxInputType || (ADCMuxInputType = {}));
var atmega328Channels = {
  0: { type: ADCMuxInputType.SingleEnded, channel: 0 },
  1: { type: ADCMuxInputType.SingleEnded, channel: 1 },
  2: { type: ADCMuxInputType.SingleEnded, channel: 2 },
  3: { type: ADCMuxInputType.SingleEnded, channel: 3 },
  4: { type: ADCMuxInputType.SingleEnded, channel: 4 },
  5: { type: ADCMuxInputType.SingleEnded, channel: 5 },
  6: { type: ADCMuxInputType.SingleEnded, channel: 6 },
  7: { type: ADCMuxInputType.SingleEnded, channel: 7 },
  8: { type: ADCMuxInputType.Temperature },
  14: { type: ADCMuxInputType.Constant, voltage: 1.1 },
  15: { type: ADCMuxInputType.Constant, voltage: 0 }
}, fallbackMuxInput = {
  type: ADCMuxInputType.Constant,
  voltage: 0
}, adcConfig = {
  ADMUX: 124,
  ADCSRA: 122,
  ADCSRB: 123,
  ADCL: 120,
  ADCH: 121,
  DIDR0: 126,
  adcInterrupt: 42,
  numChannels: 8,
  muxInputMask: 15,
  muxChannels: atmega328Channels,
  adcReferences: [
    ADCReference.AREF,
    ADCReference.AVCC,
    ADCReference.Reserved,
    ADCReference.Internal1V1
  ]
}, ADPS_MASK = 7, ADIE = 8, ADIF = 16, ADSC = 64, ADEN = 128, MUX_MASK = 31, ADLAR = 32, MUX5 = 8, REFS2 = 8, REFS_MASK = 3, REFS_SHIFT = 6, AVRADC = class {
  constructor(cpu, config) {
    this.cpu = cpu, this.config = config, this.channelValues = new Array(this.config.numChannels), this.avcc = 5, this.aref = 5, this.onADCRead = (input) => {
      var _a;
      let voltage = 0;
      switch (input.type) {
        case ADCMuxInputType.Constant:
          voltage = input.voltage;
          break;
        case ADCMuxInputType.SingleEnded:
          voltage = (_a = this.channelValues[input.channel]) !== null && _a !== void 0 ? _a : 0;
          break;
        case ADCMuxInputType.Differential:
          voltage = input.gain * ((this.channelValues[input.positiveChannel] || 0) - (this.channelValues[input.negativeChannel] || 0));
          break;
        case ADCMuxInputType.Temperature:
          voltage = 0.378125;
          break;
      }
      let rawValue = voltage / this.referenceVoltage * 1024, result = Math.min(Math.max(Math.floor(rawValue), 0), 1023);
      this.cpu.addClockEvent(() => this.completeADCRead(result), this.sampleCycles);
    }, this.converting = !1, this.conversionCycles = 25, this.ADC = {
      address: this.config.adcInterrupt,
      flagRegister: this.config.ADCSRA,
      flagMask: ADIF,
      enableRegister: this.config.ADCSRA,
      enableMask: ADIE
    }, cpu.writeHooks[config.ADCSRA] = (value, oldValue) => {
      var _a;
      if (value & ADEN && !(oldValue & ADEN) && (this.conversionCycles = 25), cpu.data[config.ADCSRA] = value, cpu.updateInterruptEnable(this.ADC, value), !this.converting && value & ADSC) {
        if (!(value & ADEN))
          return this.cpu.addClockEvent(() => this.completeADCRead(0), this.sampleCycles), !0;
        let channel = this.cpu.data[this.config.ADMUX] & MUX_MASK;
        cpu.data[config.ADCSRB] & MUX5 && (channel |= 32), channel &= config.muxInputMask;
        let muxInput = (_a = config.muxChannels[channel]) !== null && _a !== void 0 ? _a : fallbackMuxInput;
        return this.converting = !0, this.onADCRead(muxInput), !0;
      }
    };
  }
  completeADCRead(value) {
    let { ADCL, ADCH, ADMUX, ADCSRA } = this.config;
    this.converting = !1, this.conversionCycles = 13, this.cpu.data[ADMUX] & ADLAR ? (this.cpu.data[ADCL] = value << 6 & 255, this.cpu.data[ADCH] = value >> 2) : (this.cpu.data[ADCL] = value & 255, this.cpu.data[ADCH] = value >> 8 & 3), this.cpu.data[ADCSRA] &= ~ADSC, this.cpu.setInterruptFlag(this.ADC);
  }
  get prescaler() {
    let { ADCSRA } = this.config;
    switch (this.cpu.data[ADCSRA] & ADPS_MASK) {
      case 0:
      case 1:
        return 2;
      case 2:
        return 4;
      case 3:
        return 8;
      case 4:
        return 16;
      case 5:
        return 32;
      case 6:
        return 64;
      case 7:
      default:
        return 128;
    }
  }
  get referenceVoltageType() {
    var _a;
    let { ADMUX, adcReferences } = this.config, refs = this.cpu.data[ADMUX] >> REFS_SHIFT & REFS_MASK;
    return adcReferences.length > 4 && this.cpu.data[ADMUX] & REFS2 && (refs |= 4), (_a = adcReferences[refs]) !== null && _a !== void 0 ? _a : ADCReference.Reserved;
  }
  get referenceVoltage() {
    switch (this.referenceVoltageType) {
      case ADCReference.AVCC:
        return this.avcc;
      case ADCReference.AREF:
        return this.aref;
      case ADCReference.Internal1V1:
        return 1.1;
      case ADCReference.Internal2V56:
        return 2.56;
      default:
        return this.avcc;
    }
  }
  get sampleCycles() {
    return this.conversionCycles * this.prescaler;
  }
};

// package/dist/esm/peripherals/clock.js
var clockConfig = {
  CLKPR: 97
}, prescalers = [
  1,
  2,
  4,
  8,
  16,
  32,
  64,
  128,
  256,
  // The following values are "reserved" according to the datasheet, so we measured
  // with a scope to figure them out (on ATmega328p)
  2,
  4,
  8,
  16,
  32,
  64,
  128
], AVRClock = class {
  constructor(cpu, baseFreqHz, config = clockConfig) {
    this.cpu = cpu, this.baseFreqHz = baseFreqHz, this.config = config, this.clockEnabledCycles = 0, this.prescalerValue = 1, this.cyclesDelta = 0, this.cpu.writeHooks[this.config.CLKPR] = (clkpr) => {
      if ((!this.clockEnabledCycles || this.clockEnabledCycles < cpu.cycles) && clkpr === 128)
        this.clockEnabledCycles = this.cpu.cycles + 4;
      else if (this.clockEnabledCycles && this.clockEnabledCycles >= cpu.cycles) {
        this.clockEnabledCycles = 0;
        let index = clkpr & 15, oldPrescaler = this.prescalerValue;
        this.prescalerValue = prescalers[index], this.cpu.data[this.config.CLKPR] = index, oldPrescaler !== this.prescalerValue && (this.cyclesDelta = (cpu.cycles + this.cyclesDelta) * (oldPrescaler / this.prescalerValue) - cpu.cycles);
      }
      return !0;
    };
  }
  get frequency() {
    return this.baseFreqHz / this.prescalerValue;
  }
  get prescaler() {
    return this.prescalerValue;
  }
  get timeNanos() {
    return (this.cpu.cycles + this.cyclesDelta) / this.frequency * 1e9;
  }
  get timeMicros() {
    return (this.cpu.cycles + this.cyclesDelta) / this.frequency * 1e6;
  }
  get timeMillis() {
    return (this.cpu.cycles + this.cyclesDelta) / this.frequency * 1e3;
  }
};

// package/dist/esm/peripherals/eeprom.js
var EEPROMMemoryBackend = class {
  constructor(size) {
    this.memory = new Uint8Array(size), this.memory.fill(255);
  }
  readMemory(addr) {
    return this.memory[addr];
  }
  writeMemory(addr, value) {
    this.memory[addr] &= value;
  }
  eraseMemory(addr) {
    this.memory[addr] = 255;
  }
}, eepromConfig = {
  eepromReadyInterrupt: 44,
  EECR: 63,
  EEDR: 64,
  EEARL: 65,
  EEARH: 66,
  eraseCycles: 28800,
  // 1.8ms at 16MHz
  writeCycles: 28800
  // 1.8ms at 16MHz
}, EERE = 1, EEPE = 2, EEMPE = 4, EERIE = 8, EEPM0 = 16, EEPM1 = 32, EECR_WRITE_MASK = EEPE | EEMPE | EERIE | EEPM0 | EEPM1, AVREEPROM = class {
  constructor(cpu, backend, config = eepromConfig) {
    this.cpu = cpu, this.backend = backend, this.config = config, this.writeEnabledCycles = 0, this.writeCompleteCycles = 0, this.EER = {
      address: this.config.eepromReadyInterrupt,
      flagRegister: this.config.EECR,
      flagMask: EEPE,
      enableRegister: this.config.EECR,
      enableMask: EERIE,
      constant: !0,
      inverseFlag: !0
    }, this.cpu.writeHooks[this.config.EECR] = (eecr) => {
      let { EEARH, EEARL, EECR, EEDR } = this.config, addr = this.cpu.data[EEARH] << 8 | this.cpu.data[EEARL];
      if (this.cpu.data[EECR] = this.cpu.data[EECR] & ~EECR_WRITE_MASK | eecr & EECR_WRITE_MASK, this.cpu.updateInterruptEnable(this.EER, eecr), eecr & EERE && this.cpu.clearInterrupt(this.EER), eecr & EEMPE && (this.writeEnabledCycles = this.cpu.cycles + 4, this.cpu.addClockEvent(() => {
        this.cpu.data[EECR] &= ~EEMPE;
      }, 4)), eecr & EERE)
        return this.cpu.data[EEDR] = this.backend.readMemory(addr), this.cpu.cycles += 4, !0;
      if (eecr & EEPE) {
        if (this.cpu.cycles >= this.writeEnabledCycles)
          return this.cpu.data[EECR] &= ~EEPE, !0;
        if (this.cpu.cycles < this.writeCompleteCycles)
          return !0;
        let eedr = this.cpu.data[EEDR];
        this.writeCompleteCycles = this.cpu.cycles, eecr & EEPM1 || (this.backend.eraseMemory(addr), this.writeCompleteCycles += this.config.eraseCycles), eecr & EEPM0 || (this.backend.writeMemory(addr, eedr), this.writeCompleteCycles += this.config.writeCycles), this.cpu.data[EECR] |= EEPE, this.cpu.addClockEvent(() => {
          this.cpu.setInterruptFlag(this.EER);
        }, this.writeCompleteCycles - this.cpu.cycles), this.cpu.cycles += 2;
      }
      return !0;
    };
  }
};

// package/dist/esm/peripherals/gpio.js
var INT0 = {
  EICR: 105,
  EIMSK: 61,
  EIFR: 60,
  index: 0,
  iscOffset: 0,
  interrupt: 2
}, INT1 = {
  EICR: 105,
  EIMSK: 61,
  EIFR: 60,
  index: 1,
  iscOffset: 2,
  interrupt: 4
}, PCINT0 = {
  PCIE: 0,
  PCICR: 104,
  PCIFR: 59,
  PCMSK: 107,
  pinChangeInterrupt: 6,
  mask: 255,
  offset: 0
}, PCINT1 = {
  PCIE: 1,
  PCICR: 104,
  PCIFR: 59,
  PCMSK: 108,
  pinChangeInterrupt: 8,
  mask: 255,
  offset: 0
}, PCINT2 = {
  PCIE: 2,
  PCICR: 104,
  PCIFR: 59,
  PCMSK: 109,
  pinChangeInterrupt: 10,
  mask: 255,
  offset: 0
}, portAConfig = {
  PIN: 32,
  DDR: 33,
  PORT: 34,
  externalInterrupts: []
}, portBConfig = {
  PIN: 35,
  DDR: 36,
  PORT: 37,
  // Interrupt settings
  pinChange: PCINT0,
  externalInterrupts: []
}, portCConfig = {
  PIN: 38,
  DDR: 39,
  PORT: 40,
  // Interrupt settings
  pinChange: PCINT1,
  externalInterrupts: []
}, portDConfig = {
  PIN: 41,
  DDR: 42,
  PORT: 43,
  // Interrupt settings
  pinChange: PCINT2,
  externalInterrupts: [null, null, INT0, INT1]
}, portEConfig = {
  PIN: 44,
  DDR: 45,
  PORT: 46,
  externalInterrupts: []
}, portFConfig = {
  PIN: 47,
  DDR: 48,
  PORT: 49,
  externalInterrupts: []
}, portGConfig = {
  PIN: 50,
  DDR: 51,
  PORT: 52,
  externalInterrupts: []
}, portHConfig = {
  PIN: 256,
  DDR: 257,
  PORT: 258,
  externalInterrupts: []
}, portJConfig = {
  PIN: 259,
  DDR: 260,
  PORT: 261,
  externalInterrupts: []
}, portKConfig = {
  PIN: 262,
  DDR: 263,
  PORT: 264,
  externalInterrupts: []
}, portLConfig = {
  PIN: 265,
  DDR: 266,
  PORT: 267,
  externalInterrupts: []
}, PinState;
(function(PinState2) {
  PinState2[PinState2.Low = 0] = "Low", PinState2[PinState2.High = 1] = "High", PinState2[PinState2.Input = 2] = "Input", PinState2[PinState2.InputPullUp = 3] = "InputPullUp";
})(PinState || (PinState = {}));
var PinOverrideMode;
(function(PinOverrideMode2) {
  PinOverrideMode2[PinOverrideMode2.None = 0] = "None", PinOverrideMode2[PinOverrideMode2.Enable = 1] = "Enable", PinOverrideMode2[PinOverrideMode2.Set = 2] = "Set", PinOverrideMode2[PinOverrideMode2.Clear = 3] = "Clear", PinOverrideMode2[PinOverrideMode2.Toggle = 4] = "Toggle";
})(PinOverrideMode || (PinOverrideMode = {}));
var InterruptMode;
(function(InterruptMode2) {
  InterruptMode2[InterruptMode2.LowLevel = 0] = "LowLevel", InterruptMode2[InterruptMode2.Change = 1] = "Change", InterruptMode2[InterruptMode2.FallingEdge = 2] = "FallingEdge", InterruptMode2[InterruptMode2.RisingEdge = 3] = "RisingEdge";
})(InterruptMode || (InterruptMode = {}));
var AVRIOPort = class {
  constructor(cpu, portConfig) {
    var _a, _b, _c, _d;
    this.cpu = cpu, this.portConfig = portConfig, this.externalClockListeners = [], this.listeners = [], this.pinValue = 0, this.overrideMask = 255, this.overrideValue = 0, this.lastValue = 0, this.lastDdr = 0, this.lastPin = 0, this.openCollector = 0, cpu.gpioPorts.add(this), cpu.gpioByPort[portConfig.PORT] = this, cpu.writeHooks[portConfig.DDR] = (value) => {
      let portValue = cpu.data[portConfig.PORT];
      return cpu.data[portConfig.DDR] = value, this.writeGpio(portValue, value), this.updatePinRegister(value), !0;
    }, cpu.writeHooks[portConfig.PORT] = (value) => {
      let ddrMask = cpu.data[portConfig.DDR];
      return cpu.data[portConfig.PORT] = value, this.writeGpio(value, ddrMask), this.updatePinRegister(ddrMask), !0;
    }, cpu.writeHooks[portConfig.PIN] = (value, oldValue, addr, mask) => {
      let oldPortValue = cpu.data[portConfig.PORT], ddrMask = cpu.data[portConfig.DDR], portValue = oldPortValue ^ value & mask;
      return cpu.data[portConfig.PORT] = portValue, this.writeGpio(portValue, ddrMask), this.updatePinRegister(ddrMask), !0;
    };
    let { externalInterrupts } = portConfig;
    this.externalInts = externalInterrupts.map((externalConfig) => externalConfig ? {
      address: externalConfig.interrupt,
      flagRegister: externalConfig.EIFR,
      flagMask: 1 << externalConfig.index,
      enableRegister: externalConfig.EIMSK,
      enableMask: 1 << externalConfig.index
    } : null);
    let EICR = new Set(externalInterrupts.map((item) => item?.EICR));
    for (let EICRx of EICR)
      this.attachInterruptHook(EICRx || 0);
    let EIMSK = (_b = (_a = externalInterrupts.find((item) => item && item.EIMSK)) === null || _a === void 0 ? void 0 : _a.EIMSK) !== null && _b !== void 0 ? _b : 0;
    this.attachInterruptHook(EIMSK, "mask");
    let EIFR = (_d = (_c = externalInterrupts.find((item) => item && item.EIFR)) === null || _c === void 0 ? void 0 : _c.EIFR) !== null && _d !== void 0 ? _d : 0;
    this.attachInterruptHook(EIFR, "flag");
    let { pinChange } = portConfig;
    if (this.PCINT = pinChange ? {
      address: pinChange.pinChangeInterrupt,
      flagRegister: pinChange.PCIFR,
      flagMask: 1 << pinChange.PCIE,
      enableRegister: pinChange.PCICR,
      enableMask: 1 << pinChange.PCIE
    } : null, pinChange) {
      let { PCIFR, PCMSK } = pinChange;
      cpu.writeHooks[PCIFR] = (value) => {
        for (let gpio of this.cpu.gpioPorts) {
          let { PCINT } = gpio;
          PCINT && cpu.clearInterruptByFlag(PCINT, value);
        }
        return !0;
      }, cpu.writeHooks[PCMSK] = (value) => {
        cpu.data[PCMSK] = value;
        for (let gpio of this.cpu.gpioPorts) {
          let { PCINT } = gpio;
          PCINT && cpu.updateInterruptEnable(PCINT, value);
        }
        return !0;
      };
    }
  }
  addListener(listener) {
    this.listeners.push(listener);
  }
  removeListener(listener) {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }
  /**
   * Get the state of a given GPIO pin
   *
   * @param index Pin index to return from 0 to 7
   * @returns PinState.Low or PinState.High if the pin is set to output, PinState.Input if the pin is set
   *   to input, and PinState.InputPullUp if the pin is set to input and the internal pull-up resistor has
   *   been enabled.
   */
  pinState(index) {
    let ddr = this.cpu.data[this.portConfig.DDR], port = this.cpu.data[this.portConfig.PORT], bitMask = 1 << index, openState = port & bitMask ? PinState.InputPullUp : PinState.Input, highValue = this.openCollector & bitMask ? openState : PinState.High;
    return ddr & bitMask ? this.lastValue & bitMask ? highValue : PinState.Low : openState;
  }
  /**
   * Sets the input value for the given pin. This is the value that
   * will be returned when reading from the PIN register.
   */
  setPin(index, value) {
    let bitMask = 1 << index;
    this.pinValue &= ~bitMask, value && (this.pinValue |= bitMask), this.updatePinRegister(this.cpu.data[this.portConfig.DDR]);
  }
  /**
   * Internal method - do not call this directly!
   * Used by the timer compare output units to override GPIO pins.
   */
  timerOverridePin(pin, mode) {
    let { cpu, portConfig } = this, pinMask = 1 << pin;
    if (mode === PinOverrideMode.None)
      this.overrideMask |= pinMask, this.overrideValue &= ~pinMask;
    else
      switch (this.overrideMask &= ~pinMask, mode) {
        case PinOverrideMode.Enable:
          this.overrideValue &= ~pinMask, this.overrideValue |= cpu.data[portConfig.PORT] & pinMask;
          break;
        case PinOverrideMode.Set:
          this.overrideValue |= pinMask;
          break;
        case PinOverrideMode.Clear:
          this.overrideValue &= ~pinMask;
          break;
        case PinOverrideMode.Toggle:
          this.overrideValue ^= pinMask;
          break;
      }
    let ddrMask = cpu.data[portConfig.DDR];
    this.writeGpio(cpu.data[portConfig.PORT], ddrMask), this.updatePinRegister(ddrMask);
  }
  updatePinRegister(ddr) {
    var _a, _b;
    let newPin = this.pinValue & ~ddr | this.lastValue & ddr;
    if (this.cpu.data[this.portConfig.PIN] = newPin, this.lastPin !== newPin) {
      for (let index = 0; index < 8; index++)
        if ((newPin & 1 << index) !== (this.lastPin & 1 << index)) {
          let value = !!(newPin & 1 << index);
          this.toggleInterrupt(index, value), (_b = (_a = this.externalClockListeners)[index]) === null || _b === void 0 || _b.call(_a, value);
        }
      this.lastPin = newPin;
    }
  }
  toggleInterrupt(pin, risingEdge) {
    let { cpu, portConfig, externalInts, PCINT } = this, { externalInterrupts, pinChange } = portConfig, externalConfig = externalInterrupts[pin], external = externalInts[pin];
    if (external && externalConfig) {
      let { EIMSK, index, EICR, iscOffset } = externalConfig;
      if (cpu.data[EIMSK] & 1 << index) {
        let configuration = cpu.data[EICR] >> iscOffset & 3, generateInterrupt = !1;
        switch (external.constant = !1, configuration) {
          case InterruptMode.LowLevel:
            generateInterrupt = !risingEdge, external.constant = !0;
            break;
          case InterruptMode.Change:
            generateInterrupt = !0;
            break;
          case InterruptMode.FallingEdge:
            generateInterrupt = !risingEdge;
            break;
          case InterruptMode.RisingEdge:
            generateInterrupt = risingEdge;
            break;
        }
        generateInterrupt ? cpu.setInterruptFlag(external) : external.constant && cpu.clearInterrupt(external, !0);
      }
    }
    if (pinChange && PCINT && pinChange.mask & 1 << pin) {
      let { PCMSK } = pinChange;
      cpu.data[PCMSK] & 1 << pin + pinChange.offset && cpu.setInterruptFlag(PCINT);
    }
  }
  attachInterruptHook(register, registerType = "other") {
    if (!register)
      return;
    let { cpu } = this;
    cpu.writeHooks[register] = (value) => {
      registerType !== "flag" && (cpu.data[register] = value);
      for (let gpio of cpu.gpioPorts) {
        for (let external of gpio.externalInts)
          external && registerType === "mask" && cpu.updateInterruptEnable(external, value), external && !external.constant && registerType === "flag" && cpu.clearInterruptByFlag(external, value);
        gpio.checkExternalInterrupts();
      }
      return !0;
    };
  }
  checkExternalInterrupts() {
    let { cpu } = this, { externalInterrupts } = this.portConfig;
    for (let pin = 0; pin < 8; pin++) {
      let external = externalInterrupts[pin];
      if (!external)
        continue;
      let pinValue = !!(this.lastPin & 1 << pin), { EIFR, EIMSK, index, EICR, iscOffset, interrupt } = external;
      if (!(cpu.data[EIMSK] & 1 << index) || pinValue)
        continue;
      (cpu.data[EICR] >> iscOffset & 3) === InterruptMode.LowLevel && cpu.queueInterrupt({
        address: interrupt,
        flagRegister: EIFR,
        flagMask: 1 << index,
        enableRegister: EIMSK,
        enableMask: 1 << index,
        constant: !0
      });
    }
  }
  writeGpio(value, ddr) {
    let newValue = (value & this.overrideMask | this.overrideValue) & ddr | value & ~ddr, prevValue = this.lastValue;
    if (newValue !== prevValue || ddr !== this.lastDdr) {
      this.lastValue = newValue, this.lastDdr = ddr;
      for (let listener of this.listeners)
        listener(newValue, prevValue);
    }
  }
};

// package/dist/esm/peripherals/spi.js
var spiConfig = {
  spiInterrupt: 34,
  SPCR: 76,
  SPSR: 77,
  SPDR: 78
}, bitsPerByte = 8, AVRSPI = class {
  constructor(cpu, config, freqHz) {
    this.cpu = cpu, this.config = config, this.freqHz = freqHz, this.onTransfer = () => 0, this.onByte = (value) => {
      let valueIn = this.onTransfer(value);
      this.cpu.addClockEvent(() => this.completeTransfer(valueIn), this.transferCycles);
    }, this.transmissionActive = !1, this.SPI = {
      address: this.config.spiInterrupt,
      flagRegister: this.config.SPSR,
      flagMask: 128,
      enableRegister: this.config.SPCR,
      enableMask: 128
    };
    let { SPCR, SPSR, SPDR } = config;
    cpu.writeHooks[SPDR] = (value) => {
      if (cpu.data[SPCR] & 64)
        return this.transmissionActive ? (cpu.data[SPSR] |= 64, !0) : (cpu.data[SPSR] &= -65, this.cpu.clearInterrupt(this.SPI), this.transmissionActive = !0, this.onByte(value), !0);
    }, cpu.writeHooks[SPCR] = (value) => {
      this.cpu.updateInterruptEnable(this.SPI, value);
    }, cpu.writeHooks[SPSR] = (value) => {
      this.cpu.data[SPSR] = value, this.cpu.clearInterruptByFlag(this.SPI, value);
    };
  }
  reset() {
    this.transmissionActive = !1;
  }
  /**
   * Completes an SPI transaction. Call this method only from the `onByte` callback.
   *
   * @param receivedByte Byte read from the SPI MISO line.
   */
  completeTransfer(receivedByte) {
    let { SPDR } = this.config;
    this.cpu.data[SPDR] = receivedByte, this.cpu.setInterruptFlag(this.SPI), this.transmissionActive = !1;
  }
  get isMaster() {
    return !!(this.cpu.data[this.config.SPCR] & 16);
  }
  get dataOrder() {
    return this.cpu.data[this.config.SPCR] & 32 ? "lsbFirst" : "msbFirst";
  }
  get spiMode() {
    let CPHA = this.cpu.data[this.config.SPCR] & 4, CPOL = this.cpu.data[this.config.SPCR] & 8;
    return (CPHA ? 2 : 0) | (CPOL ? 1 : 0);
  }
  /**
   * The clock divider is only relevant for Master mode
   */
  get clockDivider() {
    let base = this.cpu.data[this.config.SPSR] & 1 ? 2 : 4;
    switch (this.cpu.data[this.config.SPCR] & 3) {
      case 0:
        return base;
      case 1:
        return base * 4;
      case 2:
        return base * 16;
      case 3:
        return base * 32;
    }
    throw new Error("Invalid divider value!");
  }
  /** Number of cycles to complete a single byte SPI transaction */
  get transferCycles() {
    return this.clockDivider * bitsPerByte;
  }
  /**
   * The SPI freqeuncy is only relevant to Master mode.
   * In slave mode, the frequency can be as high as F(osc) / 4.
   */
  get spiFrequency() {
    return this.freqHz / this.clockDivider;
  }
};

// package/dist/esm/peripherals/timer.js
var timer01Dividers = {
  0: 0,
  1: 1,
  2: 8,
  3: 64,
  4: 256,
  5: 1024,
  6: 0,
  // External clock - see ExternalClockMode
  7: 0
  // Ditto
}, ExternalClockMode;
(function(ExternalClockMode2) {
  ExternalClockMode2[ExternalClockMode2.FallingEdge = 6] = "FallingEdge", ExternalClockMode2[ExternalClockMode2.RisingEdge = 7] = "RisingEdge";
})(ExternalClockMode || (ExternalClockMode = {}));
var defaultTimerBits = {
  // TIFR bits
  TOV: 1,
  OCFA: 2,
  OCFB: 4,
  OCFC: 0,
  // Unused
  // TIMSK bits
  TOIE: 1,
  OCIEA: 2,
  OCIEB: 4,
  OCIEC: 0
  // Unused
}, timer0Config = Object.assign({ bits: 8, captureInterrupt: 0, compAInterrupt: 28, compBInterrupt: 30, compCInterrupt: 0, ovfInterrupt: 32, TIFR: 53, OCRA: 71, OCRB: 72, OCRC: 0, ICR: 0, TCNT: 70, TCCRA: 68, TCCRB: 69, TCCRC: 0, TIMSK: 110, dividers: timer01Dividers, compPortA: portDConfig.PORT, compPinA: 6, compPortB: portDConfig.PORT, compPinB: 5, compPortC: 0, compPinC: 0, externalClockPort: portDConfig.PORT, externalClockPin: 4 }, defaultTimerBits), timer1Config = Object.assign({ bits: 16, captureInterrupt: 20, compAInterrupt: 22, compBInterrupt: 24, compCInterrupt: 0, ovfInterrupt: 26, TIFR: 54, OCRA: 136, OCRB: 138, OCRC: 0, ICR: 134, TCNT: 132, TCCRA: 128, TCCRB: 129, TCCRC: 130, TIMSK: 111, dividers: timer01Dividers, compPortA: portBConfig.PORT, compPinA: 1, compPortB: portBConfig.PORT, compPinB: 2, compPortC: 0, compPinC: 0, externalClockPort: portDConfig.PORT, externalClockPin: 5 }, defaultTimerBits), timer2Config = Object.assign({ bits: 8, captureInterrupt: 0, compAInterrupt: 14, compBInterrupt: 16, compCInterrupt: 0, ovfInterrupt: 18, TIFR: 55, OCRA: 179, OCRB: 180, OCRC: 0, ICR: 0, TCNT: 178, TCCRA: 176, TCCRB: 177, TCCRC: 0, TIMSK: 112, dividers: {
  0: 0,
  1: 1,
  2: 8,
  3: 32,
  4: 64,
  5: 128,
  6: 256,
  7: 1024
}, compPortA: portBConfig.PORT, compPinA: 3, compPortB: portDConfig.PORT, compPinB: 3, compPortC: 0, compPinC: 0, externalClockPort: 0, externalClockPin: 0 }, defaultTimerBits), TimerMode;
(function(TimerMode2) {
  TimerMode2[TimerMode2.Normal = 0] = "Normal", TimerMode2[TimerMode2.PWMPhaseCorrect = 1] = "PWMPhaseCorrect", TimerMode2[TimerMode2.CTC = 2] = "CTC", TimerMode2[TimerMode2.FastPWM = 3] = "FastPWM", TimerMode2[TimerMode2.PWMPhaseFrequencyCorrect = 4] = "PWMPhaseFrequencyCorrect", TimerMode2[TimerMode2.Reserved = 5] = "Reserved";
})(TimerMode || (TimerMode = {}));
var TOVUpdateMode;
(function(TOVUpdateMode2) {
  TOVUpdateMode2[TOVUpdateMode2.Max = 0] = "Max", TOVUpdateMode2[TOVUpdateMode2.Top = 1] = "Top", TOVUpdateMode2[TOVUpdateMode2.Bottom = 2] = "Bottom";
})(TOVUpdateMode || (TOVUpdateMode = {}));
var OCRUpdateMode;
(function(OCRUpdateMode2) {
  OCRUpdateMode2[OCRUpdateMode2.Immediate = 0] = "Immediate", OCRUpdateMode2[OCRUpdateMode2.Top = 1] = "Top", OCRUpdateMode2[OCRUpdateMode2.Bottom = 2] = "Bottom";
})(OCRUpdateMode || (OCRUpdateMode = {}));
var TopOCRA = 1, TopICR = 2, OCToggle = 1, { Normal, PWMPhaseCorrect, CTC, FastPWM, Reserved, PWMPhaseFrequencyCorrect } = TimerMode, wgmModes8Bit = [
  /*0*/
  [Normal, 255, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
  /*1*/
  [PWMPhaseCorrect, 255, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
  /*2*/
  [CTC, TopOCRA, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
  /*3*/
  [FastPWM, 255, OCRUpdateMode.Bottom, TOVUpdateMode.Max, 0],
  /*4*/
  [Reserved, 255, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
  /*5*/
  [PWMPhaseCorrect, TopOCRA, OCRUpdateMode.Top, TOVUpdateMode.Bottom, OCToggle],
  /*6*/
  [Reserved, 255, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
  /*7*/
  [FastPWM, TopOCRA, OCRUpdateMode.Bottom, TOVUpdateMode.Top, OCToggle]
], wgmModes16Bit = [
  /*0 */
  [Normal, 65535, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
  /*1 */
  [PWMPhaseCorrect, 255, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
  /*2 */
  [PWMPhaseCorrect, 511, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
  /*3 */
  [PWMPhaseCorrect, 1023, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
  /*4 */
  [CTC, TopOCRA, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
  /*5 */
  [FastPWM, 255, OCRUpdateMode.Bottom, TOVUpdateMode.Top, 0],
  /*6 */
  [FastPWM, 511, OCRUpdateMode.Bottom, TOVUpdateMode.Top, 0],
  /*7 */
  [FastPWM, 1023, OCRUpdateMode.Bottom, TOVUpdateMode.Top, 0],
  /*8 */
  [PWMPhaseFrequencyCorrect, TopICR, OCRUpdateMode.Bottom, TOVUpdateMode.Bottom, 0],
  /*9 */
  [PWMPhaseFrequencyCorrect, TopOCRA, OCRUpdateMode.Bottom, TOVUpdateMode.Bottom, OCToggle],
  /*10*/
  [PWMPhaseCorrect, TopICR, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
  /*11*/
  [PWMPhaseCorrect, TopOCRA, OCRUpdateMode.Top, TOVUpdateMode.Bottom, OCToggle],
  /*12*/
  [CTC, TopICR, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
  /*13*/
  [Reserved, 65535, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
  /*14*/
  [FastPWM, TopICR, OCRUpdateMode.Bottom, TOVUpdateMode.Top, OCToggle],
  /*15*/
  [FastPWM, TopOCRA, OCRUpdateMode.Bottom, TOVUpdateMode.Top, OCToggle]
];
function compToOverride(comp) {
  switch (comp) {
    case 1:
      return PinOverrideMode.Toggle;
    case 2:
      return PinOverrideMode.Clear;
    case 3:
      return PinOverrideMode.Set;
    default:
      return PinOverrideMode.Enable;
  }
}
var FOCA = 128, FOCB = 64, FOCC = 32, AVRTimer = class {
  constructor(cpu, config) {
    if (this.cpu = cpu, this.config = config, this.MAX = this.config.bits === 16 ? 65535 : 255, this.lastCycle = 0, this.ocrA = 0, this.nextOcrA = 0, this.ocrB = 0, this.nextOcrB = 0, this.hasOCRC = this.config.OCRC > 0, this.ocrC = 0, this.nextOcrC = 0, this.ocrUpdateMode = OCRUpdateMode.Immediate, this.tovUpdateMode = TOVUpdateMode.Max, this.icr = 0, this.tcnt = 0, this.tcntNext = 0, this.tcntUpdated = !1, this.updateDivider = !1, this.countingUp = !0, this.divider = 0, this.externalClockRisingEdge = !1, this.highByteTemp = 0, this.OVF = {
      address: this.config.ovfInterrupt,
      flagRegister: this.config.TIFR,
      flagMask: this.config.TOV,
      enableRegister: this.config.TIMSK,
      enableMask: this.config.TOIE
    }, this.OCFA = {
      address: this.config.compAInterrupt,
      flagRegister: this.config.TIFR,
      flagMask: this.config.OCFA,
      enableRegister: this.config.TIMSK,
      enableMask: this.config.OCIEA
    }, this.OCFB = {
      address: this.config.compBInterrupt,
      flagRegister: this.config.TIFR,
      flagMask: this.config.OCFB,
      enableRegister: this.config.TIMSK,
      enableMask: this.config.OCIEB
    }, this.OCFC = {
      address: this.config.compCInterrupt,
      flagRegister: this.config.TIFR,
      flagMask: this.config.OCFC,
      enableRegister: this.config.TIMSK,
      enableMask: this.config.OCIEC
    }, this.count = (reschedule = !0, external = !1) => {
      let { divider, lastCycle, cpu: cpu2 } = this, { cycles } = cpu2, delta = cycles - lastCycle;
      if (divider && delta >= divider || external) {
        let counterDelta = external ? 1 : Math.floor(delta / divider);
        this.lastCycle += counterDelta * divider;
        let val = this.tcnt, { timerMode, TOP } = this, phasePwm = timerMode === PWMPhaseCorrect || timerMode === PWMPhaseFrequencyCorrect, newVal = phasePwm ? this.phasePwmCount(val, counterDelta) : (val + counterDelta) % (TOP + 1), overflow = val + counterDelta > TOP;
        if (this.tcntUpdated || (this.tcnt = newVal, phasePwm || this.timerUpdated(newVal, val)), !phasePwm) {
          if (timerMode === FastPWM && overflow) {
            let { compA, compB } = this;
            compA && this.updateCompPin(compA, "A", !0), compB && this.updateCompPin(compB, "B", !0);
          }
          this.ocrUpdateMode == OCRUpdateMode.Bottom && overflow && (this.ocrA = this.nextOcrA, this.ocrB = this.nextOcrB, this.ocrC = this.nextOcrC), overflow && (this.tovUpdateMode == TOVUpdateMode.Top || TOP === this.MAX) && cpu2.setInterruptFlag(this.OVF);
        }
      }
      if (this.tcntUpdated && (this.tcnt = this.tcntNext, this.tcntUpdated = !1, (this.tcnt === 0 && this.ocrUpdateMode === OCRUpdateMode.Bottom || this.tcnt === this.TOP && this.ocrUpdateMode === OCRUpdateMode.Top) && (this.ocrA = this.nextOcrA, this.ocrB = this.nextOcrB, this.ocrC = this.nextOcrC)), this.updateDivider) {
        let { CS } = this, { externalClockPin } = this.config, newDivider = this.config.dividers[CS];
        this.lastCycle = newDivider ? this.cpu.cycles : 0, this.updateDivider = !1, this.divider = newDivider, this.config.externalClockPort && !this.externalClockPort && (this.externalClockPort = this.cpu.gpioByPort[this.config.externalClockPort]), this.externalClockPort && (this.externalClockPort.externalClockListeners[externalClockPin] = null), newDivider ? cpu2.addClockEvent(this.count, this.lastCycle + newDivider - cpu2.cycles) : this.externalClockPort && (CS === ExternalClockMode.FallingEdge || CS === ExternalClockMode.RisingEdge) && (this.externalClockPort.externalClockListeners[externalClockPin] = this.externalClockCallback, this.externalClockRisingEdge = CS === ExternalClockMode.RisingEdge);
        return;
      }
      reschedule && divider && cpu2.addClockEvent(this.count, this.lastCycle + divider - cpu2.cycles);
    }, this.externalClockCallback = (value) => {
      value === this.externalClockRisingEdge && this.count(!1, !0);
    }, this.updateWGMConfig(), this.cpu.readHooks[config.TCNT] = (addr) => (this.count(!1), this.config.bits === 16 && (this.cpu.data[addr + 1] = this.tcnt >> 8), this.cpu.data[addr] = this.tcnt & 255), this.cpu.writeHooks[config.TCNT] = (value) => {
      this.tcntNext = this.highByteTemp << 8 | value, this.countingUp = !0, this.tcntUpdated = !0, this.cpu.updateClockEvent(this.count, 0), this.divider && this.timerUpdated(this.tcntNext, this.tcntNext);
    }, this.cpu.writeHooks[config.OCRA] = (value) => {
      this.nextOcrA = this.highByteTemp << 8 | value, this.ocrUpdateMode === OCRUpdateMode.Immediate && (this.ocrA = this.nextOcrA);
    }, this.cpu.writeHooks[config.OCRB] = (value) => {
      this.nextOcrB = this.highByteTemp << 8 | value, this.ocrUpdateMode === OCRUpdateMode.Immediate && (this.ocrB = this.nextOcrB);
    }, this.hasOCRC && (this.cpu.writeHooks[config.OCRC] = (value) => {
      this.nextOcrC = this.highByteTemp << 8 | value, this.ocrUpdateMode === OCRUpdateMode.Immediate && (this.ocrC = this.nextOcrC);
    }), this.config.bits === 16) {
      this.cpu.writeHooks[config.ICR] = (value) => {
        this.icr = this.highByteTemp << 8 | value;
      };
      let updateTempRegister = (value) => {
        this.highByteTemp = value;
      }, updateOCRHighRegister = (value, old, addr) => (this.highByteTemp = value & this.ocrMask >> 8, cpu.data[addr] = this.highByteTemp, !0);
      this.cpu.writeHooks[config.TCNT + 1] = updateTempRegister, this.cpu.writeHooks[config.OCRA + 1] = updateOCRHighRegister, this.cpu.writeHooks[config.OCRB + 1] = updateOCRHighRegister, this.hasOCRC && (this.cpu.writeHooks[config.OCRC + 1] = updateOCRHighRegister), this.cpu.writeHooks[config.ICR + 1] = updateTempRegister;
    }
    cpu.writeHooks[config.TCCRA] = (value) => (this.cpu.data[config.TCCRA] = value, this.updateWGMConfig(), !0), cpu.writeHooks[config.TCCRB] = (value) => (config.TCCRC || (this.checkForceCompare(value), value &= ~(FOCA | FOCB)), this.cpu.data[config.TCCRB] = value, this.updateDivider = !0, this.cpu.clearClockEvent(this.count), this.cpu.addClockEvent(this.count, 0), this.updateWGMConfig(), !0), config.TCCRC && (cpu.writeHooks[config.TCCRC] = (value) => {
      this.checkForceCompare(value);
    }), cpu.writeHooks[config.TIFR] = (value) => (this.cpu.data[config.TIFR] = value, this.cpu.clearInterruptByFlag(this.OVF, value), this.cpu.clearInterruptByFlag(this.OCFA, value), this.cpu.clearInterruptByFlag(this.OCFB, value), !0), cpu.writeHooks[config.TIMSK] = (value) => {
      this.cpu.updateInterruptEnable(this.OVF, value), this.cpu.updateInterruptEnable(this.OCFA, value), this.cpu.updateInterruptEnable(this.OCFB, value);
    };
  }
  reset() {
    this.divider = 0, this.lastCycle = 0, this.ocrA = 0, this.nextOcrA = 0, this.ocrB = 0, this.nextOcrB = 0, this.ocrC = 0, this.nextOcrC = 0, this.icr = 0, this.tcnt = 0, this.tcntNext = 0, this.tcntUpdated = !1, this.countingUp = !1, this.updateDivider = !0;
  }
  get TCCRA() {
    return this.cpu.data[this.config.TCCRA];
  }
  get TCCRB() {
    return this.cpu.data[this.config.TCCRB];
  }
  get TIMSK() {
    return this.cpu.data[this.config.TIMSK];
  }
  get CS() {
    return this.TCCRB & 7;
  }
  get WGM() {
    let mask = this.config.bits === 16 ? 24 : 8;
    return (this.TCCRB & mask) >> 1 | this.TCCRA & 3;
  }
  get TOP() {
    switch (this.topValue) {
      case TopOCRA:
        return this.ocrA;
      case TopICR:
        return this.icr;
      default:
        return this.topValue;
    }
  }
  get ocrMask() {
    switch (this.topValue) {
      case TopOCRA:
      case TopICR:
        return 65535;
      default:
        return this.topValue;
    }
  }
  /** Expose the raw value of TCNT, for use by the unit tests */
  get debugTCNT() {
    return this.tcnt;
  }
  updateWGMConfig() {
    let { config, WGM } = this, wgmModes = config.bits === 16 ? wgmModes16Bit : wgmModes8Bit, TCCRA = this.cpu.data[config.TCCRA], [timerMode, topValue, ocrUpdateMode, tovUpdateMode, flags] = wgmModes[WGM];
    this.timerMode = timerMode, this.topValue = topValue, this.ocrUpdateMode = ocrUpdateMode, this.tovUpdateMode = tovUpdateMode;
    let pwmMode = timerMode === FastPWM || timerMode === PWMPhaseCorrect || timerMode === PWMPhaseFrequencyCorrect, prevCompA = this.compA;
    this.compA = TCCRA >> 6 & 3, this.compA === 1 && pwmMode && !(flags & OCToggle) && (this.compA = 0), !!prevCompA != !!this.compA && this.updateCompA(this.compA ? PinOverrideMode.Enable : PinOverrideMode.None);
    let prevCompB = this.compB;
    if (this.compB = TCCRA >> 4 & 3, this.compB === 1 && pwmMode && (this.compB = 0), !!prevCompB != !!this.compB && this.updateCompB(this.compB ? PinOverrideMode.Enable : PinOverrideMode.None), this.hasOCRC) {
      let prevCompC = this.compC;
      this.compC = TCCRA >> 2 & 3, this.compC === 1 && pwmMode && (this.compC = 0), !!prevCompC != !!this.compC && this.updateCompC(this.compC ? PinOverrideMode.Enable : PinOverrideMode.None);
    }
  }
  phasePwmCount(value, delta) {
    let { ocrA, ocrB, ocrC, hasOCRC, TOP, MAX, tcntUpdated } = this;
    for (!value && !TOP && (delta = 0, this.ocrUpdateMode === OCRUpdateMode.Top && (this.ocrA = this.nextOcrA, this.ocrB = this.nextOcrB, this.ocrC = this.nextOcrC)); delta > 0; )
      this.countingUp ? (value++, value === TOP && !tcntUpdated && (this.countingUp = !1, this.ocrUpdateMode === OCRUpdateMode.Top && (this.ocrA = this.nextOcrA, this.ocrB = this.nextOcrB, this.ocrC = this.nextOcrC))) : (value--, !value && !tcntUpdated && (this.countingUp = !0, this.cpu.setInterruptFlag(this.OVF), this.ocrUpdateMode === OCRUpdateMode.Bottom && (this.ocrA = this.nextOcrA, this.ocrB = this.nextOcrB, this.ocrC = this.nextOcrC))), tcntUpdated || (value === ocrA && (this.cpu.setInterruptFlag(this.OCFA), this.compA && this.updateCompPin(this.compA, "A")), value === ocrB && (this.cpu.setInterruptFlag(this.OCFB), this.compB && this.updateCompPin(this.compB, "B")), hasOCRC && value === ocrC && (this.cpu.setInterruptFlag(this.OCFC), this.compC && this.updateCompPin(this.compC, "C"))), delta--;
    return value & MAX;
  }
  timerUpdated(value, prevValue) {
    let { ocrA, ocrB, ocrC, hasOCRC } = this, overflow = prevValue > value;
    ((prevValue < ocrA || overflow) && value >= ocrA || prevValue < ocrA && overflow) && (this.cpu.setInterruptFlag(this.OCFA), this.compA && this.updateCompPin(this.compA, "A")), ((prevValue < ocrB || overflow) && value >= ocrB || prevValue < ocrB && overflow) && (this.cpu.setInterruptFlag(this.OCFB), this.compB && this.updateCompPin(this.compB, "B")), hasOCRC && ((prevValue < ocrC || overflow) && value >= ocrC || prevValue < ocrC && overflow) && (this.cpu.setInterruptFlag(this.OCFC), this.compC && this.updateCompPin(this.compC, "C"));
  }
  checkForceCompare(value) {
    this.timerMode == TimerMode.FastPWM || this.timerMode == TimerMode.PWMPhaseCorrect || this.timerMode == TimerMode.PWMPhaseFrequencyCorrect || (value & FOCA && this.updateCompPin(this.compA, "A"), value & FOCB && this.updateCompPin(this.compB, "B"), this.config.compPortC && value & FOCC && this.updateCompPin(this.compC, "C"));
  }
  updateCompPin(compValue, pinName, bottom = !1) {
    let newValue = PinOverrideMode.None, invertingMode = compValue === 3, isSet = this.countingUp === invertingMode;
    switch (this.timerMode) {
      case Normal:
      case CTC:
        newValue = compToOverride(compValue);
        break;
      case FastPWM:
        compValue === 1 ? newValue = bottom ? PinOverrideMode.None : PinOverrideMode.Toggle : newValue = invertingMode !== bottom ? PinOverrideMode.Set : PinOverrideMode.Clear;
        break;
      case PWMPhaseCorrect:
      case PWMPhaseFrequencyCorrect:
        compValue === 1 ? newValue = PinOverrideMode.Toggle : newValue = isSet ? PinOverrideMode.Set : PinOverrideMode.Clear;
        break;
    }
    newValue !== PinOverrideMode.None && (pinName === "A" ? this.updateCompA(newValue) : pinName === "B" ? this.updateCompB(newValue) : this.updateCompC(newValue));
  }
  updateCompA(value) {
    let { compPortA, compPinA } = this.config, port = this.cpu.gpioByPort[compPortA];
    port?.timerOverridePin(compPinA, value);
  }
  updateCompB(value) {
    let { compPortB, compPinB } = this.config, port = this.cpu.gpioByPort[compPortB];
    port?.timerOverridePin(compPinB, value);
  }
  updateCompC(value) {
    let { compPortC, compPinC } = this.config, port = this.cpu.gpioByPort[compPortC];
    port?.timerOverridePin(compPinC, value);
  }
};

// package/dist/esm/peripherals/timer-attiny.js
var CTC1 = 128, PWM1A = 64, CS_MASK = 15, PWM1B_BIT = 64, FOC1B = 8, FOC1A = 4, PSR1 = 2, attinyTimer1Config = {
  TCCR1: 80,
  GTCCR: 76,
  TCNT1: 79,
  OCR1A: 78,
  OCR1B: 75,
  OCR1C: 77,
  TIFR: 88,
  TIMSK: 89,
  ovfInterrupt: 4,
  compAInterrupt: 3,
  compBInterrupt: 9,
  TOV1: 4,
  OCF1A: 64,
  OCF1B: 32,
  TOIE1: 4,
  OCIE1A: 64,
  OCIE1B: 32,
  compPortB: 56,
  compPinA: 1,
  // PB1
  compPinB: 4,
  // PB4
  dividers: {
    0: 0,
    1: 1,
    2: 2,
    3: 4,
    4: 8,
    5: 16,
    6: 32,
    7: 64,
    8: 128,
    9: 256,
    10: 512,
    11: 1024,
    12: 2048,
    13: 4096,
    14: 8192,
    15: 16384
  }
}, ATtinyTimer1 = class {
  constructor(cpu, config) {
    this.cpu = cpu, this.config = config, this.lastCycle = 0, this.tcnt = 0, this.tcntNext = 0, this.tcntUpdated = !1, this.ocrA = 0, this.ocrB = 0, this.ocrC = 0, this.divider = 0, this.updateDivider = !1, this.countingUp = !0, this.OVF = {
      address: this.config.ovfInterrupt,
      flagRegister: this.config.TIFR,
      flagMask: this.config.TOV1,
      enableRegister: this.config.TIMSK,
      enableMask: this.config.TOIE1
    }, this.OCFA = {
      address: this.config.compAInterrupt,
      flagRegister: this.config.TIFR,
      flagMask: this.config.OCF1A,
      enableRegister: this.config.TIMSK,
      enableMask: this.config.OCIE1A
    }, this.OCFB = {
      address: this.config.compBInterrupt,
      flagRegister: this.config.TIFR,
      flagMask: this.config.OCF1B,
      enableRegister: this.config.TIMSK,
      enableMask: this.config.OCIE1B
    }, this.count = (reschedule = !0) => {
      var _a;
      let { divider, lastCycle, cpu: cpu2 } = this, { cycles } = cpu2, delta = cycles - lastCycle;
      if (divider && delta >= divider) {
        let counterDelta = Math.floor(delta / divider);
        this.lastCycle += counterDelta * divider;
        let val = this.tcnt, top = this.TOP, phasePwm = (this.pwmA || this.pwmB) && !this.ctcMode, newVal = phasePwm ? this.phasePwmCount(val, counterDelta) : (val + counterDelta) % (top + 1), overflow = val + counterDelta > top;
        this.tcntUpdated || (this.tcnt = newVal, phasePwm || this.timerUpdated(newVal, val)), !phasePwm && overflow && cpu2.setInterruptFlag(this.OVF);
      }
      if (this.tcntUpdated && (this.tcnt = this.tcntNext, this.tcntUpdated = !1), this.updateDivider) {
        let cs = this.CS, newDivider = (_a = this.config.dividers[cs]) !== null && _a !== void 0 ? _a : 0;
        this.lastCycle = newDivider ? this.cpu.cycles : 0, this.updateDivider = !1, this.divider = newDivider, newDivider && cpu2.addClockEvent(this.count, this.lastCycle + newDivider - cpu2.cycles);
        return;
      }
      reschedule && divider && cpu2.addClockEvent(this.count, this.lastCycle + divider - cpu2.cycles);
    };
    let { TCCR1, GTCCR, TCNT1, OCR1A, OCR1B, OCR1C, TIFR, TIMSK } = config;
    cpu.readHooks[TCNT1] = () => (this.count(!1), cpu.data[TCNT1] = this.tcnt & 255), cpu.writeHooks[TCNT1] = (value) => {
      this.tcntNext = value, this.countingUp = !0, this.tcntUpdated = !0, cpu.updateClockEvent(this.count, 0), this.divider && this.timerUpdated(this.tcntNext, this.tcntNext);
    }, cpu.writeHooks[OCR1A] = (value) => {
      this.ocrA = value;
    }, cpu.writeHooks[OCR1B] = (value) => {
      this.ocrB = value;
    }, cpu.writeHooks[OCR1C] = (value) => {
      this.ocrC = value;
    }, cpu.writeHooks[TCCR1] = (value) => (cpu.data[TCCR1] = value, this.updateDivider = !0, cpu.clearClockEvent(this.count), cpu.addClockEvent(this.count, 0), this.updateCompConfig(), !0);
    let prevGtccrHook = cpu.writeHooks[GTCCR];
    cpu.writeHooks[GTCCR] = (value, oldValue, addr, mask) => (value & FOC1A && this.forceCompare("A"), value & FOC1B && this.forceCompare("B"), value & PSR1 && (this.lastCycle = this.cpu.cycles), value &= ~(FOC1A | FOC1B | PSR1), prevGtccrHook ? prevGtccrHook(value, oldValue, addr, mask) : cpu.data[GTCCR] = value, this.updateCompConfig(), !0);
    let prevTifrHook = cpu.writeHooks[TIFR];
    cpu.writeHooks[TIFR] = (value, oldValue, addr, mask) => (prevTifrHook ? prevTifrHook(value, oldValue, addr, mask) : cpu.data[TIFR] = value, cpu.clearInterruptByFlag(this.OVF, value), cpu.clearInterruptByFlag(this.OCFA, value), cpu.clearInterruptByFlag(this.OCFB, value), !0);
    let prevTimskHook = cpu.writeHooks[TIMSK];
    cpu.writeHooks[TIMSK] = (value, oldValue, addr, mask) => {
      prevTimskHook && prevTimskHook(value, oldValue, addr, mask), cpu.updateInterruptEnable(this.OVF, value), cpu.updateInterruptEnable(this.OCFA, value), cpu.updateInterruptEnable(this.OCFB, value);
    };
  }
  get tccr1() {
    return this.cpu.data[this.config.TCCR1];
  }
  get gtccr() {
    return this.cpu.data[this.config.GTCCR];
  }
  get CS() {
    return this.tccr1 & CS_MASK;
  }
  get ctcMode() {
    return !!(this.tccr1 & CTC1);
  }
  get pwmA() {
    return !!(this.tccr1 & PWM1A);
  }
  get pwmB() {
    return !!(this.gtccr & PWM1B_BIT);
  }
  get comA() {
    return this.tccr1 >> 4 & 3;
  }
  get comB() {
    return this.gtccr >> 4 & 3;
  }
  /** TOP = OCR1C in CTC/PWM modes, 0xFF in Normal mode */
  get TOP() {
    return this.ctcMode || this.pwmA || this.pwmB ? this.ocrC : 255;
  }
  phasePwmCount(value, delta) {
    let top = this.TOP;
    for (; delta > 0; )
      this.countingUp ? (value++, value >= top && (value = top, this.countingUp = !1)) : (value--, value <= 0 && (value = 0, this.countingUp = !0, this.cpu.setInterruptFlag(this.OVF))), this.tcntUpdated || (value === this.ocrA && (this.cpu.setInterruptFlag(this.OCFA), this.updateCompPinPwm("A")), value === this.ocrB && (this.cpu.setInterruptFlag(this.OCFB), this.updateCompPinPwm("B"))), delta--;
    return value & 255;
  }
  timerUpdated(value, prevValue) {
    let { ocrA, ocrB } = this, overflow = prevValue > value;
    ((prevValue < ocrA || overflow) && value >= ocrA || prevValue < ocrA && overflow) && (this.cpu.setInterruptFlag(this.OCFA), this.comA && !this.pwmA && this.updateCompPinNonPwm("A")), ((prevValue < ocrB || overflow) && value >= ocrB || prevValue < ocrB && overflow) && (this.cpu.setInterruptFlag(this.OCFB), this.comB && !this.pwmB && this.updateCompPinNonPwm("B"));
  }
  forceCompare(channel) {
    channel === "A" && !this.pwmA && this.comA ? this.updateCompPinNonPwm("A") : channel === "B" && !this.pwmB && this.comB && this.updateCompPinNonPwm("B");
  }
  updateCompPinNonPwm(channel) {
    var _a;
    let com = channel === "A" ? this.comA : this.comB, pin = channel === "A" ? this.config.compPinA : this.config.compPinB, mode;
    switch (com) {
      case 1:
        mode = PinOverrideMode.Toggle;
        break;
      case 2:
        mode = PinOverrideMode.Clear;
        break;
      case 3:
        mode = PinOverrideMode.Set;
        break;
      default:
        return;
    }
    (_a = this.cpu.gpioByPort[this.config.compPortB]) === null || _a === void 0 || _a.timerOverridePin(pin, mode);
  }
  updateCompPinPwm(channel) {
    var _a;
    let com = channel === "A" ? this.comA : this.comB, pin = channel === "A" ? this.config.compPinA : this.config.compPinB, invertingMode = com === 3, isSet = this.countingUp === invertingMode, mode;
    switch (com) {
      case 1:
        mode = PinOverrideMode.Toggle;
        break;
      case 2:
      case 3:
        mode = isSet ? PinOverrideMode.Set : PinOverrideMode.Clear;
        break;
      default:
        return;
    }
    (_a = this.cpu.gpioByPort[this.config.compPortB]) === null || _a === void 0 || _a.timerOverridePin(pin, mode);
  }
  updateCompConfig() {
    let port = this.cpu.gpioByPort[this.config.compPortB];
    port && (port.timerOverridePin(this.config.compPinA, this.comA ? PinOverrideMode.Enable : PinOverrideMode.None), port.timerOverridePin(this.config.compPinB, this.comB ? PinOverrideMode.Enable : PinOverrideMode.None));
  }
};

// package/dist/esm/peripherals/twi.js
var twiConfig = {
  twiInterrupt: 48,
  TWBR: 184,
  TWSR: 185,
  TWAR: 186,
  TWDR: 187,
  TWCR: 188,
  TWAMR: 189
}, NoopTWIEventHandler = class {
  constructor(twi) {
    this.twi = twi;
  }
  start() {
    this.twi.completeStart();
  }
  stop() {
    this.twi.completeStop();
  }
  connectToSlave() {
    this.twi.completeConnect(!1);
  }
  writeByte() {
    this.twi.completeWrite(!1);
  }
  readByte() {
    this.twi.completeRead(255);
  }
}, AVRTWI = class {
  constructor(cpu, config, freqHz) {
    this.cpu = cpu, this.config = config, this.freqHz = freqHz, this.eventHandler = new NoopTWIEventHandler(this), this.busy = !1, this.TWI = {
      address: this.config.twiInterrupt,
      flagRegister: this.config.TWCR,
      flagMask: 128,
      enableRegister: this.config.TWCR,
      enableMask: 1
    }, this.updateStatus(248), this.cpu.writeHooks[config.TWCR] = (value) => {
      this.cpu.data[config.TWCR] = value;
      let clearInt = value & 128;
      this.cpu.clearInterruptByFlag(this.TWI, value), this.cpu.updateInterruptEnable(this.TWI, value);
      let { status } = this;
      if (clearInt && value & 4 && !this.busy) {
        let twdrValue = this.cpu.data[this.config.TWDR];
        return this.cpu.addClockEvent(() => {
          if (value & 32)
            this.busy = !0, this.eventHandler.start(status !== 248);
          else if (value & 16)
            this.busy = !0, this.eventHandler.stop();
          else if (status === 8 || status === 16)
            this.busy = !0, this.eventHandler.connectToSlave(twdrValue >> 1, !(twdrValue & 1));
          else if (status === 24 || status === 40)
            this.busy = !0, this.eventHandler.writeByte(twdrValue);
          else if (status === 64 || status === 80) {
            this.busy = !0;
            let ack = !!(value & 64);
            this.eventHandler.readByte(ack);
          }
        }, 0), !0;
      }
    };
  }
  get prescaler() {
    switch (this.cpu.data[this.config.TWSR] & 3) {
      case 0:
        return 1;
      case 1:
        return 4;
      case 2:
        return 16;
      case 3:
        return 64;
    }
    throw new Error("Invalid prescaler value!");
  }
  get sclFrequency() {
    return this.freqHz / (16 + 2 * this.cpu.data[this.config.TWBR] * this.prescaler);
  }
  completeStart() {
    this.busy = !1, this.updateStatus(this.status === 248 ? 8 : 16);
  }
  completeStop() {
    this.busy = !1, this.cpu.data[this.config.TWCR] &= -17, this.updateStatus(248);
  }
  completeConnect(ack) {
    this.busy = !1, this.cpu.data[this.config.TWDR] & 1 ? this.updateStatus(ack ? 64 : 72) : this.updateStatus(ack ? 24 : 32);
  }
  completeWrite(ack) {
    this.busy = !1, this.updateStatus(ack ? 40 : 48);
  }
  completeRead(value) {
    this.busy = !1;
    let ack = !!(this.cpu.data[this.config.TWCR] & 64);
    this.cpu.data[this.config.TWDR] = value, this.updateStatus(ack ? 80 : 88);
  }
  get status() {
    return this.cpu.data[this.config.TWSR] & 248;
  }
  updateStatus(value) {
    let { TWSR } = this.config;
    this.cpu.data[TWSR] = this.cpu.data[TWSR] & -249 | value, this.cpu.setInterruptFlag(this.TWI);
  }
};

// package/dist/esm/peripherals/usart.js
var usart0Config = {
  rxCompleteInterrupt: 36,
  dataRegisterEmptyInterrupt: 38,
  txCompleteInterrupt: 40,
  UCSRA: 192,
  UCSRB: 193,
  UCSRC: 194,
  UBRRL: 196,
  UBRRH: 197,
  UDR: 198
}, UCSRA_RXC = 128, UCSRA_TXC = 64, UCSRA_UDRE = 32;
var UCSRA_U2X = 2, UCSRA_MPCM = 1, UCSRA_CFG_MASK = UCSRA_U2X, UCSRB_RXCIE = 128, UCSRB_TXCIE = 64, UCSRB_UDRIE = 32, UCSRB_RXEN = 16, UCSRB_TXEN = 8, UCSRB_UCSZ2 = 4;
var UCSRB_CFG_MASK = UCSRB_UCSZ2 | UCSRB_RXEN | UCSRB_TXEN;
var UCSRC_UPM1 = 32, UCSRC_UPM0 = 16, UCSRC_USBS = 8, UCSRC_UCSZ1 = 4, UCSRC_UCSZ0 = 2;
var rxMasks = {
  5: 31,
  6: 63,
  7: 127,
  8: 255,
  9: 255
}, AVRUSART = class {
  constructor(cpu, config, freqHz) {
    this.cpu = cpu, this.config = config, this.freqHz = freqHz, this.onByteTransmit = null, this.onLineTransmit = null, this.onRxComplete = null, this.onConfigurationChange = null, this.rxBusyValue = !1, this.rxByte = 0, this.lineBuffer = "", this.RXC = {
      address: this.config.rxCompleteInterrupt,
      flagRegister: this.config.UCSRA,
      flagMask: UCSRA_RXC,
      enableRegister: this.config.UCSRB,
      enableMask: UCSRB_RXCIE,
      constant: !0
    }, this.UDRE = {
      address: this.config.dataRegisterEmptyInterrupt,
      flagRegister: this.config.UCSRA,
      flagMask: UCSRA_UDRE,
      enableRegister: this.config.UCSRB,
      enableMask: UCSRB_UDRIE
    }, this.TXC = {
      address: this.config.txCompleteInterrupt,
      flagRegister: this.config.UCSRA,
      flagMask: UCSRA_TXC,
      enableRegister: this.config.UCSRB,
      enableMask: UCSRB_TXCIE
    }, this.reset(), this.cpu.writeHooks[config.UCSRA] = (value, oldValue) => {
      var _a;
      return cpu.data[config.UCSRA] = value & (UCSRA_MPCM | UCSRA_U2X), cpu.clearInterruptByFlag(this.TXC, value), (value & UCSRA_CFG_MASK) !== (oldValue & UCSRA_CFG_MASK) && ((_a = this.onConfigurationChange) === null || _a === void 0 || _a.call(this)), !0;
    }, this.cpu.writeHooks[config.UCSRB] = (value, oldValue) => {
      var _a;
      return cpu.updateInterruptEnable(this.RXC, value), cpu.updateInterruptEnable(this.UDRE, value), cpu.updateInterruptEnable(this.TXC, value), value & UCSRB_RXEN && oldValue & UCSRB_RXEN && cpu.clearInterrupt(this.RXC), value & UCSRB_TXEN && !(oldValue & UCSRB_TXEN) && cpu.setInterruptFlag(this.UDRE), cpu.data[config.UCSRB] = value, (value & UCSRB_CFG_MASK) !== (oldValue & UCSRB_CFG_MASK) && ((_a = this.onConfigurationChange) === null || _a === void 0 || _a.call(this)), !0;
    }, this.cpu.writeHooks[config.UCSRC] = (value) => {
      var _a;
      return cpu.data[config.UCSRC] = value, (_a = this.onConfigurationChange) === null || _a === void 0 || _a.call(this), !0;
    }, this.cpu.readHooks[config.UDR] = () => {
      var _a;
      let mask = (_a = rxMasks[this.bitsPerChar]) !== null && _a !== void 0 ? _a : 255, result = this.rxByte & mask;
      return this.rxByte = 0, this.cpu.clearInterrupt(this.RXC), result;
    }, this.cpu.writeHooks[config.UDR] = (value) => {
      if (this.onByteTransmit && this.onByteTransmit(value), this.onLineTransmit) {
        let ch = String.fromCharCode(value);
        ch === `
` ? (this.onLineTransmit(this.lineBuffer), this.lineBuffer = "") : this.lineBuffer += ch;
      }
      this.cpu.addClockEvent(() => {
        cpu.setInterruptFlag(this.UDRE), cpu.setInterruptFlag(this.TXC);
      }, this.cyclesPerChar), this.cpu.clearInterrupt(this.TXC), this.cpu.clearInterrupt(this.UDRE);
    }, this.cpu.writeHooks[config.UBRRH] = (value) => {
      var _a;
      return this.cpu.data[config.UBRRH] = value, (_a = this.onConfigurationChange) === null || _a === void 0 || _a.call(this), !0;
    }, this.cpu.writeHooks[config.UBRRL] = (value) => {
      var _a;
      return this.cpu.data[config.UBRRL] = value, (_a = this.onConfigurationChange) === null || _a === void 0 || _a.call(this), !0;
    };
  }
  reset() {
    this.cpu.data[this.config.UCSRA] = UCSRA_UDRE, this.cpu.data[this.config.UCSRB] = 0, this.cpu.data[this.config.UCSRC] = UCSRC_UCSZ1 | UCSRC_UCSZ0, this.rxBusyValue = !1, this.rxByte = 0, this.lineBuffer = "";
  }
  get rxBusy() {
    return this.rxBusyValue;
  }
  writeByte(value, immediate = !1) {
    var _a;
    let { cpu } = this;
    if (this.rxBusyValue || !this.rxEnable)
      return !1;
    if (immediate)
      this.rxByte = value, cpu.setInterruptFlag(this.RXC), (_a = this.onRxComplete) === null || _a === void 0 || _a.call(this);
    else
      return this.rxBusyValue = !0, cpu.addClockEvent(() => {
        this.rxBusyValue = !1, this.writeByte(value, !0);
      }, this.cyclesPerChar), !0;
  }
  get cyclesPerChar() {
    let symbolsPerChar = 1 + this.bitsPerChar + this.stopBits + (this.parityEnabled ? 1 : 0);
    return (this.UBRR + 1) * this.multiplier * symbolsPerChar;
  }
  get UBRR() {
    let { UBRRH, UBRRL } = this.config;
    return this.cpu.data[UBRRH] << 8 | this.cpu.data[UBRRL];
  }
  get multiplier() {
    return this.cpu.data[this.config.UCSRA] & UCSRA_U2X ? 8 : 16;
  }
  get rxEnable() {
    return !!(this.cpu.data[this.config.UCSRB] & UCSRB_RXEN);
  }
  get txEnable() {
    return !!(this.cpu.data[this.config.UCSRB] & UCSRB_TXEN);
  }
  get baudRate() {
    return Math.floor(this.freqHz / (this.multiplier * (1 + this.UBRR)));
  }
  get bitsPerChar() {
    switch ((this.cpu.data[this.config.UCSRC] & (UCSRC_UCSZ1 | UCSRC_UCSZ0)) >> 1 | this.cpu.data[this.config.UCSRB] & UCSRB_UCSZ2) {
      case 0:
        return 5;
      case 1:
        return 6;
      case 2:
        return 7;
      case 3:
        return 8;
      default:
      // 4..6 are reserved
      case 7:
        return 9;
    }
  }
  get stopBits() {
    return this.cpu.data[this.config.UCSRC] & UCSRC_USBS ? 2 : 1;
  }
  get parityEnabled() {
    return !!(this.cpu.data[this.config.UCSRC] & UCSRC_UPM1);
  }
  get parityOdd() {
    return !!(this.cpu.data[this.config.UCSRC] & UCSRC_UPM0);
  }
};

// package/dist/esm/peripherals/usi.js
var AVRUSI = class {
  constructor(cpu, port, portPin, dataPin, clockPin) {
    this.START = {
      address: 13,
      flagRegister: 46,
      flagMask: 128,
      enableRegister: 45,
      enableMask: 128
    }, this.OVF = {
      address: 14,
      flagRegister: 46,
      flagMask: 64,
      enableRegister: 45,
      enableMask: 64
    };
    let PIN = portPin, PORT = PIN + 2;
    port.addListener((value) => {
      (cpu.data[45] & 32) === 32 && (value & 1 << clockPin && !(value & 1 << dataPin) && cpu.setInterruptFlag(this.START), value & 1 << clockPin && value & 1 << dataPin && (cpu.data[46] |= 32));
    });
    let updateOutput = () => {
      let oldValue = cpu.data[PORT], newValue = cpu.data[47] & 128 ? oldValue | 1 << dataPin : oldValue & ~(1 << dataPin);
      cpu.writeHooks[PORT](newValue, oldValue, PORT, 255), newValue & 128 && !(cpu.data[PIN] & 128) ? cpu.data[46] |= 16 : cpu.data[46] &= -17;
    }, count = () => {
      let counter = cpu.data[46] + 1 & 15;
      cpu.data[46] = cpu.data[46] & -16 | counter, counter || (cpu.data[48] = cpu.data[47], cpu.setInterruptFlag(this.OVF));
    }, shift = (inputValue) => {
      cpu.data[47] = cpu.data[47] << 1 | inputValue, updateOutput();
    };
    cpu.writeHooks[47] = (value) => (cpu.data[47] = value, updateOutput(), !0), cpu.writeHooks[46] = (value) => (cpu.data[46] = cpu.data[46] & 224 & ~value | value & 15, cpu.clearInterruptByFlag(this.START, value), cpu.clearInterruptByFlag(this.OVF, value), !0), cpu.writeHooks[45] = (value) => {
      cpu.data[45] = value & -4, cpu.updateInterruptEnable(this.START, value), cpu.updateInterruptEnable(this.OVF, value);
      let clockSrc = value & 3, mode = value & 3, usiClk = value & 2;
      port.openCollector = mode >= 2 ? 1 << dataPin : 0;
      let inputValue = cpu.data[PIN] & 1 << dataPin ? 1 : 0;
      if (usiClk && !clockSrc && (shift(inputValue), count()), value & 1) {
        cpu.writeHooks[PIN](1 << clockPin, cpu.data[PIN], PIN, 255);
        let newValue = cpu.data[PIN] & 1 << clockPin;
        return usiClk && (clockSrc === 2 || clockSrc === 3) && (clockSrc === 2 && newValue && shift(inputValue), clockSrc === 3 && !newValue && shift(inputValue), count()), !0;
      }
    };
  }
};

// package/dist/esm/peripherals/watchdog.js
var watchdogConfig = {
  watchdogInterrupt: 12,
  MCUSR: 84,
  WDTCSR: 96
}, AVRWatchdog = class {
  constructor(cpu, config, clock) {
    this.cpu = cpu, this.config = config, this.clock = clock, this.clockFrequency = 128e3, this.changeEnabledCycles = 0, this.watchdogTimeout = 0, this.enabledValue = !1, this.scheduled = !1, this.Watchdog = {
      address: this.config.watchdogInterrupt,
      flagRegister: this.config.WDTCSR,
      flagMask: 128,
      enableRegister: this.config.WDTCSR,
      enableMask: 64
    }, this.checkWatchdog = () => {
      if (this.enabled && this.cpu.cycles >= this.watchdogTimeout) {
        let wdtcsr = this.cpu.data[this.config.WDTCSR];
        if (wdtcsr & 64 && this.cpu.setInterruptFlag(this.Watchdog), wdtcsr & 8)
          if (wdtcsr & 64)
            this.cpu.data[this.config.WDTCSR] &= -65;
          else {
            this.cpu.reset(), this.scheduled = !1, this.cpu.data[this.config.MCUSR] |= 8;
            return;
          }
        this.resetWatchdog();
      }
      this.enabled ? (this.scheduled = !0, this.cpu.addClockEvent(this.checkWatchdog, this.watchdogTimeout - this.cpu.cycles)) : this.scheduled = !1;
    };
    let { WDTCSR } = config;
    this.cpu.onWatchdogReset = () => {
      this.resetWatchdog();
    }, cpu.writeHooks[WDTCSR] = (value, oldValue) => (value & 16 && value & 8 ? (this.changeEnabledCycles = this.cpu.cycles + 4, value = value & -48) : (this.cpu.cycles >= this.changeEnabledCycles && (value = value & -48 | oldValue & 47), this.enabledValue = !!(value & 8 || value & 64), this.cpu.data[WDTCSR] = value), this.enabled && this.resetWatchdog(), this.enabled && !this.scheduled && this.cpu.addClockEvent(this.checkWatchdog, this.watchdogTimeout - this.cpu.cycles), this.cpu.clearInterruptByFlag(this.Watchdog, value), !0);
  }
  resetWatchdog() {
    let cycles = Math.floor(this.clock.frequency / this.clockFrequency * this.prescaler);
    this.watchdogTimeout = this.cpu.cycles + cycles;
  }
  get enabled() {
    return this.enabledValue;
  }
  /**
   * The base clock frequency is 128KHz. Thus, a prescaler of 2048 gives 16ms timeout.
   */
  get prescaler() {
    let wdtcsr = this.cpu.data[this.config.WDTCSR];
    return 2048 << ((wdtcsr & 32) >> 2 | wdtcsr & 7);
  }
};
export {
  ADCMuxInputType,
  ADCReference,
  ATtinyTimer1,
  AVRADC,
  AVRClock,
  AVREEPROM,
  AVRIOPort,
  AVRSPI,
  AVRTWI,
  AVRTimer,
  AVRUSART,
  AVRUSI,
  AVRWatchdog,
  CPU,
  EEPROMMemoryBackend,
  INT0,
  INT1,
  NoopTWIEventHandler,
  PCINT0,
  PCINT1,
  PCINT2,
  PinState,
  adcConfig,
  atmega328Channels,
  attinyTimer1Config,
  avrInstruction,
  avrInterrupt,
  clockConfig,
  eepromConfig,
  portAConfig,
  portBConfig,
  portCConfig,
  portDConfig,
  portEConfig,
  portFConfig,
  portGConfig,
  portHConfig,
  portJConfig,
  portKConfig,
  portLConfig,
  spiConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  twiConfig,
  usart0Config,
  watchdogConfig
};
