/**
 * Glacier — procedural terrain generation and rendering
 *
 * Architecture:
 *   - Terrain profiles are pre-computed once as height arrays (generateGlacier)
 *   - Heightmaps are 3× display width (960px) for camera drift headroom
 *   - 32px smoothstep crossfade at wrap point for seamless tiling
 *   - Surface normals pre-computed at init (finite differences → Lambertian lighting)
 *   - Each frame, layers render back-to-front with animated effects
 *   - Colors: 70% static palette + 30% daily cosine palette (dateHash 120-131)
 *   - Normal-mapped directional lighting: phase-driven light direction, depth fade
 *   - Geological strata: domain-warped horizontal bands, light-coupled visibility
 *   - Crevasses use ridge noise, pre-computed per layer
 *   - Shimmer uses 3D noise (time as Z) for organic sparkle
 *   - All frequencies are incommensurate — nothing syncs up
 *   - Far layers (fogBase > 0.30) get 1px horizontal DoF blur after rendering
 *   - Optional ordered dithering (4×4 Bayer, dev panel toggle)
 */

import { fbm, ridge, simplex2, simplex3 } from './noise.js';
import * as palette from './palette.js';
import { dateHash } from './lightCycle.js';

// --- Layer definitions (back to front) ---

const LAYER_DEFS = [
  // --- NEW far-field layers (behind existing stack) ---
  // Far mountains — silhouette in fog, barely visible
  {
    colorDark: palette.SKY_MID,
    colorLight: palette.ICE_SHADOW,
    depth: 0.0,
    noiseScale: 0.005,
    baseHeight: 0.15,
    amplitude: 0.10,
    octaves: 2,
    driftSpeed: 0.001,
    shimmerAmount: 0.1,
    fogBase: 0.75,
  },
  // Distant ridge — faint shape emerging from haze
  {
    colorDark: palette.SKY_MID,
    colorLight: palette.ICE_SHADOW,
    depth: 0.08,
    noiseScale: 0.007,
    baseHeight: 0.18,
    amplitude: 0.10,
    octaves: 2,
    driftSpeed: 0.0015,
    shimmerAmount: 0.15,
    fogBase: 0.60,
  },
  // Mid-far ice mass — bridge into existing stack
  {
    colorDark: palette.ICE_SHADOW,
    colorLight: palette.ICE_DEEP,
    depth: 0.15,
    noiseScale: 0.010,
    baseHeight: 0.22,
    amplitude: 0.10,
    octaves: 3,
    driftSpeed: 0.002,
    shimmerAmount: 0.25,
    fogBase: 0.45,
  },
  // --- Existing layers (unchanged) ---
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
    fogBase: 0.35,
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

// --- Terrain generation constants ---

/** Terrain width multiplier — 3× display width for camera drift headroom */
const TERRAIN_WIDTH_MULT = 3;

/** Crossfade zone at terrain wrap point (pixels) */
const BLEND_ZONE = 32;

/** DoF blur threshold — layers with fogBase above this get blurred */
const DOF_FOG_THRESHOLD = 0.30;

// --- Cosine palette: daily structural color variation ---
// color(t) = a + b * cos(2π(c*t + d))
// a,b,c,d are RGB vectors seeded daily. t = columnDepth (0=surface, 1=deep).
// Constrained to glacial blue-purple-cyan range — never warm.

const COS_A = new Float32Array(3); // bias (center)
const COS_B = new Float32Array(3); // amplitude
const COS_C = new Float32Array(3); // frequency
const COS_D = new Float32Array(3); // phase offset

function initCosinePalette() {
  // Base: glacial blue-white center, moderate amplitude
  // dateHash modulates within a constrained range — always reads as ice
  const h = (i) => dateHash(120 + i); // indices 120-131

  // Center: cool tones (high blue, moderate green, low red)
  COS_A[0] = 0.35 + h(0) * 0.15;  // R: 0.35-0.50
  COS_A[1] = 0.45 + h(1) * 0.15;  // G: 0.45-0.60
  COS_A[2] = 0.55 + h(2) * 0.15;  // B: 0.55-0.70

  // Amplitude: how much the color swings
  COS_B[0] = 0.15 + h(3) * 0.15;  // R: 0.15-0.30
  COS_B[1] = 0.15 + h(4) * 0.15;  // G: 0.15-0.30
  COS_B[2] = 0.10 + h(5) * 0.15;  // B: 0.10-0.25 (less swing — blue stays dominant)

  // Frequency: how many color cycles across depth
  COS_C[0] = 0.5 + h(6) * 1.0;    // R: 0.5-1.5
  COS_C[1] = 0.5 + h(7) * 1.0;    // G: 0.5-1.5
  COS_C[2] = 0.5 + h(8) * 0.8;    // B: 0.5-1.3

  // Phase offset: where in the cosine cycle each channel starts
  COS_D[0] = h(9);                 // R: 0.0-1.0
  COS_D[1] = h(10);                // G: 0.0-1.0
  COS_D[2] = h(11);                // B: 0.0-1.0
}

// Pre-computed cosine palette LUT: 64 entries × 3 channels = 192 floats
// Rebuilt once per frame with current ambient. Avoids Math.cos in inner loop.
const COS_LUT_SIZE = 64;
const COS_LUT = new Float32Array(COS_LUT_SIZE * 3);
let _cosLutAmbient = -1; // Sentinel: force rebuild on first frame

/**
 * Rebuild cosine palette LUT for current ambient brightness.
 * Called once per frame before rendering layers. ~192 cos calls total.
 */
function rebuildCosineLUT(ambient) {
  if (ambient === _cosLutAmbient) return; // Skip if ambient unchanged
  _cosLutAmbient = ambient;
  const TAU = Math.PI * 2;
  for (let i = 0; i < COS_LUT_SIZE; i++) {
    const t = i / (COS_LUT_SIZE - 1);
    const base = i * 3;
    COS_LUT[base]     = (COS_A[0] + COS_B[0] * Math.cos(TAU * (COS_C[0] * t + COS_D[0]))) * 255 * ambient;
    COS_LUT[base + 1] = (COS_A[1] + COS_B[1] * Math.cos(TAU * (COS_C[1] * t + COS_D[1]))) * 255 * ambient;
    COS_LUT[base + 2] = (COS_A[2] + COS_B[2] * Math.cos(TAU * (COS_C[2] * t + COS_D[2]))) * 255 * ambient;
  }
}

/**
 * Look up cosine palette at depth t (0=surface, 1=deep).
 * Uses pre-computed LUT with linear interpolation. Zero trig in inner loop.
 * @param {number} t — column depth 0→1
 * @param {number[]} out — [r,g,b] output (mutated)
 */
function cosinePaletteLookup(t, out) {
  const ft = t * (COS_LUT_SIZE - 1);
  const idx = ft | 0;
  const frac = ft - idx;
  const lo = idx * 3;
  const hi = Math.min(idx + 1, COS_LUT_SIZE - 1) * 3;
  out[0] = COS_LUT[lo]     + (COS_LUT[hi]     - COS_LUT[lo])     * frac;
  out[1] = COS_LUT[lo + 1] + (COS_LUT[hi + 1] - COS_LUT[lo + 1]) * frac;
  out[2] = COS_LUT[lo + 2] + (COS_LUT[hi + 2] - COS_LUT[lo + 2]) * frac;
}

// Pre-allocated output for cosinePaletteLookup (zero GC)
const _cosOut = [0, 0, 0];

// --- Ordered dithering: 4×4 Bayer matrix ---
// Normalized to [-0.5, 0.5] range for threshold dithering
const BAYER_4X4 = new Float32Array([
   0/16 - 0.5,  8/16 - 0.5,  2/16 - 0.5, 10/16 - 0.5,
  12/16 - 0.5,  4/16 - 0.5, 14/16 - 0.5,  6/16 - 0.5,
   3/16 - 0.5, 11/16 - 0.5,  1/16 - 0.5,  9/16 - 0.5,
  15/16 - 0.5,  7/16 - 0.5, 13/16 - 0.5,  5/16 - 0.5,
]);

/**
 * @typedef {Object} GlacierLayer
 * @property {Float32Array} heights
 * @property {Float32Array} normals — surface normal [nx, ny] pairs, 2 floats per column
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
 * @property {number} width — display width (320)
 * @property {number} height — display height (180)
 */

/**
 * Generate the glacier terrain. Call once at init.
 * Heightmaps are generated at 3× display width with crossfade at wrap point.
 *
 * @param {number} width — display width
 * @param {number} height — display height
 * @returns {Glacier}
 */
export function generateGlacier(width, height) {
  const terrainWidth = width * TERRAIN_WIDTH_MULT;

  // Init daily cosine palette
  initCosinePalette();

  const layers = LAYER_DEFS.map((def, li) => {
    const heights = new Float32Array(terrainWidth);
    const normals = new Float32Array(terrainWidth * 2); // [nx, ny] pairs
    const crevasses = new Float32Array(terrainWidth);

    for (let x = 0; x < terrainWidth; x++) {
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

    // 32px smoothstep crossfade at wrap point for seamless tiling
    for (let i = 0; i < BLEND_ZONE; i++) {
      const t = i / BLEND_ZONE;
      const smooth = t * t * (3 - 2 * t); // smoothstep
      const wrapX = terrainWidth - BLEND_ZONE + i;
      heights[wrapX] = heights[wrapX] * (1 - smooth) + heights[i] * smooth;
      crevasses[wrapX] = crevasses[wrapX] * (1 - smooth) + crevasses[i] * smooth;
    }

    // Compute surface normals from height derivatives (finite differences)
    // Tangent = (2, dh), Normal = perpendicular, normalized to unit length.
    // Computed once at init — zero per-frame cost.
    for (let x = 0; x < terrainWidth; x++) {
      const xPrev = (x - 1 + terrainWidth) % terrainWidth;
      const xNext = (x + 1) % terrainWidth;
      const dh = heights[xNext] - heights[xPrev]; // height delta over 2px
      const dx = 2.0; // horizontal span
      // Tangent: (dx, dh). Normal: perpendicular = (-dh, dx), normalized.
      const len = Math.sqrt(dx * dx + dh * dh);
      normals[x * 2]     = -dh / len; // nx: points away from surface
      normals[x * 2 + 1] = dx / len;  // ny: upward component
    }

    return {
      heights,
      normals,
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
 * @param {number} cameraDriftX — global camera drift offset (pixels)
 */
// --- Dithering state (toggled via dev panel) ---
let _ditheringEnabled = false; // Off by default — dev panel toggle for christian to evaluate

/** Toggle ordered dithering on/off. Returns new state. */
export function toggleDithering() { _ditheringEnabled = !_ditheringEnabled; return _ditheringEnabled; }
/** Get current dithering state. */
export function isDitheringEnabled() { return _ditheringEnabled; }

export function renderGlacierTerrain(glacier, data, time, mood, aurora, cameraDriftX) {
  const { layers, width, height } = glacier;

  // Rebuild cosine palette LUT for current ambient (once per frame, ~192 cos calls)
  rebuildCosineLUT(mood.ambientBrightness);

  for (let li = 0; li < layers.length; li++) {
    renderLayer(layers[li], data, width, height, time, li, mood, aurora, cameraDriftX);

    // DoF blur: 1px horizontal box blur on far layers (fogBase > 0.30)
    if (layers[li].fogBase > DOF_FOG_THRESHOLD) {
      blurLayer(layers[li], data, width, height, time, cameraDriftX);
    }
  }

  // Ordered dithering: selective 4×4 Bayer on terrain pixels
  // Applied after all layers render, before snow caps
  // Only dithers mid-tone pixels (avoids dithering pure black/white)
  if (_ditheringEnabled) {
    applyDithering(layers, data, width, height, time, cameraDriftX);
  }

  renderSnowCaps(layers, data, width, height, time, mood, cameraDriftX);
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

function renderLayer(layer, data, width, height, time, layerIndex, mood, aurora, cameraDriftX) {
  const { heights, normals, crevasses, colorDark, colorLight, depth, driftSpeed, shimmerAmount, fogBase } = layer;
  const terrainLen = heights.length;

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

  // Shimmer modulation: ambient light cycle + aurora memory
  const shimmerMod = (0.2 + ambient * 0.8) * (mood.shimmerBoost || 1.0);

  // Normal-mapped lighting: light direction from mood phase
  // Phase 0.0-0.2 (cold→amber): light from right (low sun east)
  // Phase 0.2-0.4 (amber→violet): light from above
  // Phase 0.4-0.8 (night): diffuse (no directional component)
  // Phase 0.8-1.0 (dawn): light from left (low sun west)
  const phase = mood.phase;
  let lightDirX, lightDirY;
  if (phase < 0.15) {
    lightDirX = 0.3; lightDirY = 0.7;        // Morning: from right, mostly above
  } else if (phase < 0.35) {
    const t = (phase - 0.15) / 0.20;
    lightDirX = 0.3 * (1 - t);               // Fade horizontal to zero
    lightDirY = 0.7 + 0.3 * t;               // Fade to overhead
  } else if (phase < 0.70) {
    lightDirX = 0.0; lightDirY = 1.0;        // Night: straight above (diffuse)
  } else if (phase < 0.85) {
    const t = (phase - 0.70) / 0.15;
    lightDirX = -0.3 * t;                     // Dawn: from left
    lightDirY = 1.0 - 0.3 * t;               // Slightly lower
  } else {
    const t = (phase - 0.85) / 0.15;
    lightDirX = -0.3 * (1 - t);              // Fade back to neutral
    lightDirY = 0.7 + 0.3 * t;               // Back to overhead
  }
  // Normal lighting strength: stronger in bright conditions, absent at night
  const normalStrength = ambient > 0.6 ? (ambient - 0.6) * 2.5 : 0; // 0→1 for ambient 0.6→1.0

  // Animated drift offset — layer's own drift + camera drift (depth-scaled)
  const drift = time * driftSpeed;
  const cameraPx = (cameraDriftX * (0.1 + depth * 0.9)) | 0;
  const parallaxOffset = ((drift * 8 + cameraPx) | 0);

  // Texture noise drift
  const texDriftX = drift * 3.0
    + Math.sin(time * 0.00007) * 2.0
    + Math.sin(time * 0.00019) * 0.8;
  const texDriftY = drift * 1.0
    + Math.sin(time * 0.00011) * 0.5;

  for (let x = 0; x < width; x++) {
    const srcX = ((x + parallaxOffset) % terrainLen + terrainLen) % terrainLen;
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

    // Normal-mapped directional light for this column
    // Lambertian: dot(normal, lightDir) → 0 = shadowed, 1 = fully lit
    const nx = normals[srcX * 2];
    const ny = normals[srcX * 2 + 1];
    const ndotl = Math.max(0, nx * lightDirX + ny * lightDirY);
    // Blend: 40% ambient + 60% directional, scaled by normalStrength
    // When normalStrength=0 (night), this is just 1.0 (no effect)
    const normalMul = 1.0 + (0.4 + 0.6 * ndotl - 1.0) * normalStrength;

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

      // --- Base color: cosine palette blended with static palette ---
      // Cosine palette provides daily structural variation
      // Static palette provides the familiar glacial character
      // Blend: 30% cosine, 70% static — cosine adds color, doesn't replace it
      cosinePaletteLookup(columnDepth, _cosOut);

      const tintBlend = columnDepth; // 0 = surface (highlight), 1 = deep (shadow)
      const tintR = hlR + (shadowR - hlR) * tintBlend;
      const tintG = hlG + (shadowG - hlG) * tintBlend;
      const tintB = hlB + (shadowB - hlB) * tintBlend;

      const staticR = (colorLight[0] + (colorDark[0] - colorLight[0]) * columnDepth) * ambient;
      const staticG = (colorLight[1] + (colorDark[1] - colorLight[1]) * columnDepth) * ambient;
      const staticB = (colorLight[2] + (colorDark[2] - colorLight[2]) * columnDepth) * ambient;

      let baseR = staticR * 0.7 + _cosOut[0] * 0.3 + tintR;
      let baseG = staticG * 0.7 + _cosOut[1] * 0.3 + tintG;
      let baseB = staticB * 0.7 + _cosOut[2] * 0.3 + tintB;

      // --- Normal-mapped lighting ---
      // Multiplicative: lit faces brighten, shadowed faces darken
      // Fades with depth into the ice (surface catches light, deep ice is diffuse)
      const normalFade = 1.0 - columnDepth * 0.7; // Surface=1.0, deep=0.3
      const nMul = 1.0 + (normalMul - 1.0) * normalFade;
      baseR *= nMul;
      baseG *= nMul;
      baseB *= nMul;

      // --- Geological strata ---
      // Domain-warped horizontal bands — visible but messy, light-dependent
      // "Can the viewer point at a band and say 'that's a layer'?
      //  If yes on first glance, too legible. If yes after 10 minutes, that's the target."
      const strataWarp = simplex2(
        x * 0.015 + layerIndex * 37 + texDriftX * 0.2,
        columnDepth * 3.0 + layerIndex * 11
      ) * 0.15; // Domain warp amount
      const strataY = columnDepth * 8.0 + strataWarp * 8.0; // 8 potential bands across depth
      const strataRaw = Math.sin(strataY * Math.PI * 2);
      // Light-coupled: strata only visible on lit faces (ndotl > 0.3)
      // Vanish in shadow, emerge in directional light — discovered, not noticed
      const strataVis = ndotl > 0.3 ? (ndotl - 0.3) * 1.4 * normalStrength : 0;
      const strata = strataRaw * 5 * strataVis * (0.3 + columnDepth * 0.7); // Stronger deeper

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
      // Crevasses deepen in darkness, shallow in light
      const crevasseStrength = 50 + (1.0 - ambient) * 40;
      const crevasseDarken = crevasseDepth > 0.65
        ? (crevasseDepth - 0.65) * crevasseStrength * (0.5 + columnDepth * 0.5)
        : 0;

      // --- Surface highlight ---
      let highlight = 0;
      if (pixelsFromSurface < 2) {
        highlight = (2 - pixelsFromSurface) * 12 * ambient;
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
        shimmer = (sparkle - 0.75) * 80 * shimmerAmount * shimmerMod;
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
      let finalR = baseR + tex + stria + strata + highlight - crevasseDarken + cyanR + shimmer + cycleDrift * 0.3 + auroraLightR;
      let finalG = baseG + tex + stria + strata + highlight - crevasseDarken + cyanG + shimmer + cycleDrift * 0.6 + auroraLightG;
      let finalB = baseB + tex * 0.7 + stria + strata + highlight - crevasseDarken * 0.6 + cyanB + shimmer + cycleDrift + auroraLightB;

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

// --- DoF blur ---

// Pre-allocated scanline buffer for blur (320 * 3 RGB = 960 bytes)
// Reused every frame — zero GC
// NOTE: assumes 320px display width — resize if renderer width changes
const blurBuf = new Uint8Array(320 * 3);

/**
 * 1px horizontal box blur [0.25, 0.5, 0.25] on pixels belonging to a layer.
 * Uses scanline buffer to prevent left-to-right cascade.
 * Only blurs rows where the layer has terrain (terrainY to height).
 */
function blurLayer(layer, data, width, height, time, cameraDriftX) {
  const { heights, depth, driftSpeed } = layer;
  const terrainLen = heights.length;

  // Recompute parallax offset (same formula as renderLayer)
  const drift = time * driftSpeed;
  const cameraPx = (cameraDriftX * (0.1 + depth * 0.9)) | 0;
  const parallaxOffset = ((drift * 8 + cameraPx) | 0);

  // Find min terrainY across all columns for this layer (blur from there down)
  let minTerrainY = height;
  for (let x = 0; x < width; x++) {
    const srcX = ((x + parallaxOffset) % terrainLen + terrainLen) % terrainLen;
    const ty = (heights[srcX] * height) | 0;
    if (ty < minTerrainY) minTerrainY = ty;
  }
  if (minTerrainY >= height) return;

  // Blur each row from minTerrainY to height
  for (let y = minTerrainY; y < height; y++) {
    const rowBase = y * width * 4;

    // Copy row RGB into buffer
    for (let x = 0; x < width; x++) {
      const si = rowBase + x * 4;
      const bi = x * 3;
      blurBuf[bi]     = data[si];
      blurBuf[bi + 1] = data[si + 1];
      blurBuf[bi + 2] = data[si + 2];
    }

    // Write blurred values: [0.25, 0.5, 0.25] weighted average
    // Skip first and last pixel (edge pixels stay sharp)
    for (let x = 1; x < width - 1; x++) {
      const si = rowBase + x * 4;
      const bi = x * 3;
      data[si]     = (blurBuf[bi - 3] + (blurBuf[bi]     << 1) + blurBuf[bi + 3]) >> 2;
      data[si + 1] = (blurBuf[bi - 2] + (blurBuf[bi + 1] << 1) + blurBuf[bi + 4]) >> 2;
      data[si + 2] = (blurBuf[bi - 1] + (blurBuf[bi + 2] << 1) + blurBuf[bi + 5]) >> 2;
    }
  }
}

// --- Ordered dithering ---

/**
 * Apply 4×4 ordered dithering to terrain pixels.
 * Selective: only affects mid-tone pixels (20-235 range) to avoid
 * dithering pure shadows or highlights. Strength is subtle — adds
 * texture without looking like a filter.
 *
 * @param {GlacierLayer[]} layers
 * @param {Uint8ClampedArray} data
 * @param {number} width
 * @param {number} height
 * @param {number} time
 * @param {number} cameraDriftX
 */
function applyDithering(layers, data, width, height, time, cameraDriftX) {
  // Find the topmost terrain pixel per column (highest layer that has terrain)
  // We only dither terrain pixels, not sky
  const lastLayer = layers[layers.length - 1];
  const terrainLen = lastLayer.heights.length;
  const drift = time * lastLayer.driftSpeed;
  const cameraPx = (cameraDriftX * (0.1 + lastLayer.depth * 0.9)) | 0;

  // Dither strength: subtle — ±3 levels out of 255
  const DITHER_STRENGTH = 3.0;

  // Simple approach: dither everything below the first layer's terrain line
  // (sky is above all terrain, so we find the global minimum terrainY)
  const firstLayer = layers[0];
  const firstLen = firstLayer.heights.length;
  const firstDrift = time * firstLayer.driftSpeed;
  const firstCameraPx = (cameraDriftX * (0.1 + firstLayer.depth * 0.9)) | 0;
  const firstOffset = ((firstDrift * 8 + firstCameraPx) | 0);

  let globalMinY = height;
  for (let x = 0; x < width; x++) {
    const srcX = ((x + firstOffset) % firstLen + firstLen) % firstLen;
    const ty = (firstLayer.heights[srcX] * height) | 0;
    if (ty < globalMinY) globalMinY = ty;
  }

  for (let y = globalMinY; y < height; y++) {
    const bayerRow = (y & 3) << 2; // (y % 4) * 4
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];

      // Skip near-black and near-white pixels
      const luma = (r * 77 + g * 150 + b * 29) >> 8; // Fast approximate luminance
      if (luma < 20 || luma > 235) continue;

      const threshold = BAYER_4X4[bayerRow + (x & 3)] * DITHER_STRENGTH;
      data[i]     = clamp(r + threshold);
      data[i + 1] = clamp(g + threshold);
      data[i + 2] = clamp(b + threshold);
    }
  }
}

// --- Snow caps ---

function renderSnowCaps(layers, data, width, height, time, mood, cameraDriftX) {
  const snowBright = mood.snowBrightness;

  // Mood-tinted snow colors
  const snowR = palette.SNOW[0] * snowBright;
  const snowG = palette.SNOW[1] * snowBright;
  const snowB = palette.SNOW[2] * snowBright;
  const frostR = palette.FROST[0] * snowBright;
  const frostG = palette.FROST[1] * snowBright;
  const frostB = palette.FROST[2] * snowBright;

  let snowLayerCount = 0;
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    // Skip far layers where snow is invisible under fog
    if (layer.fogBase > DOF_FOG_THRESHOLD) continue;

    // First 3 visible layers get snow caps: 4px, 3px, 2px thickness
    if (snowLayerCount >= 3) break;
    const maxThickness = 4 - snowLayerCount;
    snowLayerCount++;

    const drift = time * layer.driftSpeed;
    const terrainLen = layer.heights.length;
    const cameraPx = (cameraDriftX * (0.1 + layer.depth * 0.9)) | 0;
    const parallaxOffset = ((drift * 8 + cameraPx) | 0);

    for (let x = 0; x < width; x++) {
      const srcX = ((x + parallaxOffset) % terrainLen + terrainLen) % terrainLen;
      const terrainY = (layer.heights[srcX] * height) | 0;

      const snowNoise = simplex2(srcX * 0.05 + li * 23, li * 11 + 0.5);
      if (snowNoise < 0.0) continue;

      const h = layer.heights[srcX];
      const prevSrcX = ((srcX - 1) % terrainLen + terrainLen) % terrainLen;
      const nextSrcX = ((srcX + 1) % terrainLen + terrainLen) % terrainLen;
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
