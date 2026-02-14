/**
 * Shooting Star — bright pixel streak across the night sky
 *
 * 0.4-0.6s duration, 4px fading trail, warm-white tint.
 * Renders in stars slot — terrain occludes naturally.
 * Pre-allocated state, zero per-frame GC.
 */

const TRAIL_LENGTH = 4;

const _state = { startX: 0, startY: 0, dx: 0, dy: 0, brightness: 0 };

/**
 * Initialize trajectory. Call when rare event activates.
 * @param {number} width
 * @param {number} height
 */
export function initShootingStar(width, height) {
  const skyLimit = (height * 0.35) | 0;
  _state.startX = (Math.random() * width * 0.6 + width * 0.2) | 0;
  _state.startY = (Math.random() * skyLimit * 0.6) | 0;

  const speed = width * (0.8 + Math.random() * 0.4);
  const angle = -0.15 - Math.random() * 0.25;
  const dir = Math.random() < 0.5 ? 1 : -1;

  _state.dx = dir * Math.cos(angle) * speed;
  _state.dy = -Math.sin(angle) * speed;
  _state.brightness = 0.8 + Math.random() * 0.2;
}

/**
 * Render shooting star into pixel buffer.
 * @param {Uint8ClampedArray} data
 * @param {number} width
 * @param {number} height
 * @param {import('./rareEvents.js').RareEventState} eventState
 */
export function renderShootingStar(data, width, height, eventState) {
  if (!eventState.active) return;

  const elapsed = eventState.elapsed;
  const progress = eventState.progress;
  const envelope = (1 - progress * progress) * _state.brightness;
  if (envelope < 0.05) return;

  for (let t = 0; t < TRAIL_LENGTH; t++) {
    const trailTime = elapsed - t * 0.02;
    if (trailTime < 0) continue;

    const tx = (_state.startX + _state.dx * trailTime) | 0;
    const ty = (_state.startY + _state.dy * trailTime) | 0;
    if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;

    const b = envelope * (1 - t / TRAIL_LENGTH);
    const idx = (ty * width + tx) * 4;
    data[idx]     = clamp255(data[idx] + b * 255);
    data[idx + 1] = clamp255(data[idx + 1] + b * 240);
    data[idx + 2] = clamp255(data[idx + 2] + b * 220);
  }
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
