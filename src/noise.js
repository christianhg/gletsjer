/**
 * Simplex Noise — lightweight 2D implementation
 *
 * Based on Stefan Gustavson's simplex noise algorithm.
 * Produces smooth, natural-looking noise in range [-1, 1].
 * Used for terrain generation, ice textures, and animation.
 */

// Permutation table — shuffled 0-255, doubled to avoid wrapping
const perm = new Uint8Array(512);
const grad2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/**
 * Seed the noise generator.
 * @param {number} seed
 */
export function seed(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;

  // Fisher-Yates shuffle with seed
  let s = seed;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807 + 0) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }

  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
  }
}

// Default seed
seed(42);

function dot2(g, x, y) {
  return g[0] * x + g[1] * y;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/**
 * 2D Simplex noise.
 * @param {number} x
 * @param {number} y
 * @returns {number} noise value in [-1, 1]
 */
export function simplex2(x, y) {
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);

  const t = (i + j) * G2;
  const X0 = i - t;
  const Y0 = j - t;
  const x0 = x - X0;
  const y0 = y - Y0;

  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  const ii = i & 255;
  const jj = j & 255;

  let n0 = 0, n1 = 0, n2 = 0;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    t0 *= t0;
    const gi0 = perm[ii + perm[jj]] & 7;
    n0 = t0 * t0 * dot2(grad2[gi0], x0, y0);
  }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    t1 *= t1;
    const gi1 = perm[ii + i1 + perm[jj + j1]] & 7;
    n1 = t1 * t1 * dot2(grad2[gi1], x1, y1);
  }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    t2 *= t2;
    const gi2 = perm[ii + 1 + perm[jj + 1]] & 7;
    n2 = t2 * t2 * dot2(grad2[gi2], x2, y2);
  }

  // Scale to [-1, 1]
  return 70 * (n0 + n1 + n2);
}

/**
 * 3D Simplex noise — used for animated effects (time as Z-axis).
 * Simplified implementation for smooth temporal animation.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {number} noise value in approx [-1, 1]
 */
export function simplex3(x, y, z) {
  // Use 2D slices offset by z for a lightweight 3D approximation.
  // True 3D simplex is heavier; this gives smooth-enough temporal variation
  // for shimmer/sparkle effects without the complexity.
  const a = simplex2(x, y + z * 31.7);
  const b = simplex2(x + z * 17.3, y);
  return (a + b) * 0.5;
}

/**
 * Fractal Brownian Motion — layered noise for natural terrain.
 * @param {number} x
 * @param {number} y
 * @param {number} [octaves=4] — number of noise layers
 * @param {number} [lacunarity=2] — frequency multiplier per octave
 * @param {number} [persistence=0.5] — amplitude multiplier per octave
 * @returns {number} noise value (roughly [-1, 1] but can exceed)
 */
export function fbm(x, y, octaves = 4, lacunarity = 2, persistence = 0.5) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmplitude = 0;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * simplex2(x * frequency, y * frequency);
    maxAmplitude += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return value / maxAmplitude;
}

/**
 * Ridge noise — creates sharp ridges, great for crevasses.
 * @param {number} x
 * @param {number} y
 * @param {number} [octaves=4]
 * @returns {number} noise value in [0, 1]
 */
export function ridge(x, y, octaves = 4) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmplitude = 0;
  let prev = 1;

  for (let i = 0; i < octaves; i++) {
    let n = simplex2(x * frequency, y * frequency);
    n = 1 - Math.abs(n); // Create ridges
    n = n * n;           // Sharpen
    n *= prev;           // Weight by previous octave (erosion)
    prev = n;
    value += amplitude * n;
    maxAmplitude += amplitude;
    amplitude *= 0.5;
    frequency *= 2.2;
  }

  return value / maxAmplitude;
}
