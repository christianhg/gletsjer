/**
 * Stars — night sky point lights
 *
 * 18 pre-allocated star positions in the upper sky region.
 * Each star twinkles at an incommensurate frequency — no two sync up.
 * Stars fade in with the night phase and fade out at dawn.
 *
 * Renders AFTER aurora, BEFORE glacier terrain — terrain naturally
 * occludes stars behind mountain peaks. Free depth without z-buffering.
 *
 * Architecture:
 *   - All star objects allocated at init, zero per-frame GC
 *   - Twinkle via sine wave with per-star frequency and phase
 *   - Color temperature variety: warm yellow to cool blue-white
 *   - Additive blend onto sky — stars near bright aurora wash out naturally
 *   - ~0.01ms per frame (18 sine + 18 pixel writes)
 */

const STAR_COUNT = 18;

/**
 * @typedef {Object} Star
 * @property {number} x — pixel x
 * @property {number} y — pixel y
 * @property {number} baseBrightness — 0.4–1.0
 * @property {number} twinkleFreq — radians/sec, incommensurate per star
 * @property {number} twinklePhase — random offset
 * @property {number} colorTemp — 0 (warm/yellow) to 1 (cool/blue-white)
 */

/**
 * @typedef {Object} StarField
 * @property {Star[]} stars
 * @property {number} width
 * @property {number} height
 */

/**
 * Create the star field. Call once at init.
 * Stars are scattered in the upper 40% of the canvas — the sky zone
 * above the glacier line.
 *
 * @param {number} width — buffer width
 * @param {number} height — buffer height
 * @returns {StarField}
 */
export function createStars(width, height) {
  const stars = new Array(STAR_COUNT);
  const skyLimit = (height * 0.40) | 0;

  for (let i = 0; i < STAR_COUNT; i++) {
    stars[i] = {
      x: (Math.random() * width) | 0,
      y: (Math.random() * skyLimit) | 0,
      baseBrightness: 0.4 + Math.random() * 0.6,
      // Incommensurate frequencies: 0.3–1.8 Hz (in radians/sec)
      // No two stars will pulse in sync
      twinkleFreq: (0.3 + Math.random() * 1.5) * Math.PI * 2,
      twinklePhase: Math.random() * Math.PI * 2,
      // Color temperature: 0 = warm yellow, 1 = cool blue-white
      colorTemp: Math.random(),
    };
  }

  return { stars, width, height };
}

/**
 * Render stars into the pixel buffer.
 * Stars are single bright pixels with additive blending.
 *
 * @param {StarField} starField
 * @param {Uint8ClampedArray} data — RGBA pixel data (sky + aurora already rendered)
 * @param {number} width
 * @param {number} time — elapsed seconds
 * @param {import('./lightCycle.js').Mood} mood
 */
export function renderStars(starField, data, width, time, mood) {
  const vis = mood.starVisibility;
  if (vis < 0.01) return;

  // Cubic fade-in: first 30% of visibility is barely perceptible
  // Matches aurora's cubic curve — stars and aurora emerge together
  const effectiveVis = vis * vis * vis;
  if (effectiveVis < 0.005) return;

  const stars = starField.stars;

  for (let i = 0; i < stars.length; i++) {
    const star = stars[i];

    // Twinkle: brightness oscillation at this star's unique frequency
    const twinkle = 0.5 + 0.5 * Math.sin(time * star.twinkleFreq + star.twinklePhase);
    const brightness = star.baseBrightness * twinkle * effectiveVis;

    // Skip invisible stars (below perceptual threshold)
    if (brightness < 0.05) continue;

    // Color: warm stars are slightly yellow, cool stars are blue-white
    const w = star.colorTemp;
    const r = brightness * (200 + w * 55);         // 200–255
    const g = brightness * (200 + w * 30);          // 200–230
    const b = brightness * (220 + (1 - w) * 35);   // 220–255

    // Additive blend — star glows on top of sky/aurora
    const idx = (star.y * width + star.x) * 4;
    data[idx]     = clamp255(data[idx] + r);
    data[idx + 1] = clamp255(data[idx + 1] + g);
    data[idx + 2] = clamp255(data[idx + 2] + b);
  }
}

// --- Util ---

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
