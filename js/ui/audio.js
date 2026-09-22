// Simple WebAudio tone engine for buzzers
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.voices = new Map();
    this.enabled = true;
    try { this.enabled = localStorage.getItem('sms.sound') !== 'off'; } catch { /* ignore */ }
  }
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  set(id, freq, vol) {
    if (!this.enabled || !freq || !vol) { this._stop(id); return; }
    const ctx = this.ensure();
    if (!ctx) return;
    let v = this.voices.get(id);
    if (!v) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      v = { osc, gain };
      this.voices.set(id, v);
    }
    v.osc.frequency.setTargetAtTime(Math.min(15000, Math.max(20, freq)), ctx.currentTime, 0.01);
    v.gain.gain.setTargetAtTime(vol * 0.5, ctx.currentTime, 0.01);
  }
  _stop(id) {
    const v = this.voices.get(id);
    if (!v) return;
    try { v.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01); v.osc.stop(this.ctx.currentTime + 0.1); } catch { /* ignore */ }
    this.voices.delete(id);
  }
  stopAll() { for (const id of [...this.voices.keys()]) this._stop(id); }
  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('sms.sound', this.enabled ? 'on' : 'off'); } catch { /* ignore */ }
    if (!this.enabled) this.stopAll();
    return this.enabled;
  }
}
