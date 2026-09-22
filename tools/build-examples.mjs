// Compiles all example projects with WinAVR avr-gcc, runs a headless
// simulation as a smoke test and writes js/examples-hex.js
// usage: node tools/build-examples.mjs [path-to-avr-gcc-bin] [example-id-filter]
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = process.argv[2] && existsSync(process.argv[2]) ? process.argv[2] : 'C:/WinAVR-20100110/bin';
const only = process.argv.find((a, i) => i >= 2 && !existsSync(a));
const imp = (p) => import(pathToFileURL(join(root, p)).href);
await imp('js/parts/index.js');
const { EXAMPLES, buildExample } = await imp('js/examples.js');
const { DEVICES } = await imp('js/mcu/devices.js');
const { Simulator } = await imp('js/sim/simulator.js');
const { parseSI } = await imp('js/sim/circuit.js');

// keep hex of examples that are not rebuilt (filter mode)
let out = {};
try { out = (await imp('js/examples-hex.js')).EXAMPLE_HEX; } catch { /* first run */ }

function compile(code, mcuPart) {
  const dev = DEVICES[mcuPart.props.device];
  const fcpu = Math.round(parseSI(String(mcuPart.props.clock).replace(/Hz$/i, ''), 16e6));
  const dir = mkdtempSync(join(tmpdir(), 'sms-'));
  writeFileSync(join(dir, 'main.c'), code);
  execFileSync(join(bin, 'avr-gcc'), [`-mmcu=${dev.gccMcu}`, `-DF_CPU=${fcpu}UL`, '-Os', '-Wall', '-std=gnu99', '-o', join(dir, 'main.elf'), join(dir, 'main.c')], { stdio: 'pipe' });
  execFileSync(join(bin, 'avr-objcopy'), ['-O', 'ihex', '-R', '.eeprom', join(dir, 'main.elf'), join(dir, 'main.hex')]);
  return readFileSync(join(dir, 'main.hex'), 'utf8');
}

/** Detect accidental shorts: two port pins of one MCU on the same net, or a port pin on a power rail */
function shortCheck(sim, doc) {
  const issues = [];
  for (const net of sim.netlist.nets) {
    const mcuPins = net.pins.filter((p) => p.part.type === 'mcu' && /^P[A-L]\d$/.test(p.pin.fn || ''));
    const byMcu = new Map();
    for (const p of mcuPins) byMcu.set(p.partId, [...(byMcu.get(p.partId) || []), p.pin.fn]);
    for (const [id, pins] of byMcu) {
      if (pins.length > 1) issues.push(`${doc.parts.find((q) => q.id === id).ref}: ${pins.join('+')} shorted`);
    }
    if (net.power && mcuPins.length) issues.push(`${mcuPins.map((p) => p.pin.fn).join(',')} tied to ${net.power.name}`);
  }
  return issues;
}

let failed = 0;
for (const ex of EXAMPLES) {
  if (only && !ex.id.includes(only)) continue;
  const doc = await buildExample(ex);
  const mcus = doc.parts.filter((p) => p.type === 'mcu');
  try {
    if (ex.files) {
      out[ex.id] = {};
      for (const f of ex.files) {
        const part = doc.parts.find((p) => p.id === doc.roles[f.role]);
        out[ex.id][f.role] = compile(f.code, part);
        part.fw = { name: f.name, hex: out[ex.id][f.role] };
      }
    } else {
      out[ex.id] = compile(ex.code, mcus[0]);
      mcus[0].fw = { name: 'main.hex', hex: out[ex.id] };
    }
  } catch (e) {
    console.error(`[${ex.id}] compile failed:\n${e.stderr?.toString() || e.message}`);
    failed++;
    continue;
  }
  // smoke test
  const logs = [];
  const sim = new Simulator(doc, { log: (m, k) => logs.push(`${k}: ${m}`) });
  const shorts = shortCheck(sim, doc);
  const serial = new Map();
  for (const inst of sim.instruments) {
    if (inst.kind === 'terminal') {
      serial.set(inst.part.ref, '');
      inst.listeners.add((it) => serial.set(inst.part.ref, serial.get(inst.part.ref) + String.fromCharCode(it.b)));
    }
  }
  const script = ex.script || [
    { t: 0.33, part: 'button', act: 'press', phase: 'down' }, { t: 0.42, part: 'button', act: 'press', phase: 'up' },
    { t: 0.33, part: 'keypad', act: 'k6', phase: 'down' }, { t: 0.42, part: 'keypad', act: 'k6', phase: 'up' },
    { t: 0.5, send: 'hi sim\r' },
  ];
  const dur = ex.simTime || 1;
  const t0 = Date.now();
  let si = 0;
  const steps = [...script].sort((a, b) => a.t - b.t);
  const fps = 60;
  for (let f = 1; f <= dur * fps; f++) {
    const t = f / fps;
    sim.runUntil(t, 1e9);
    sim.frame(1 / fps);
    while (si < steps.length && steps[si].t <= t) {
      const s = steps[si++];
      if (s.send) {
        for (const inst of sim.instruments) if (inst.kind === 'terminal' && (!s.ref || inst.part.ref === s.ref)) inst.send([...Buffer.from(s.send, 'utf8')]);
        continue;
      }
      if (s.adjust) { const p = doc.parts.find((q) => q.ref === s.adjust || q.type === s.adjust); p.props[s.key] = String(s.value); sim.solveAt(sim.time); continue; }
      const p = doc.parts.find((q) => (s.ref ? q.ref === s.ref : q.type === s.part));
      if (p) { sim.instances.get(p.id)?.action?.(s.act, s.phase, {}); sim.solveAt(sim.time); }
    }
  }
  const ms = Date.now() - t0;
  const extra = [];
  for (const [id, inst] of sim.instances) {
    const p = doc.parts.find((q) => q.id === id);
    if (inst.lcd) {
      const row = (r) => { let s = ''; for (let c = 0; c < 16; c++) { const ch = inst.lcd.charAt(r, c); s += String.fromCharCode(ch < 32 ? 0x2a : ch); } return s; };
      extra.push(`${p.ref} LCD="${row(0)}|${row(1)}"`);
    }
    if (inst.el?.bright !== undefined && inst.el.bright > 0.05) extra.push(`${p.ref} on`);
    if (inst.leds) extra.push(`${p.ref} lit=${inst.leds.filter((l) => l.bright > 0.05).length}/${inst.leds.length}`);
    if (p.type === 'servo') extra.push(`${p.ref} ${inst.angle.toFixed(0)}deg`);
    if (inst.rpm !== undefined) extra.push(`${p.ref} ${inst.rpm.toFixed(0)}rpm`);
    if (p.type === 'relay') extra.push(`${p.ref} ${inst.on ? 'ON' : 'off'}`);
    if (p.type === 'buzzer') extra.push(`${p.ref} ${inst.sounding ? 'beep' : 'quiet'}`);
    if (inst.st?.latch !== undefined) extra.push(`${p.ref} latch=${inst.st.latch}`);
  }
  for (const [ref, txt] of serial) if (txt) extra.push(`${ref}=${JSON.stringify(txt.slice(-160))}`);
  const warn = [...shorts.map((s) => `SHORT ${s}`), ...logs.filter((l) => /warn|error/.test(l))];
  if (warn.length) failed++;
  console.log(`[${ex.id}] sim ${dur}s in ${ms}ms, solves=${sim.circuit.solveCount} ${extra.join(' ')}${warn.length ? `\n   !! ${warn.slice(0, 4).join('; ')}` : ''}`);
}
writeFileSync(join(root, 'js/examples-hex.js'), `// Generated by tools/build-examples.mjs (WinAVR avr-gcc) — do not edit\nexport const EXAMPLE_HEX = ${JSON.stringify(out, null, 0)};\n`);
if (failed) { console.log(`${failed} example(s) with problems`); process.exitCode = 1; }
