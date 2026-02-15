/**
 * Water Reflection — fjord water as a body of water, not a mirror
 *
 * Two blended systems:
 *   1. Reflection — existing mirror logic, attenuated by power curve (1-d)^1.5
 *   2. Own-color — waterDeep mood field, rises as reflection fades
 *
 * The "deep zone" emerges naturally from the power curve — reflection drops
 * faster than own-color rises. No explicit third layer needed.
 *
 * Architecture:
 *   - Runs AFTER glacier rendering, BEFORE snow particles
 *   - Per-column waterline from foreground layer heights (geological contour)
 *   - Reads aurora.columnLight for surface tinting (attenuated vs ice)
 *   - Processes top-to-bottom so source pixels are never overwritten
 */

import { simplex2 } from './noise.js';

/** Vertical compression — perspective foreshortening */
const COMPRESSION = 0.85;

/** Ripple noise parameters */
const RIPPLE_FREQ_X = 0.08;
const RIPPLE_FREQ_Y = 0.15;
const RIPPLE_SPEED = 0.4;
const RIPPLE_BASE_AMP = 1.2;
const RIPPLE_DEPTH_AMP = 0.04;

/** Reflection power curve exponent — higher = faster fade */
const REFL_POWER = 1.8;

/** Aurora attenuation on water vs ice (water absorbs more) */
const AURORA_WATER_ATTEN = 0.35;
const AURORA_WATER_ROWS = 8;

/** Surface highlight */
const HIGHLIGHT_ROWS = 2;

/** Surface current — slow horizontal drift */
const CURRENT_SPEED = 0.006;
const CURRENT_DEPTH_SCALE = 0.3;

/** Waterline offset below terrain surface (fraction of canvas height) */
const WATERLINE_OFFSET = 0.06;

/** Waterline noise — ±1px geological drift */
const WATERLINE_NOISE_FREQ = 0.04;
const WATERLINE_NOISE_SPEED = 0.008;

/** Depth texture — slow breathing, not waves */
const DEPTH_TEXTURE_FREQ = 0.06;
const DEPTH_TEXTURE_SPEED = 0.02;
const DEPTH_TEXTURE_AMP = 8;

/** Foreground layer index and drift speed (must match glacier.js LAYER_DEFS[4]) */
const FG_LAYER_IDX = 4;
const FG_DRIFT_SPEED = 0.02;

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
 * @param {import('./glacier.js').GlacierLayer[]} glacierLayers — terrain layer data
 */
export function renderWater(data, width, height, time, mood, rippleBoost, aurora, glacierLayers) {
  const fgLayer = glacierLayers[FG_LAYER_IDX];
  const fgHeights = fgLayer.heights;
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
  const darkenSurface = 0.65 * darkMod;
  const darkenBottom = 0.25 * darkMod;

  // Fog response — haze the water when fog crosses
  const fogFrontX = mood.fogFrontX || -1;
  const fogFrontDir = mood.fogFrontDir || 1;
  const fogFrontIntensity = mood.fogFrontIntensity || 0;

  // Parallax offset for foreground layer (same formula as glacier.js)
  const fgDrift = time * FG_DRIFT_SPEED;
  const parallaxOffset = (fgDrift * 8) | 0;

  // Surface current offset — slow horizontal drift
  const currentOffset = time * CURRENT_SPEED;

  for (let x = 0; x < width; x++) {
    // Per-column waterline from foreground terrain contour
    const srcX = ((x + parallaxOffset) % width + width) % width;
    const terrainHeight = fgHeights[srcX];
    // Waterline sits below terrain surface, following its contour
    // Waterline noise: ±1px geological drift on top of terrain shape
    const wlNoise = simplex2(x * WATERLINE_NOISE_FREQ, time * WATERLINE_NOISE_SPEED) * 1.5;
    const waterlineY = (((terrainHeight + WATERLINE_OFFSET) * height) + wlNoise) | 0;
    const waterHeight = height - waterlineY;

    if (waterHeight <= 0) continue;

    // Aurora light for this column (attenuated for water)
    let auroraLight = 0, auroraR = 0, auroraG = 0, auroraB = 0;
    if (aurora && aurora.columnLight[x] > 0.005) {
      auroraLight = aurora.columnLight[x] * AURORA_WATER_ATTEN;
      auroraR = aurora.columnR[x];
      auroraG = aurora.columnG[x];
      auroraB = aurora.columnB[x];
    }

    // Fog front: per-column fog boost (smoothstep edge)
    let fogBoost = 0;
    if (fogFrontX >= -0.3 && fogFrontX <= 1.3) {
      const xFrac = x / width;
      const edgeDist = (xFrac - fogFrontX) * fogFrontDir;
      const edgeWidth = 0.12;
      const t = edgeDist / edgeWidth;
      const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
      fogBoost = clamped * clamped * (3 - 2 * clamped) * fogFrontIntensity * 0.2;
    }

    for (let wy = 0; wy < waterHeight; wy++) {
      const depthFrac = wy / waterHeight;
      const dstY = waterlineY + wy;

      // --- Reflection strength: power curve fade (drift's formula) ---
      // Reflection clings to surface, gone by 50% depth. Clean break.
      const reflStr = Math.max(0, 1.0 - Math.pow(depthFrac * 2, REFL_POWER));

      // --- Own-color: gradient from waterFloor (surface) → waterDeep (bottom) ---
      // Horizontal banding texture (blue-green biased, the water breathes)
      const bandStrength = depthFrac > 0.15 ? (depthFrac - 0.15) * 4 : 0;
      const bandNoise = bandStrength > 0 ? simplex2(
        x * 0.03 + time * 0.008,
        wy * 0.15
      ) * bandStrength * 2.5 : 0;
      const ownR = floorR + (deepR - floorR) * depthFrac + bandNoise * 0.5;
      const ownG = floorG + (deepG - floorG) * depthFrac + bandNoise * 0.8;
      const ownB = floorB + (deepB - floorB) * depthFrac + bandNoise;

      let waterR, waterG, waterB;

      if (reflStr > 0.01) {
        // --- Reflection zone: mirror + ripple + blend ---
        const mirrorY = waterlineY - 1 - ((wy * COMPRESSION) | 0);
        const clampedMirrorY = mirrorY < 0 ? 0 : mirrorY > waterlineY - 1 ? waterlineY - 1 : mirrorY;

        // Surface current: horizontal drift increases with depth
        const currentDisplace = currentOffset * (1.0 + depthFrac * CURRENT_DEPTH_SCALE);

        const rippleAmp = (RIPPLE_BASE_AMP + wy * RIPPLE_DEPTH_AMP) * boost;

        const displaceX = simplex2(
          (x + currentDisplace) * RIPPLE_FREQ_X,
          dstY * RIPPLE_FREQ_Y + time * RIPPLE_SPEED
        ) * rippleAmp;

        const displaceY = simplex2(
          (x + currentDisplace) * RIPPLE_FREQ_X + 137.5,
          dstY * RIPPLE_FREQ_Y * 0.5 + time * RIPPLE_SPEED * 0.7
        ) * rippleAmp * 0.3;

        let reflSrcX = (x + displaceX) | 0;
        let reflSrcY = (clampedMirrorY + displaceY) | 0;

        if (reflSrcX < 0) reflSrcX = 0;
        if (reflSrcX >= width) reflSrcX = width - 1;
        if (reflSrcY < 0) reflSrcY = 0;
        if (reflSrcY >= waterlineY) reflSrcY = waterlineY - 1;

        const srcIdx = (reflSrcY * width + reflSrcX) * 4;
        const sr = data[srcIdx];
        const sg = data[srcIdx + 1];
        const sb = data[srcIdx + 2];

        // Darken gradient for reflection
        const darken = darkenSurface - depthFrac * (darkenSurface - darkenBottom);

        // Reflected color (tinted + darkened)
        const reflR = sr * darken * tintR + floorR;
        const reflG = sg * darken * tintG + floorG;
        const reflB = sb * darken * tintB + floorB;

        // Blend: reflection × reflStr + own-color × (1 - reflStr)
        waterR = reflR * reflStr + ownR * (1 - reflStr);
        waterG = reflG * reflStr + ownG * (1 - reflStr);
        waterB = reflB * reflStr + ownB * (1 - reflStr);
      } else {
        // --- Own-color zone: skip reflection entirely (perf win) ---
        waterR = ownR;
        waterG = ownG;
        waterB = ownB;
      }

      // --- Surface highlight (noise-modulated, blue-green bias) ---
      if (wy < HIGHLIGHT_ROWS) {
        const hlStrength = (HIGHLIGHT_ROWS - wy) / HIGHLIGHT_ROWS;
        const surfNoise = simplex2(x * 0.08 + time * 0.12, time * 0.05);
        const surfMod = surfNoise * 0.35 + 0.65;
        const hl = hlStrength * 28 * mood.ambientBrightness * surfMod;
        waterR += hl * 0.7;
        waterG += hl + 5;
        waterB += hl + 12;
      }

      // --- Aurora on water surface (top rows, attenuated vs ice) ---
      if (auroraLight > 0 && wy < AURORA_WATER_ROWS) {
        const auroraFade = 1.0 - (wy / AURORA_WATER_ROWS);
        const aStr = auroraLight * auroraFade * 15;
        waterR += aStr * auroraR;
        waterG += aStr * auroraG;
        waterB += aStr * auroraB;
      }

      // --- Fog response ---
      if (fogBoost > 0) {
        const fogStr = fogBoost * (1.0 - depthFrac * 0.5);
        const fogR = mood.fogColor[0];
        const fogG = mood.fogColor[1];
        const fogB = mood.fogColor[2];
        waterR += (fogR - waterR) * fogStr;
        waterG += (fogG - waterG) * fogStr;
        waterB += (fogB - waterB) * fogStr;
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
