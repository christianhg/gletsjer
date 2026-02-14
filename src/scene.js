/**
 * Scene — glacier rendering entry point
 *
 * Owns the glacier lifecycle: generates terrain once at init,
 * then renders each frame with ambient animation layered on top.
 *
 * The glacier is pre-computed as height arrays. Per-frame work is
 * limited to color cycling, shimmer, and drift — keeping us well
 * within the 16ms frame budget at 320×180.
 */

import { generateGlacier, renderGlacier } from './glacier.js';

/** @type {import('./glacier.js').Glacier | null} */
let glacier = null;

/** Pre-allocated ImageData — reused every frame to avoid GC pressure */
let imageData = null;

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
    imageData = renderer.ctx.createImageData(width, height);
  }

  // Clear pixel data (fill with zeros — fully transparent, will be overwritten)
  // Using typed array fill is faster than iterating
  imageData.data.fill(0);

  // Render glacier with animated effects
  renderGlacier(glacier, imageData.data, state.time);

  // Write to buffer
  renderer.putImageData(imageData);
}
