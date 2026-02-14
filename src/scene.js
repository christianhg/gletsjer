/**
 * Scene — glacier rendering entry point
 *
 * Pipeline:
 *   0. Update light cycle → mood
 *   0b. Update rare event scheduler
 *   1. Sky (mood gradient)
 *   2. Aurora (sky zone + per-column ice light)
 *   3. Stars + shooting star (terrain occludes)
 *   4. Glacier layers (fog + aurora ice lighting + snow caps)
 *   4b. Ice calving (localized block displacement)
 *   5. Water (mood-tinted, calving ripple boost)
 *   6. Snow (whiteout-capable, blue-shifted)
 *   7. Glitch (deep glitch override + color inversion)
 *   8. Vignette
 */

import { createLightCycle, updateLightCycle, getMood, dateHash } from './lightCycle.js';
import { generateGlacier, renderGlacierSky, renderGlacierTerrain } from './glacier.js';
import { createAurora, renderAurora } from './aurora.js';
import { createStars, renderStars } from './stars.js';
import { createRareEvents, registerEvent, updateRareEvents, getEventState, forceEvent } from './rareEvents.js';
import { initShootingStar, renderShootingStar } from './shootingStar.js';
import { createCalving, updateCalving, applyCalving, applyScars, getCalvingDuration } from './calving.js';
import { renderWater } from './water.js';
import { createSnow, updateAndRenderSnow, activateWhiteout, beginWhiteoutTaper } from './snow.js';
import { createGlitch, updateGlitch, applyGlitch, applyDataBleed } from './glitch.js';
import { createVignette, applyVignette } from './vignette.js';
import { updateAudio, isAudioActive, getAudioElapsed,
         triggerCalvingSound, triggerShootingStarSound,
         triggerWhiteoutSound, taperWhiteoutSound, triggerDeepGlitchSound,
         triggerStillness, endStillness } from './audio.js';

let lightCycle = null;
let glacier = null;
let aurora = null;
let stars = null;
let rareEvents = null;
let calving = null;
let snow = null;
let glitch = null;
let vignette = null;

// --- Dev panel API (reads/writes internal state) ---
export const devAPI = {
  getLightCycle: () => lightCycle,
  getRareEvents: () => rareEvents,
  getSnow: () => snow,
  getGlitch: () => glitch,
  forceEvent: (id) => {
    if (!rareEvents) return;
    // Reset edge-detection so re-forcing same event triggers callbacks
    if (id === 'calving') { calvingWasActive = false; if (calving) calving.wasActive = false; }
    if (id === 'shootingStar') shootingStarWasActive = false;
    if (id === 'whiteout') { whiteoutWasActive = false; whiteoutTaperStarted = false; }
    if (id === 'deepGlitch') deepGlitchWasActive = false;
    if (id === 'stillness') stillnessWasActive = false;
    forceEvent(rareEvents, id);
  },
  frozen: false,
  speedMultiplier: 1,
};

// --- Residue state ---
let auroraResidue = 0.0;
let auroraHighStart = 0;
let fogResidueBoost = 0.0;

// --- Fog front state ---
let fogFrontX = -1;           // -1 = inactive, 0→1 = position across screen
let fogFrontDir = 1;          // 1 = left-to-right, -1 = right-to-left
let fogFrontIntensity = 0;    // 0→1, density behind the front
let fogFrontLastEnd = 0;      // performance.now() timestamp, 3-min gap

// Pre-allocated mood overlay (avoids mutating lightCycle singleton)
const renderMood = {};
const fogColorBuf = [0, 0, 0];

// Rare event edge-detection flags
let shootingStarWasActive = false;
let whiteoutWasActive = false;
let whiteoutTaperStarted = false;
let deepGlitchWasActive = false;
let calvingWasActive = false;
let stillnessWasActive = false;

/**
 * @param {import('./renderer.js').Renderer} renderer
 * @param {import('./main.js').FrameState} state
 */
export function drawScene(renderer, state) {
  const { width, height } = renderer;

  if (!glacier) {
    lightCycle = createLightCycle();
    glacier = generateGlacier(width, height);
    aurora = createAurora(width, height);
    stars = createStars(width, height);
    calving = createCalving(width, height);
    snow = createSnow(width, height);
    glitch = createGlitch(width, height);
    vignette = createVignette(width, height);

    rareEvents = createRareEvents();
    registerEvent(rareEvents, {
      id: 'shootingStar',
      meanInterval: 45 * 60,
      canActivate: (mood) => mood.starVisibility > 0.5,
      duration: () => 0.4 + Math.random() * 0.2,
    });
    registerEvent(rareEvents, {
      id: 'whiteout',
      meanInterval: 60 * 60,
      canActivate: () => true,
      duration: () => 10 + Math.random() * 5,
    });
    registerEvent(rareEvents, {
      id: 'deepGlitch',
      meanInterval: 90 * 60,
      canActivate: () => true,
      duration: () => 1 + Math.random() * 1,
    });
    registerEvent(rareEvents, {
      id: 'calving',
      meanInterval: 20 * 60,
      canActivate: () => true,
      duration: getCalvingDuration,
    });
    registerEvent(rareEvents, {
      id: 'stillness',
      meanInterval: 20 * 60,
      canActivate: () => getAudioElapsed() > 600 && isAudioActive(),
      duration: () => 3 + Math.random() * 2,
    });

    seedStartingState(width, height);
  }

  // 0. Mood (dev panel: freeze stops phase, speedMultiplier scales dt)
  const cycleDt = devAPI.frozen ? 0 : state.dt * devAPI.speedMultiplier;
  updateLightCycle(lightCycle, cycleDt);
  const mood = getMood(lightCycle);

  // 0a. Residue: aurora afterglow + calving fog surge
  // Aurora afterglow: accumulate when aurora is bright for 60+ seconds
  if (mood.auroraVisibility > 0.7) {
    if (auroraHighStart === 0) auroraHighStart = state.time;
    if (state.time - auroraHighStart > 60) {
      auroraResidue = Math.min(auroraResidue + state.dt * 0.01, 1.0);
    }
  } else {
    auroraHighStart = 0;
    if (auroraResidue > 0.001) auroraResidue *= Math.exp(-state.dt / 90); // τ = 90s
  }
  // Calving fog surge decay (τ = 60s)
  if (fogResidueBoost > 0.001) fogResidueBoost *= Math.exp(-state.dt / 60);

  // Fog front: Poisson trigger (λ=1/480 ≈ 8min mean), movement, reset
  if (fogFrontX < 0) {
    const now = performance.now();
    if (now - fogFrontLastEnd > 180000 && Math.random() < state.dt / 480) {
      fogFrontDir = Math.random() < 0.5 ? 1 : -1;
      fogFrontX = fogFrontDir > 0 ? -0.3 : 1.3;
      fogFrontIntensity = 0.3 + Math.random() * 0.7;
    }
  } else {
    fogFrontX += fogFrontDir * 0.004 * state.dt;
    if (fogFrontX > 1.3 || fogFrontX < -0.3) {
      fogFrontX = -1;
      fogFrontLastEnd = performance.now();
    }
  }

  // Build renderMood: copy mood + augment fog fields (zero-alloc)
  Object.assign(renderMood, mood);
  renderMood.fogDensity = Math.min(mood.fogDensity + fogResidueBoost, 1.0);
  fogColorBuf[0] = mood.fogColor[0];
  fogColorBuf[1] = mood.fogColor[1] + auroraResidue * 8;
  fogColorBuf[2] = mood.fogColor[2];
  renderMood.fogColor = fogColorBuf;
  renderMood.fogFrontX = fogFrontX;
  renderMood.fogFrontDir = fogFrontDir;
  renderMood.fogFrontIntensity = fogFrontIntensity;

  // 0b. Audio: update parameters from mood (dt for thermal inertia)
  if (isAudioActive()) updateAudio(mood, state.dt, fogFrontX);

  // 0c. Rare events
  updateRareEvents(rareEvents, state.dt, mood);
  handleShootingStar(width, height);
  handleWhiteout();
  handleDeepGlitch();

  const calvingEvent = getEventState(rareEvents, 'calving');
  if (calvingEvent.active && !calvingWasActive && isAudioActive()) triggerCalvingSound();
  if (!calvingEvent.active && calvingWasActive) fogResidueBoost = 0.15; // Calving fog surge
  calvingWasActive = calvingEvent.active;
  updateCalving(calving, calvingEvent);

  // Stillness: the glacier holds its breath. No visual signature.
  const stillnessEvent = getEventState(rareEvents, 'stillness');
  if (stillnessEvent.active && !stillnessWasActive) triggerStillness();
  if (!stillnessEvent.active && stillnessWasActive) endStillness();
  stillnessWasActive = stillnessEvent.active;

  // Render
  const imageData = renderer.getImageData();
  const data = imageData.data;

  // 1. Sky
  renderGlacierSky(glacier, data, state.time, renderMood);

  // 2. Aurora
  renderAurora(aurora, data, width, height, state.time, renderMood);

  // 3. Stars + shooting star
  renderStars(stars, data, width, state.time, renderMood);
  renderShootingStar(data, width, height, getEventState(rareEvents, 'shootingStar'));

  // 4. Glacier terrain (reads augmented fogDensity + fogColor)
  renderGlacierTerrain(glacier, data, state.time, renderMood, aurora);

  // 4b. Ice calving + scars
  applyCalving(calving, data, width, height, calvingEvent);
  applyScars(calving, data, width, height);

  // 5. Water (with calving ripple boost)
  renderWater(data, width, height, state.time, renderMood, calving.rippleBoost);

  // 6. Snow (whiteout-capable, blue-shifted)
  updateAndRenderSnow(snow, data, state.time, state.dt, renderMood);

  // 7. Glitch + deep glitch inversion
  updateGlitch(glitch, state.dt);
  applyGlitch(glitch, data, width, height, renderMood);

  const dgState = getEventState(rareEvents, 'deepGlitch');
  if (dgState.active && dgState.progress > 0.1 && dgState.progress < 0.15) {
    invertFrame(data, width, height);
    applyDataBleed(data, width, height, glitch.seed, glitch);
  }

  // 8. Vignette
  applyVignette(vignette, data);

  // 9. Dead pixel — screen damage, over everything including vignette
  const dp = glitch.deadPixel;
  if (dp && performance.now() - dp.birth < 30000) {
    const di = (dp.y * width + dp.x) * 4;
    data[di] = dp.r; data[di + 1] = dp.g; data[di + 2] = dp.b; data[di + 3] = 255;
  } else if (dp) { glitch.deadPixel = null; }

  renderer.putImageData();
}

// --- Rare event handlers ---

function handleShootingStar(width, height) {
  const s = getEventState(rareEvents, 'shootingStar');
  if (s.active && !shootingStarWasActive) {
    initShootingStar(width, height);
    if (isAudioActive()) triggerShootingStarSound();
  }
  shootingStarWasActive = s.active;
}

function handleWhiteout() {
  const s = getEventState(rareEvents, 'whiteout');
  if (s.active && !whiteoutWasActive) {
    activateWhiteout(snow);
    whiteoutTaperStarted = false;
    if (isAudioActive()) triggerWhiteoutSound();
  }
  if (s.active && !whiteoutTaperStarted && s.progress >= 0.8) {
    beginWhiteoutTaper(snow);
    whiteoutTaperStarted = true;
    if (isAudioActive()) taperWhiteoutSound();
  }
  if (!s.active && whiteoutWasActive) {
    if (!snow.tapering) beginWhiteoutTaper(snow);
    whiteoutTaperStarted = false;
    snow.residue = Math.min(snow.residue + 0.3, 1.0);
  }
  whiteoutWasActive = s.active;
}

function handleDeepGlitch() {
  const s = getEventState(rareEvents, 'deepGlitch');
  if (s.active && !deepGlitchWasActive) {
    glitch.active = true;
    glitch.seed = Math.random();
    glitch.burstDuration = s.duration;
    glitch.burstElapsed = 0;
    glitch.timer = s.duration;
    if (isAudioActive()) triggerDeepGlitchSound();
  }
  if (s.active) {
    // 2-3× normal peak — unmistakably different from a normal burst
    glitch.intensity = 1.5 + s.intensity * 1.5;
    glitch.burstElapsed = s.elapsed;
    glitch.timer = s.duration - s.elapsed;
    glitch.active = true;
  } else if (deepGlitchWasActive) {
    glitch.active = false;
    glitch.intensity = 0;
    glitch.timer = 3 + Math.random() * 5;
  }
  deepGlitchWasActive = s.active;
}

/**
 * Seed starting state — the glacier has history when you arrive.
 * Uses dateHash(10-50) for deterministic per-day seeding.
 * Called once at init, after all subsystems are created.
 */
function seedStartingState(width, height) {
  // 1. Calving scars: 2-3 pre-existing, partially decayed
  const scarCount = 2 + (dateHash(10) > 0.5 ? 1 : 0);
  for (let i = 0; i < scarCount; i++) {
    const base = 11 + i * 5;
    const blockW = 8 + (dateHash(base) * 8) | 0;       // 8-16px
    const blockH = 6 + (dateHash(base + 1) * 6) | 0;   // 6-12px
    const margin = (width * 0.2) | 0;
    const blockX = margin + (dateHash(base + 2) * (width - 2 * margin - blockW)) | 0;
    const blockY = ((height * 0.72) | 0) + (dateHash(base + 3) * 10) | 0;
    const jagged = calving.scarJagged[i];
    for (let j = 0; j < blockW; j++) jagged[j] = ((dateHash(50 + i * 16 + j) - 0.5) * 4) | 0;
    const age = 30 + dateHash(base + 4) * 210; // 30-240s ago
    calving.scars[i] = { blockX, blockY, blockW, blockH, jaggedOffset: jagged, birth: performance.now() - age * 1000 };
  }
  calving.scarIdx = scarCount % 4;

  // 2. Fog front: ~30% chance of mid-crossing
  if (dateHash(30) < 0.3) {
    fogFrontDir = dateHash(31) < 0.5 ? 1 : -1;
    fogFrontX = 0.2 + dateHash(32) * 0.6;  // 0.2-0.8, already mid-crossing
    fogFrontIntensity = 0.3 + dateHash(33) * 0.7;
  }

  // 3. Aurora afterglow: only if phase is post-aurora-peak (0.6-0.9)
  if (lightCycle.phase > 0.6 && lightCycle.phase < 0.9) {
    auroraResidue = dateHash(40) * 0.6;
  }

  // 4. Snow memory: always seeded, 0-0.4 range
  snow.residue = dateHash(41) * 0.4;

  // 5. Calving fog surge: if freshest scar < 60s old
  let freshestAge = Infinity;
  for (let i = 0; i < scarCount; i++) {
    const scar = calving.scars[i];
    if (scar) freshestAge = Math.min(freshestAge, (performance.now() - scar.birth) / 1000);
  }
  if (freshestAge < 60) fogResidueBoost = 0.15 * Math.exp(-freshestAge / 60);
}

/** Single-frame color inversion. The fourth-wall crack. ~0.1ms. */
function invertFrame(data, width, height) {
  const len = width * height * 4;
  for (let i = 0; i < len; i += 4) {
    data[i]     = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
}
