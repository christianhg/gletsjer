/**
 * Glitch Effects System
 *
 * Post-processing effects that create intermittent data-corruption aesthetics.
 * Glitches are rare, brief events — punctuation, not noise.
 *
 * Architecture:
 *   - GlitchController manages timing: cooldown (3-10s) → burst (100-500ms)
 *   - During a burst, 1-3 effects are randomly combined
 *   - Effects operate on the pixel buffer using a pre-allocated copy
 *   - Intensity ramps up at burst start, cuts sharply at end
 *
 * Effects:
 *   1. RGB channel split — horizontal offset of R and B channels
 *   2. Scanlines — darken alternating rows with noise variation
 *   3. Block displacement — shift random horizontal slices
 */

import { simplex2 } from './noise.js';

/**
 * @typedef {Object} GlitchController
 * @property {boolean} active — currently in a glitch burst
 * @property {number} timer — countdown to next state change (seconds)
 * @property {number} intensity — current burst intensity (0-1)
 * @property {number} burstDuration — total duration of current burst
 * @property {number} burstElapsed — time elapsed in current burst
 * @property {number} seed — per-burst seed for deterministic effect selection
 * @property {Uint8ClampedArray} copy — pre-allocated pixel copy buffer
 */

/**
 * Create the glitch controller. Call once at init.
 *
 * @param {number} width — buffer width
 * @param {number} height — buffer height
 * @returns {GlitchController}
 */
export function createGlitch(width, height) {
  return {
    active: false,
    timer: 3 + Math.random() * 5, // Initial cooldown: 3-8s
    intensity: 0,
    burstDuration: 0,
    burstElapsed: 0,
    seed: 0,
    // Pre-allocated copy buffer for effects that read source pixels
    copy: new Uint8ClampedArray(width * height * 4),
    // Dead pixel: one stuck pixel after data bleed, persists 30s
    deadPixel: null,
  };
}

/**
 * Update the glitch controller timing.
 *
 * @param {GlitchController} glitch
 * @param {number} dt — delta seconds
 */
export function updateGlitch(glitch, dt) {
  glitch.timer -= dt;

  if (glitch.active) {
    glitch.burstElapsed += dt;

    // Intensity envelope: quick ramp up (20% of duration), sustain, sharp cut
    const progress = glitch.burstElapsed / glitch.burstDuration;
    const rampUp = Math.min(1, progress / 0.2); // 0→1 over first 20%
    glitch.intensity = rampUp * (0.3 + glitch.seed * 0.7);

    if (glitch.timer <= 0) {
      // Burst ended — enter cooldown
      glitch.active = false;
      glitch.intensity = 0;
      glitch.timer = 3 + seededRandom(glitch.seed + 1) * 7; // 3-10s cooldown
    }
  } else {
    if (glitch.timer <= 0) {
      // Cooldown ended — start burst
      glitch.active = true;
      glitch.seed = Math.random();
      glitch.burstDuration = 0.1 + Math.random() * 0.4; // 100-500ms
      glitch.burstElapsed = 0;
      glitch.timer = glitch.burstDuration;
    }
  }
}

/**
 * Apply glitch effects to the pixel buffer (if active).
 *
 * @param {GlitchController} glitch
 * @param {Uint8ClampedArray} data — RGBA pixel data
 * @param {number} width
 * @param {number} height
 * @param {import('./lightCycle.js').Mood} [mood] — light cycle mood (optional)
 */
export function applyGlitch(glitch, data, width, height, mood) {
  if (!glitch.active) return;

  const { intensity, seed, copy } = glitch;

  // Snapshot current pixels for effects that need to read source
  copy.set(data);

  // Mood-shifted effect selection:
  // 'chromatic' (warm phases) → favor RGB split, less block displacement
  // 'corruption' (night) → favor block displacement, less RGB split
  const character = mood ? mood.glitchCharacter : 'mixed';
  const rgbThreshold = character === 'chromatic' ? 0.85 : character === 'corruption' ? 0.55 : 0.7;
  const blockThreshold = character === 'corruption' ? 0.35 : character === 'chromatic' ? 0.65 : 0.5;

  if (seed < rgbThreshold) rgbSplit(data, copy, width, height, intensity);
  if (seed > 0.3 && seed < 0.8) scanlines(data, width, height, intensity);
  if (seed > blockThreshold) blockDisplace(data, copy, width, height, intensity, seed);
}

// --- Effects ---

/**
 * RGB channel split — offset R and B channels horizontally.
 * Creates chromatic aberration / data corruption look.
 */
function rgbSplit(data, copy, width, height, intensity) {
  // Offset scales with intensity: 2-5px
  const offset = ((2 + intensity * 3) | 0) || 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dstIdx = (y * width + x) * 4;

      // Red channel: shift right
      const srcRX = Math.min(width - 1, Math.max(0, x + offset));
      const srcRIdx = (y * width + srcRX) * 4;
      data[dstIdx] = copy[srcRIdx]; // R from shifted position

      // Green channel: stays in place (already correct)
      // data[dstIdx + 1] = copy[dstIdx + 1];

      // Blue channel: shift left
      const srcBX = Math.min(width - 1, Math.max(0, x - offset));
      const srcBIdx = (y * width + srcBX) * 4;
      data[dstIdx + 2] = copy[srcBIdx + 2]; // B from shifted position
    }
  }
}

/**
 * Scanlines — darken alternating rows.
 * Simulates CRT display artifacts.
 */
function scanlines(data, width, height, intensity) {
  // Darkness: 0.5-0.8 multiplier (stronger at higher intensity)
  const baseDarkness = 0.8 - intensity * 0.3;

  for (let y = 0; y < height; y += 2) {
    // Vary darkness per line for organic feel
    const lineDarkness = baseDarkness + simplex2(y * 0.5, intensity * 10) * 0.08;

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      data[idx]     = (data[idx]     * lineDarkness) | 0;
      data[idx + 1] = (data[idx + 1] * lineDarkness) | 0;
      data[idx + 2] = (data[idx + 2] * lineDarkness) | 0;
    }
  }
}

/**
 * Block displacement — shift random horizontal slices.
 * The classic "data corruption" glitch look.
 */
function blockDisplace(data, copy, width, height, intensity, seed) {
  // Number of displaced slices: 2-8 based on intensity
  const numSlices = (2 + intensity * 6) | 0;

  for (let s = 0; s < numSlices; s++) {
    // Deterministic slice positioning from seed
    const sliceSeed = seededRandom(seed * 1000 + s * 7.3);
    const sliceSeed2 = seededRandom(seed * 1000 + s * 13.7);
    const sliceSeed3 = seededRandom(seed * 1000 + s * 23.1);

    const sliceY = (sliceSeed * height) | 0;
    const sliceH = (2 + sliceSeed2 * 8) | 0; // 2-10px tall
    const offset = ((sliceSeed3 - 0.5) * width * intensity * 0.3) | 0;

    if (offset === 0) continue;

    for (let y = sliceY; y < Math.min(height, sliceY + sliceH); y++) {
      for (let x = 0; x < width; x++) {
        const srcX = Math.min(width - 1, Math.max(0, x + offset));
        const dstIdx = (y * width + x) * 4;
        const srcIdx = (y * width + srcX) * 4;

        data[dstIdx]     = copy[srcIdx];
        data[dstIdx + 1] = copy[srcIdx + 1];
        data[dstIdx + 2] = copy[srcIdx + 2];
      }
    }
  }
}

// --- Data Bleed ---
// The glacier's DNA — its own thermal inertia function, as source bytes.
// During deep glitch inversion, the glacier bleeds its own physics as pixels.
const DNA = 'function lagPhase(current,target,dt,τ){let delta=target-current;if(delta>0.5)delta-=1;if(delta<-0.5)delta+=1;return((current+delta*(dt/τ))%1+1)%1}';
// Doomsday DNA: the normal palette's coldest values — colors the glacier can't be today
const DNA_DOOMSDAY = 'skyTop:[10,10,26],skyBottom:[35,42,82],fogColor:[30,35,60],snowTint:[0.55,0.60,0.75],waterDeep:[4,7,16]';

/**
 * Overwrite a small pixel patch with source code bytes as RGB values.
 * Called after invertFrame during deep glitch inversion (progress 0.10-0.15).
 * The patch sits un-inverted on the inverted frame — a window into the source.
 *
 * @param {Uint8ClampedArray} data — RGBA pixel buffer
 * @param {number} width
 * @param {number} height
 * @param {number} seed — glitch seed for deterministic positioning
 * @param {GlitchController} glitch — state object (captures dead pixel)
 * @param {boolean} [doomsday] — use doomsday DNA source (palette definitions)
 */
export function applyDataBleed(data, width, height, seed, glitch, doomsday) {
  const source = doomsday ? DNA_DOOMSDAY : DNA;
  const patchW = 4 + ((seededRandom(seed * 31.7) * 7) | 0);   // 4-10px
  const patchH = 1 + ((seededRandom(seed * 47.3) * 3) | 0);   // 1-3px
  const px = (seededRandom(seed * 71.1) * (width - patchW)) | 0;
  const py = (seededRandom(seed * 89.3) * (height - patchH)) | 0;
  const byteStart = (seededRandom(seed * 113.7) * source.length) | 0;

  // Pick one random pixel from the patch for dead pixel residue
  const dpX = px + ((seededRandom(seed * 137.9) * patchW) | 0);
  const dpY = py + ((seededRandom(seed * 151.3) * patchH) | 0);

  let bi = byteStart;
  for (let y = py; y < py + patchH; y++) {
    for (let x = px; x < px + patchW; x++) {
      const idx = (y * width + x) * 4;
      data[idx]     = source.charCodeAt(bi % source.length);       // R
      data[idx + 1] = source.charCodeAt((bi + 1) % source.length); // G
      data[idx + 2] = source.charCodeAt((bi + 2) % source.length); // B
      // Alpha stays 255
      // Capture dead pixel color when we hit the chosen coordinate
      if (x === dpX && y === dpY) {
        glitch.deadPixel = { x: dpX, y: dpY, r: data[idx], g: data[idx + 1], b: data[idx + 2], birth: performance.now() };
      }
      bi += 3;
    }
  }
}

// --- Util ---

/**
 * Simple seeded pseudo-random. Returns 0-1.
 * Deterministic for same input — gives consistent glitch patterns per burst.
 */
function seededRandom(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
