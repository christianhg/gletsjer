/**
 * Ice Calving — regular + epic calving as unified cascade
 *
 * Architecture:
 *   - Both regular and epic calving use the same cascade array
 *   - Regular calving: cascade count = 1, block 8-16px
 *   - Epic calving: cascade count = 2-3, blocks 6-32px, staggered timing
 *   - Triggered by rareEvents.js scheduler (not self-timed)
 *   - Own pixel manipulation (not through glitch.js — different metaphor)
 *   - Exposes rippleBoost for water.js (decays after splash)
 *   - Pre-allocated copy buffer — zero GC during effect
 *
 * Cascade sub-block phases (each block runs independently):
 *   Crack  (0–15% progress): Bright cyan-white line appears at block top
 *   Fall   (15–70% progress): Block displaces downward with gravity ease-in
 *   Splash (70–100% progress): Block fades out, ripple peaks then decays
 *
 * Epic-only visual systems:
 *   Splash columns: bright pixel columns at water impact points, 4s fade
 *   Dust clouds: fog-colored overlay at crack site, 1s ramp + 7s decay
 *
 * Tuning:
 *   BLOCK_W_MIN/MAX     8-16px   Regular block width
 *   BLOCK_H_MIN/MAX     6-12px   Regular block height
 *   FALL_DISTANCE        10-18px  Regular fall distance
 *   RIPPLE_BOOST_PEAK    2.5      Regular ripple peak (epic main: 3.5)
 *   CRACK_BRIGHTNESS     180      Cyan-white crack line intensity
 *   GAP_DARKEN           0.4      Exposed interior darkening factor
 */

// --- Constants ---

/** Regular block dimensions (pixels) */
const BLOCK_W_MIN = 8;
const BLOCK_W_MAX = 16;
const BLOCK_H_MIN = 6;
const BLOCK_H_MAX = 12;

/** Regular fall distance range (pixels) */
const FALL_DIST_MIN = 10;
const FALL_DIST_MAX = 18;

/** Phase boundaries (fraction of total progress 0→1) */
const CRACK_END = 0.15;
const FALL_END = 0.70;
// Splash: 0.70 → 1.0

/** Ripple boost */
const RIPPLE_BOOST_PEAK = 2.5;
const RIPPLE_BOOST_PEAK_EPIC = 3.5;

/** Crack line brightness */
const CRACK_BRIGHTNESS = 180;

/** Gap darkening factor (exposed interior) */
const GAP_DARKEN = 0.4;

/** Calving zone: foreground shelf near waterline */
const CALVE_ZONE_Y_FRAC = 0.72;
const CALVE_ZONE_RANGE = 10;

/** Total event duration reported to scheduler */
const BASE_DURATION = 3.0;

/** Max cascade sub-blocks */
const MAX_CASCADE = 3;

/** Max splash columns / dust clouds (matches MAX_CASCADE) */
const MAX_SPLASH = 3;
const MAX_DUST = 3;

/** Splash column lifetime (seconds) */
const SPLASH_LIFETIME = 4.0;

/** Dust cloud lifetime (seconds) — 1s ramp + 7s decay */
const DUST_LIFETIME = 8.0;

/** Scar ring buffer size */
const SCAR_COUNT = 8;

/** Max block width for pre-allocated buffers */
const EPIC_BLOCK_W_MAX = 40;

/**
 * Create the calving system. Call once at init.
 */
export function createCalving(width, height) {
  // Pre-allocate copy buffer for max possible block (epic: up to 32px wide × 16px tall)
  const bufSize = EPIC_BLOCK_W_MAX * 20 * 4;

  // Pre-allocate scar jagged offset arrays
  const scarJagged = [];
  for (let s = 0; s < SCAR_COUNT; s++) scarJagged.push(new Int8Array(EPIC_BLOCK_W_MAX));

  // Pre-allocate cascade sub-blocks
  const cascade = [];
  for (let i = 0; i < MAX_CASCADE; i++) {
    cascade.push({
      active: false,
      blockX: 0, blockY: 0, blockW: 0, blockH: 0,
      fallDist: 0,
      jaggedOffset: new Int8Array(EPIC_BLOCK_W_MAX),
      startDelay: 0,
      elapsed: 0,
      duration: BASE_DURATION,
      progress: 0,
      phase: 'idle',  // 'idle' | 'waiting' | 'crack' | 'fall' | 'splash' | 'done'
      isMain: false,   // true for the main (biggest) block in epic cascade
    });
  }

  // Pre-allocate splash columns
  const splashColumns = [];
  for (let i = 0; i < MAX_SPLASH; i++) {
    splashColumns.push({ active: false, x: 0, width: 0, intensity: 0, birth: 0 });
  }

  // Pre-allocate dust clouds
  const dustClouds = [];
  for (let i = 0; i < MAX_DUST; i++) {
    dustClouds.push({ active: false, x: 0, y: 0, width: 0, intensity: 0, birth: 0 });
  }

  return {
    // Cascade state
    cascade,
    cascadeCount: 0,
    epicActive: false,
    isEpic: false,

    // Shared state
    rippleBoost: 1.0,
    wasActive: false,
    copyBuf: new Uint8ClampedArray(bufSize),

    // Visual effects (epic only)
    splashColumns,
    dustClouds,

    // Scars
    scars: new Array(SCAR_COUNT).fill(null),
    scarIdx: 0,
    scarJagged,

    // Canvas dimensions
    width,
    height,
  };
}

/**
 * Duration callback for regular calving.
 */
export function getCalvingDuration() {
  return BASE_DURATION + Math.random() * 0.5;
}

/**
 * Duration callback for epic calving.
 */
export function getEpicCalvingDuration() {
  return 7 + Math.random() * 2;
}

/**
 * Update calving state based on scheduler event state.
 * Handles both regular and epic calving through unified cascade.
 *
 * @param {Object} calving - CalvingSystem
 * @param {{ active: boolean, elapsed: number, progress: number }} eventState
 * @param {boolean} isEpic - true for epicCalving event
 * @param {number} [cameraDriftX] - global camera drift offset (pixels)
 */
export function updateCalving(calving, eventState, isEpic, cameraDriftX) {
  const { active, progress, elapsed } = eventState;
  const drift = cameraDriftX || 0;

  // Rising edge: event just activated — pick blocks
  if (active && !calving.wasActive) {
    calving.isEpic = isEpic;
    if (isEpic) {
      pickEpicSequence(calving);
    } else {
      pickRegularBlock(calving);
    }
  }

  // Falling edge: event just ended — snapshot scars for all active/done blocks
  if (!active && calving.wasActive) {
    for (let i = 0; i < calving.cascadeCount; i++) {
      const block = calving.cascade[i];
      if (block.phase !== 'idle' && block.phase !== 'waiting') {
        snapshotScar(calving, block, drift);
      }
      block.active = false;
      block.phase = 'idle';
    }
    calving.epicActive = false;
    calving.cascadeCount = 0;
  }
  calving.wasActive = active;

  if (!active) {
    calving.rippleBoost = 1.0;
    return;
  }

  // Update each cascade sub-block
  let totalRipple = 1.0;
  for (let i = 0; i < calving.cascadeCount; i++) {
    const block = calving.cascade[i];
    if (!block.active) continue;

    // Advance elapsed time
    block.elapsed = elapsed - block.startDelay;
    if (block.elapsed < 0) {
      block.phase = 'waiting';
      continue;
    }

    block.progress = Math.min(1, block.elapsed / block.duration);

    // Determine phase
    if (block.progress < CRACK_END) {
      block.phase = 'crack';
    } else if (block.progress < FALL_END) {
      block.phase = 'fall';
    } else if (block.progress < 1.0) {
      block.phase = 'splash';
    } else {
      block.phase = 'done';
      block.active = false;
    }

    // Compute per-block ripple contribution
    const peak = block.isMain ? RIPPLE_BOOST_PEAK_EPIC : RIPPLE_BOOST_PEAK;
    if (block.progress < CRACK_END) {
      // No ripple during crack
    } else if (block.progress < FALL_END) {
      const fallProgress = (block.progress - CRACK_END) / (FALL_END - CRACK_END);
      totalRipple += fallProgress * 1.5;
    } else {
      const splashProgress = (block.progress - FALL_END) / (1.0 - FALL_END);
      totalRipple += (peak - 1.0) * (1.0 - splashProgress * splashProgress);
    }
  }
  calving.rippleBoost = totalRipple;
}

/**
 * Apply calving visual effect to the pixel buffer.
 * Renders all active cascade sub-blocks.
 * Call AFTER glacier terrain rendering, BEFORE water.
 */
export function applyCalving(calving, data, width, height) {
  for (let i = 0; i < calving.cascadeCount; i++) {
    const block = calving.cascade[i];
    if (!block.active || block.phase === 'idle' || block.phase === 'waiting') continue;

    if (block.phase === 'crack') {
      // Bright cyan-white line at the top of the calving block (jagged)
      const crackIntensity = (block.progress / CRACK_END) * CRACK_BRIGHTNESS;
      for (let dx = 0; dx < block.blockW; dx++) {
        const x = block.blockX + dx;
        if (x >= width) break;
        const crackY = block.blockY + block.jaggedOffset[dx];
        if (crackY < 0 || crackY >= height) continue;
        const idx = (crackY * width + x) * 4;
        data[idx]     = clamp255(data[idx] + crackIntensity * 0.6);
        data[idx + 1] = clamp255(data[idx + 1] + crackIntensity * 0.9);
        data[idx + 2] = clamp255(data[idx + 2] + crackIntensity);
      }

      // Epic: spawn dust cloud at crack start (first frame of crack phase)
      if (calving.isEpic && block.progress < 0.02) {
        spawnDust(calving, block);
      }
      continue;
    }

    if (block.phase === 'fall') {
      const fallProgress = (block.progress - CRACK_END) / (FALL_END - CRACK_END);
      const eased = fallProgress * fallProgress;
      const disp = (eased * block.fallDist) | 0;
      if (disp > 0) {
        displaceBlock(calving, block, data, width, height, disp, 1.0, fallProgress);
      }
      continue;
    }

    if (block.phase === 'splash') {
      const splashProgress = (block.progress - FALL_END) / (1.0 - FALL_END);
      const opacity = 1.0 - splashProgress;

      // Spawn splash column at splash start (first frame)
      if (calving.isEpic && splashProgress < 0.05) {
        spawnSplash(calving, block);
      }

      if (opacity > 0.01) {
        displaceBlock(calving, block, data, width, height, block.fallDist, opacity, 1.0);
      }
    }
  }
}

/**
 * Apply calving scars — faint darkened patches from past calving events.
 * Scars store world-space X, converted to screen-space using cameraDriftX.
 */
export function applyScars(calving, data, width, height, cameraDriftX) {
  const now = performance.now();
  const drift = cameraDriftX || 0;
  for (let s = 0; s < SCAR_COUNT; s++) {
    const scar = calving.scars[s];
    if (!scar) continue;
    const age = (now - scar.birth) / 1000;
    const opacity = Math.exp(-age / 300); // τ = 300s = 5min
    if (opacity < 0.01) { calving.scars[s] = null; continue; }
    const darken = 1 - opacity * 0.18;
    const scarScreenX = scar.worldX !== undefined
      ? ((scar.worldX - drift) | 0)
      : scar.blockX;
    for (let dy = 0; dy < scar.blockH; dy++) {
      for (let dx = 0; dx < scar.blockW; dx++) {
        const py = scar.blockY + scar.jaggedOffset[dx] + dy;
        const px = scarScreenX + dx;
        if (px < 0 || px >= width || py < 0 || py >= height) continue;
        const idx = (py * width + px) * 4;
        data[idx]     = (data[idx] * darken) | 0;
        data[idx + 1] = (data[idx + 1] * darken) | 0;
        data[idx + 2] = (data[idx + 2] * darken) | 0;
      }
    }
  }
}

/**
 * Apply dust clouds — fog-colored overlay at crack sites (epic only).
 * Call AFTER calving/scars, BEFORE water.
 */
export function applyDust(calving, data, width, height, mood) {
  const now = performance.now();
  for (let d = 0; d < MAX_DUST; d++) {
    const dust = calving.dustClouds[d];
    if (!dust.active) continue;
    const age = (now - dust.birth) / 1000;
    if (age > DUST_LIFETIME) { dust.active = false; continue; }

    // 1s ramp up, 7s decay
    const fade = age < 1.0 ? age : 1.0 - ((age - 1.0) / 7.0);
    const spread = dust.width * (1 + age * 0.15); // 15%/s spread
    const fogAdd = dust.intensity * fade;
    if (fogAdd < 0.005) continue;

    const halfW = (spread / 2) | 0;
    const dustRows = 8;
    const fogR = mood.fogColor[0];
    const fogG = mood.fogColor[1];
    const fogB = mood.fogColor[2];

    for (let dy = 0; dy < dustRows; dy++) {
      const py = dust.y - dy;
      if (py < 0 || py >= height) continue;
      const rowFade = 1.0 - (dy / dustRows);
      for (let dx = -halfW; dx < halfW; dx++) {
        const px = dust.x + dx;
        if (px < 0 || px >= width) continue;
        const edgeFade = 1.0 - Math.abs(dx) / halfW;
        const str = fogAdd * rowFade * edgeFade * edgeFade;
        if (str < 0.01) continue;
        const idx = (py * width + px) * 4;
        data[idx]     = (data[idx]     + (fogR - data[idx])     * str) | 0;
        data[idx + 1] = (data[idx + 1] + (fogG - data[idx + 1]) * str) | 0;
        data[idx + 2] = (data[idx + 2] + (fogB - data[idx + 2]) * str) | 0;
      }
    }
  }
}

/**
 * Apply splash columns — bright pixel columns at water impact points (epic only).
 * Call AFTER renderWater, BEFORE snow.
 */
export function applySplash(calving, data, width, height) {
  const now = performance.now();
  const waterlineY = (height * 0.78) | 0;

  for (let s = 0; s < MAX_SPLASH; s++) {
    const splash = calving.splashColumns[s];
    if (!splash.active) continue;
    const age = (now - splash.birth) / 1000;
    if (age > SPLASH_LIFETIME) { splash.active = false; continue; }

    const fade = 1.0 - (age / SPLASH_LIFETIME);
    const fadeEased = fade * fade; // Quadratic — fast initial, slow tail

    const maxRows = Math.min(6, height - waterlineY);
    for (let wy = 0; wy < maxRows; wy++) {
      const rowFade = 1.0 - (wy / 6);
      const halfW = (splash.width / 2) | 0;
      for (let dx = -halfW; dx < halfW; dx++) {
        const px = (splash.x + dx) | 0;
        if (px < 0 || px >= width) continue;

        // Spray pattern: brighter at center, noisy at edges
        const centerDist = Math.abs(dx) / (halfW || 1);
        const sprayNoise = ((px * 17 + wy * 31 + (age * 10 | 0) * 7) & 0xFF) / 255;
        if (centerDist > 0.6 && sprayNoise > 0.5) continue;

        const str = fadeEased * rowFade * splash.intensity * 40;
        const dstIdx = ((waterlineY + wy) * width + px) * 4;
        // Additive white-cyan (same palette as crack line)
        data[dstIdx]     = clamp255(data[dstIdx]     + str * 0.7);
        data[dstIdx + 1] = clamp255(data[dstIdx + 1] + str * 0.9);
        data[dstIdx + 2] = clamp255(data[dstIdx + 2] + str);
      }
    }
  }
}

// --- Internal: block picking ---

/**
 * Pick a single regular calving block (cascade count = 1).
 */
function pickRegularBlock(calving) {
  const { width, height } = calving;
  const block = calving.cascade[0];

  block.active = true;
  block.startDelay = 0;
  block.elapsed = 0;
  block.duration = BASE_DURATION + Math.random() * 0.5;
  block.progress = 0;
  block.phase = 'crack';
  block.isMain = false;

  block.blockW = BLOCK_W_MIN + ((Math.random() * (BLOCK_W_MAX - BLOCK_W_MIN)) | 0);
  block.blockH = BLOCK_H_MIN + ((Math.random() * (BLOCK_H_MAX - BLOCK_H_MIN)) | 0);

  const margin = (width * 0.2) | 0;
  block.blockX = margin + ((Math.random() * (width - 2 * margin - block.blockW)) | 0);
  block.blockY = ((height * CALVE_ZONE_Y_FRAC) | 0) + ((Math.random() * CALVE_ZONE_RANGE) | 0);
  block.fallDist = FALL_DIST_MIN + ((Math.random() * (FALL_DIST_MAX - FALL_DIST_MIN)) | 0);

  // Jagged top edge
  for (let dx = 0; dx < block.blockW; dx++) {
    block.jaggedOffset[dx] = (((block.blockX + dx) * 17 + dx * 31) & 3) - 1;
  }

  calving.cascadeCount = 1;
  calving.epicActive = false;
}

/**
 * Pick epic cascade sequence: lead → main → fragment (70%).
 * Blocks are spatially clustered — pieces of the same section.
 */
function pickEpicSequence(calving) {
  const { width, height } = calving;
  const margin = (width * 0.2) | 0;

  // Main block: 24-32px wide, the big one
  const mainW = 24 + ((Math.random() * 8) | 0);
  const mainH = 10 + ((Math.random() * 6) | 0);
  const mainX = margin + ((Math.random() * (width - 2 * margin - mainW)) | 0);
  const mainY = ((height * CALVE_ZONE_Y_FRAC) | 0) + ((Math.random() * CALVE_ZONE_RANGE) | 0);

  // Lead block: smaller, adjacent to main
  const leadW = 8 + ((Math.random() * 6) | 0);
  const leadH = 6 + ((Math.random() * 4) | 0);
  const leadSide = Math.random() < 0.5 ? -1 : 1;
  const leadX = Math.max(0, Math.min(width - leadW,
    mainX + (leadSide > 0 ? mainW + 2 : -leadW - 2)));
  const leadY = mainY + ((Math.random() * 4 - 2) | 0);

  // Block 0: Lead (t=0)
  const lead = calving.cascade[0];
  lead.active = true;
  lead.startDelay = 0;
  lead.elapsed = 0;
  lead.duration = BASE_DURATION;
  lead.progress = 0;
  lead.phase = 'crack';
  lead.isMain = false;
  lead.blockX = leadX;
  lead.blockY = leadY;
  lead.blockW = leadW;
  lead.blockH = leadH;
  lead.fallDist = 12 + ((Math.random() * 6) | 0);
  for (let dx = 0; dx < leadW; dx++) {
    lead.jaggedOffset[dx] = (((leadX + dx) * 17 + dx * 31) & 3) - 1;
  }

  // Block 1: Main (t=1.0-1.5s)
  const main = calving.cascade[1];
  main.active = true;
  main.startDelay = 1.0 + Math.random() * 0.5;
  main.elapsed = 0;
  main.duration = BASE_DURATION + 0.5;
  main.progress = 0;
  main.phase = 'waiting';
  main.isMain = true;
  main.blockX = mainX;
  main.blockY = mainY;
  main.blockW = mainW;
  main.blockH = mainH;
  main.fallDist = 20 + ((Math.random() * 10) | 0);
  for (let dx = 0; dx < mainW; dx++) {
    main.jaggedOffset[dx] = (((mainX + dx) * 17 + dx * 31) & 3) - 1;
  }

  calving.cascadeCount = 2;

  // 70% chance of trailing fragment
  if (Math.random() < 0.7) {
    const fragW = 6 + ((Math.random() * 4) | 0);
    const fragH = 4 + ((Math.random() * 4) | 0);
    const fragX = mainX + ((Math.random() * (mainW - fragW)) | 0);
    const fragY = mainY - 2 + ((Math.random() * 4) | 0);

    const frag = calving.cascade[2];
    frag.active = true;
    frag.startDelay = 2.5 + Math.random() * 1.0;
    frag.elapsed = 0;
    frag.duration = BASE_DURATION;
    frag.progress = 0;
    frag.phase = 'waiting';
    frag.isMain = false;
    frag.blockX = fragX;
    frag.blockY = fragY;
    frag.blockW = fragW;
    frag.blockH = fragH;
    frag.fallDist = 8 + ((Math.random() * 8) | 0);
    for (let dx = 0; dx < fragW; dx++) {
      frag.jaggedOffset[dx] = (((fragX + dx) * 17 + dx * 31) & 3) - 1;
    }

    calving.cascadeCount = 3;
  }

  calving.epicActive = true;
}

// --- Internal: visual effect spawning ---

function spawnSplash(calving, block) {
  for (let s = 0; s < MAX_SPLASH; s++) {
    const splash = calving.splashColumns[s];
    if (splash.active) continue;
    splash.active = true;
    splash.x = block.blockX + (block.blockW >> 1);
    splash.width = Math.min(block.blockW, 20);
    splash.intensity = block.blockW / 32;
    splash.birth = performance.now();
    return;
  }
}

function spawnDust(calving, block) {
  for (let d = 0; d < MAX_DUST; d++) {
    const dust = calving.dustClouds[d];
    if (dust.active) continue;
    dust.active = true;
    dust.x = block.blockX + (block.blockW >> 1);
    dust.y = block.blockY;
    dust.width = block.blockW;
    dust.intensity = 0.15;
    dust.birth = performance.now();
    return;
  }
}

// --- Internal: scar snapshot ---

function snapshotScar(calving, block, drift) {
  const idx = calving.scarIdx;
  const jagged = calving.scarJagged[idx];
  jagged.set(block.jaggedOffset.subarray(0, block.blockW));
  calving.scars[idx] = {
    blockX: block.blockX, blockY: block.blockY,
    blockW: block.blockW, blockH: block.blockH,
    worldX: block.blockX + drift,
    jaggedOffset: jagged, birth: performance.now(),
  };
  calving.scarIdx = (idx + 1) % SCAR_COUNT;
}

// --- Internal: block displacement ---

/**
 * Displace a block of pixels downward and fill the gap.
 */
function displaceBlock(calving, block, data, width, height, disp, opacity, fallProgress) {
  const { blockX, blockY, blockW, blockH, jaggedOffset } = block;
  const { copyBuf } = calving;

  // Copy block pixels into pre-allocated buffer (jagged source)
  let bufIdx = 0;
  for (let dy = 0; dy < blockH; dy++) {
    for (let dx = 0; dx < blockW; dx++) {
      const srcY = blockY + jaggedOffset[dx] + dy;
      const x = blockX + dx;
      if (x >= 0 && x < width && srcY >= 0 && srcY < height) {
        const srcIdx = (srcY * width + x) * 4;
        copyBuf[bufIdx]     = data[srcIdx];
        copyBuf[bufIdx + 1] = data[srcIdx + 1];
        copyBuf[bufIdx + 2] = data[srcIdx + 2];
        copyBuf[bufIdx + 3] = 255;
      }
      bufIdx += 4;
    }
  }

  // Write displaced block from buffer (with edge crumble)
  bufIdx = 0;
  for (let dy = 0; dy < blockH; dy++) {
    for (let dx = 0; dx < blockW; dx++) {
      const dstY = blockY + jaggedOffset[dx] + dy + disp;
      const x = blockX + dx;
      if (x >= 0 && x < width && dstY >= 0 && dstY < height) {
        // Edge crumble: skip edge pixels probabilistically as fall progresses
        if (fallProgress > 0) {
          const isEdge = dx === 0 || dx === blockW - 1;
          const isNearEdge = dx === 1 || dx === blockW - 2;
          if (isEdge || isNearEdge) {
            const threshold = isEdge ? fallProgress * 0.7 : fallProgress * 0.3;
            const hash = ((blockX * 17 + dx * 31 + dy * 7) & 0xFF) / 255;
            if (hash < threshold) {
              bufIdx += 4;
              continue;
            }
          }
        }

        const dstIdx = (dstY * width + x) * 4;
        if (opacity >= 0.99) {
          data[dstIdx]     = copyBuf[bufIdx];
          data[dstIdx + 1] = copyBuf[bufIdx + 1];
          data[dstIdx + 2] = copyBuf[bufIdx + 2];
        } else {
          data[dstIdx]     = (data[dstIdx]     + (copyBuf[bufIdx]     - data[dstIdx])     * opacity) | 0;
          data[dstIdx + 1] = (data[dstIdx + 1] + (copyBuf[bufIdx + 1] - data[dstIdx + 1]) * opacity) | 0;
          data[dstIdx + 2] = (data[dstIdx + 2] + (copyBuf[bufIdx + 2] - data[dstIdx + 2]) * opacity) | 0;
        }
      }
      bufIdx += 4;
    }
  }

  // Fill the gap with darkened pixels (jagged top edge)
  const gapRows = Math.min(disp, blockH);
  for (let dy = 0; dy < gapRows; dy++) {
    for (let dx = 0; dx < blockW; dx++) {
      const gapY = blockY + jaggedOffset[dx] + dy;
      const x = blockX + dx;
      if (x < 0 || x >= width || gapY < 0 || gapY >= height) continue;
      const idx = (gapY * width + x) * 4;
      data[idx]     = (data[idx] * GAP_DARKEN) | 0;
      data[idx + 1] = (data[idx + 1] * (GAP_DARKEN + 0.1)) | 0;
      data[idx + 2] = (data[idx + 2] * (GAP_DARKEN + 0.2)) | 0;
    }
  }
}

/** @param {number} v */
function clamp255(v) {
  return v > 255 ? 255 : v | 0;
}
