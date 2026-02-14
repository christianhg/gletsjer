/**
 * Water Reflection — fjord water post-processing
 *
 * Reads the rendered glacier pixels and mirrors them into the water zone.
 * Applies mood-dependent darkening, tint, and noise-based ripple distortion.
 *
 * Architecture:
 *   - Runs AFTER glacier rendering, BEFORE snow particles
 *   - Reads glacier pixels above the waterline as source
 *   - Writes transformed pixels into the water zone below
 *   - Processes top-to-bottom so source pixels are never overwritten
 *   - Water tint and floor color shift with light cycle mood
 */

import { simplex2 } from './noise.js';

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

/** Darkening gradient base values (modulated by mood) */
const DARKEN_SURFACE_BASE = 0.65;
const DARKEN_BOTTOM_BASE = 0.25;

/** Surface highlight */
const HIGHLIGHT_ROWS = 2;

/**
 * Render water reflection into the pixel buffer.
 *
 * @param {Uint8ClampedArray} data — RGBA pixel data (already has glacier rendered)
 * @param {number} width
 * @param {number} height
 * @param {number} time — elapsed seconds
 * @param {import('./lightCycle.js').Mood} [mood] — light cycle mood (optional for backwards compat)
 * @param {number} [rippleBoost=1.0] — ripple amplitude multiplier (from calving events)
 */
export function renderWater(data, width, height, time, mood, rippleBoost) {
  const waterlineY = (height * WATERLINE_FRAC) | 0;
  const waterHeight = height - waterlineY;

  if (waterHeight <= 0) return;

  // Mood-driven tint (fall back to cold blue defaults if no mood)
  const tintR = mood ? mood.waterTint[0] : 0.18;
  const tintG = mood ? mood.waterTint[1] : 0.38;
  const tintB = mood ? mood.waterTint[2] : 0.78;
  const floorR = mood ? mood.waterFloorR : 8;
  const floorG = mood ? mood.waterFloorG : 12;
  const floorB = mood ? mood.waterFloorB : 28;

  // Darken more at night
  const darkMod = mood ? (1.0 - mood.ambientBrightness * 0.3) : 1.0;
  const darkenSurface = DARKEN_SURFACE_BASE * darkMod;
  const darkenBottom = DARKEN_BOTTOM_BASE * darkMod;

  for (let wy = 0; wy < waterHeight; wy++) {
    const depthFrac = wy / waterHeight;
    const mirrorY = waterlineY - 1 - ((wy * COMPRESSION) | 0);
    const clampedMirrorY = mirrorY < 0 ? 0 : mirrorY > waterlineY - 1 ? waterlineY - 1 : mirrorY;
    const boost = rippleBoost || 1.0;
    const rippleAmp = (RIPPLE_BASE_AMP + wy * RIPPLE_DEPTH_AMP) * boost;
    const darken = darkenSurface - depthFrac * (darkenSurface - darkenBottom);
    const dstY = waterlineY + wy;

    for (let x = 0; x < width; x++) {
      const displaceX = simplex2(
        x * RIPPLE_FREQ_X,
        dstY * RIPPLE_FREQ_Y + time * RIPPLE_SPEED
      ) * rippleAmp;

      const displaceY = simplex2(
        x * RIPPLE_FREQ_X + 137.5,
        dstY * RIPPLE_FREQ_Y * 0.5 + time * RIPPLE_SPEED * 0.7
      ) * rippleAmp * 0.3;

      let srcX = (x + displaceX) | 0;
      let srcY = (clampedMirrorY + displaceY) | 0;

      if (srcX < 0) srcX = 0;
      if (srcX >= width) srcX = width - 1;
      if (srcY < 0) srcY = 0;
      if (srcY >= waterlineY) srcY = waterlineY - 1;

      const srcIdx = (srcY * width + srcX) * 4;
      const r = data[srcIdx];
      const g = data[srcIdx + 1];
      const b = data[srcIdx + 2];

      let waterR = (r * darken * tintR + floorR) | 0;
      let waterG = (g * darken * tintG + floorG) | 0;
      let waterB = (b * darken * tintB + floorB) | 0;

      // Surface highlight — dims with mood so night waterline isn't a bright line
      if (wy < HIGHLIGHT_ROWS) {
        const hlStrength = (HIGHLIGHT_ROWS - wy) / HIGHLIGHT_ROWS;
        const ambientHL = mood ? mood.ambientBrightness : 1.0;
        const hl = (hlStrength * 35 * ambientHL) | 0;
        waterR = (waterR + hl) | 0;
        waterG = (waterG + hl + 8) | 0;
        waterB = (waterB + hl + 18) | 0;
      }

      // Subtle shimmer
      if (depthFrac < 0.3) {
        const shimmer = simplex2(x * 0.2 + time * 0.15, dstY * 0.2 + time * 0.09);
        if (shimmer > 0.72) {
          const shimmerBoost = ((shimmer - 0.72) * 60) | 0;
          waterG = (waterG + shimmerBoost) | 0;
          waterB = (waterB + shimmerBoost) | 0;
        }
      }

      const dstIdx = (dstY * width + x) * 4;
      data[dstIdx]     = waterR > 255 ? 255 : waterR;
      data[dstIdx + 1] = waterG > 255 ? 255 : waterG;
      data[dstIdx + 2] = waterB > 255 ? 255 : waterB;
      data[dstIdx + 3] = 255;
    }
  }
}
