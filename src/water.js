/**
 * Water Reflection — fjord water post-processing
 *
 * Reads the rendered glacier pixels and mirrors them into the water zone
 * at the bottom of the canvas. Applies darkening, blue tint, and
 * noise-based ripple distortion for a calm fjord look.
 *
 * Architecture:
 *   - Runs AFTER glacier rendering, BEFORE snow particles
 *   - Reads glacier pixels above the waterline as source
 *   - Writes transformed pixels into the water zone below
 *   - No extra buffers needed — reads and writes the same ImageData
 *   - Processes top-to-bottom so source pixels are never overwritten
 *     before being read (waterline is always below glacier source area)
 */

import { simplex2 } from './noise.js';
import * as palette from './palette.js';

/** Water zone starts at this fraction of canvas height */
const WATERLINE_FRAC = 0.78;

/** Vertical compression — perspective foreshortening */
const COMPRESSION = 0.85;

/** Ripple noise parameters */
const RIPPLE_FREQ_X = 0.08;
const RIPPLE_FREQ_Y = 0.15;
const RIPPLE_SPEED = 0.4;
const RIPPLE_BASE_AMP = 1.2;
const RIPPLE_DEPTH_AMP = 0.04;

/** Darkening gradient: surface → bottom */
const DARKEN_SURFACE = 0.65;
const DARKEN_BOTTOM = 0.25;

/** Blue tint — how much each channel is preserved (rest shifts to water color) */
const TINT_R = 0.18;
const TINT_G = 0.38;
const TINT_B = 0.78;

/** Base water color floor (prevents pure black) */
const WATER_FLOOR_R = 8;
const WATER_FLOOR_G = 12;
const WATER_FLOOR_B = 28;

/** Surface highlight */
const HIGHLIGHT_ROWS = 2;

/**
 * Render water reflection into the pixel buffer.
 *
 * @param {Uint8ClampedArray} data — RGBA pixel data (already has glacier rendered)
 * @param {number} width — buffer width
 * @param {number} height — buffer height
 * @param {number} time — elapsed seconds
 */
export function renderWater(data, width, height, time) {
  const waterlineY = (height * WATERLINE_FRAC) | 0;
  const waterHeight = height - waterlineY;

  if (waterHeight <= 0) return;

  for (let wy = 0; wy < waterHeight; wy++) {
    // Depth below waterline: 0 at surface, 1 at bottom
    const depthFrac = wy / waterHeight;

    // Vertical mirror with compression (perspective foreshortening)
    const mirrorY = waterlineY - 1 - ((wy * COMPRESSION) | 0);
    const clampedMirrorY = mirrorY < 0 ? 0 : mirrorY > waterlineY - 1 ? waterlineY - 1 : mirrorY;

    // Ripple amplitude increases with depth
    const rippleAmp = RIPPLE_BASE_AMP + wy * RIPPLE_DEPTH_AMP;

    // Darkening factor: fades from surface to bottom
    const darken = DARKEN_SURFACE - depthFrac * (DARKEN_SURFACE - DARKEN_BOTTOM);

    // Destination Y
    const dstY = waterlineY + wy;

    for (let x = 0; x < width; x++) {
      // --- Ripple distortion: noise-displaced source coordinates ---
      const displaceX = simplex2(
        x * RIPPLE_FREQ_X,
        (dstY) * RIPPLE_FREQ_Y + time * RIPPLE_SPEED
      ) * rippleAmp;

      const displaceY = simplex2(
        x * RIPPLE_FREQ_X + 137.5,
        (dstY) * RIPPLE_FREQ_Y * 0.5 + time * RIPPLE_SPEED * 0.7
      ) * rippleAmp * 0.3;

      // Source coordinates with ripple offset
      let srcX = (x + displaceX) | 0;
      let srcY = (clampedMirrorY + displaceY) | 0;

      // Clamp to valid glacier area
      if (srcX < 0) srcX = 0;
      if (srcX >= width) srcX = width - 1;
      if (srcY < 0) srcY = 0;
      if (srcY >= waterlineY) srcY = waterlineY - 1;

      // Read source pixel from glacier
      const srcIdx = (srcY * width + srcX) * 4;
      const r = data[srcIdx];
      const g = data[srcIdx + 1];
      const b = data[srcIdx + 2];

      // Apply darkening + blue tint
      let waterR = (r * darken * TINT_R + WATER_FLOOR_R) | 0;
      let waterG = (g * darken * TINT_G + WATER_FLOOR_G) | 0;
      let waterB = (b * darken * TINT_B + WATER_FLOOR_B) | 0;

      // Surface highlight: bright line at waterline
      if (wy < HIGHLIGHT_ROWS) {
        const hlStrength = (HIGHLIGHT_ROWS - wy) / HIGHLIGHT_ROWS;
        const hl = (hlStrength * 35) | 0;
        waterR = waterR + hl | 0;
        waterG = waterG + hl + 8 | 0;
        waterB = waterB + hl + 18 | 0;
      }

      // Subtle shimmer on water surface — sparse bright points
      if (depthFrac < 0.3) {
        const shimmer = simplex2(x * 0.2 + time * 0.15, dstY * 0.2 + time * 0.09);
        if (shimmer > 0.72) {
          const shimmerBoost = ((shimmer - 0.72) * 60) | 0;
          waterG = waterG + shimmerBoost | 0;
          waterB = waterB + shimmerBoost | 0;
        }
      }

      // Write water pixel
      const dstIdx = (dstY * width + x) * 4;
      data[dstIdx]     = waterR > 255 ? 255 : waterR;
      data[dstIdx + 1] = waterG > 255 ? 255 : waterG;
      data[dstIdx + 2] = waterB > 255 ? 255 : waterB;
      data[dstIdx + 3] = 255;
    }
  }
}
