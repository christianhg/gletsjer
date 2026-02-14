/**
 * Scene — glacier rendering entry point
 *
 * Orchestrates the full scene: glacier terrain (with parallax),
 * snow particles, and future effects.
 *
 * Uses the renderer's pre-allocated ImageData — zero allocations per frame.
 */

import { generateGlacier, renderGlacier } from './glacier.js';
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

  // Render glacier (includes sky, layers with parallax, snow caps)
  renderGlacier(glacier, imageData.data, state.time);

  // Render snow particles on top of everything
  updateAndRenderSnow(snow, imageData.data, state.time, state.dt);

  // Write to buffer canvas (no arg = uses pre-allocated ImageData)
  renderer.putImageData();
}
