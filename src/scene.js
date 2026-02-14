/**
 * Scene — glacier rendering entry point
 *
 * This is where the glacier comes to life. The scene module receives
 * the renderer (with its off-screen buffer) and frame state, and draws
 * the glacier scene pixel by pixel.
 *
 * @glacier will own this file. This stub renders a placeholder gradient
 * to verify the pipeline works end-to-end.
 */

import * as palette from './palette.js';

/**
 * Draw the scene into the renderer's off-screen buffer.
 *
 * @param {import('./renderer.js').Renderer} renderer
 * @param {import('./main.js').FrameState} state
 */
export function drawScene(renderer, state) {
  const { width, height } = renderer;
  const { time } = state;

  // --- Placeholder: animated gradient to prove the pipeline ---
  // This will be replaced with the real glacier rendering.

  const imageData = renderer.getImageData();
  const data = renderer.pixels;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // Vertical gradient from sky to ice
      const t = y / height;

      // Slow shimmer based on time
      const shimmer = Math.sin(time * 0.5 + x * 0.05 + y * 0.03) * 0.05;

      let r, g, b;

      if (t < 0.4) {
        // Sky region
        const skyT = t / 0.4 + shimmer;
        const color = palette.lerpColor(palette.SKY_DEEP, palette.SKY_HIGH, skyT);
        [r, g, b] = color;
      } else if (t < 0.65) {
        // Ice highlights
        const iceT = (t - 0.4) / 0.25 + shimmer;
        const color = palette.lerpColor(palette.ICE_BRIGHT, palette.ICE_MID, iceT);
        [r, g, b] = color;
      } else {
        // Deep ice
        const deepT = (t - 0.65) / 0.35 + shimmer;
        const color = palette.lerpColor(palette.ICE_DEEP, palette.PURPLE_DEEP, deepT);
        [r, g, b] = color;
      }

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }

  renderer.putImageData();
}
