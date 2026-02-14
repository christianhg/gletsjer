/**
 * Ice Calving — rare event: localized block displacement near waterline
 *
 * Architecture:
 *   - Triggered by rareEvents.js scheduler (not self-timed)
 *   - Own pixel manipulation (not through glitch.js — different metaphor)
 *   - Selects a random block on the foreground ice shelf near waterline
 *   - Three phases: crack → fall → splash
 *   - Exposes rippleBoost for water.js (decays after splash)
 *   - Pre-allocated copy buffer — zero GC during effect
 *
 * Three phases (total ~3s, reported to scheduler via getCalvingDuration):
 *   Crack  (0–15% progress): Bright cyan-white line appears at block top
 *   Fall   (15–70% progress): Block displaces downward with gravity ease-in
 *   Splash (70–100% progress): Block fades out, ripple peaks at 2.5× then decays
 *
 * Block: 8-16px wide, 6-12px tall on the foreground ice shelf.
 * Gap fill: 0.4× darkened pixels (exposed glacier interior).
 *
 * Tuning:
 *   BLOCK_W_MIN/MAX     8-16px   Width of calving block
 *   BLOCK_H_MIN/MAX     6-12px   Height of calving block
 *   FALL_DISTANCE        10-18px  How far the block drops
 *   RIPPLE_BOOST_PEAK    2.5      Peak ripple amplitude multiplier
 *   CRACK_BRIGHTNESS     180      Cyan-white crack line intensity
 *   GAP_DARKEN           0.4      Exposed interior darkening factor
 */

// --- Constants ---

/** Block dimensions (pixels) */
const BLOCK_W_MIN = 8;
const BLOCK_W_MAX = 16;
const BLOCK_H_MIN = 6;
const BLOCK_H_MAX = 12;

/** Fall distance range (pixels) */
const FALL_DIST_MIN = 10;
const FALL_DIST_MAX = 18;

/** Phase boundaries (fraction of total progress 0→1) */
const CRACK_END = 0.15;
const FALL_END = 0.70;
// Splash: 0.70 → 1.0

/** Ripple boost */
const RIPPLE_BOOST_PEAK = 2.5;

/** Crack line brightness */
const CRACK_BRIGHTNESS = 180;

/** Gap darkening factor (exposed interior) */
const GAP_DARKEN = 0.4;

/** Calving zone: foreground shelf near waterline */
const CALVE_ZONE_Y_FRAC = 0.72;  // Foreground layer baseHeight
const CALVE_ZONE_RANGE = 10;      // Pixels of vertical variation

/** Total event duration reported to scheduler */
const BASE_DURATION = 3.0;

/**
 * @typedef {Object} CalvingSystem
 * @property {number} blockX - Left edge of calving block
 * @property {number} blockY - Top row of calving block
 * @property {number} blockW - Block width
 * @property {number} blockH - Block height
 * @property {number} fallDist - Total fall distance
 * @property {number} rippleBoost - Current ripple multiplier (1.0 = no boost)
 * @property {boolean} wasActive - Edge detection for event activation
 * @property {Uint8ClampedArray} copyBuf - Pre-allocated buffer for block copy
 * @property {Int8Array} jaggedOffset - Per-column height offset for jagged top edge
 * @property {number} width - Canvas width
 * @property {number} height - Canvas height
 */

/**
 * Create the calving system. Call once at init.
 *
 * @param {number} width
 * @param {number} height
 * @returns {CalvingSystem}
 */
export function createCalving(width, height) {
  // Pre-allocate copy buffer for max possible block
  const bufSize = BLOCK_W_MAX * BLOCK_H_MAX * 4;

  return {
    blockX: 0,
    blockY: 0,
    blockW: 0,
    blockH: 0,
    fallDist: 0,
    rippleBoost: 1.0,
    wasActive: false,
    copyBuf: new Uint8ClampedArray(bufSize),
    jaggedOffset: new Int8Array(BLOCK_W_MAX),
    width,
    height,
  };
}

/**
 * Duration callback for rareEvents.js registration.
 * @returns {number} Total event duration in seconds
 */
export function getCalvingDuration() {
  return BASE_DURATION + Math.random() * 0.5;
}

/**
 * Update calving state based on scheduler event state.
 * Call once per frame.
 *
 * @param {CalvingSystem} calving
 * @param {{ active: boolean, elapsed: number, progress: number }} eventState
 */
export function updateCalving(calving, eventState) {
  const { active, progress } = eventState;

  // Rising edge: event just activated — pick a new block
  if (active && !calving.wasActive) {
    pickCalvingBlock(calving);
  }
  calving.wasActive = active;

  if (!active) {
    calving.rippleBoost = 1.0;
    return;
  }

  // Compute ripple boost based on phase
  if (progress < CRACK_END) {
    // Crack phase: no ripple yet
    calving.rippleBoost = 1.0;
  } else if (progress < FALL_END) {
    // Fall phase: ripple builds as block approaches water
    const fallProgress = (progress - CRACK_END) / (FALL_END - CRACK_END);
    calving.rippleBoost = 1.0 + fallProgress * 1.5;
  } else {
    // Splash phase: ripple peaks then decays
    const splashProgress = (progress - FALL_END) / (1.0 - FALL_END);
    calving.rippleBoost = RIPPLE_BOOST_PEAK * (1.0 - splashProgress * splashProgress);
  }
}

/**
 * Apply calving visual effect to the pixel buffer.
 * Call AFTER glacier terrain rendering, BEFORE water.
 *
 * @param {CalvingSystem} calving
 * @param {Uint8ClampedArray} data - RGBA pixel buffer
 * @param {number} width
 * @param {number} height
 * @param {{ active: boolean, progress: number }} eventState
 */
export function applyCalving(calving, data, width, height, eventState) {
  if (!eventState.active) return;

  const { progress } = eventState;
  const { blockX, blockY, blockW, blockH, fallDist } = calving;

  if (progress < CRACK_END) {
    // --- Phase 1: Crack ---
    // Bright cyan-white line at the top of the calving block (jagged)
    const crackIntensity = (progress / CRACK_END) * CRACK_BRIGHTNESS;

    for (let dx = 0; dx < blockW; dx++) {
      const x = blockX + dx;
      if (x >= width) break;
      const crackY = blockY + calving.jaggedOffset[dx];
      if (crackY < 0 || crackY >= height) continue;
      const i = (crackY * width + x) * 4;
      // Additive cyan-white crack
      data[i]     = clamp255(data[i] + crackIntensity * 0.6);
      data[i + 1] = clamp255(data[i + 1] + crackIntensity * 0.9);
      data[i + 2] = clamp255(data[i + 2] + crackIntensity);
    }
    return;
  }

  if (progress < FALL_END) {
    // --- Phase 2: Fall ---
    // Block displaces downward with gravity (ease-in: progress²)
    const fallProgress = (progress - CRACK_END) / (FALL_END - CRACK_END);
    const eased = fallProgress * fallProgress; // Gravity acceleration
    const disp = (eased * fallDist) | 0;

    if (disp > 0) {
      displaceBlock(calving, data, width, height, disp, 1.0, fallProgress);
    }
    return;
  }

  // --- Phase 3: Splash ---
  // Block at full displacement, fading out
  const splashProgress = (progress - FALL_END) / (1.0 - FALL_END);
  const opacity = 1.0 - splashProgress;

  if (opacity > 0.01) {
    displaceBlock(calving, data, width, height, fallDist, opacity, 1.0);
  }
}

// --- Internal ---

/**
 * Pick a random calving block on the foreground ice shelf.
 * @param {CalvingSystem} calving
 */
function pickCalvingBlock(calving) {
  const { width, height, jaggedOffset } = calving;

  // Block dimensions
  calving.blockW = BLOCK_W_MIN + ((Math.random() * (BLOCK_W_MAX - BLOCK_W_MIN)) | 0);
  calving.blockH = BLOCK_H_MIN + ((Math.random() * (BLOCK_H_MAX - BLOCK_H_MIN)) | 0);

  // Horizontal position: middle 60% of canvas (avoid edges)
  const margin = (width * 0.2) | 0;
  calving.blockX = margin + ((Math.random() * (width - 2 * margin - calving.blockW)) | 0);

  // Vertical position: foreground shelf near waterline
  calving.blockY = ((height * CALVE_ZONE_Y_FRAC) | 0) + ((Math.random() * CALVE_ZONE_RANGE) | 0);

  // Fall distance
  calving.fallDist = FALL_DIST_MIN + ((Math.random() * (FALL_DIST_MAX - FALL_DIST_MIN)) | 0);

  // Jagged top edge: ±1-2px per column, seeded from blockX
  for (let dx = 0; dx < calving.blockW; dx++) {
    jaggedOffset[dx] = (((calving.blockX + dx) * 17 + dx * 31) & 3) - 1; // -1 to +2
  }
}

/**
 * Displace a block of pixels downward and fill the gap.
 * Uses jagged top edge profile and edge crumble during fall.
 *
 * @param {CalvingSystem} calving
 * @param {Uint8ClampedArray} data
 * @param {number} width
 * @param {number} height
 * @param {number} disp - Displacement in pixels
 * @param {number} opacity - Block opacity (1.0 = full, fades during splash)
 * @param {number} fallProgress - 0→1 fall progress (drives edge crumble)
 */
function displaceBlock(calving, data, width, height, disp, opacity, fallProgress) {
  const { blockX, blockY, blockW, blockH, copyBuf, jaggedOffset } = calving;

  // Copy block pixels into pre-allocated buffer (jagged source)
  let bufIdx = 0;
  for (let dy = 0; dy < blockH; dy++) {
    for (let dx = 0; dx < blockW; dx++) {
      const srcY = blockY + jaggedOffset[dx] + dy;
      const x = blockX + dx;
      if (x >= 0 && x < width && srcY >= 0 && srcY < height) {
        const srcIdx = (srcY * width + x) * 4;
        copyBuf[bufIdx]     = data[srcIdx];
        copyBuf[bufIdx + 1] = data[srcIdx + 1];
        copyBuf[bufIdx + 2] = data[srcIdx + 2];
        copyBuf[bufIdx + 3] = 255;
      }
      bufIdx += 4;
    }
  }

  // Write displaced block from buffer (with edge crumble)
  bufIdx = 0;
  for (let dy = 0; dy < blockH; dy++) {
    for (let dx = 0; dx < blockW; dx++) {
      const dstY = blockY + jaggedOffset[dx] + dy + disp;
      const x = blockX + dx;
      if (x >= 0 && x < width && dstY >= 0 && dstY < height) {
        // Edge crumble: skip edge pixels probabilistically as fall progresses
        if (fallProgress > 0) {
          const isEdge = dx === 0 || dx === blockW - 1;
          const isNearEdge = dx === 1 || dx === blockW - 2;
          if (isEdge || isNearEdge) {
            const threshold = isEdge ? fallProgress * 0.7 : fallProgress * 0.3;
            const hash = ((blockX * 17 + dx * 31 + dy * 7) & 0xFF) / 255;
            if (hash < threshold) {
              bufIdx += 4;
              continue;
            }
          }
        }

        const dstIdx = (dstY * width + x) * 4;
        if (opacity >= 0.99) {
          data[dstIdx]     = copyBuf[bufIdx];
          data[dstIdx + 1] = copyBuf[bufIdx + 1];
          data[dstIdx + 2] = copyBuf[bufIdx + 2];
        } else {
          // Blend displaced block with existing pixels (splash fade)
          data[dstIdx]     = (data[dstIdx]     + (copyBuf[bufIdx]     - data[dstIdx])     * opacity) | 0;
          data[dstIdx + 1] = (data[dstIdx + 1] + (copyBuf[bufIdx + 1] - data[dstIdx + 1]) * opacity) | 0;
          data[dstIdx + 2] = (data[dstIdx + 2] + (copyBuf[bufIdx + 2] - data[dstIdx + 2]) * opacity) | 0;
        }
      }
      bufIdx += 4;
    }
  }

  // Fill the gap with darkened pixels (jagged top edge)
  const gapRows = Math.min(disp, blockH);
  for (let dy = 0; dy < gapRows; dy++) {
    for (let dx = 0; dx < blockW; dx++) {
      const gapY = blockY + jaggedOffset[dx] + dy;
      const x = blockX + dx;
      if (x < 0 || x >= width || gapY < 0 || gapY >= height) continue;
      const i = (gapY * width + x) * 4;
      data[i]     = (data[i] * GAP_DARKEN) | 0;
      data[i + 1] = (data[i + 1] * (GAP_DARKEN + 0.1)) | 0;  // Slightly more green
      data[i + 2] = (data[i + 2] * (GAP_DARKEN + 0.2)) | 0;  // Slightly more blue
    }
  }
}

/** @param {number} v */
function clamp255(v) {
  return v > 255 ? 255 : v | 0;
}
