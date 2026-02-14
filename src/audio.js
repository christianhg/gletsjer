/**
 * Generative Audio — the glacier's voice
 *
 * Three layers (drone, wind, aurora harmonic) + four event sounds.
 * Zero audio files. Everything from Web Audio API oscillators + noise.
 * All parameters derived from mood. Touch to activate, touch to mute.
 */

let ctx, master, initialized = false, muted = false, reduced = false;
let droneA, droneB, droneLpf, droneMix;
let iceFilter, windFilter, windGain, windLfoGain;
let auroraOsc, auroraGain;
let eventBus, noiseBuf;
let whiteoutActive = false;

// Drone stops: phase → freqA, freqB, lpf cutoff, gain
const DS = [
  [0.00, 58, 59.5, 180, 0.70], [0.20, 62, 63.2, 220, 0.75],
  [0.38, 52, 53.8, 150, 0.65], [0.55, 48, 50.5, 120, 0.42],
  [0.78, 55, 56.3, 170, 0.60],
];
// Wind stops: phase → gain, freq, Q
const WS = [
  [0.00, 0.06, 500, 2.5], [0.20, 0.03, 350, 3.5],
  [0.38, 0.07, 600, 2.0], [0.55, 0.04, 400, 3.0],
  [0.78, 0.05, 550, 2.5],
];

export async function toggleAudio(isReduced) {
  if (!initialized) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    reduced = !!isReduced;
    ctx = new AC();
    if (ctx.state === 'suspended') await ctx.resume();

    master = gain(0); master.connect(ctx.destination);
    noiseBuf = makeNoise(4);
    buildDrone(); buildWind(); buildAurora();
    eventBus = gain(reduced ? 0.25 : 0.5); eventBus.connect(master);

    initialized = true; muted = false;
    master.gain.setTargetAtTime(0.7, ctx.currentTime, 1.3);
    windGain.gain.setValueAtTime(0, ctx.currentTime);
    windGain.gain.setTargetAtTime(0.06, ctx.currentTime + 8, 2.0);
    return;
  }
  if (muted) {
    if (ctx.state === 'suspended') await ctx.resume();
    master.gain.setTargetAtTime(0.7, ctx.currentTime, 1.3);
    muted = false;
  } else {
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
    muted = true;
  }
}

export function isAudioActive() {
  return initialized && !muted && ctx && ctx.state === 'running';
}
export function suspendAudio() { if (ctx && ctx.state === 'running') ctx.suspend(); }
export function resumeAudio() { if (ctx && ctx.state === 'suspended' && !muted) ctx.resume(); }

export function updateAudio(mood) {
  if (!isAudioActive()) return;
  const t = ctx.currentTime, τ = 3.0;

  const d = lerp(DS, mood.phase);
  droneA.frequency.setTargetAtTime(d[0], t, τ);
  droneB.frequency.setTargetAtTime(d[1], t, τ);
  droneLpf.frequency.setTargetAtTime(d[2], t, τ);
  droneMix.gain.setTargetAtTime(d[3], t, τ);

  auroraOsc.frequency.setTargetAtTime(d[0] * 3, t, τ);
  auroraGain.gain.setTargetAtTime(Math.pow(mood.auroraVisibility, 3) * 0.25, t, 0.3);

  iceFilter.frequency.setTargetAtTime(300 + (1 - mood.ambientBrightness) * 200, t, τ);

  // Skip wind during whiteout — triggerWhiteoutSound owns these params
  if (!whiteoutActive) {
    const w = lerp(WS, mood.phase); // [gain, freq, Q]
    windGain.gain.setTargetAtTime(w[0], t, τ);
    windFilter.frequency.setTargetAtTime(w[1], t, τ);
    windFilter.Q.setTargetAtTime(w[2], t, τ);
  }
}

// --- Event sounds ---

export function triggerCalvingSound() {
  if (!isAudioActive()) return;
  const t = ctx.currentTime, v = reduced ? 0.25 : 0.5;
  // Crack: noise → resonant sweeping lowpass
  const n = noiseSrc(); const f = bpf('lowpass', 2000, 3);
  f.frequency.exponentialRampToValueAtTime(80, t + 0.8);
  const g = gain(v * 0.8); g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
  n.connect(f); f.connect(g); g.connect(eventBus);
  n.start(t); n.stop(t + 1.5);
  // Sub-thump
  const o = osc('sine', 60); o.frequency.exponentialRampToValueAtTime(25, t + 0.5);
  const tg = gain(v * 0.6); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
  o.connect(tg); tg.connect(eventBus); o.start(t); o.stop(t + 0.8);
}

export function triggerShootingStarSound() {
  if (!isAudioActive()) return;
  const t = ctx.currentTime, v = reduced ? 0.03 : 0.06;
  const o = osc('sine', 4000); o.frequency.exponentialRampToValueAtTime(1200, t + 0.4);
  const g = gain(0); g.gain.linearRampToValueAtTime(v, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  o.connect(g); g.connect(eventBus); o.start(t); o.stop(t + 0.5);
}

export function triggerWhiteoutSound() {
  if (!isAudioActive()) return;
  whiteoutActive = true;
  const t = ctx.currentTime;
  windGain.gain.linearRampToValueAtTime(0.25, t + 2.0);
  windFilter.frequency.linearRampToValueAtTime(1200, t + 2.0);
  windLfoGain.gain.linearRampToValueAtTime(500, t + 1.0);
  // Low rumble
  const o = osc('sine', 35), v = reduced ? 0.06 : 0.12;
  const g = gain(0); g.gain.linearRampToValueAtTime(v, t + 3);
  g.gain.linearRampToValueAtTime(v, t + 8);
  g.gain.exponentialRampToValueAtTime(0.001, t + 14);
  o.connect(g); g.connect(eventBus); o.start(t); o.stop(t + 14);
}

export function taperWhiteoutSound() {
  if (!isAudioActive()) return;
  whiteoutActive = false; // Release wind params back to updateAudio()
  windLfoGain.gain.linearRampToValueAtTime(200, ctx.currentTime + 4);
}

export function triggerDeepGlitchSound() {
  if (!isAudioActive()) return;
  const t = ctx.currentTime, v = reduced ? 0.04 : 0.08;
  [110, 147, 185].forEach(f => {
    const o = osc('square', f);
    o.frequency.setValueAtTime(f * 0.5, t + 0.1);
    o.frequency.setValueAtTime(f * 1.3, t + 0.12);
    o.frequency.setValueAtTime(f * 0.7, t + 0.15);
    const g = gain(0); g.gain.linearRampToValueAtTime(v, t + 0.02);
    g.gain.setValueAtTime(v * 0.75, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    o.connect(g); g.connect(eventBus); o.start(t); o.stop(t + 1.5);
  });
  master.gain.setValueAtTime(0.3, t + 0.15);
  master.gain.linearRampToValueAtTime(0.7, t + 0.3);
}

// --- Graph builders ---

function buildDrone() {
  droneMix = gain(0.7); droneMix.connect(master);
  droneA = osc('triangle', 58); droneB = osc('triangle', 59.5);
  droneLpf = bpf('lowpass', 180, 1.0);
  const gA = gain(0.20), gB = gain(0.20);
  droneA.connect(gA); gA.connect(droneLpf);
  droneB.connect(gB); gB.connect(droneLpf);
  droneLpf.connect(droneMix);
  droneA.start(); droneB.start();
  // Ice texture
  const ice = noiseSrc(); ice.loop = true;
  iceFilter = bpf('bandpass', 400, 2.0);
  const ig = gain(0.06);
  ice.connect(iceFilter); iceFilter.connect(ig); ig.connect(droneMix); ice.start();
}

function buildWind() {
  const n = noiseSrc(); n.loop = true;
  windFilter = bpf('bandpass', 500, 2.5);
  // Gain LFO: 0.043Hz (~23s, incommensurate with snow's 0.07Hz)
  const gLfo = osc('sine', 0.043);
  const gLfoD = gain(0.02); gLfo.connect(gLfoD);
  // Filter LFO: 0.011Hz (~90s)
  const fLfo = osc('sine', 0.011);
  windLfoGain = gain(200); fLfo.connect(windLfoGain);
  windLfoGain.connect(windFilter.frequency);
  windGain = gain(0.06); gLfoD.connect(windGain.gain);
  n.connect(windFilter); windFilter.connect(windGain); windGain.connect(master);
  n.start(); gLfo.start(); fLfo.start();
}

function buildAurora() {
  auroraOsc = osc('sine', 174); // 58 × 3
  const trem = osc('sine', 0.4);
  const td = gain(0.08); trem.connect(td);
  auroraGain = gain(0); td.connect(auroraGain.gain);
  auroraOsc.connect(auroraGain); auroraGain.connect(master);
  auroraOsc.start(); trem.start();
}

// --- Helpers ---

function gain(v) { const g = ctx.createGain(); g.gain.setValueAtTime(v, ctx.currentTime); return g; }
function osc(type, freq) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime); return o; }
function bpf(type, freq, q) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, ctx.currentTime); f.Q.setValueAtTime(q, ctx.currentTime); return f; }
function noiseSrc() { const s = ctx.createBufferSource(); s.buffer = noiseBuf; return s; }
function makeNoise(sec) {
  const len = ctx.sampleRate * sec, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Interpolate between stops using smoothstep. Returns array of values (excluding phase). */
function lerp(stops, phase) {
  const p = ((phase % 1) + 1) % 1;
  let a = stops[stops.length - 1], b = stops[0], t = 0;
  for (let i = 0; i < stops.length; i++) {
    const ni = (i + 1) % stops.length;
    const np = ni === 0 ? 1.0 : stops[ni][0];
    if (p >= stops[i][0] && p < np) {
      a = stops[i]; b = stops[ni];
      t = (np - stops[i][0]) > 0 ? (p - stops[i][0]) / (np - stops[i][0]) : 0;
      break;
    }
  }
  t = t * t * (3 - 2 * t);
  const r = [];
  for (let j = 1; j < a.length; j++) r.push(a[j] + (b[j] - a[j]) * t);
  return r;
}
