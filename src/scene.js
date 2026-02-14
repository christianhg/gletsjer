/**
 * Scene — glacier rendering entry point
 *
 * This is where the glacier comes to life. The scene module receives
 * the renderer (with its off-screen buffer) and frame state, and draws
 * the glacier scene pixel by pixel.
 *
 * Uses the renderer's pre-allocated ImageData — zero allocations per frame.
 */

import { generateGlacier, renderGlacier } from './glacier.js';

/** @type {import('./glacier.js').Glacier | null} */
let glacier = null;

/**
 * Draw the scene into the renderer's off-screen buffer.
 *
 * @param {import('./renderer.js').Renderer} renderer
 * @param {import('./main.js').FrameState} state
 */
export function drawScene(renderer, state) {
  const { width, height } = renderer;

  // Lazy init — generate terrain once
  if (!glacier) {
    glacier = generateGlacier(width, height);
  }

  // Get pre-allocated ImageData and render directly into its pixel buffer
  const imageData = renderer.getImageData();
  renderGlacier(glacier, imageData.data, state.time);

  // Write to buffer canvas (no arg = uses pre-allocated ImageData)
  renderer.putImageData();
}
