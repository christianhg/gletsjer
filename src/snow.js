/**
 * Snow Particle System
 *
 * 120 pre-allocated particles (40 active, 80 dormant for whiteout).
 * Zero GC after init. Whiteout: wind spike + brightness override + natural taper.
 * Blue shift: reads mood.snowTint per-channel from lightCycle.js.
 */

import * as palette from './palette.js';

const POOL_SIZE = 120;
const NORMAL_ACTIVE = 40;

/**
 * @typedef {Object} SnowSystem
 * @property {Object[]} particles
 * @property {number} width
 * @property {number} height
 * @property {number} windMultiplier
 * @property {number} brightnessOverride
 * @property {boolean} tapering
 */

/** @returns {SnowSystem} */
export function createSnow(width, height) {
  const particles = new Array(POOL_SIZE);
  for (let i = 0; i < POOL_SIZE; i++) {
    particles[i] = spawnParticle(width, height, i < NORMAL_ACTIVE);
    particles[i].active = i < NORMAL_ACTIVE;
  }
  return { particles, width, height, windMultiplier: 1.0, brightnessOverride: 0.0, tapering: false, residue: 0.0, draining: false };
}

function spawnParticle(width, height, randomY) {
  return {
    x: Math.random() * width,
    y: randomY ? Math.random() * height : -1 - Math.random() * 10,
    fallSpeed: 3 + Math.random() * 8,
    driftFreq: 0.3 + Math.random() * 0.7,
    driftAmp: 0.3 + Math.random() * 0.8,
    phase: Math.random() * Math.PI * 2,
    brightness: 0.4 + Math.random() * 0.6,
    size: Math.random() < 0.15 ? 2 : 1,
    active: true,
  };
}

/** Activate whiteout — spike wind, brightness, wake dormant particles. */
export function activateWhiteout(snow) {
  snow.windMultiplier = 4.0;
  snow.brightnessOverride = 0.8;
  snow.tapering = false;
  for (let i = NORMAL_ACTIVE; i < POOL_SIZE; i++) {
    const p = snow.particles[i];
    p.active = true;
    p.x = Math.random() * snow.width;
    p.y = Math.random() * snow.height;
    p.fallSpeed = 5 + Math.random() * 12;
    p.brightness = 0.6 + Math.random() * 0.4;
  }
}

/** Begin taper — dormant particles fall off and don't respawn. The wind moved on. */
export function beginWhiteoutTaper(snow) {
  snow.tapering = true;
}

/**
 * Update and render snow particles.
 * @param {SnowSystem} snow
 * @param {Uint8ClampedArray} data
 * @param {number} time
 * @param {number} dt
 * @param {import('./lightCycle.js').Mood} [mood]
 * @param {number} [cameraDriftDelta] — per-frame camera drift (pixels)
 */
export function updateAndRenderSnow(snow, data, time, dt, mood, cameraDriftDelta) {
  const { particles, width, height, brightnessOverride } = snow;
  const wind = Math.sin(time * 0.07) * 0.5 * snow.windMultiplier;

  // Decay snow residue (τ = 300s = 5min)
  if (snow.residue > 0.001) {
    snow.residue *= Math.exp(-dt / 300);
  }

  // Decay whiteout toward normal
  if (snow.tapering) {
    snow.windMultiplier += (1.0 - snow.windMultiplier) * dt * 0.8;
    snow.brightnessOverride *= (1 - dt * 1.2);
    if (snow.windMultiplier < 1.05 && snow.brightnessOverride < 0.02) {
      snow.windMultiplier = 1.0;
      snow.brightnessOverride = 0.0;
      snow.tapering = false;
    }
  }

  // Snow tint from mood (blue shift at night)
  let tintR, tintG, tintB;
  if (mood && mood.snowTint) {
    tintR = mood.snowTint[0];
    tintG = mood.snowTint[1];
    tintB = mood.snowTint[2];
  } else if (mood) {
    const coldShift = Math.max(0, 1 - mood.ambientBrightness);
    tintR = mood.snowBrightness * (1 - coldShift * 0.3);
    tintG = mood.snowBrightness * (1 - coldShift * 0.2);
    tintB = mood.snowBrightness;
  } else {
    tintR = 1.0; tintG = 1.0; tintB = 1.0;
  }

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (!p.active) continue;

    p.y += p.fallSpeed * dt;
    p.x += (Math.sin(time * p.driftFreq + p.phase) * p.driftAmp + wind) * dt * 3;
    // Subtle counter-drift: snow appears to drift opposite to camera movement
    if (cameraDriftDelta) p.x -= cameraDriftDelta * 0.02;

    if (p.x < 0) p.x += width;
    if (p.x >= width) p.x -= width;

    if (p.y >= height) {
      // Doomsday drain: particles fall off and don't come back
      if (snow.draining) { p.active = false; continue; }
      const activeLimit = NORMAL_ACTIVE + ((snow.residue * 40) | 0);
      if (snow.tapering && i >= activeLimit) { p.active = false; continue; }
      p.x = Math.random() * width;
      p.y = -1 - Math.random() * 5;
      p.fallSpeed = 3 + Math.random() * 8;
    }

    if (p.y < 0) continue;

    const px = p.x | 0;
    const py = p.y | 0;
    const color = p.brightness > 0.7 ? palette.SNOW : palette.FROST;
    const bright = Math.min(1, p.brightness + brightnessOverride);
    const cr = color[0] * tintR;
    const cg = color[1] * tintG;
    const cb = color[2] * tintB;

    drawSnowPixel(data, width, height, px, py, cr, cg, cb, bright);
    if (p.size === 2 && px + 1 < width) {
      drawSnowPixel(data, width, height, px + 1, py, cr, cg, cb, bright * 0.7);
    }
  }
}

function drawSnowPixel(data, width, height, x, y, cr, cg, cb, brightness) {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const i = (y * width + x) * 4;
  data[i]     = clamp(data[i]     + (cr - data[i])     * brightness);
  data[i + 1] = clamp(data[i + 1] + (cg - data[i + 1]) * brightness);
  data[i + 2] = clamp(data[i + 2] + (cb - data[i + 2]) * brightness);
}

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
