/**
 * Water Reflection — fjord water post-processing
 *
 * Full-depth reflection with mood-driven tint, darkening, and ripple
 * distortion. Every water pixel is a transformed glacier pixel, tinted
 * toward waterDeep at depth. Flat waterline at 78%.
 *
 * Sprint 16 capabilities retained: aurora on water, fog response,
 * surface current, noise-modulated highlight, deep color tint.
 *
 * Architecture:
 *   - Runs AFTER glacier rendering, BEFORE snow particles
 *   - Reads glacier pixels above the waterline as source
 *   - Processes top-to-bottom so source pixels are never overwritten
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

/** Aurora rows affected on water surface */
const AURORA_WATER_ROWS = 8;

/** Surface highlight */
const HIGHLIGHT_ROWS = 2;

/** Surface current — slow horizontal drift */
const CURRENT_SPEED = 0.006;
const CURRENT_DEPTH_SCALE = 0.3;

/** Deep tint blend — how much waterDeep colors show at maximum depth */
const DEEP_TINT_STRENGTH = 0.3;

/**
 * Render water into the pixel buffer.
 *
 * @param {Uint8ClampedArray} data — RGBA pixel data (already has glacier rendered)
 * @param {number} width
 * @param {number} height
 * @param {number} time — elapsed seconds
 * @param {import('./lightCycle.js').Mood} mood — light cycle mood
 * @param {number} rippleBoost — ripple amplitude multiplier (from calving events)
 * @param {import('./aurora.js').Aurora} aurora — aurora column light data
 */
export function renderWater(data, width, height, time, mood, rippleBoost, aurora) {
  const waterlineY = (height * WATERLINE_FRAC) | 0;
  const waterHeight = height - waterlineY;

  if (waterHeight <= 0) return;

  const boost = rippleBoost || 1.0;

  // Mood-driven tint
  const tintR = mood.waterTint[0];
  const tintG = mood.waterTint[1];
  const tintB = mood.waterTint[2];
  const floorR = mood.waterFloorR;
  const floorG = mood.waterFloorG;
  const floorB = mood.waterFloorB;

  // Water's own deep color
  const deepR = mood.waterDeep[0];
  const deepG = mood.waterDeep[1];
  const deepB = mood.waterDeep[2];

  // Darken more at night
  const darkMod = 1.0 - mood.ambientBrightness * 0.3;
  const darkenSurface = DARKEN_SURFACE_BASE * darkMod;
  const darkenBottom = DARKEN_BOTTOM_BASE * darkMod;

  // Fog response — haze the water when fog crosses
  const fogFrontX = mood.fogFrontX || -1;
  const fogFrontDir = mood.fogFrontDir || 1;
  const fogFrontIntensity = mood.fogFrontIntensity || 0;

  // Surface current offset — slow horizontal drift
  const currentOffset = time * CURRENT_SPEED;

  for (let wy = 0; wy < waterHeight; wy++) {
    const depthFrac = wy / waterHeight;

    // Vertical mirror with compression
    const mirrorY = waterlineY - 1 - ((wy * COMPRESSION) | 0);
    const clampedMirrorY = mirrorY < 0 ? 0 : mirrorY > waterlineY - 1 ? waterlineY - 1 : mirrorY;

    // Ripple amplitude increases with depth
    const rippleAmp = (RIPPLE_BASE_AMP + wy * RIPPLE_DEPTH_AMP) * boost;

    // Darkening factor: fades from surface to bottom
    const darken = darkenSurface - depthFrac * (darkenSurface - darkenBottom);

    // Deep tint blend factor: 0 at surface, DEEP_TINT_STRENGTH at bottom
    const deepBlend = depthFrac * DEEP_TINT_STRENGTH;

    // Surface current: horizontal drift increases with depth
    const currentDisplace = currentOffset * (1.0 + depthFrac * CURRENT_DEPTH_SCALE);

    const dstY = waterlineY + wy;

    for (let x = 0; x < width; x++) {
      // --- Ripple distortion ---
      const displaceX = simplex2(
        (x + currentDisplace) * RIPPLE_FREQ_X,
        dstY * RIPPLE_FREQ_Y + time * RIPPLE_SPEED
      ) * rippleAmp;

      const displaceY = simplex2(
        (x + currentDisplace) * RIPPLE_FREQ_X + 137.5,
        dstY * RIPPLE_FREQ_Y * 0.5 + time * RIPPLE_SPEED * 0.7
      ) * rippleAmp * 0.3;

      let srcX = (x + displaceX) | 0;
      let srcY = (clampedMirrorY + displaceY) | 0;

      if (srcX < 0) srcX = 0;
      if (srcX >= width) srcX = width - 1;
      if (srcY < 0) srcY = 0;
      if (srcY >= waterlineY) srcY = waterlineY - 1;

      // Read source pixel from glacier
      const srcIdx = (srcY * width + srcX) * 4;
      const r = data[srcIdx];
      const g = data[srcIdx + 1];
      const b = data[srcIdx + 2];

      // Reflected color: darken + tint + floor
      const reflR = r * darken * tintR + floorR;
      const reflG = g * darken * tintG + floorG;
      const reflB = b * darken * tintB + floorB;

      // Blend reflection toward waterDeep at depth
      let waterR = reflR * (1 - deepBlend) + deepR * deepBlend;
      let waterG = reflG * (1 - deepBlend) + deepG * deepBlend;
      let waterB = reflB * (1 - deepBlend) + deepB * deepBlend;

      // --- Surface highlight (noise-modulated, blue-green bias) ---
      if (wy < HIGHLIGHT_ROWS) {
        const hlStrength = (HIGHLIGHT_ROWS - wy) / HIGHLIGHT_ROWS;
        const surfNoise = simplex2(x * 0.08 + time * 0.12, time * 0.05);
        const surfMod = surfNoise * 0.35 + 0.65;
        const hl = hlStrength * 28 * Math.max(0.20, mood.ambientBrightness) * surfMod;
        waterR += hl * 0.7;
        waterG += hl + 5;
        waterB += hl + 12;
      }

      // --- Shimmer: sparse bright points in top 30% ---
      if (depthFrac < 0.3) {
        const shimmer = simplex2(x * 0.2 + time * 0.15, dstY * 0.2 + time * 0.09);
        if (shimmer > 0.72) {
          const shimmerBoost = (shimmer - 0.72) * 60;
          waterG += shimmerBoost;
          waterB += shimmerBoost;
        }
      }

      // --- Aurora on water surface (top rows, attenuated vs ice) ---
      if (aurora && wy < AURORA_WATER_ROWS && aurora.columnLight[x] > 0.005) {
        const auroraFade = 1.0 - (wy / AURORA_WATER_ROWS);
        const aStr = aurora.columnLight[x] * auroraFade * 15;
        waterR += aStr * aurora.columnR[x];
        waterG += aStr * aurora.columnG[x];
        waterB += aStr * aurora.columnB[x];
      }

      // --- Fog response ---
      if (fogFrontX >= -0.3 && fogFrontX <= 1.3) {
        const xFrac = x / width;
        const edgeDist = (xFrac - fogFrontX) * fogFrontDir;
        const edgeWidth = 0.12;
        const t = edgeDist / edgeWidth;
        const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
        const fogStr = clamped * clamped * (3 - 2 * clamped) * fogFrontIntensity * 0.2 * (1.0 - depthFrac * 0.5);
        if (fogStr > 0.001) {
          waterR += (mood.fogColor[0] - waterR) * fogStr;
          waterG += (mood.fogColor[1] - waterG) * fogStr;
          waterB += (mood.fogColor[2] - waterB) * fogStr;
        }
      }

      // --- Write pixel ---
      const dstIdx = (dstY * width + x) * 4;
      data[dstIdx]     = waterR > 255 ? 255 : waterR < 0 ? 0 : waterR | 0;
      data[dstIdx + 1] = waterG > 255 ? 255 : waterG < 0 ? 0 : waterG | 0;
      data[dstIdx + 2] = waterB > 255 ? 255 : waterB < 0 ? 0 : waterB | 0;
      data[dstIdx + 3] = 255;
    }
  }
}
