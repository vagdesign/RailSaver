// Synthesised clock sounds (Web Audio, no sample files):
//  - release: the minute impulse. The solenoid clacks, the minute hand jumps
//    and settles, and the case rings briefly. Plays when the second hand
//    unlocks at 12.
//  - latch: a soft tick when the second hand reaches 12 and stops.
// Events are scheduled on the audio clock ahead of time, so they land on the
// exact moment regardless of the frame rate.

export class ClockAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
    this.enabled = false;
    this.scheduled = new Set();   // wall-clock ms of events already queued
  }

  setOptions({ sound, volume }) {
    this.enabled = !!sound;
    this.volume = volume;
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? volume : 0, this.ctx.currentTime, 0.05);
    if (this.enabled) this.ensure();
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { this.ctx = new AC({ latencyHint: 'playback' }); } catch { return false; }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(ctx.destination);

    // Dry bus + a short, dark "station hall" reverb.
    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.dry.connect(this.master);
    this.verb = ctx.createConvolver();
    this.verb.buffer = hallImpulse(ctx, 1.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    this.verb.connect(wet).connect(this.master);
    this.bus = ctx.createGain();
    this.bus.connect(this.dry);
    this.bus.connect(this.verb);
    this.noise = noiseBuffer(ctx, 0.5);
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  }

  /** Try to start audio after a user gesture (browsers without autoplay). */
  unlock() { if (this.enabled) this.ensure(); }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  /**
   * Queue an event `inSeconds` from now (0 = immediately). `key` de-duplicates.
   */
  schedule(type, inSeconds, key) {
    if (!this.enabled || !this.ready) return;
    if (key !== undefined) {
      if (this.scheduled.has(key)) return;
      this.scheduled.add(key);
      if (this.scheduled.size > 16) this.scheduled.delete(this.scheduled.values().next().value);
    }
    const t = this.ctx.currentTime + Math.max(0, inSeconds);
    if (type === 'release') this.release(t);
    else if (type === 'latch') this.latch(t);
  }

  // ---- voices ----
  burst(t, { freq, q = 1, dur, gain, type = 'bandpass' }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.bus);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.05);
  }

  tone(t, { freq, to, dur, gain, type = 'sine', attack = 0.002 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  release(t) {
    // 1. Solenoid armature pulls in: sharp, bright clack.
    this.burst(t, { freq: 2400, q: 1.2, dur: 0.035, gain: 0.9 });
    this.burst(t, { freq: 5200, q: 0.8, dur: 0.012, gain: 0.35, type: 'highpass' });
    // 2. The case takes the knock: a short low thump.
    this.tone(t, { freq: 130, to: 62, dur: 0.12, gain: 0.55 });
    this.burst(t, { freq: 420, q: 2.5, dur: 0.07, gain: 0.35 });
    // 3. Steel case rings (inharmonic partials, quick decay).
    for (const [f, d, g] of [[1187, 0.42, 0.045], [2633, 0.26, 0.03], [4171, 0.16, 0.02], [6120, 0.09, 0.012]]) {
      this.tone(t + 0.002, { freq: f, dur: d, gain: g });
    }
    // 4. The minute hand lands and the pawl drops back ~40 ms later.
    this.burst(t + 0.042, { freq: 3300, q: 1.6, dur: 0.022, gain: 0.32 });
    this.tone(t + 0.042, { freq: 210, to: 120, dur: 0.06, gain: 0.18 });
    // 5. Armature release when the impulse ends (~0.35 s).
    this.burst(t + 0.36, { freq: 1900, q: 1.4, dur: 0.02, gain: 0.16 });
  }

  latch(t) {
    this.burst(t, { freq: 4200, q: 1.8, dur: 0.014, gain: 0.22 });
    this.tone(t, { freq: 1650, dur: 0.05, gain: 0.03 });
    this.burst(t + 0.05, { freq: 3800, q: 2, dur: 0.01, gain: 0.07 });
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx && this.enabled) this.ctx.resume().catch(() => {}); }
}

function noiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function hallImpulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      // Early reflections, then a smooth, darkening tail.
      const early = i < ctx.sampleRate * 0.03 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.8 : 0;
      lp += ((Math.random() * 2 - 1) - lp) * (0.35 - 0.3 * x);
      d[i] = (lp * Math.pow(1 - x, 3.2) + early) * 0.6;
    }
  }
  return buf;
}
