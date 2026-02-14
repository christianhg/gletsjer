/**
 * Scene — glacier rendering entry point
 *
 * Orchestrates the full scene: glacier terrain (with parallax),
 * water reflection, and snow particles.
 *
 * Render order:
 *   1. Glacier (sky + 5 ice layers + snow caps)
 *   2. Water reflection (reads glacier pixels, writes water zone)
 *   3. Snow particles (additive blend on top of everything)
 *
 * Uses the renderer's pre-allocated ImageData — zero allocations per frame.
 */

import { generateGlacier, renderGlacier } from './glacier.js';
import { renderWater } from './water.js';
import { createSnow, updateAndRenderSnow } from './snow.js';

/** @type {import('./glacier.js').Glacier | null} */
let glacier = null;

/** @type {import('./snow.js').SnowSystem | null} */
let snow = null;

/**
 * Draw the scene into the renderer's off-screen buffer.
 *
 * @param {import('./renderer.js').Renderer} renderer
 * @param {import('./main.js').FrameState} state
 */
export function drawScene(renderer, state) {
  const { width, height } = renderer;

  // Lazy init — generate terrain and particle systems once
  if (!glacier) {
    glacier = generateGlacier(width, height);
    snow = createSnow(width, height);
  }

  // Get pre-allocated ImageData and render directly into its pixel buffer
  const imageData = renderer.getImageData();
  const data = imageData.data;

  // 1. Glacier: sky, ice layers with parallax, snow caps
  renderGlacier(glacier, data, state.time);

  // 2. Water: mirrored reflection with ripple distortion
  renderWater(data, width, height, state.time);

  // 3. Snow: particles on top of everything (additive blend)
  updateAndRenderSnow(snow, data, state.time, state.dt);

  // Write to buffer canvas (no arg = uses pre-allocated ImageData)
  renderer.putImageData();
}
