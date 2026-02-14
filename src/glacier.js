/**
 * Glacier — procedural terrain generation and rendering
 *
 * Architecture:
 *   - Terrain profiles are pre-computed once as height arrays (generateGlacier)
 *   - Each frame, layers render back-to-front with animated effects
 *   - Colors are mood-dependent: lightCycle.js provides tints, fog, aurora light
 *   - Crevasses use ridge noise, pre-computed per layer
 *   - Shimmer uses 3D noise (time as Z) for organic sparkle
 *   - All frequencies are incommensurate — nothing syncs up
 */

import { fbm, ridge, simplex2, simplex3 } from './noise.js';
import * as palette from './palette.js';

// --- Layer definitions (back to front) ---

const LAYER_DEFS = [
  // Far background mountains — subtle, muted
  {
    colorDark: palette.SKY_MID,
    colorLight: palette.ICE_SHADOW,
    depth: 0.0,
    noiseScale: 0.008,
    baseHeight: 0.25,
    amplitude: 0.10,
    octaves: 3,
    driftSpeed: 0.003,
    shimmerAmount: 0.2,
    fogBase: 0.35,       // Heavy fog — almost silhouette
  },
  // Mid-background ice mass
  {
    colorDark: palette.ICE_SHADOW,
    colorLight: palette.ICE_DEEP,
    depth: 0.25,
    noiseScale: 0.012,
    baseHeight: 0.33,
    amplitude: 0.13,
    octaves: 4,
    driftSpeed: 0.006,
    shimmerAmount: 0.4,
    fogBase: 0.20,
  },
  // Main glacier body — the star
  {
    colorDark: palette.ICE_DEEP,
    colorLight: palette.ICE_MID,
    depth: 0.5,
    noiseScale: 0.015,
    baseHeight: 0.40,
    amplitude: 0.16,
    octaves: 5,
    driftSpeed: 0.01,
    shimmerAmount: 0.7,
    fogBase: 0.08,
  },
  // Foreground ice shelf
  {
    colorDark: palette.ICE_MID,
    colorLight: palette.ICE_LIGHT,
    depth: 0.75,
    noiseScale: 0.02,
    baseHeight: 0.55,
    amplitude: 0.12,
    octaves: 4,
    driftSpeed: 0.015,
    shimmerAmount: 0.9,
    fogBase: 0.03,
  },
  // Near foreground — ice cliff face
  {
    colorDark: palette.PURPLE_MID,
    colorLight: palette.ICE_DEEP,
    depth: 1.0,
    noiseScale: 0.025,
    baseHeight: 0.72,
    amplitude: 0.10,
    octaves: 3,
    driftSpeed: 0.02,
    shimmerAmount: 0.5,
    fogBase: 0.0,        // No fog on nearest layer
  },
];

/**
 * @typedef {Object} GlacierLayer
 * @property {Float32Array} heights
 * @property {Float32Array} crevasses
 * @property {number[]} colorDark
 * @property {number[]} colorLight
 * @property {number} depth
 * @property {number} driftSpeed
 * @property {number} shimmerAmount
 * @property {number} fogBase
 */

/**
 * @typedef {Object} Glacier
 * @property {GlacierLayer[]} layers
 * @property {number} width
 * @property {number} height
 */

/**
 * Generate the glacier terrain. Call once at init.
 * @param {number} width
 * @param {number} height
 * @returns {Glacier}
 */
export function generateGlacier(width, height) {
  const layers = LAYER_DEFS.map((def, li) => {
    const heights = new Float32Array(width);
    const crevasses = new Float32Array(width);

    for (let x = 0; x < width; x++) {
      const nx = x * def.noiseScale;
      const terrainNoise = fbm(nx, def.depth * 10 + li * 7.3, def.octaves);
      heights[x] = def.baseHeight + terrainNoise * def.amplitude;

      const crevasseNoise = ridge(
        x * 0.03 + li * 50,
        def.depth * 20 + li * 13.7,
        3
      );
      crevasses[x] = crevasseNoise;
    }

    return {
      heights,
      crevasses,
      colorDark: def.colorDark,
      colorLight: def.colorLight,
      depth: def.depth,
      driftSpeed: def.driftSpeed,
      shimmerAmount: def.shimmerAmount,
      fogBase: def.fogBase,
    };
  });

  return { layers, width, height };
}

/**
 * Render the sky gradient. Call first, before aurora.
 *
 * @param {Glacier} glacier
 * @param {Uint8ClampedArray} data
 * @param {number} time
 * @param {import('./lightCycle.js').Mood} mood
 */
export function renderGlacierSky(glacier, data, time, mood) {
  renderSky(data, glacier.width, glacier.height, time, mood);
}

/**
 * Render glacier layers + snow caps. Call AFTER aurora so terrain occludes it.
 *
 * @param {Glacier} glacier
 * @param {Uint8ClampedArray} data
 * @param {number} time
 * @param {import('./lightCycle.js').Mood} mood
 * @param {import('./aurora.js').Aurora} aurora
 */
export function renderGlacierTerrain(glacier, data, time, mood, aurora) {
  const { layers, width, height } = glacier;

  for (let li = 0; li < layers.length; li++) {
    renderLayer(layers[li], data, width, height, time, li, mood, aurora);
  }

  renderSnowCaps(layers, data, width, height, time, mood);
}

// --- Sky ---

function renderSky(data, width, height, time, mood) {
  const skyTop = mood.skyTop;
  const skyBot = mood.skyBottom;
  const skyLimit = (height * 0.55) | 0;

  for (let y = 0; y < skyLimit; y++) {
    // Gradient from top to bottom of sky zone
    const t = y / skyLimit;

    const r = skyTop[0] + (skyBot[0] - skyTop[0]) * t;
    const g = skyTop[1] + (skyBot[1] - skyTop[1]) * t;
    const b = skyTop[2] + (skyBot[2] - skyTop[2]) * t;

    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // Subtle atmospheric shimmer
      const atmo = simplex2(x * 0.02 + time * 0.013, y * 0.04 + time * 0.007) * 5;

      data[i]     = clamp(r + atmo);
      data[i + 1] = clamp(g + atmo);
      data[i + 2] = clamp(b + atmo * 0.6);
      data[i + 3] = 255;
    }
  }
}

// --- Layer rendering ---

function renderLayer(layer, data, width, height, time, layerIndex, mood, aurora) {
  const { heights, crevasses, colorDark, colorLight, depth, driftSpeed, shimmerAmount, fogBase } = layer;

  // Mood tints
  const shadowR = mood.shadowTint[0];
  const shadowG = mood.shadowTint[1];
  const shadowB = mood.shadowTint[2];
  const hlR = mood.highlightTint[0];
  const hlG = mood.highlightTint[1];
  const hlB = mood.highlightTint[2];

  // Fog: base amount scaled by mood density
  const fogAmountBase = fogBase * mood.fogDensity;
  const fogR = mood.fogColor[0];
  const fogG = mood.fogColor[1];
  const fogB = mood.fogColor[2];
  const ffX = mood.fogFrontX;
  const ffDir = mood.fogFrontDir;
  const ffInt = mood.fogFrontIntensity;

  // Ambient brightness from mood
  const ambient = mood.ambientBrightness;

  // Animated drift offset
  const drift = time * driftSpeed;
  const parallaxOffset = (drift * 8) | 0;

  // Texture noise drift
  const texDriftX = drift * 3.0
    + Math.sin(time * 0.00007) * 2.0
    + Math.sin(time * 0.00019) * 0.8;
  const texDriftY = drift * 1.0
    + Math.sin(time * 0.00011) * 0.5;

  for (let x = 0; x < width; x++) {
    const srcX = ((x + parallaxOffset) % width + width) % width;
    const terrainY = (heights[srcX] * height) | 0;
    if (terrainY >= height) continue;

    // Per-column fog: base + fog front contribution
    let fogAmount = fogAmountBase;
    if (ffX >= 0) {
      const dist = (x / width - ffX) * ffDir;
      const edgeW = 0.12;
      const ft = Math.max(0, Math.min(1, (dist + edgeW) / (2 * edgeW)));
      fogAmount = Math.min(1.0, fogAmount + ft * ft * (3 - 2 * ft) * ffInt * 0.3);
    }

    const columnHeight = height - terrainY;
    const crevasseBase = crevasses[srcX];

    // Aurora light for this column (0 when aurora not visible)
    let auroraIntensity = 0;
    let auroraR = 0, auroraG = 0, auroraB = 0;
    if (aurora && aurora.columnLight[x] > 0.005) {
      auroraIntensity = aurora.columnLight[x];
      auroraR = aurora.columnR[x];
      auroraG = aurora.columnG[x];
      auroraB = aurora.columnB[x];
    }

    for (let y = terrainY; y < height; y++) {
      const i = (y * width + x) * 4;
      const pixelsFromSurface = y - terrainY;
      const columnDepth = pixelsFromSurface / columnHeight;

      // --- Base color with mood tint ---
      // Deep pixels get shadow tint, surface pixels get highlight tint
      const tintBlend = columnDepth; // 0 = surface (highlight), 1 = deep (shadow)
      const tintR = hlR + (shadowR - hlR) * tintBlend;
      const tintG = hlG + (shadowG - hlG) * tintBlend;
      const tintB = hlB + (shadowB - hlB) * tintBlend;

      let baseR = (colorLight[0] + (colorDark[0] - colorLight[0]) * columnDepth) * ambient + tintR;
      let baseG = (colorLight[1] + (colorDark[1] - colorLight[1]) * columnDepth) * ambient + tintG;
      let baseB = (colorLight[2] + (colorDark[2] - colorLight[2]) * columnDepth) * ambient + tintB;

      // --- Ice texture ---
      const tex = simplex2(
        x * 0.09 + layerIndex * 97 + texDriftX,
        y * 0.09 + texDriftY
      ) * 10;

      // --- Horizontal striations ---
      const stria = simplex2(
        x * 0.12 + layerIndex * 43 + texDriftX * 0.5,
        y * 0.006 + texDriftY * 0.3
      ) * 6 * columnDepth;

      // --- Crevasse darkening ---
      const crevasseDepth = ridge(
        x * 0.02 + layerIndex * 50,
        y * 0.035 + depth * 20
      );
      const crevasseDarken = crevasseDepth > 0.65
        ? (crevasseDepth - 0.65) * 70 * (0.5 + columnDepth * 0.5)
        : 0;

      // --- Surface highlight ---
      let highlight = 0;
      if (pixelsFromSurface < 2) {
        highlight = (2 - pixelsFromSurface) * 12;
      }

      // --- Cyan edge glow ---
      let cyanR = 0, cyanG = 0, cyanB = 0;
      if (pixelsFromSurface < 6 && depth > 0.2) {
        const edgeNoise = simplex2(x * 0.04 + time * 0.07, layerIndex * 31);
        if (edgeNoise > 0.25) {
          const cyanStrength = (edgeNoise - 0.25) * 20;
          cyanR = cyanStrength * 0.3;
          cyanG = cyanStrength * 0.85;
          cyanB = cyanStrength;
        }
      }

      // --- Ice shimmer ---
      let shimmer = 0;
      const sparkle = simplex3(x * 0.25, y * 0.25, time * 0.08);
      if (sparkle > 0.75) {
        shimmer = (sparkle - 0.75) * 80 * shimmerAmount;
      }

      // --- Color cycling ---
      const cycleDrift = Math.sin(time * 0.037 + x * 0.01 + layerIndex * 1.7) * 3;

      // --- Aurora light on ice highlights ---
      // Aurora tints the surface and near-surface pixels
      // 8px depth = highlight, not wash. Peaks catch the light.
      let auroraLightR = 0, auroraLightG = 0, auroraLightB = 0;
      if (auroraIntensity > 0 && pixelsFromSurface < 8) {
        // Fade aurora light with depth into the ice
        const auroraFade = 1.0 - (pixelsFromSurface / 8);
        const auroraStr = auroraIntensity * auroraFade * 40; // Scale to visible color offset
        auroraLightR = auroraR * auroraStr;
        auroraLightG = auroraG * auroraStr;
        auroraLightB = auroraB * auroraStr;
      }

      // --- Compose ---
      let finalR = baseR + tex + stria + highlight - crevasseDarken + cyanR + shimmer + cycleDrift * 0.3 + auroraLightR;
      let finalG = baseG + tex + stria + highlight - crevasseDarken + cyanG + shimmer + cycleDrift * 0.6 + auroraLightG;
      let finalB = baseB + tex * 0.7 + stria + highlight - crevasseDarken * 0.6 + cyanB + shimmer + cycleDrift + auroraLightB;

      // --- Fog: blend toward fog color based on layer depth ---
      if (fogAmount > 0) {
        finalR = finalR + (fogR - finalR) * fogAmount;
        finalG = finalG + (fogG - finalG) * fogAmount;
        finalB = finalB + (fogB - finalB) * fogAmount;
      }

      data[i]     = clamp(finalR);
      data[i + 1] = clamp(finalG);
      data[i + 2] = clamp(finalB);
      data[i + 3] = 255;
    }
  }
}

// --- Snow caps ---

function renderSnowCaps(layers, data, width, height, time, mood) {
  const snowBright = mood.snowBrightness;

  // Mood-tinted snow colors
  const snowR = palette.SNOW[0] * snowBright;
  const snowG = palette.SNOW[1] * snowBright;
  const snowB = palette.SNOW[2] * snowBright;
  const frostR = palette.FROST[0] * snowBright;
  const frostG = palette.FROST[1] * snowBright;
  const frostB = palette.FROST[2] * snowBright;

  for (let li = 0; li < Math.min(3, layers.length); li++) {
    const layer = layers[li];
    const maxThickness = li === 0 ? 4 : li === 1 ? 3 : 2;

    const drift = time * layer.driftSpeed;
    const parallaxOffset = (drift * 8) | 0;

    for (let x = 0; x < width; x++) {
      const srcX = ((x + parallaxOffset) % width + width) % width;
      const terrainY = (layer.heights[srcX] * height) | 0;

      const snowNoise = simplex2(srcX * 0.05 + li * 23, li * 11 + 0.5);
      if (snowNoise < 0.0) continue;

      const h = layer.heights[srcX];
      const prevSrcX = ((srcX - 1) % width + width) % width;
      const nextSrcX = ((srcX + 1) % width + width) % width;
      const hPrev = layer.heights[prevSrcX];
      const hNext = layer.heights[nextSrcX];
      const isPeak = h <= hPrev && h <= hNext;

      if (!isPeak && snowNoise < 0.3) continue;

      const thickness = Math.max(1, (maxThickness * (0.5 + snowNoise * 0.5)) | 0);

      for (let dy = 0; dy < thickness && terrainY + dy < height; dy++) {
        const y = terrainY + dy;
        const i = (y * width + x) * 4;

        const sparkle = simplex3(x * 0.3, y * 0.3, time * 0.12);
        if (sparkle > 0.4) {
          data[i]     = clamp(snowR);
          data[i + 1] = clamp(snowG);
          data[i + 2] = clamp(snowB);
        } else {
          data[i]     = clamp(frostR);
          data[i + 1] = clamp(frostG);
          data[i + 2] = clamp(frostB);
        }
        data[i + 3] = 255;
      }
    }
  }
}

// --- Util ---

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
