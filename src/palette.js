/**
 * Glacier Color Palette
 *
 * Organized by role so the rendering code reads clearly.
 * Each color is [r, g, b] for direct pixel manipulation.
 */

/** Deep background / void */
export const VOID = [10, 10, 26]; // #0a0a1a

/** Sky tones — dark to light */
export const SKY_DEEP = [18, 18, 48]; // #121230
export const SKY_MID = [26, 26, 62]; // #1a1a3e
export const SKY_HIGH = [35, 42, 82]; // #232a52

/** Ice body — the glacier mass */
export const ICE_SHADOW = [45, 58, 110]; // #2d3a6e
export const ICE_DEEP = [60, 80, 140]; // #3c508c
export const ICE_MID = [100, 130, 180]; // #6482b4
export const ICE_LIGHT = [160, 195, 225]; // #a0c3e1
export const ICE_BRIGHT = [212, 228, 247]; // #d4e4f7
export const ICE_WHITE = [234, 242, 255]; // #eaf2ff

/** Cyan highlights — refracted light, edges */
export const CYAN_DEEP = [78, 205, 196]; // #4ecdc4
export const CYAN_BRIGHT = [127, 219, 218]; // #7fdbda
export const CYAN_GLOW = [170, 240, 240]; // #aaf0f0

/** Purple shadows — crevasses, deep ice */
export const PURPLE_DEEP = [50, 30, 80]; // #321e50
export const PURPLE_MID = [74, 45, 115]; // #4a2d73
export const PURPLE_LIGHT = [110, 70, 150]; // #6e4696

/** Snow / frost accents */
export const SNOW = [245, 248, 255]; // #f5f8ff
export const FROST = [200, 220, 245]; // #c8dcf5

/**
 * Convert [r, g, b] to a CSS color string.
 * @param {number[]} rgb
 * @param {number} [alpha=1]
 * @returns {string}
 */
export function toCSS([r, g, b], alpha = 1) {
  if (alpha < 1) {
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `rgb(${r},${g},${b})`;
}

/**
 * Linearly interpolate between two RGB colors.
 * @param {number[]} a — [r, g, b]
 * @param {number[]} b — [r, g, b]
 * @param {number} t — 0..1
 * @returns {number[]} [r, g, b]
 */
export function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * Pre-built gradient ramps for common use cases.
 * Each is an array of [r,g,b] from dark to light.
 */
export const RAMPS = {
  sky: [VOID, SKY_DEEP, SKY_MID, SKY_HIGH],
  ice: [ICE_SHADOW, ICE_DEEP, ICE_MID, ICE_LIGHT, ICE_BRIGHT, ICE_WHITE],
  cyan: [CYAN_DEEP, CYAN_BRIGHT, CYAN_GLOW],
  purple: [PURPLE_DEEP, PURPLE_MID, PURPLE_LIGHT],
};
