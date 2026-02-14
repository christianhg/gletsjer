/**
 * Scene — glacier rendering entry point
 *
 * Orchestrates the full scene render pipeline:
 *   1. Glacier (sky + 5 ice layers with parallax + texture drift + snow caps)
 *   2. Water reflection (mirrored, tinted, ripple distortion)
 *   3. Snow particles (additive blend)
 *   4. Glitch effects (intermittent post-processing)
 *   5. Vignette (edge darkening — final compositing step)
 *
 * Uses the renderer's pre-allocated ImageData — zero allocations per frame.
 */

import { generateGlacier, renderGlacier } from './glacier.js';
import { renderWater } from './water.js';
import { createSnow, updateAndRenderSnow } from './snow.js';
import { createGlitch, updateGlitch, applyGlitch } from './glitch.js';
import { createVignette, applyVignette } from './vignette.js';

/** @type {import('./glacier.js').Glacier | null} */
let glacier = null;

/** @type {import('./snow.js').SnowSystem | null} */
let snow = null;

/** @type {import('./glitch.js').GlitchController | null} */
let glitch = null;

/** @type {import('./vignette.js').VignetteMap | null} */
let vignette = null;

/**
 * Draw the scene into the renderer's off-screen buffer.
 *
 * @param {import('./renderer.js').Renderer} renderer
 * @param {import('./main.js').FrameState} state
 */
export function drawScene(renderer, state) {
  const { width, height } = renderer;

  // Lazy init — generate terrain and systems once
  if (!glacier) {
    glacier = generateGlacier(width, height);
    snow = createSnow(width, height);
    glitch = createGlitch(width, height);
    vignette = createVignette(width, height);
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

  // 4. Glitch: intermittent post-processing effects
  updateGlitch(glitch, state.dt);
  applyGlitch(glitch, data, width, height);

  // 5. Vignette: darken edges (final compositing step)
  applyVignette(vignette, data);

  // Write to buffer canvas (no arg = uses pre-allocated ImageData)
  renderer.putImageData();
}
