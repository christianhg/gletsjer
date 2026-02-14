/**
 * Snow Particle System
 *
 * Pre-allocated particle pool — zero GC pressure after init.
 * Particles are single bright pixels that drift slowly downward
 * with gentle sine-wave horizontal movement.
 *
 * Design:
 *   - Fixed pool of particles, all allocated at init
 *   - Each particle has position, speed, drift, and brightness
 *   - Particles wrap around when they fall off-screen
 *   - Depth variation: some particles are dimmer (further away)
 *   - Wind: subtle global horizontal drift that shifts over time
 */

import * as palette from './palette.js';

const PARTICLE_COUNT = 40;

/**
 * @typedef {Object} SnowParticle
 * @property {number} x
 * @property {number} y
 * @property {number} fallSpeed — vertical pixels per second
 * @property {number} driftFreq — sine wave frequency for horizontal wander
 * @property {number} driftAmp — sine wave amplitude
 * @property {number} phase — initial phase offset
 * @property {number} brightness — 0..1, affects color (depth simulation)
 * @property {number} size — 1 or 2 pixels (most are 1)
 */

/**
 * @typedef {Object} SnowSystem
 * @property {SnowParticle[]} particles
 * @property {number} width
 * @property {number} height
 */

/**
 * Create the snow particle system. Call once at init.
 *
 * @param {number} width — buffer width
 * @param {number} height — buffer height
 * @returns {SnowSystem}
 */
export function createSnow(width, height) {
  const particles = new Array(PARTICLE_COUNT);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles[i] = spawnParticle(width, height, true);
  }

  return { particles, width, height };
}

/**
 * Initialize or reset a particle.
 * @param {number} width
 * @param {number} height
 * @param {boolean} randomY — if true, scatter across full height (init); if false, spawn at top
 * @returns {SnowParticle}
 */
function spawnParticle(width, height, randomY) {
  return {
    x: Math.random() * width,
    y: randomY ? Math.random() * height : -1 - Math.random() * 10,
    fallSpeed: 3 + Math.random() * 8,       // 3-11 px/sec — very gentle
    driftFreq: 0.3 + Math.random() * 0.7,   // Sine frequency
    driftAmp: 0.3 + Math.random() * 0.8,    // Sine amplitude in pixels
    phase: Math.random() * Math.PI * 2,      // Random start phase
    brightness: 0.4 + Math.random() * 0.6,   // Depth: dimmer = further
    size: Math.random() < 0.15 ? 2 : 1,      // 15% chance of 2px particle
  };
}

/**
 * Update and render snow particles.
 * Mutates particle positions in-place (zero allocation).
 *
 * @param {SnowSystem} snow
 * @param {Uint8ClampedArray} data — RGBA pixel data
 * @param {number} time — elapsed seconds
 * @param {number} dt — delta seconds
 * @param {import('./lightCycle.js').Mood} [mood] — light cycle mood (optional)
 */
export function updateAndRenderSnow(snow, data, time, dt, mood) {
  const { particles, width, height } = snow;

  // Global wind: slow horizontal drift that shifts over time
  const wind = Math.sin(time * 0.07) * 0.5;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];

    // Update position
    p.y += p.fallSpeed * dt;
    p.x += (Math.sin(time * p.driftFreq + p.phase) * p.driftAmp + wind) * dt * 3;

    // Wrap horizontally
    if (p.x < 0) p.x += width;
    if (p.x >= width) p.x -= width;

    // Reset when fallen off bottom
    if (p.y >= height) {
      p.x = Math.random() * width;
      p.y = -1 - Math.random() * 5;
      // Vary speed slightly on respawn for organic feel
      p.fallSpeed = 3 + Math.random() * 8;
    }

    // Skip if above screen
    if (p.y < 0) continue;

    // Render — blend snow color with brightness for depth
    const px = p.x | 0;
    const py = p.y | 0;

    const color = p.brightness > 0.7 ? palette.SNOW : palette.FROST;
    // Scale brightness by mood (dimmer at night)
    const bright = p.brightness * (mood ? mood.snowBrightness : 1.0);

    drawSnowPixel(data, width, height, px, py, color, bright);

    // Larger particles get a second pixel
    if (p.size === 2 && px + 1 < width) {
      drawSnowPixel(data, width, height, px + 1, py, color, bright * 0.7);
    }
  }
}

/**
 * Draw a single snow pixel, blending with existing content.
 * Uses additive-ish blending so snow glows on dark backgrounds.
 */
function drawSnowPixel(data, width, height, x, y, color, brightness) {
  if (x < 0 || x >= width || y < 0 || y >= height) return;

  const i = (y * width + x) * 4;

  // Blend: lerp toward snow color based on brightness
  data[i]     = clamp(data[i]     + (color[0] - data[i])     * brightness);
  data[i + 1] = clamp(data[i + 1] + (color[1] - data[i + 1]) * brightness);
  data[i + 2] = clamp(data[i + 2] + (color[2] - data[i + 2]) * brightness);
  // Alpha stays 255
}

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
