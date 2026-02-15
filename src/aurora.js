/**
 * Aurora Borealis — procedural northern lights
 *
 * Renders slow undulating vertical curtains of light in the sky zone.
 * The aurora is both a visual element AND a lighting source — it outputs
 * per-column light tint that glacier.js uses to color ice highlights.
 *
 * Four pillars (from research):
 *   1. Bottom-edge luminosity weighting — brightness peaks at lower edge
 *   2. Fold concentration — overlapping curtains stack brightness
 *   3. Light casting onto ice — per-column tint for glacier highlights
 *   4. Vertical color gradient — green (oxygen) base → magenta (nitrogen) top
 *
 * Design principle (from creative vision):
 *   "Resist the urge to make it too bright or too present."
 *   Cubic intensity curve: first 30% of visibility produces barely visible output.
 *   The aurora is something you discover, not something that announces itself.
 *
 * Renders AFTER sky, BEFORE glacier layers — terrain naturally occludes aurora.
 */

import { simplex2 } from './noise.js';

// --- Curtain parameters ---
// 3 overlapping bands with incommensurate speeds
const CURTAIN_DEFS = [
  { xOff: 0.0,  freq: 0.008, speed: 0.015, ampY: 0.30, bright: 1.0 },
  { xOff: 0.4,  freq: 0.011, speed: 0.022, ampY: 0.25, bright: 0.7 },
  { xOff: 0.7,  freq: 0.006, speed: 0.010, ampY: 0.20, bright: 0.5 },
];

// Aurora lives in this vertical region
const AURORA_Y_MIN_FRAC = 0.05;  // Top 5% of canvas
const AURORA_Y_MAX_FRAC = 0.40;  // Down to 40%

/**
 * @typedef {Object} Aurora
 * @property {Float32Array} columnLight — per-column aurora brightness (0→1)
 * @property {Float32Array} columnR — per-column aurora light R (0→1)
 * @property {Float32Array} columnG — per-column aurora light G (0→1)
 * @property {Float32Array} columnB — per-column aurora light B (0→1)
 * @property {number} width
 */

/**
 * Create the aurora system. Call once at init.
 * @param {number} width
 * @param {number} height
 * @returns {Aurora}
 */
export function createAurora(width, height) {
  return {
    columnLight: new Float32Array(width),
    columnR: new Float32Array(width),
    columnG: new Float32Array(width),
    columnB: new Float32Array(width),
    width,
  };
}

/**
 * Render aurora into the pixel buffer and compute per-column light.
 * Call AFTER sky rendering, BEFORE glacier layers.
 *
 * @param {Aurora} aurora
 * @param {Uint8ClampedArray} data — RGBA pixel data (sky already rendered)
 * @param {number} width
 * @param {number} height
 * @param {number} time — elapsed seconds
 * @param {import('./lightCycle.js').Mood} mood
 */
export function renderAurora(aurora, data, width, height, time, mood) {
  const vis = mood.auroraVisibility;

  // Clear per-column light every frame
  aurora.columnLight.fill(0);
  aurora.columnR.fill(0);
  aurora.columnG.fill(0);
  aurora.columnB.fill(0);

  // Cubic curve: first 30% of visibility produces barely visible output
  const effectiveVis = vis * vis * vis;
  if (effectiveVis < 0.005) return;

  const yMin = (height * AURORA_Y_MIN_FRAC) | 0;
  const yMax = (height * AURORA_Y_MAX_FRAC) | 0;
  const auroraH = yMax - yMin;
  if (auroraH <= 0) return;

  // Render each curtain band — overlapping bands stack brightness (fold effect)
  for (let c = 0; c < CURTAIN_DEFS.length; c++) {
    renderBand(aurora, data, width, yMin, auroraH, time, effectiveVis, c);
  }

  // Clamp accumulated column light
  for (let x = 0; x < width; x++) {
    if (aurora.columnLight[x] > 1) aurora.columnLight[x] = 1;
    if (aurora.columnR[x] > 1) aurora.columnR[x] = 1;
    if (aurora.columnG[x] > 1) aurora.columnG[x] = 1;
    if (aurora.columnB[x] > 1) aurora.columnB[x] = 1;
  }
}

/**
 * Render a single curtain band.
 */
function renderBand(aurora, data, width, yMin, auroraH, time, vis, bandIdx) {
  const def = CURTAIN_DEFS[bandIdx];
  const bandBright = def.bright * vis;
  if (bandBright < 0.005) return;

  for (let x = 0; x < width; x++) {
    const nx = x / width;

    // Curtain center: layered sine waves + noise for organic undulation
    const wave1 = Math.sin(nx * Math.PI * 2 * (def.freq * width * 0.01) + time * def.speed + bandIdx * 2.1) * def.ampY;
    const wave2 = Math.sin(nx * Math.PI * 2 * (def.freq * width * 0.023) + time * def.speed * 0.7 + bandIdx * 4.3) * def.ampY * 0.4;
    const noiseMod = simplex2(nx * 3 + time * 0.008 + bandIdx * 50, time * 0.005 + bandIdx * 30) * 0.2;

    const centerFrac = 0.5 + wave1 + wave2 + noiseMod;

    // Curtain width varies along x
    const widthNoise = simplex2(nx * 2 + bandIdx * 70, time * 0.01) * 0.5 + 0.5;
    const bandWidth = ((0.15 + widthNoise * 0.25) * auroraH) | 0;
    const halfWidth = (bandWidth * 0.5) | 0;

    const centerY = yMin + ((centerFrac * auroraH) | 0);
    const topY = centerY - halfWidth;
    const botY = centerY + halfWidth;

    // Clamp to aurora region
    const drawTop = topY < yMin ? yMin : topY;
    const drawBot = botY > yMin + auroraH ? yMin + auroraH : botY;
    if (drawBot <= drawTop) continue;

    const bandH = drawBot - drawTop;
    let columnPeak = 0;

    for (let y = drawTop; y < drawBot; y++) {
      // Vertical position: 0 = top of band, 1 = bottom edge
      const vFrac = (y - drawTop) / bandH;

      // PILLAR 1: Bottom-edge luminosity weighting
      // Brightness peaks at the bottom edge — pow(vFrac, 0.6) gives gentle ramp
      const edgeBright = Math.pow(vFrac, 0.6);

      // Fine vertical structure: ray-like striations
      const rays = simplex2(x * 0.1 + bandIdx * 40, y * 0.3 + time * 0.02);
      const rayMod = 0.7 + Math.max(0, rays) * 0.6;

      const brightness = edgeBright * rayMod * bandBright;
      if (brightness < 0.01) continue;

      if (brightness > columnPeak) columnPeak = brightness;

      // PILLAR 4: Vertical color gradient
      // Bottom: bright green (oxygen emission ~557.7nm)
      // Top: magenta/violet (nitrogen emission)
      const greenAmt = Math.pow(vFrac, 0.4);
      const magentaAmt = Math.pow(1 - vFrac, 0.8);

      const aR = (magentaAmt * 80 + greenAmt * 15) * brightness;
      const aG = (greenAmt * 140 + magentaAmt * 20) * brightness;
      const aB = (magentaAmt * 100 + greenAmt * 60) * brightness;

      // Additive blend onto sky
      const i = (y * width + x) * 4;
      data[i]     = clamp255(data[i] + aR);
      data[i + 1] = clamp255(data[i + 1] + aG);
      data[i + 2] = clamp255(data[i + 2] + aB);
    }

    // PILLAR 2: Fold concentration — accumulate across bands
    aurora.columnLight[x] += columnPeak * 0.5;

    // Per-column light color for ice tinting (green-dominant at horizon)
    aurora.columnR[x] += columnPeak * 0.1;
    aurora.columnG[x] += columnPeak * 0.6;
    aurora.columnB[x] += columnPeak * 0.3;
  }
}

/**
 * Get aurora light intensity for a given column.
 * Used by glacier.js to tint ice highlights.
 *
 * @param {Aurora} aurora
 * @param {number} x — column index
 * @returns {number} intensity 0→1
 */
export function getAuroraLight(aurora, x) {
  return aurora.columnLight[x];
}

// --- Light shafts ---

// Vertical zone where shafts render (between aurora bottom and glacier top)
const SHAFT_TOP_FRAC = 0.40;    // Just below aurora zone
const SHAFT_BOT_FRAC = 0.70;    // Where glacier body starts
const SHAFT_MAX_INTENSITY = 12;  // Very subtle — discovered, not noticed
const SHAFT_COL_THRESHOLD = 0.3; // Minimum columnLight to produce a shaft

/**
 * Render aurora light shafts — faint god rays between aurora and glacier.
 * Call AFTER renderAurora, BEFORE stars/glacier terrain.
 *
 * @param {Aurora} aurora
 * @param {Uint8ClampedArray} data
 * @param {number} width
 * @param {number} height
 * @param {number} time
 * @param {import('./lightCycle.js').Mood} mood
 */
export function renderLightShafts(aurora, data, width, height, time, mood) {
  const vis = mood.auroraVisibility;
  const effectiveVis = vis * vis * vis; // Cubic — same as aurora
  if (effectiveVis < 0.01) return;

  const shaftTop = (height * SHAFT_TOP_FRAC) | 0;
  const shaftBot = (height * SHAFT_BOT_FRAC) | 0;
  const shaftH = shaftBot - shaftTop;
  if (shaftH <= 0) return;

  for (let x = 0; x < width; x++) {
    const colLight = aurora.columnLight[x];
    if (colLight < SHAFT_COL_THRESHOLD) continue;

    // Noise gate: creates 3-5 visible shafts, slowly drifting
    const gate = simplex2(x * 0.025 + time * 0.008, time * 0.003);
    if (gate < -0.2) continue;

    const colR = aurora.columnR[x];
    const colG = aurora.columnG[x];
    const colB = aurora.columnB[x];
    const shaftStr = (colLight - SHAFT_COL_THRESHOLD) * effectiveVis * SHAFT_MAX_INTENSITY;

    for (let y = shaftTop; y < shaftBot; y++) {
      const vFrac = (y - shaftTop) / shaftH;
      const fade = (1 - vFrac) * (1 - vFrac); // Quadratic falloff
      const intensity = shaftStr * fade;
      if (intensity < 0.5) continue;

      const i = (y * width + x) * 4;
      data[i]     = clamp255(data[i]     + intensity * colR);
      data[i + 1] = clamp255(data[i + 1] + intensity * colG);
      data[i + 2] = clamp255(data[i + 2] + intensity * colB);
    }
  }
}

// --- Util ---

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
