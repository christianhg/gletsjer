/**
 * Glacier — procedural terrain generation and rendering
 *
 * Architecture:
 *   - Terrain profiles are pre-computed once as height arrays (generateGlacier)
 *   - Each frame, layers render back-to-front with animated effects
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
    driftSpeed: 0.003,     // Barely moves
    shimmerAmount: 0.2,
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
    driftSpeed: 0.02,      // Moves most (but still very slow)
    shimmerAmount: 0.5,
  },
];

/**
 * @typedef {Object} GlacierLayer
 * @property {Float32Array} heights — terrain height at each x (0=top, 1=bottom of canvas)
 * @property {Float32Array} crevasses — crevasse intensity at each x (0=none, 1=deep)
 * @property {number[]} colorDark
 * @property {number[]} colorLight
 * @property {number} depth
 * @property {number} driftSpeed
 * @property {number} shimmerAmount
 */

/**
 * @typedef {Object} Glacier
 * @property {GlacierLayer[]} layers
 * @property {number} width
 * @property {number} height
 */

/**
 * Generate the glacier terrain. Call once at init.
 *
 * @param {number} width
 * @param {number} height
 * @returns {Glacier}
 */
export function generateGlacier(width, height) {
  const layers = LAYER_DEFS.map((def, li) => {
    const heights = new Float32Array(width);
    const crevasses = new Float32Array(width);

    for (let x = 0; x < width; x++) {
      // Terrain profile from FBM
      const nx = x * def.noiseScale;
      const terrainNoise = fbm(nx, def.depth * 10 + li * 7.3, def.octaves);
      heights[x] = def.baseHeight + terrainNoise * def.amplitude;

      // Pre-compute crevasse intensity along the surface
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
    };
  });

  return { layers, width, height };
}

/**
 * Render the glacier into pixel data.
 *
 * @param {Glacier} glacier
 * @param {Uint8ClampedArray} data — RGBA pixel data
 * @param {number} time — elapsed seconds
 */
export function renderGlacier(glacier, data, time) {
  const { layers, width, height } = glacier;

  renderSky(data, width, height, time);

  for (let li = 0; li < layers.length; li++) {
    renderLayer(layers[li], data, width, height, time, li);
  }

  renderSnowCaps(layers, data, width, height, time);
}

// --- Sky ---

function renderSky(data, width, height, time) {
  const skyColors = palette.RAMPS.sky;
  const skyLimit = Math.floor(height * 0.55);

  for (let y = 0; y < skyLimit; y++) {
    const t = y / skyLimit;
    const rampPos = t * (skyColors.length - 1);
    const idx = Math.min(Math.floor(rampPos), skyColors.length - 2);
    const frac = rampPos - idx;
    const color = palette.lerpColor(skyColors[idx], skyColors[idx + 1], frac);

    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // Subtle atmospheric shimmer — very slow, barely visible
      const atmo = simplex2(x * 0.02 + time * 0.013, y * 0.04 + time * 0.007) * 5;

      data[i]     = clamp(color[0] + atmo);
      data[i + 1] = clamp(color[1] + atmo);
      data[i + 2] = clamp(color[2] + atmo * 0.6);
      data[i + 3] = 255;
    }
  }
}

// --- Layer rendering ---

function renderLayer(layer, data, width, height, time, layerIndex) {
  const { heights, crevasses, colorDark, colorLight, depth, driftSpeed, shimmerAmount } = layer;

  // Animated drift offset — incommensurate with other layers
  const drift = time * driftSpeed;

  for (let x = 0; x < width; x++) {
    const terrainY = (heights[x] * height) | 0;
    if (terrainY >= height) continue;

    const columnHeight = height - terrainY;
    const crevasseBase = crevasses[x];

    for (let y = terrainY; y < height; y++) {
      const i = (y * width + x) * 4;
      const pixelsFromSurface = y - terrainY;

      // Depth within column: 0 = surface, 1 = deep
      const columnDepth = pixelsFromSurface / columnHeight;

      // --- Base color ---
      const baseR = colorLight[0] + (colorDark[0] - colorLight[0]) * columnDepth;
      const baseG = colorLight[1] + (colorDark[1] - colorLight[1]) * columnDepth;
      const baseB = colorLight[2] + (colorDark[2] - colorLight[2]) * columnDepth;

      // --- Ice texture: fine noise for crystalline look ---
      const tex = simplex2(
        x * 0.09 + layerIndex * 97,
        y * 0.09 + drift
      ) * 10;

      // --- Horizontal striations: compressed ice layers ---
      const stria = simplex2(
        x * 0.12 + layerIndex * 43,
        y * 0.006
      ) * 6 * columnDepth;

      // --- Crevasse darkening ---
      // Combine pre-computed surface crevasse with per-pixel depth variation
      const crevasseDepth = ridge(
        x * 0.02 + layerIndex * 50,
        y * 0.035 + depth * 20
      );
      const crevasseDarken = crevasseDepth > 0.65
        ? (crevasseDepth - 0.65) * 70 * (0.5 + columnDepth * 0.5)
        : 0;

      // --- Surface highlight: bright edge ---
      let highlight = 0;
      if (pixelsFromSurface < 2) {
        highlight = (2 - pixelsFromSurface) * 12;
      }

      // --- Cyan edge glow: light catching ice surfaces ---
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

      // --- Ice shimmer: 3D noise sparkle (time as Z) ---
      let shimmer = 0;
      const sparkle = simplex3(x * 0.25, y * 0.25, time * 0.08);
      if (sparkle > 0.75) {
        shimmer = (sparkle - 0.75) * 80 * shimmerAmount;
      }

      // --- Color cycling: slow hue drift ---
      const cycleDrift = Math.sin(time * 0.037 + x * 0.01 + layerIndex * 1.7) * 3;

      // --- Compose ---
      data[i]     = clamp(baseR + tex + stria + highlight - crevasseDarken + cyanR + shimmer + cycleDrift * 0.3);
      data[i + 1] = clamp(baseG + tex + stria + highlight - crevasseDarken + cyanG + shimmer + cycleDrift * 0.6);
      data[i + 2] = clamp(baseB + tex * 0.7 + stria + highlight - crevasseDarken * 0.6 + cyanB + shimmer + cycleDrift);
      data[i + 3] = 255;
    }
  }
}

// --- Snow caps ---

function renderSnowCaps(layers, data, width, height, time) {
  // Snow on the first 3 layers (background + mid + main)
  for (let li = 0; li < Math.min(3, layers.length); li++) {
    const layer = layers[li];
    const maxThickness = li === 0 ? 4 : li === 1 ? 3 : 2;

    for (let x = 0; x < width; x++) {
      const terrainY = (layer.heights[x] * height) | 0;

      // Snow coverage: patchy noise
      const snowNoise = simplex2(x * 0.05 + li * 23, li * 11 + 0.5);
      if (snowNoise < 0.0) continue;

      // Favor peaks: check if local high point
      const h = layer.heights[x];
      const hPrev = x > 0 ? layer.heights[x - 1] : h;
      const hNext = x < width - 1 ? layer.heights[x + 1] : h;
      const isPeak = h <= hPrev && h <= hNext;

      // Non-peaks need stronger noise to get snow
      if (!isPeak && snowNoise < 0.3) continue;

      const thickness = Math.max(1, (maxThickness * (0.5 + snowNoise * 0.5)) | 0);

      for (let dy = 0; dy < thickness && terrainY + dy < height; dy++) {
        const y = terrainY + dy;
        const i = (y * width + x) * 4;

        // Sparkle: animated bright spots in the snow
        const sparkle = simplex3(x * 0.3, y * 0.3, time * 0.12);
        const color = sparkle > 0.4 ? palette.SNOW : palette.FROST;

        data[i]     = color[0];
        data[i + 1] = color[1];
        data[i + 2] = color[2];
        data[i + 3] = 255;
      }
    }
  }
}

// --- Util ---

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
