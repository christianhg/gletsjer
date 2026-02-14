/**
 * Scene — glacier rendering entry point
 *
 * Orchestrates the full scene render pipeline:
 *   0. Update light cycle → derive mood
 *   1. Sky (mood-dependent gradient)
 *   2. Aurora borealis (renders into sky, outputs per-column light)
 *   3. Glacier layers (terrain occludes aurora + fog + aurora ice lighting)
 *   4. Water reflection (mood-tinted)
 *   5. Snow particles (mood-dimmed)
 *   6. Glitch effects (mood-character)
 *   7. Vignette (edge darkening)
 *
 * The mood object flows from lightCycle.js to every renderer.
 * One source of truth, one update per frame.
 *
 * Key ordering: aurora renders AFTER sky but BEFORE glacier layers.
 * Glacier terrain paints over aurora pixels → free depth occlusion.
 */

import { createLightCycle, updateLightCycle, getMood } from './lightCycle.js';
import { generateGlacier, renderGlacierSky, renderGlacierTerrain } from './glacier.js';
import { createAurora, renderAurora } from './aurora.js';
import { renderWater } from './water.js';
import { createSnow, updateAndRenderSnow } from './snow.js';
import { createGlitch, updateGlitch, applyGlitch } from './glitch.js';
import { createVignette, applyVignette } from './vignette.js';

/** @type {import('./lightCycle.js').LightCycle | null} */
let lightCycle = null;

/** @type {import('./glacier.js').Glacier | null} */
let glacier = null;

/** @type {import('./aurora.js').Aurora | null} */
let aurora = null;

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
    lightCycle = createLightCycle();
    glacier = generateGlacier(width, height);
    aurora = createAurora(width, height);
    snow = createSnow(width, height);
    glitch = createGlitch(width, height);
    vignette = createVignette(width, height);
  }

  // 0. Update light cycle and derive mood (single source of truth)
  updateLightCycle(lightCycle, state.dt);
  const mood = getMood(lightCycle);

  // Get pre-allocated ImageData
  const imageData = renderer.getImageData();
  const data = imageData.data;

  // 1. Sky: mood-driven gradient
  renderGlacierSky(glacier, data, state.time, mood);

  // 2. Aurora: renders into sky zone, computes per-column light for ice tinting
  renderAurora(aurora, data, width, height, state.time, mood);

  // 3. Glacier layers: terrain occludes aurora + fog + aurora ice lighting + snow caps
  renderGlacierTerrain(glacier, data, state.time, mood, aurora);

  // 4. Water: mirrored reflection with mood-tinted colors
  renderWater(data, width, height, state.time, mood);

  // 5. Snow: particles with mood-dimmed brightness
  updateAndRenderSnow(snow, data, state.time, state.dt, mood);

  // 6. Glitch: intermittent post-processing with mood-shifted character
  updateGlitch(glitch, state.dt);
  applyGlitch(glitch, data, width, height, mood);

  // 7. Vignette: darken edges (final compositing step)
  applyVignette(vignette, data);

  // Write to buffer canvas
  renderer.putImageData();
}
