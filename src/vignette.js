/**
 * Vignette — edge darkening post-process
 *
 * Darkens the edges and corners of the frame to draw the eye inward.
 * Applied as a final compositing step after all scene rendering and glitch.
 *
 * Architecture:
 *   - Pre-computes a Float32Array lookup table of multipliers at init
 *   - Per-frame cost is just a multiply per pixel — no sqrt, no branching
 *   - Cubic ease falloff for smooth, invisible gradient
 *   - Max 35% darkening at corners
 */

/**
 * @typedef {Object} VignetteMap
 * @property {Float32Array} lut — per-pixel multiplier (0..1), row-major
 * @property {number} width
 * @property {number} height
 */

/**
 * Pre-compute the vignette intensity map. Call once at init.
 *
 * @param {number} width — buffer width
 * @param {number} height — buffer height
 * @returns {VignetteMap}
 */
export function createVignette(width, height) {
  const lut = new Float32Array(width * height);

  const cx = width * 0.5;
  const cy = height * 0.5;

  for (let y = 0; y < height; y++) {
    const dy = (y - cy) / cy; // Normalized: -1..1
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / cx; // Normalized: -1..1
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Smooth falloff: no darkening until dist > 0.6, then cubic ramp
      // At corners (dist ~1.4): multiplier ~0.65 (35% darkening)
      // At center (dist ~0.0): multiplier = 1.0 (no change)
      const t = Math.max(0, (dist - 0.6) / 0.8);
      lut[y * width + x] = 1.0 - t * t * t * 0.35;
    }
  }

  return { lut, width, height };
}

/**
 * Apply vignette darkening to the pixel buffer in-place.
 *
 * @param {VignetteMap} vignette — pre-computed intensity map
 * @param {Uint8ClampedArray} data — RGBA pixel data
 */
export function applyVignette(vignette, data) {
  const { lut, width, height } = vignette;
  const len = width * height;

  for (let i = 0; i < len; i++) {
    const v = lut[i];
    // Skip pixels in the center region (no darkening)
    if (v >= 1.0) continue;

    const pi = i * 4;
    data[pi]     = (data[pi] * v) | 0;
    data[pi + 1] = (data[pi + 1] * v) | 0;
    data[pi + 2] = (data[pi + 2] * v) | 0;
    // Alpha stays 255
  }
}
