/**
 * gletsjer — main entry point
 *
 * Sets up the rendering pipeline and animation loop.
 * Handles lifecycle: resize, visibility (battery), reduced motion.
 */

import { createRenderer } from './renderer.js';
import { drawScene } from './scene.js';
import { toggleAudio, suspendAudio, resumeAudio } from './audio.js';

// --- Bootstrap ---

const canvas = document.getElementById('canvas');
if (!canvas) throw new Error('Canvas element #canvas not found');

const renderer = createRenderer(canvas);

// --- Accessibility: reduced motion ---

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Animation speed multiplier.
 * 1.0 = normal, 0.3 = reduced motion (slow, calm, no glitch/snow).
 */
const SPEED = prefersReducedMotion ? 0.3 : 1.0;

// --- Resize handling ---

window.addEventListener('resize', () => {
  renderer.resize();
});

// --- Prevent mobile touch interference ---

document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', (e) => e.preventDefault());

// --- Audio: opt-in via touch/click, no UI ---
// Debounce: mobile fires touchstart then click — guard with timestamp

let lastAudioToggle = 0;
function handleAudioToggle() {
  const now = performance.now();
  if (now - lastAudioToggle < 400) return;
  lastAudioToggle = now;
  toggleAudio(prefersReducedMotion);
}
canvas.addEventListener('click', handleAudioToggle);
canvas.addEventListener('touchstart', handleAudioToggle);

// --- Animation loop ---

/**
 * Frame state passed to scene renderers.
 * Pre-allocated to avoid GC pressure in the hot loop.
 *
 * @typedef {Object} FrameState
 * @property {number} time — elapsed time in seconds (monotonic)
 * @property {number} dt — delta time since last frame in seconds
 * @property {number} frame — frame counter
 * @property {boolean} reducedMotion — user prefers reduced motion
 */

/** @type {FrameState} */
const state = {
  time: 0,
  dt: 0,
  frame: 0,
  reducedMotion: prefersReducedMotion,
};

let lastTimestamp = 0;
let animFrameId = null;

/**
 * Main animation loop. Runs every frame via requestAnimationFrame.
 * @param {DOMHighResTimeStamp} timestamp
 */
function loop(timestamp) {
  animFrameId = requestAnimationFrame(loop);

  // Convert to seconds
  const timeSec = timestamp / 1000;

  if (lastTimestamp === 0) {
    lastTimestamp = timeSec;
  }

  const rawDt = Math.min(timeSec - lastTimestamp, 0.1); // Cap dt to avoid spiral of death
  state.dt = rawDt * SPEED;
  state.time += state.dt;
  state.frame++;
  lastTimestamp = timeSec;

  // Clear buffer
  renderer.clear();

  // Draw the scene into the off-screen buffer
  drawScene(renderer, state);

  // Scale buffer to display
  renderer.flush();
}

// --- Visibility API: pause when tab is hidden (battery) ---

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    suspendAudio();
  } else {
    // Reset timestamp to avoid huge dt spike on resume
    lastTimestamp = 0;
    resumeAudio();
    if (animFrameId === null) {
      animFrameId = requestAnimationFrame(loop);
    }
  }
});

// Kick off
animFrameId = requestAnimationFrame(loop);
