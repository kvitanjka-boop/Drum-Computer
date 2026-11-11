/* ---------------------------------------------------------------- Daten */
export const STEPS = 16;
export const INSTR = [
  { name: 'KICK',  color: '#ff4136' },
  { name: 'SNARE', color: '#ff851b' },
  { name: 'CLAP',  color: '#ffdc00' },
  { name: 'HH CL', color: '#2ecc40' },
  { name: 'HH OP', color: '#39cccc' },
  { name: 'TOM',   color: '#2d8cff' },
  { name: 'RIM',   color: '#b10dc9' },
  { name: 'COW',   color: '#f012be' },
];
const R = INSTR.length;
export const pattern = INSTR.map(() => new Array(STEPS).fill(false));
[0,4,8,12].forEach(i => pattern[0][i] = true);
[4,12].forEach(i => pattern[1][i] = true);
[12].forEach(i => pattern[2][i] = true);
[0,2,4,6,8,10,12].forEach(i => pattern[3][i] = true);
[14].forEach(i => pattern[4][i] = true);
[10].forEach(i => pattern[7][i] = true);

export const params = INSTR.map(() => ({ tune: 0.5, decay: 0.5, level: 0.8 }));
export const globals = { bpm: 120, swing: 0, volume: 0.8, res: 4 };

/* ---------------------------------------------------------------- Audio */
export const engine = {
  ctx: null, master: null, noise: null, openHat: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = globals.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    s.connect(ctx.destination); s.start(0);
  },
  ratio(t) { return 0.5 * Math.pow(2, t * 2); },
  gain(t, peak, dec) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    g.connect(this.master);
    return g;
  },
  osc(type, f, t, dur) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    o.start(t); o.stop(t + dur); return o;
  },
  noiseSrc(t, dur) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    s.start(t, Math.random()); s.stop(t + dur); return s;
  },
  filter(type, f, q = 1) {
    const x = this.ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x;
  },
  trigger(r, t) { this.voices[r].call(this, t, params[r]); },
  voices: [
    // KICK
    function (t, p) {
      const r = this.ratio(p.tune), dec = 0.15 + p.decay * 0.85;
      const o = this.osc('sine', 150 * r, t, dec + 0.05);
      o.frequency.exponentialRampToValueAtTime(48 * r, t + 0.07);
      o.connect(this.gain(t, p.level, dec));
      const n = this.noiseSrc(t, 0.02), f = this.filter('lowpass', 3000);
      n.connect(f); f.connect(this.gain(t, 0.3 * p.level, 0.012));
    },
    // SNARE
    function (t, p) {
      const r = this.ratio(p.tune), dec = 0.08 + p.decay * 0.4;
      this.osc('triangle', 185 * r, t, 0.2).connect(this.gain(t, 0.6 * p.level, 0.1));
      this.osc('triangle', 330 * r, t, 0.2).connect(this.gain(t, 0.4 * p.level, 0.07));
      const n = this.noiseSrc(t, dec + 0.05), f = this.filter('highpass', 1500);
      n.connect(f); f.connect(this.gain(t, 0.8 * p.level, dec));
    },
    // CLAP
    function (t, p) {
      const r = this.ratio(p.tune), lv = p.level * 0.9, tail = 0.05 + p.decay * 0.3;
      const n = this.noiseSrc(t, 0.5), f = this.filter('bandpass', 1300 * r, 1.2);
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      for (let k = 0; k < 3; k++) {
        const tk = t + k * 0.012;
        g.gain.setValueAtTime(lv, tk);
        g.gain.exponentialRampToValueAtTime(0.02, tk + 0.01);
      }
      g.gain.setValueAtTime(lv, t + 0.036);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.036 + tail);
      n.connect(f); f.connect(g); g.connect(this.master);
    },
    // HH closed
    function (t, p) {
      if (this.openHat) { try { this.openHat.gain.cancelScheduledValues(t); this.openHat.gain.setTargetAtTime(0, t, 0.004); } catch (e) {} }
      this.metal(t, p, 0.02 + p.decay * 0.12);
    },
    // HH open
    function (t, p) { this.openHat = this.metal(t, p, 0.15 + p.decay * 0.8); },
    // TOM
    function (t, p) {
      const r = this.ratio(p.tune), dec = 0.15 + p.decay * 0.6;
      const o = this.osc('sine', 200 * r, t, dec + 0.05);
      o.frequency.exponentialRampToValueAtTime(110 * r, t + 0.1);
      o.connect(this.gain(t, p.level, dec));
    },
    // RIM
    function (t, p) {
      const r = this.ratio(p.tune), dec = 0.02 + p.decay * 0.07;
      const f = this.filter('highpass', 300);
      this.osc('sine', 1700 * r, t, dec + 0.02).connect(f);
      this.osc('triangle', 480 * r, t, dec + 0.02).connect(f);
      const g = this.gain(t, 0.7 * p.level, dec); f.connect(g);
    },
    // COWBELL
    function (t, p) {
      const r = this.ratio(p.tune), dec = 0.08 + p.decay * 0.5;
      const f = this.filter('bandpass', 1500 * r, 1);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.5 * p.level, t);
      g.gain.exponentialRampToValueAtTime(0.15 * p.level, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + dec);
      this.osc('square', 540 * r, t, dec + 0.02).connect(f);
      this.osc('square', 800 * r, t, dec + 0.02).connect(f);
      f.connect(g); g.connect(this.master);
    },
  ],
  metal(t, p, dec) {
    const r = this.ratio(p.tune);
    const bp = this.filter('bandpass', 10000, 0.8), hp = this.filter('highpass', 7000);
    [205.3, 304.4, 369.6, 522.7, 540, 800].forEach(f => this.osc('square', f * r * 1.0, t, dec + 0.05).connect(bp));
    bp.connect(hp);
    const g = this.gain(t, 0.35 * p.level, dec); hp.connect(g);
    return g;
  },
};

/* ---------------------------------------------------------------- Sequencer */
export const seq = { playing: false, step: 0, nextTime: 0, queue: [], cur: -1, timer: null };
function scheduler() {
  const ctx = engine.ctx;
  while (seq.nextTime < ctx.currentTime + 0.12) {
    const dur = 60 / globals.bpm / globals.res;
    const t = seq.nextTime + (seq.step % 2 ? globals.swing * dur * 0.5 : 0);
    for (let r = 0; r < R; r++) if (pattern[r][seq.step]) engine.trigger(r, t);
    seq.queue.push({ step: seq.step, time: t });
    seq.step = (seq.step + 1) % STEPS;
    seq.nextTime += dur;
  }
}
export function play() {
  engine.init();
  seq.playing = true; seq.step = 0; seq.queue = [];
  seq.nextTime = engine.ctx.currentTime + 0.06;
  scheduler();
  seq.timer = setInterval(scheduler, 25);
}
export function stop() {
  seq.playing = false; clearInterval(seq.timer); seq.queue = []; seq.cur = -1;
}
export const toggle = () => seq.playing ? stop() : play();


const E = '................';
// Spuren: k=Kick s=Snare c=Clap h=HH zu o=HH offen t=Tom r=Rim w=Cowbell
export const STYLES = [
  { n: 'ROCK',   bpm: [80, 120, 160],  sw: 0,    res: 4, p: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x...', o: '..............x.' } },
  { n: 'BLUES',  bpm: [60, 90, 130],   sw: 0.67, res: 2, p: { k: 'x...x...x...x...', s: '..x...x...x...x.', h: 'xxxxxxxxxxxxxxxx' } },
  { n: 'HIP-HOP',bpm: [75, 90, 100],   sw: 0.35, res: 4, p: { k: 'x.....x...x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '.............x..' } },
  { n: 'TRAP',   bpm: [120, 140, 160], sw: 0,    res: 4, p: { k: 'x.........x.....', s: '........x.......', c: '........x.......', h: 'x.x.x.x.x.x.xxxx' } },
  { n: 'SOUL',   bpm: [70, 90, 115],   sw: 0.3,  res: 4, p: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', r: '......x.......x.' } },
  { n: 'FUNK',   bpm: [95, 108, 120],  sw: 0.2,  res: 4, p: { k: 'x..x...x..x.....', s: '....x..x.x..x...', h: 'xxxxxxxxxxxxxxxx', o: '......x.......x.' } },
  { n: 'DISCO',  bpm: [110, 120, 128], sw: 0,    res: 4, p: { k: 'x...x...x...x...', s: '....x.......x...', c: '....x.......x...', h: '.x.x.x.x.x.x.x.x', o: '..x...x...x...x.' } },
  { n: 'REGGAE', bpm: [65, 75, 85],    sw: 0.15, res: 4, p: { k: '........x.......', r: '........x.......', h: 'x.x.x.x.x.x.x.x.' } },
  { n: 'HOUSE',  bpm: [118, 124, 130], sw: 0,    res: 4, p: { k: 'x...x...x...x...', c: '....x.......x...', h: '.x.x.x.x.x.x.x.x', o: '..x...x...x...x.' } },
  { n: 'TECHNO', bpm: [128, 135, 145], sw: 0,    res: 4, p: { k: 'x...x...x...x...', c: '....x.......x...', h: 'xxxxxxxxxxxxxxxx', o: '..x...x...x...x.', r: '.x.....x..x.....' } },
  { n: 'POP',    bpm: [95, 110, 125],  sw: 0,    res: 4, p: { k: 'x.......x.x.....', s: '....x.......x...', c: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' } },
  { n: 'D&B',    bpm: [160, 170, 180], sw: 0,    res: 4, p: { k: 'x.........x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' } },
  { n: 'JAZZ',   bpm: [90, 120, 160],  sw: 0.67, res: 2, p: { k: 'x.......x.......', s: '...x.......x....', h: 'x.xxx.xxx.xxx.xx' } },
  { n: 'LATIN',  bpm: [90, 105, 120],  sw: 0.1,  res: 4, p: { k: 'x.....x.x.....x.', r: 'x..x..x...x.x...', h: 'x.x.x.x.x.x.x.x.', w: 'x...x...x...x...' } },
];
export const SPEEDS = ['LANGSAM', 'MITTEL', 'SCHNELL'];
const KEYS = ['k', 's', 'c', 'h', 'o', 't', 'r', 'w'];
export function loadStyle(i, sp) {
  const st = STYLES[i];
  KEYS.forEach((k, r) => { const str = st.p[k] || E; for (let j = 0; j < STEPS; j++) pattern[r][j] = str[j] === 'x'; });
  globals.res = st.res; globals.swing = st.sw; globals.bpm = st.bpm[sp];
  return st;
}

/* Speichern / Laden (Pattern, Instrument-Regler, Tempo, Swing, Lautstärke) */
export function getState() {
  return {
    pattern: pattern.map(r => r.map(x => (x ? 'x' : '.')).join('')),
    params: params.map(p => ({ tune: p.tune, decay: p.decay, level: p.level })),
    g: { bpm: globals.bpm, swing: globals.swing, volume: globals.volume, res: globals.res },
  };
}
const clamp = (v, a, b, d) => (typeof v === 'number' && isFinite(v) ? Math.min(b, Math.max(a, v)) : d);
export function applyState(s) {
  if (!s || !Array.isArray(s.pattern) || !Array.isArray(s.params) || !s.g) return false;
  s.pattern.slice(0, INSTR.length).forEach((str, r) => { for (let i = 0; i < STEPS; i++) pattern[r][i] = typeof str === 'string' && str[i] === 'x'; });
  s.params.slice(0, INSTR.length).forEach((p, r) => {
    params[r].tune = clamp(p.tune, 0, 1, 0.5); params[r].decay = clamp(p.decay, 0, 1, 0.5); params[r].level = clamp(p.level, 0, 1, 0.8);
  });
  globals.bpm = Math.round(clamp(s.g.bpm, 60, 200, 120));
  globals.swing = clamp(s.g.swing, 0, 1, 0);
  globals.volume = clamp(s.g.volume, 0, 1, 0.8);
  globals.res = s.g.res === 2 ? 2 : 4;
  return true;
}
