/**
 * gletsjer — main entry point
 *
 * Sets up the rendering pipeline and animation loop.
 * Scene modules plug in via the render callback pattern.
 */

import { createRenderer } from './renderer.js';
import { drawScene } from './scene.js';

// --- Bootstrap ---

const canvas = document.getElementById('canvas');
if (!canvas) throw new Error('Canvas element #canvas not found');

const renderer = createRenderer(canvas);

// --- Resize handling ---

window.addEventListener('resize', () => {
  renderer.resize();
});

// --- Animation loop ---

/**
 * Frame state passed to scene renderers.
 * Pre-allocated to avoid GC pressure in the hot loop.
 *
 * @typedef {Object} FrameState
 * @property {number} time — elapsed time in seconds (monotonic)
 * @property {number} dt — delta time since last frame in seconds
 * @property {number} frame — frame counter
 */

/** @type {FrameState} */
const state = {
  time: 0,
  dt: 0,
  frame: 0,
};

let lastTimestamp = 0;

/**
 * Main animation loop. Runs every frame via requestAnimationFrame.
 * @param {DOMHighResTimeStamp} timestamp
 */
function loop(timestamp) {
  // Convert to seconds
  const timeSec = timestamp / 1000;

  if (lastTimestamp === 0) {
    lastTimestamp = timeSec;
  }

  state.dt = Math.min(timeSec - lastTimestamp, 0.1); // Cap dt to avoid spiral of death
  state.time = timeSec;
  state.frame++;
  lastTimestamp = timeSec;

  // Clear buffer
  renderer.clear();

  // Draw the scene into the off-screen buffer
  drawScene(renderer, state);

  // Scale buffer to display
  renderer.flush();

  requestAnimationFrame(loop);
}

// Kick off
requestAnimationFrame(loop);
