/* 4-Spur-Looper mit Metronom. Alle Zeiten laufen auf der Audio-Uhr des Drumcomputers,
   dadurch liegen die Aufnahmen im Takt. */
const WORKLET = `
class Cap extends AudioWorkletProcessor {
  constructor() { super(); this.job = null;
    this.port.onmessage = e => { const m = e.data;
      if (m.type === 'start') this.job = { start: m.start, end: m.start + m.frames, buf: new Float32Array(m.frames) };
      else if (m.type === 'cancel') this.job = null; }; }
  process(inputs) {
    const j = this.job; if (!j) return true;
    const inp = inputs[0] || [], n = 128, f0 = currentFrame, f1 = f0 + n;
    if (f1 > j.start && f0 < j.end) {
      const a = Math.max(f0, j.start), b = Math.min(f1, j.end), ch = inp.length;
      for (let f = a; f < b; f++) { let s = 0; for (let c = 0; c < ch; c++) s += inp[c][f - f0]; j.buf[f - j.start] = ch ? s / ch : 0; }
    }
    if (f1 >= j.end) { this.port.postMessage({ type: 'done', buf: j.buf }, [j.buf.buffer]); this.job = null; }
    return true;
  } }
registerProcessor('cap', Cap);`;

export const TRACK_COLORS = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0'];

function toWav(f32, sr) {
  const n = f32.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: 'audio/wav' });
}

export function createRecorder({ engine, seq, globals, STEPS, play, onChange }) {
  const KEY = 'drum.rec';
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  const cfg = Object.assign({ loopBars: 2, countIn: 1, metro: 0, source: 'mic', latency: null, drumsMute: false }, saved);
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  const tracks = [0, 1, 2, 3].map(i => ({ i, state: 'empty', vol: 0.9, mute: false, buffer: null, gain: null, src: null, T: 0, Tend: 0, token: 0 }));
  let audioReady = false, workletReady = false, capIn, capMix, trackBus, metroGain, micStream, micSrc, routed = null;
  const beatQ = [];
  let message = 'Bereit. Spur wählen und REC drücken (Kopfhörer empfohlen).';
  const rec = { cfg, tracks, get message() { return message; } };
  const changed = () => onChange && onChange();
  const say = t => { message = t; changed(); };
  seq.mute = cfg.drumsMute;

  /* ---- Hilfswerte ---- */
  const beatDur = () => 60 / globals.bpm;
  const cycleBeats = () => STEPS / globals.res;
  const loopBeats = () => Math.max(cfg.loopBars * 4, cycleBeats());
  const loopCycles = () => Math.round(loopBeats() / cycleBeats());
  const loopDur = () => loopBeats() * beatDur();
  rec.loopSeconds = loopDur;
  rec.locked = () => tracks.some(t => t.state !== 'empty');

  function initAudio() {
    if (audioReady) return;
    engine.init();
    const ctx = engine.ctx;
    trackBus = ctx.createGain(); trackBus.connect(engine.comp);
    metroGain = ctx.createGain(); metroGain.gain.value = 0.5; metroGain.connect(ctx.destination);   // am Mix und an der Aufnahme vorbei
    tracks.forEach(t => { t.gain = ctx.createGain(); t.gain.connect(trackBus); applyGain(t); });
    if (cfg.latency == null) cfg.latency = Math.min(400, Math.max(0, Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000)));
    audioReady = true;
  }
  async function initWorklet() {
    initAudio();
    if (workletReady) return;
    const ctx = engine.ctx;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    const mk = () => {
      const n = new AudioWorkletNode(ctx, 'cap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const z = ctx.createGain(); z.gain.value = 0; n.connect(z); z.connect(ctx.destination); return n;
    };
    capIn = mk(); capMix = mk(); engine.comp.connect(capMix);
    workletReady = true;
  }
  function applyGain(t) { if (t.gain) t.gain.gain.value = t.mute ? 0 : t.vol; }
  function capture(node, startSec, seconds) {
    return new Promise(res => {
      node.port.onmessage = e => { if (e.data.type === 'done') res(e.data.buf); };
      const sr = engine.ctx.sampleRate;
      node.port.postMessage({ type: 'start', start: Math.round(startSec * sr), frames: Math.round(seconds * sr) });
    });
  }
  async function ensureMic() {
    if (micSrc) return true;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      micSrc = engine.ctx.createMediaStreamSource(micStream); return true;
    } catch (e) { say('Mikrofon nicht erlaubt oder nicht vorhanden. Erlaube es in den Browser-Einstellungen für diese Seite.'); return false; }
  }
  function route() {
    if (routed === cfg.source) return;
    try { micSrc && micSrc.disconnect(capIn); } catch (e) {}
    try { engine.master.disconnect(capIn); } catch (e) {}
    if (cfg.source === 'mic') micSrc.connect(capIn); else engine.master.connect(capIn);
    routed = cfg.source;
  }

  /* ---- Klick ---- */
  function click(t, accent) {
    const ctx = engine.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = accent ? 1600 : 1000;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(accent ? 1 : 0.7, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(metroGain); o.start(t); o.stop(t + 0.06);
  }
  const pushBeat = (time, beat) => { beatQ.push({ time, beat }); if (beatQ.length > 64) beatQ.shift(); };

  /* ---- Wiedergabe der Spuren ---- */
  function stopSrc(t) { if (t.src) { try { t.src.stop(); } catch (e) {} t.src = null; } }
  function playBuf(t, when, offset) {
    if (!t.buffer) return;
    stopSrc(t);
    const s = engine.ctx.createBufferSource(); s.buffer = t.buffer; s.connect(t.gain); s.start(when, offset); t.src = s;
  }
  seq.onCycle = (t, idx) => {
    initAudio();
    if (cfg.metro > 0) {
      const bd = beatDur(), cb = cycleBeats();
      for (let j = 0; j < cb; j++) { if (cfg.metro === 2) click(t + j * bd, j % 4 === 0); pushBeat(t + j * bd, j % 4); }
    }
    if (idx % loopCycles() === 0) tracks.forEach(tr => { if (tr.state === 'ready') playBuf(tr, t, 0); });
  };

  function nextBoundary(minTime) {
    const cd = cycleBeats() * beatDur(), k = loopCycles();
    let c = seq.cycleIdx + Math.max(0, Math.ceil((minTime - seq.cycleStart) / cd));
    while (c % k !== 0) c++;
    return seq.cycleStart + (c - seq.cycleIdx) * cd;
  }

  /* ---- Aufnahme ---- */
  rec.record = async i => {
    const tr = tracks[i];
    if (tr.state === 'armed' || tr.state === 'recording') { cancel(tr); say(`Spur ${i + 1}: abgebrochen.`); return; }
    if (tracks.some(t => t.state === 'armed' || t.state === 'recording')) { say('Erst die laufende Aufnahme beenden.'); return; }
    try { await initWorklet(); } catch (e) { say('Aufnahme wird von diesem Browser nicht unterstützt.'); return; }
    if (cfg.source === 'mic' && !(await ensureMic())) return;
    route();
    if (!seq.playing) { play(); }
    const ctx = engine.ctx, bd = beatDur(), ci = cfg.countIn * 4 * bd;
    const T = nextBoundary(ctx.currentTime + ci + 0.3), L = loopDur();
    stopSrc(tr); tr.buffer = null; tr.state = 'armed'; tr.T = T; tr.Tend = T + L; const token = ++tr.token;
    if (cfg.countIn > 0 && cfg.metro === 0) {
      for (let j = cfg.countIn * 4; j >= 1; j--) { const tt = T - j * bd; click(tt, j === cfg.countIn * 4); pushBeat(tt, (cfg.countIn * 4 - j) % 4); }
    }
    const lat = cfg.source === 'mic' ? (cfg.latency || 0) / 1000 : 0;
    say(`Spur ${i + 1}: wartet auf den Takt-Anfang …`);
    capture(capIn, T + lat, L).then(buf => { if (tr.token === token) finish(tr, buf); });
  };
  function finish(tr, f32) {
    const ctx = engine.ctx, b = ctx.createBuffer(1, f32.length, ctx.sampleRate);
    b.copyToChannel(f32, 0);
    tr.buffer = b; tr.state = 'ready';
    const L = f32.length / ctx.sampleRate, when = ctx.currentTime + 0.03, off = when - tr.Tend;
    if (seq.playing && off >= 0 && off < L) playBuf(tr, when, off);   // nahtlos weiter, ohne eine ganze Runde zu warten
    say(`Spur ${tr.i + 1}: aufgenommen und läuft im Loop.`);
  }
  function cancel(tr) {
    tr.token++; tr.state = tr.buffer ? 'ready' : 'empty';
    if (capIn) capIn.port.postMessage({ type: 'cancel' });
  }
  rec.clear = i => { const tr = tracks[i]; cancel(tr); stopSrc(tr); tr.buffer = null; tr.state = 'empty'; say(`Spur ${i + 1} gelöscht.`); };
  rec.clearAll = () => { tracks.forEach(tr => { cancel(tr); stopSrc(tr); tr.buffer = null; tr.state = 'empty'; }); say('Alle Spuren gelöscht. Tempo ist wieder frei.'); };
  rec.setMute = (i, m) => { tracks[i].mute = m; applyGain(tracks[i]); changed(); };
  rec.setVol = (i, v) => { tracks[i].vol = v; applyGain(tracks[i]); };
  rec.onStop = () => {
    tracks.forEach(tr => { stopSrc(tr); if (tr.state === 'armed' || tr.state === 'recording') cancel(tr); });
    beatQ.length = 0; say('Gestoppt. Laufende Aufnahmen wurden abgebrochen.');
  };
  rec.set = (k, v) => {
    if (k === 'source') routed = null;
    cfg[k] = v; if (k === 'drumsMute') seq.mute = v; persist(); changed();
  };

  /* ---- Export des Gesamtklangs (Drums + Spuren, ohne Metronom) ---- */
  rec.exportMix = async (loops = 2) => {
    try { await initWorklet(); } catch (e) { say('Export wird von diesem Browser nicht unterstützt.'); return null; }
    if (!seq.playing) { play(); }
    const T = nextBoundary(engine.ctx.currentTime + 0.4), dur = loops * loopDur();
    say(`Mix wird aufgenommen (${Math.round(dur * 10) / 10} s) …`);
    const buf = await capture(capMix, T, dur);
    say('Mix fertig.');
    return URL.createObjectURL(toWav(buf, engine.ctx.sampleRate));
  };

  /* ---- Pro Bild aufrufen ---- */
  rec.tick = () => {
    const ctx = engine.ctx; if (!ctx) return null;
    const now = ctx.currentTime; let beat = null;
    while (beatQ.length && beatQ[0].time <= now) beat = beatQ.shift().beat;
    tracks.forEach(tr => { if (tr.state === 'armed' && now >= tr.T) { tr.state = 'recording'; changed(); } });
    return beat;
  };
  rec.progress = i => {
    const tr = tracks[i], ctx = engine.ctx;
    if (!ctx || tr.state !== 'recording') return 0;
    return Math.min(1, Math.max(0, (ctx.currentTime - tr.T) / (tr.Tend - tr.T)));
  };
  return rec;
}
