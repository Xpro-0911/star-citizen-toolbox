// 原创配乐：全部由 Web Audio 实时合成（弦乐、钢琴、圆号、合唱、钟琴、甘美兰、定音鼓、风声）。
// D 小调起，结尾转 D 大调；只有渐强与呼吸，没有硬卡点。
(function (root) {
  const { BEAT, BAR, DURATION } = root.TL;

  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function m(n) {
    if (typeof n === 'number') return n;
    const r = /^([A-G])([b#]?)(-?\d)$/.exec(n);
    return PC[r[1]] + (r[2] === '#' ? 1 : r[2] === 'b' ? -1 : 0) + (parseInt(r[3], 10) + 1) * 12;
  }
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const b = (bar, beat = 0) => bar * BAR + beat * BEAT;

  class Orchestra {
    constructor(ctx) {
      this.ctx = ctx;
      this.rand = rng(7);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 14; comp.ratio.value = 2.4;
      comp.attack.value = 0.04; comp.release.value = 0.5;
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(comp); comp.connect(ctx.destination);

      this.verb = ctx.createConvolver();
      this.verb.buffer = this.makeIR(5.2);
      this.verbIn = ctx.createGain();
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160;
      this.verbIn.connect(hp); hp.connect(this.verb);
      const verbOut = ctx.createGain(); verbOut.gain.value = 0.9;
      this.verb.connect(verbOut); verbOut.connect(this.master);

      this.noise = this.makeNoise(6);
      this.buses = {};
    }

    makeIR(sec) {
      const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sec * sr);
      const buf = ctx.createBuffer(2, len, sr);
      const r = rng(99);
      const pre = Math.floor(0.03 * sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let y = 0;
        for (let i = pre; i < len; i++) {
          const t = (i - pre) / sr;
          const x = (r() * 2 - 1) * Math.exp(-t / 1.35);
          const a = 0.7 * Math.exp(-t / 1.5) + 0.06; // 越往后越暗
          y += a * (x - y);
          d[i] = y;
        }
        for (let k = 0; k < 10; k++) {
          const idx = pre + Math.floor((0.008 + r() * 0.08) * sr);
          d[idx] += (0.15 + r() * 0.35) * (r() < 0.5 ? -1 : 1);
        }
      }
      return buf;
    }

    makeNoise(sec) {
      const ctx = this.ctx, len = Math.floor(sec * ctx.sampleRate);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      const r = rng(1234);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
      }
      return buf;
    }

    bus(name, { gain = 1, send = 0.4, pan = 0, lp = null } = {}) {
      if (this.buses[name]) return this.buses[name];
      const ctx = this.ctx;
      const g = ctx.createGain(); g.gain.value = gain;
      let out = g;
      if (lp) {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.5;
        g.connect(f); out = f;
      }
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      out.connect(p); p.connect(this.master);
      const s = ctx.createGain(); s.gain.value = send;
      p.connect(s); s.connect(this.verbIn);
      this.buses[name] = g;
      return g;
    }

    noiseSrc(t0, t1, seedOffset = 0) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      src.start(t0, (seedOffset * 1.37) % 5);
      src.stop(t1);
      return src;
    }

    // ---- 弦乐（锯齿波合奏 + 颤音 + 低通） ----
    strings(t, midi, dur, vel, o = {}) {
      const ctx = this.ctx, f = hz(m(midi));
      const att = o.att ?? 0.9, rel = o.rel ?? 1.6;
      const bus = this.bus(o.bus || 'strings', o.busOpt || { send: 0.5, pan: o.pan ?? 0 });
      const env = ctx.createGain();
      const peak = vel * (o.amp ?? 0.05);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + att);
      if (o.swell) env.gain.linearRampToValueAtTime(peak * o.swell, t + dur);
      else env.gain.setValueAtTime(peak, t + dur);
      env.gain.setTargetAtTime(0, t + dur, rel / 3);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.4;
      const cut = (o.cut ?? 600 + vel * 2600) * (o.bright ?? 1);
      lp.frequency.setValueAtTime(cut * 0.55, t);
      lp.frequency.linearRampToValueAtTime(cut, t + att);
      if (o.swell) lp.frequency.linearRampToValueAtTime(cut * Math.min(1.8, o.swell), t + dur);
      lp.connect(env); env.connect(bus);
      const stop = t + dur + rel * 2.4;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 4.4 + this.rand() * 1.4;
      const lg = ctx.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(o.vib ?? 7, t + Math.min(1.2, att + 0.3));
      lfo.connect(lg);
      for (const d of o.voices || [-10, 0, 9]) {
        const osc = ctx.createOscillator(); osc.type = 'sawtooth';
        osc.frequency.value = f; osc.detune.value = d + (this.rand() - 0.5) * 4;
        lg.connect(osc.detune); osc.connect(lp);
        osc.start(t); osc.stop(stop);
      }
      lfo.start(t); lfo.stop(stop);
    }

    // ---- 低音弦乐断奏（推动感，不做重音） ----
    lowStr(t, midi, dur, vel, o = {}) {
      const ctx = this.ctx, f = hz(m(midi));
      const bus = this.bus('low', { send: 0.28 });
      const env = ctx.createGain(); const peak = vel * (o.amp ?? 0.08);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + 0.035);
      env.gain.setTargetAtTime(peak * 0.7, t + 0.04, 0.15);
      env.gain.setTargetAtTime(0, t + dur, 0.07);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380 + vel * 800; lp.Q.value = 0.6;
      lp.connect(env); env.connect(bus);
      for (const d of [-7, 6]) {
        const osc = ctx.createOscillator(); osc.type = 'sawtooth';
        osc.frequency.value = f; osc.detune.value = d;
        osc.connect(lp); osc.start(t); osc.stop(t + dur + 0.6);
      }
    }

    // ---- 钢琴（加法合成，带非谐性） ----
    piano(t, midi, dur, vel, o = {}) {
      const ctx = this.ctx, mm = m(midi), f0 = hz(mm);
      const bus = this.bus('piano', { send: 0.42, lp: 5200, pan: o.pan ?? 0 });
      const B = 0.0004;
      const tau = Math.max(0.9, 7.5 * Math.pow(0.5, (mm - 50) / 15));
      const amps = [1, 0.5, 0.3, 0.17, 0.1, 0.06, 0.035];
      const out = ctx.createGain();
      const lvl = vel * (o.amp ?? 0.14);
      out.gain.setValueAtTime(lvl, t);
      const off = t + dur;
      const damp = o.damp ?? 0.4;
      out.gain.setValueAtTime(lvl, off);
      out.gain.setTargetAtTime(0, off, damp);
      out.connect(bus);
      const stop = off + damp * 6;
      amps.forEach((a, i) => {
        const n = i + 1;
        const fr = f0 * n * Math.sqrt(1 + B * n * n);
        if (fr > 14000) return;
        const A = a * Math.pow(0.3 + 0.7 * vel, i * 0.55);
        const osc = ctx.createOscillator(); osc.frequency.value = fr;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(A, t + 0.005);
        g.gain.setTargetAtTime(A * 0.45, t + 0.006, 0.18 / n);
        g.gain.setTargetAtTime(0, t + 0.3, tau / (1 + 0.6 * i));
        osc.connect(g); g.connect(out);
        osc.start(t); osc.stop(stop);
      });
    }

    // ---- 圆号 ----
    horn(t, midi, dur, vel, o = {}) {
      const ctx = this.ctx, f = hz(m(midi));
      const bus = this.bus('horn', { send: 0.6, pan: -0.15 });
      const att = o.att ?? 0.35;
      const env = ctx.createGain(); const peak = vel * (o.amp ?? 0.06);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + att);
      env.gain.setValueAtTime(peak, t + dur);
      env.gain.setTargetAtTime(0, t + dur, 0.25);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.1;
      lp.frequency.setValueAtTime(260, t);
      lp.frequency.linearRampToValueAtTime(450 + vel * 1300, t + att + 0.1);
      lp.connect(env); env.connect(bus);
      for (const d of [-5, 5]) {
        const osc = ctx.createOscillator(); osc.type = 'sawtooth';
        osc.frequency.value = f; osc.detune.value = d;
        osc.connect(lp); osc.start(t); osc.stop(t + dur + 1.5);
      }
    }

    // ---- 合唱（共振峰滤波） ----
    choir(t, midi, dur, vel, o = {}) {
      const ctx = this.ctx, f = hz(m(midi));
      const bus = this.bus('choir', { send: 0.75 });
      const vowel = o.vowel === 'oo'
        ? [[330, 1, 7], [820, 0.32, 9], [2300, 0.07, 12]]
        : [[720, 1, 8], [1150, 0.55, 10], [2650, 0.2, 13]];
      const att = o.att ?? 1.4;
      const env = ctx.createGain(); const peak = vel * (o.amp ?? 0.22);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + att);
      env.gain.setValueAtTime(peak, t + dur);
      env.gain.setTargetAtTime(0, t + dur, 0.6);
      env.connect(bus);
      const src = ctx.createGain(); src.gain.value = 1;
      for (const [fq, g, q] of vowel) {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = q;
        const gg = ctx.createGain(); gg.gain.value = g;
        src.connect(bp); bp.connect(gg); gg.connect(env);
      }
      const stop = t + dur + 3;
      [-13, 0, 11].forEach((d, i) => {
        const osc = ctx.createOscillator(); osc.type = 'sawtooth';
        osc.frequency.value = f; osc.detune.value = d;
        const lfo = ctx.createOscillator(); lfo.frequency.value = 4.8 + i * 0.37;
        const lg = ctx.createGain(); lg.gain.value = 14;
        lfo.connect(lg); lg.connect(osc.detune);
        osc.connect(src); osc.start(t); osc.stop(stop); lfo.start(t); lfo.stop(stop);
      });
    }

    // ---- 钟琴 / 钢片琴（FM） ----
    bell(t, midi, vel, o = {}) {
      const ctx = this.ctx, f = hz(m(midi));
      const bus = this.bus('bell', { send: 0.65, pan: o.pan ?? 0.2 });
      const ratio = o.ratio ?? 3.5, index = o.index ?? 1.6, decay = o.decay ?? 1.4;
      const car = ctx.createOscillator(); car.frequency.value = f;
      const mod = ctx.createOscillator(); mod.frequency.value = f * ratio;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(index * f * ratio, t);
      mg.gain.setTargetAtTime(0, t, decay * 0.25);
      mod.connect(mg); mg.connect(car.frequency);
      const env = ctx.createGain(); const peak = vel * (o.amp ?? 0.06);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + 0.003);
      env.gain.setTargetAtTime(0, t + 0.004, decay / 3);
      car.connect(env); env.connect(bus);
      const stop = t + decay * 3;
      car.start(t); mod.start(t); car.stop(stop); mod.stop(stop);
    }

    // ---- 甘美兰金属琴（非谐分音 + 双音 ombak 拍频） ----
    gamelan(t, midi, vel) {
      const ctx = this.ctx, f = hz(m(midi));
      const bus = this.bus('gamelan', { send: 0.55, pan: 0.25 });
      const parts = [[1, 1, 2.4], [2.76, 0.35, 0.9], [5.4, 0.14, 0.4], [8.93, 0.06, 0.22]];
      const out = ctx.createGain(); out.gain.value = vel * 0.05; out.connect(bus);
      for (const det of [0, 3.2]) {
        for (const [r, a, tau] of parts) {
          const osc = ctx.createOscillator(); osc.frequency.value = f * r + det * r;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(a * (det ? 0.7 : 1), t + 0.004);
          g.gain.setTargetAtTime(0, t + 0.005, tau);
          osc.connect(g); g.connect(out);
          osc.start(t); osc.stop(t + tau * 7);
        }
      }
    }

    // ---- 软槌定音鼓 ----
    timp(t, midi, vel) {
      const ctx = this.ctx, f = hz(m(midi));
      const bus = this.bus('timp', { send: 0.35 });
      const out = ctx.createGain(); out.gain.value = vel * 0.2; out.connect(bus);
      const o1 = ctx.createOscillator(); o1.frequency.setValueAtTime(f * 1.025, t);
      o1.frequency.exponentialRampToValueAtTime(f, t + 0.15);
      const g1 = ctx.createGain();
      g1.gain.setValueAtTime(0, t); g1.gain.linearRampToValueAtTime(1, t + 0.012);
      g1.gain.setTargetAtTime(0, t + 0.013, 0.5);
      o1.connect(g1); g1.connect(out);
      const o2 = ctx.createOscillator(); o2.frequency.value = f * 1.5;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.3, t + 0.012);
      g2.gain.setTargetAtTime(0, t + 0.013, 0.25);
      o2.connect(g2); g2.connect(out);
      const n = this.noiseSrc(t, t + 0.4, t);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.4, t + 0.01);
      gn.gain.setTargetAtTime(0, t + 0.011, 0.04);
      n.connect(lp); lp.connect(gn); gn.connect(out);
      o1.start(t); o2.start(t); o1.stop(t + 3.5); o2.stop(t + 2);
    }

    timpRoll(t0, t1, midi, v0, v1) {
      let t = t0;
      while (t < t1) {
        const k = (t - t0) / (t1 - t0);
        this.timp(t, midi, (v0 + (v1 - v0) * k * k) * (0.8 + 0.2 * this.rand()));
        t += 0.065 + this.rand() * 0.02;
      }
    }

    // ---- 镲片渐强（只有 swell，没有 crash） ----
    cymSwell(t0, dur, v) {
      const ctx = this.ctx;
      const bus = this.bus('cym', { send: 0.6 });
      const src = this.noiseSrc(t0, t0 + dur + 4, t0);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800;
      const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 7000; pk.gain.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(v * 0.03, t0 + dur);
      g.gain.setTargetAtTime(0, t0 + dur, 0.7);
      src.connect(hp); hp.connect(pk); pk.connect(g); g.connect(bus);
    }

    // ---- 风声（噪声 + 缓慢扫频） ----
    wind(t0, dur, v, seed = 1) {
      const ctx = this.ctx;
      const r = rng(seed);
      [-0.6, 0.6].forEach((pan, i) => {
        const src = this.noiseSrc(t0, t0 + dur + 0.1, seed + i);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
        const N = Math.ceil(dur / 1.5) + 2;
        const fc = new Float32Array(N), ac = new Float32Array(N);
        for (let k = 0; k < N; k++) { fc[k] = 280 + r() * 1100; ac[k] = 0.4 + r() * 0.6; }
        bp.frequency.setValueCurveAtTime(fc, t0, dur);
        const g = ctx.createGain();
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t0);
        env.gain.linearRampToValueAtTime(v * 0.09, t0 + Math.min(4, dur / 3));
        env.gain.setValueAtTime(v * 0.09, t0 + dur - Math.min(4, dur / 3));
        env.gain.linearRampToValueAtTime(0, t0 + dur);
        g.gain.setValueCurveAtTime(ac, t0, dur);
        const p = ctx.createStereoPanner(); p.pan.value = pan;
        src.connect(bp); bp.connect(g); g.connect(env); env.connect(p);
        p.connect(this.bus('wind', { send: 0.3 }));
      });
    }

    // ---- 持续低音 ----
    drone(t0, dur, midi, v, fade = 4) {
      const ctx = this.ctx, f = hz(m(midi));
      const bus = this.bus('drone', { send: 0.3 });
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(v * 0.028, t0 + fade);
      env.gain.setValueAtTime(v * 0.028, t0 + dur - fade);
      env.gain.linearRampToValueAtTime(0, t0 + dur);
      env.connect(bus);
      [[1, 1], [2, 0.35], [3, 0.06]].forEach(([r, a]) => {
        const osc = ctx.createOscillator(); osc.frequency.value = f * r;
        osc.detune.value = (this.rand() - 0.5) * 6;
        const g = ctx.createGain(); g.gain.value = a;
        osc.connect(g); g.connect(env); osc.start(t0); osc.stop(t0 + dur + 0.1);
      });
    }
  }

  // ---------------- 和声与旋律素材 ----------------
  const CH = {
    Dm:   { u: ['D4', 'F4', 'A4'],  mid: ['A3', 'D3'],  b: 'D2' },
    DmC:  { u: ['D4', 'F4', 'A4'],  mid: ['A3', 'F3'],  b: 'C2' },
    C:    { u: ['C4', 'E4', 'G4'],  mid: ['G3', 'C3'],  b: 'C2' },
    Bb:   { u: ['D4', 'F4', 'Bb4'], mid: ['F3', 'Bb2'], b: 'Bb1' },
    F:    { u: ['C4', 'F4', 'A4'],  mid: ['A3', 'F3'],  b: 'F2' },
    Gm:   { u: ['D4', 'G4', 'Bb4'], mid: ['G3', 'D3'],  b: 'G1' },
    A:    { u: ['C#4', 'E4', 'A4'], mid: ['E3', 'A2'],  b: 'A1' },
    Asus: { u: ['D4', 'E4', 'A4'],  mid: ['E3', 'A2'],  b: 'A1' },
    Csus: { u: ['C4', 'F4', 'G4'],  mid: ['G3', 'C3'],  b: 'C2' },
    D:    { u: ['D4', 'F#4', 'A4'], mid: ['A3', 'D3'],  b: 'D2' },
    Bm:   { u: ['D4', 'F#4', 'B4'], mid: ['F#3', 'B2'], b: 'B1' },
    G:    { u: ['D4', 'G4', 'B4'],  mid: ['G3', 'D3'],  b: 'G1' },
    Dadd9:{ u: ['E4', 'F#4', 'A4'], mid: ['A3', 'D3'],  b: 'D2' },
  };

  // 主题：四个音 A-D-E-F 的上行，是全片的“母题”
  const TA   = [[0, 'A4', 1], [1, 'D5', 1], [2, 'E5', 1], [3, 'F5', 3], [6, 'E5', 1], [7, 'C5', 1], [8, 'D5', 4], [12, 'A4', 1], [13, 'C5', 1], [14, 'D5', 2]];
  const TB   = [[0, 'A4', 1], [1, 'D5', 1], [2, 'E5', 1], [3, 'A5', 3], [6, 'G5', 1], [7, 'F5', 1], [8, 'E5', 3], [11, 'C5', 1], [12, 'D5', 4]];
  const TA_M = [[0, 'A4', 1], [1, 'D5', 1], [2, 'E5', 1], [3, 'F#5', 3], [6, 'E5', 1], [7, 'C#5', 1], [8, 'D5', 4], [12, 'A4', 1], [13, 'B4', 1], [14, 'D5', 2]];
  const TB_M = [[0, 'A4', 1], [1, 'D5', 1], [2, 'E5', 1], [3, 'A5', 3], [6, 'B5', 1], [7, 'A5', 1], [8, 'F#5', 3], [11, 'E5', 1], [12, 'D5', 8]];
  const T_HOME = [[0, 'C5', 1], [1, 'F5', 1], [2, 'G5', 1], [3, 'A5', 3], [6, 'G5', 1], [7, 'E5', 1], [8, 'F5', 4], [12, 'C5', 1], [13, 'D5', 1], [14, 'F5', 2], [16, 'E5', 2], [18, 'G5', 2]];

  function score(o) {
    const R = rng(42);
    const hum = () => (R() - 0.5) * 0.018;

    function pad(bar, name, bars, vel, opt = {}) {
      const c = CH[name], t = b(bar) + (opt.beat || 0) * BEAT;
      const dur = bars * BAR + (opt.overlap ?? 0.3);
      const base = { att: opt.att ?? 1.1, rel: opt.rel ?? 1.8, swell: opt.swell };
      if (!opt.noUpper) c.u.forEach((n, i) => o.strings(t, m(n) + (opt.up || 0), dur, vel, { ...base, amp: 0.04, bright: opt.bright ?? 1, pan: (i - 1) * 0.35 }));
      if (!opt.noMid) c.mid.forEach((n) => o.strings(t, n, dur, vel * 0.85, { ...base, amp: 0.042, cut: 450 + vel * 1300, bus: 'celli', busOpt: { send: 0.45, pan: 0.2 } }));
      if (!opt.noBass) o.strings(t, c.b, dur, vel * 0.9, { ...base, att: (opt.att ?? 1.1) * 1.2, amp: 0.055, cut: 260 + vel * 420, voices: [-6, 5], bus: 'basses', busOpt: { send: 0.3, pan: 0 } });
    }
    function choirChord(bar, name, bars, vel, vowel = 'ah', up = 0) {
      const c = CH[name];
      c.u.forEach((n) => o.choir(b(bar), m(n) + up, bars * BAR + 0.3, vel, { vowel }));
      o.choir(b(bar), m(c.mid[0]), bars * BAR + 0.3, vel * 0.8, { vowel });
    }
    function arp(bar, name, vel, opt = {}) {
      const c = CH[name];
      const up = opt.up || 0;
      const seq = [m(c.mid[1]), m(c.mid[0]), m(c.u[0]), m(c.u[1]), m(c.u[2]), m(c.u[1]), m(c.u[0]), m(c.mid[0])];
      const n = opt.half ? 4 : 8;
      for (let i = 0; i < n; i++) {
        const acc = i === 0 ? 1.15 : i === 4 ? 1.05 : 0.9;
        o.piano(b(bar, i * 0.5) + hum(), seq[i] + up, BEAT * 1.6, vel * acc, { pan: -0.2 });
      }
    }
    function mel(instr, bar, notes, vel, opt = {}) {
      const tr = opt.tr || 0;
      for (const [beat, n, dur, v] of notes) {
        if (opt.until != null && beat >= opt.until) continue;
        const t = b(bar, beat) + hum();
        const d = dur * BEAT * (opt.legato ?? 1.02);
        const vv = vel * (v ?? 1);
        if (instr === 'piano') o.piano(t, m(n) + tr, d, vv, opt);
        else if (instr === 'horn') o.horn(t, m(n) + tr, d, vv, opt);
        else if (instr === 'violin') o.strings(t, m(n) + tr, d, vv, { att: opt.att ?? 0.22, rel: 0.9, amp: opt.amp ?? 0.05, voices: [-6, 5], cut: 1800 + vv * 2600, bus: 'violins', busOpt: { send: 0.55, pan: 0.15 }, vib: 11 });
        else if (instr === 'cello') o.strings(t, m(n) + tr, d, vv, { att: opt.att ?? 0.3, rel: 1.2, amp: opt.amp ?? 0.07, voices: [-4, 4], cut: 900 + vv * 1400, bus: 'cellosolo', busOpt: { send: 0.5, pan: -0.1 }, vib: 14 });
        else if (instr === 'choir') o.choir(t, m(n) + tr, d, vv, { att: 0.4 });
      }
    }
    function ost(bar, bars, notes, vel, opt = {}) {
      // 低音弦乐八分音符：强弱 3+3+2，但幅度很小
      const acc = [1, 0.8, 0.8, 0.95, 0.8, 0.8, 0.92, 0.82];
      for (let k = 0; k < bars; k++) {
        const nn = notes[k % notes.length];
        const step = opt.quarter ? 1 : 0.5;
        for (let i = 0; i < 4 / step; i++) {
          const v = vel * acc[(i * (opt.quarter ? 2 : 1)) % 8] * (opt.cresc ? 1 + (k + i * step / 4) / bars * opt.cresc : 1);
          o.lowStr(b(bar + k, i * step), m(nn) + ((i % 2 === 1 && !opt.quarter) ? 12 : 0), BEAT * step * 0.85, v);
        }
      }
    }

    // ===== 序章 · 片名 (0–6) =====
    o.drone(0, b(12), 'D2', 1.0, 6);
    o.drone(b(1), b(10) - b(1), 'A2', 0.5, 6);
    pad(1, 'Dm', 2, 0.28, { att: 3.5, noBass: true });
    pad(3, 'Bb', 1, 0.3, { att: 1.5, noBass: true });
    pad(4, 'Dm', 2, 0.3, { att: 1.5, noBass: true });
    choirChord(3, 'Dm', 3, 0.35, 'oo');
    mel('piano', 2, [[0, 'A4', 1], [1, 'D5', 1], [2, 'E5', 1], [3, 'F5', 4]], 0.42);
    mel('piano', 4, [[0, 'A4', 1], [1, 'D5', 1], [2, 'E5', 1], [3, 'C5', 1], [4, 'D5', 4]], 0.36);
    [['D6', 3, 0], ['A6', 3, 1.5], ['E6', 3, 2.5], ['F6', 4, 0.5], ['A5', 4, 2]].forEach(([n, bar, beat]) => o.bell(b(bar, beat), n, 0.5, { ratio: 2, index: 0.8, decay: 2.2, amp: 0.05 }));

    // ===== 2014 上海 · 起步 (6–12) =====
    [['Dm', 6], ['Bb', 7], ['Dm', 8], ['C', 9], ['Bb', 10], ['F', 11]].forEach(([c, bar]) => arp(bar, c, 0.26, { up: 12 }));
    mel('piano', 8, TA, 0.46, { tr: 12 });
    mel('cello', 6, [[0, 'D3', 8], [8, 'D3', 4], [12, 'C3', 4], [16, 'Bb2', 4], [20, 'F2', 4]], 0.4, { att: 1.2 });

    // ===== 2015 魔法英雄 (12–17) =====
    pad(12, 'Bb', 1, 0.38); pad(13, 'F', 1, 0.42); pad(14, 'C', 1, 0.46); pad(15, 'Dm', 1, 0.5); pad(16, 'C', 1, 0.52, { swell: 1.3 });
    [['Bb', 12], ['F', 13], ['C', 14], ['Dm', 15], ['C', 16]].forEach(([c, bar]) => arp(bar, c, 0.24, { up: 12 }));
    mel('violin', 12, [[0, 'D5', 2], [2, 'F5', 2], [4, 'C5', 4], [8, 'E5', 2], [10, 'G5', 2], [12, 'F5', 2], [14, 'A5', 2], [16, 'G5', 4]], 0.55);
    for (let i = 0; i < 20; i++) {
      const pool = ['D6', 'F6', 'A6', 'C7', 'G6', 'E6'];
      o.bell(b(12, i) + BEAT * 0.5 * (i % 2), pool[Math.floor(R() * pool.length)], 0.25 + R() * 0.2, { ratio: 2, index: 0.7, decay: 1.6, amp: 0.045 });
    }
    o.timpRoll(b(16, 2), b(17), 'D2', 0.05, 0.28);

    // ===== 2016 无尽对决 (17–23) =====
    ost(17, 6, ['D2', 'D2', 'Bb1', 'F2', 'G1', 'A1'], 0.42, { cresc: 0.4 });
    pad(17, 'Dm', 1, 0.5); pad(18, 'C', 1, 0.52); pad(19, 'Bb', 1, 0.55); pad(20, 'F', 1, 0.58);
    pad(21, 'Gm', 1, 0.6); pad(22, 'A', 1, 0.62, { swell: 1.2 });
    mel('horn', 17, TA, 0.7);
    mel('violin', 17, TA, 0.32, { tr: 12, amp: 0.035 });
    choirChord(21, 'Gm', 1, 0.45); choirChord(22, 'A', 1, 0.5);
    o.horn(b(21), 'D4', BAR, 0.55); o.horn(b(21), 'Bb3', BAR, 0.5);
    o.horn(b(22), 'E4', BAR, 0.6); o.horn(b(22), 'C#4', BAR, 0.55);
    o.timpRoll(b(22), b(23), 'A1', 0.08, 0.38);

    // ===== 2017 强敌压境 (23–30) =====
    o.wind(b(23) - 1, b(30) - b(23) + 1.5, 1.0, 11);
    ost(23, 7, ['D2', 'C2', 'Bb1', 'A1', 'G1', 'Bb1', 'A1'], 0.44, { cresc: 0.3 });
    pad(23, 'Dm', 1, 0.42, { bright: 0.6 }); pad(24, 'DmC', 1, 0.44, { bright: 0.6 });
    pad(25, 'Bb', 1, 0.46, { bright: 0.6 }); pad(26, 'A', 1, 0.5, { bright: 0.65 });
    pad(27, 'Gm', 1, 0.5, { bright: 0.65 }); pad(28, 'Bb', 1, 0.55, { bright: 0.7 }); pad(29, 'A', 1, 0.6, { bright: 0.8, swell: 1.4 });
    mel('cello', 23, TA, 0.62, { tr: -12, until: 11 });
    choirChord(23, 'Dm', 2, 0.35, 'oo'); choirChord(25, 'Bb', 1, 0.38, 'oo'); choirChord(26, 'A', 1, 0.4, 'oo');
    choirChord(27, 'Gm', 1, 0.42, 'oo'); choirChord(28, 'Bb', 1, 0.46); choirChord(29, 'A', 1, 0.52);
    [['D3', 27], ['F3', 28], ['E3', 29]].forEach(([n, bar]) => o.horn(b(bar), n, BAR, 0.55, { att: 0.8 }));
    [['A3', 27], ['Bb3', 28], ['C#4', 29]].forEach(([n, bar]) => o.horn(b(bar), n, BAR, 0.5, { att: 0.8 }));
    o.timpRoll(b(24, 2), b(25), 'D2', 0.04, 0.18);
    o.timpRoll(b(26, 2), b(27), 'A1', 0.05, 0.22);
    o.timpRoll(b(28), b(30), 'A1', 0.05, 0.45);
    o.cymSwell(b(29), BAR, 0.8);

    // ===== 2017–2020 燎原 (30–38) =====
    const seaCh = ['Dm', 'C', 'Bb', 'F', 'Dm', 'F', 'C', 'Dm'];
    seaCh.forEach((c, i) => pad(30 + i, c, 1, 0.62 + i * 0.015, { bright: 1.1 }));
    seaCh.forEach((c, i) => choirChord(30 + i, c, 1, 0.42 + i * 0.01));
    ost(30, 8, ['D2', 'C2', 'Bb1', 'F2', 'D2', 'F2', 'C2', 'D2'], 0.42, { quarter: true });
    mel('horn', 30, TA, 0.75); mel('violin', 30, TA, 0.55, { tr: 12 });
    mel('horn', 34, TB, 0.8); mel('violin', 34, TB, 0.6, { tr: 12 });
    const pent = ['D5', 'F5', 'G5', 'A5', 'C6', 'D6', 'C6', 'A5', 'G5', 'F5', 'A5', 'G5', 'D5', 'F5', 'G5', 'A5'];
    for (let bar = 31; bar < 38; bar++) for (let i = 0; i < 8; i++) o.gamelan(b(bar, i * 0.5), pent[(bar * 8 + i) % pent.length], i % 4 === 0 ? 0.55 : 0.38);
    o.timpRoll(b(33, 2), b(34), 'F2', 0.05, 0.3);
    o.cymSwell(b(33), BAR, 0.6);
    o.timpRoll(b(37), b(37, 3), 'D2', 0.05, 0.25);

    // ===== 2021–2023 平台期 (38–44) =====
    o.drone(b(38) - 1, b(44) - b(38) + 2, 'D2', 0.8, 3);
    [['Gm', 38], ['Dm', 39], ['Bb', 40], ['A', 41], ['Gm', 42]].forEach(([c, bar]) => pad(bar, c, 1, 0.22, { bright: 0.55, noBass: true, att: 1.6 }));
    pad(43, 'Asus', 0.5, 0.22, { bright: 0.55, noBass: true, att: 1.2 });
    pad(43, 'A', 0.5, 0.24, { bright: 0.55, noBass: true, att: 1.0, beat: 2 });
    mel('cello', 38, [[0, 'D4', 2], [2, 'C4', 1], [3, 'Bb3', 1], [4, 'A3', 4], [8, 'Bb3', 2], [10, 'D4', 2], [12, 'C#4', 4], [16, 'D4', 2], [18, 'Bb3', 2], [20, 'A3', 4]], 0.55, { att: 0.5 });
    [['D5', 38, 0], ['A4', 38, 2], ['F5', 39, 0], ['A4', 40, 0], ['D5', 40, 2], ['E5', 41, 0], ['D5', 42, 0], ['Bb4', 42, 2], ['E5', 43, 0]].forEach(([n, bar, beat]) => o.piano(b(bar, beat), n, BEAT * 2, 0.26));

    // ===== 2025 回家 (44–49) =====
    mel('piano', 44, T_HOME, 0.52);
    [['F', 44], ['C', 45], ['Dm', 46], ['Bb', 47], ['C', 48]].forEach(([c, bar]) => arp(bar, c, 0.22, { half: false }));
    pad(46, 'Dm', 1, 0.3, { att: 1.8 }); pad(47, 'Bb', 1, 0.34); pad(48, 'Csus', 0.5, 0.38); pad(48, 'C', 0.5, 0.42, { beat: 2, swell: 1.2 });
    o.bell(b(44, 1), 'F6', 0.3, { ratio: 2, index: 0.6, decay: 2 }); o.bell(b(46, 3), 'A6', 0.25, { ratio: 2, index: 0.6, decay: 2 });

    // ===== 产品星图 (49–54) =====
    const starCh = ['D', 'Bm', 'G', 'A', 'A'];
    starCh.forEach((c, i) => pad(49 + i, c, 1, 0.45 + i * 0.05, { bright: 1.1 }));
    for (let bar = 49; bar < 54; bar++) {
      const c = CH[starCh[bar - 49]];
      const seq = [c.mid[0], c.u[0], c.u[1], c.u[2], c.u[1], c.u[0], c.u[1], c.u[2]];
      for (let i = 0; i < 8; i++) o.strings(b(bar, i * 0.5), m(seq[i]) + 12, BEAT * 0.45, 0.4 + (bar - 49) * 0.05, { att: 0.03, rel: 0.25, amp: 0.028, voices: [-5, 5], bus: 'viola', busOpt: { send: 0.45, pan: -0.3 }, cut: 2600 });
    }
    ['D6', 'F#6', 'A6', 'E6', 'B6', 'D7', 'A6', 'F#6'].forEach((n, i) => o.bell(b(49, i * 2) + BEAT * 0.02, n, 0.55, { ratio: 3.5, index: 1.1, decay: 3.2, amp: 0.055 }));
    choirChord(51, 'G', 1, 0.4); choirChord(52, 'A', 2, 0.48);
    o.horn(b(52), 'E4', BAR * 2, 0.55, { att: 1.5 }); o.horn(b(52), 'A3', BAR * 2, 0.5, { att: 1.5 });
    o.timpRoll(b(53), b(54), 'A1', 0.06, 0.42);
    o.cymSwell(b(53) - 0.5, BAR + 0.5, 0.9);

    // ===== 2026 巅峰 (54–61) =====
    const peakCh = [['D', 54, 1], ['A', 55, 1], ['Bm', 56, 1], ['G', 57, 1], ['D', 58, 1], ['G', 59, 1]];
    peakCh.forEach(([c, bar, n]) => { pad(bar, c, n, 0.86, { bright: 1.2 }); choirChord(bar, c, n, 0.6); });
    pad(60, 'Bm', 0.5, 0.8, { bright: 1.2 }); choirChord(60, 'Bm', 0.5, 0.55);
    pad(60, 'A', 0.5, 0.82, { bright: 1.25, beat: 2, swell: 1.15 }); o.choir(b(60, 2), 'E4', BAR / 2, 0.58); o.choir(b(60, 2), 'C#4', BAR / 2, 0.58); o.choir(b(60, 2), 'A4', BAR / 2, 0.58);
    ost(54, 7, ['D2', 'A1', 'B1', 'G1', 'D2', 'G1', 'A1'], 0.48, { quarter: true });
    mel('horn', 54, TA_M, 0.95); mel('horn', 54, TA_M, 0.6, { tr: -12 }); mel('violin', 54, TA_M, 0.7, { tr: 12 });
    mel('horn', 58, TB_M, 1.0); mel('horn', 58, TB_M, 0.62, { tr: -12 }); mel('violin', 58, TB_M, 0.75, { tr: 12 });
    mel('choir', 58, TB_M, 0.35);
    for (let bar = 54; bar < 61; bar++) o.bell(b(bar), ['D6', 'A5', 'B5', 'G5', 'D6', 'G5', 'A5'][bar - 54], 0.4, { ratio: 3.5, index: 1, decay: 2.8 });
    o.timpRoll(b(57, 2), b(58), 'G1', 0.06, 0.34);
    o.timpRoll(b(60), b(61), 'A1', 0.06, 0.45);
    o.cymSwell(b(60), BAR, 0.9);

    // ===== 尾声 (61–68) =====
    pad(61, 'D', 1, 0.7, { att: 0.4, swell: 0.6 }); choirChord(61, 'D', 1, 0.5);
    o.timp(b(61), 'D2', 0.3);
    pad(62, 'G', 1, 0.4, { att: 1.5 }); pad(63, 'Bm', 1, 0.34, { att: 1.5 }); pad(64, 'G', 1, 0.3, { att: 1.5 });
    pad(65, 'Dadd9', 3, 0.26, { att: 2, swell: 0.3, rel: 3 });
    choirChord(62, 'G', 2, 0.3, 'oo'); choirChord(65, 'Dadd9', 3, 0.22, 'oo');
    o.drone(b(62), b(68) - b(62) + 2, 'D2', 0.7, 4);
    mel('piano', 63, [[0, 'A4', 1], [1, 'D5', 1], [2, 'E5', 2]], 0.4);
    mel('piano', 65, [[0, 'A4', 1.5], [1.5, 'D5', 1.5], [3, 'E5', 9]], 0.36, { damp: 1.5 });
    [['A6', 62, 1], ['F#6', 63, 3], ['D6', 64, 2], ['E6', 66, 0], ['A6', 67, 0]].forEach(([n, bar, beat]) => o.bell(b(bar, beat), n, 0.3, { ratio: 2, index: 0.6, decay: 2.6, amp: 0.045 }));
  }

  async function renderMusic(sampleRate = 48000) {
    const len = Math.ceil(DURATION * sampleRate);
    const ctx = new OfflineAudioContext(2, len, sampleRate);
    const o = new Orchestra(ctx);
    score(o);
    const buf = await ctx.startRendering();
    // 峰值归一化到 -1 dBFS，首尾做淡入淡出
    let peak = 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    }
    const gain = peak > 0 ? 0.891 / peak : 1;
    const fadeOut = Math.floor(2.5 * sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        let g = gain;
        const fromEnd = d.length - i;
        if (fromEnd < fadeOut) g *= fromEnd / fadeOut;
        d[i] *= g;
      }
    }
    return buf;
  }

  function toWav(buf) {
    const n = buf.length, chs = buf.numberOfChannels, sr = buf.sampleRate;
    const ab = new ArrayBuffer(44 + n * chs * 2);
    const v = new DataView(ab);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + n * chs * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, chs, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * chs * 2, true); v.setUint16(32, chs * 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, n * chs * 2, true);
    const data = [];
    for (let c = 0; c < chs; c++) data.push(buf.getChannelData(c));
    let off = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < chs; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2;
    }
    return ab;
  }

  root.MVMusic = { renderMusic, toWav };
})(typeof window !== 'undefined' ? window : globalThis);
