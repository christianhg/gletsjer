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

import { createLightCycle, updateLightCycle, getMood } from './lightCycle.js';
import { generateGlacier, renderGlacierSky, renderGlacierTerrain } from './glacier.js';
import { createAurora, renderAurora } from './aurora.js';
import { createStars, renderStars } from './stars.js';
import { createRareEvents, registerEvent, updateRareEvents, getEventState } from './rareEvents.js';
import { initShootingStar, renderShootingStar } from './shootingStar.js';
import { createCalving, updateCalving, applyCalving, getCalvingDuration } from './calving.js';
import { renderWater } from './water.js';
import { createSnow, updateAndRenderSnow, activateWhiteout, beginWhiteoutTaper } from './snow.js';
import { createGlitch, updateGlitch, applyGlitch } from './glitch.js';
import { createVignette, applyVignette } from './vignette.js';
import { updateAudio, isAudioActive, triggerCalvingSound, triggerShootingStarSound,
         triggerWhiteoutSound, taperWhiteoutSound, triggerDeepGlitchSound } from './audio.js';

let lightCycle = null;
let glacier = null;
let aurora = null;
let stars = null;
let rareEvents = null;
let calving = null;
let snow = null;
let glitch = null;
let vignette = null;

// Rare event edge-detection flags
let shootingStarWasActive = false;
let whiteoutWasActive = false;
let whiteoutTaperStarted = false;
let deepGlitchWasActive = false;
let calvingWasActive = false;

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
  }

  // 0. Mood
  updateLightCycle(lightCycle, state.dt);
  const mood = getMood(lightCycle);

  // 0a. Audio: update parameters from mood
  if (isAudioActive()) updateAudio(mood);

  // 0b. Rare events
  updateRareEvents(rareEvents, state.dt, mood);
  handleShootingStar(width, height);
  handleWhiteout();
  handleDeepGlitch();

  const calvingEvent = getEventState(rareEvents, 'calving');
  if (calvingEvent.active && !calvingWasActive && isAudioActive()) triggerCalvingSound();
  calvingWasActive = calvingEvent.active;
  updateCalving(calving, calvingEvent);

  // Render
  const imageData = renderer.getImageData();
  const data = imageData.data;

  // 1. Sky
  renderGlacierSky(glacier, data, state.time, mood);

  // 2. Aurora
  renderAurora(aurora, data, width, height, state.time, mood);

  // 3. Stars + shooting star
  renderStars(stars, data, width, state.time, mood);
  renderShootingStar(data, width, height, getEventState(rareEvents, 'shootingStar'));

  // 4. Glacier terrain
  renderGlacierTerrain(glacier, data, state.time, mood, aurora);

  // 4b. Ice calving
  applyCalving(calving, data, width, height, calvingEvent);

  // 5. Water (with calving ripple boost)
  renderWater(data, width, height, state.time, mood, calving.rippleBoost);

  // 6. Snow (whiteout-capable, blue-shifted)
  updateAndRenderSnow(snow, data, state.time, state.dt, mood);

  // 7. Glitch + deep glitch inversion
  updateGlitch(glitch, state.dt);
  applyGlitch(glitch, data, width, height, mood);

  const dgState = getEventState(rareEvents, 'deepGlitch');
  if (dgState.active && dgState.progress > 0.1 && dgState.progress < 0.15) {
    invertFrame(data, width, height);
  }

  // 8. Vignette
  applyVignette(vignette, data);

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

/** Single-frame color inversion. The fourth-wall crack. ~0.1ms. */
function invertFrame(data, width, height) {
  const len = width * height * 4;
  for (let i = 0; i < len; i += 4) {
    data[i]     = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
}
