/**
 * Light Cycle — the heartbeat of the living glacier
 *
 * A single phase value (0→1) rotates continuously over ~10 minutes,
 * driving the entire mood of the scene. Every visual system reads
 * derived values from the mood object — no module computes mood
 * independently.
 *
 * Mood stops (phase → feeling):
 *   0.0  Cold blue    — glacier at rest, default
 *   0.2  Warm amber   — low sun, golden highlights
 *   0.4  Deep violet  — twilight, deep shadows
 *   0.6  Near-black   — deep night, aurora most visible
 *   0.8  Pale rose    — dawn, faintest warmth returning
 *   1.0  → wraps to 0.0
 *
 * Architecture:
 *   - createLightCycle() → init state
 *   - updateLightCycle(cycle, dt) → advance phase
 *   - getMood(cycle) → returns derived mood object (call once per frame)
 *   - All other modules receive the mood object, never compute phase
 */

/**
 * @typedef {Object} LightCycle
 * @property {number} phase — 0→1, continuous loop
 * @property {number} cycleSpeed — phase units per second
 */

/**
 * @typedef {Object} Mood
 * @property {number} phase — raw 0→1 value
 * @property {number[]} skyTop — [r,g,b] sky gradient top
 * @property {number[]} skyBottom — [r,g,b] sky gradient bottom
 * @property {number[]} shadowTint — [r,g,b] additive tint for shadows
 * @property {number[]} highlightTint — [r,g,b] additive tint for highlights
 * @property {number} fogDensity — 0→1, scales base fog per layer
 * @property {number[]} fogColor — [r,g,b] fog blends toward this
 * @property {number} auroraVisibility — 0→1, peaks during deep night
 * @property {number} starVisibility — 0→1, peaks during night
 * @property {number[]} waterTint — [r,g,b] multiplier for water color
 * @property {number} waterFloorR — base water color floor R
 * @property {number} waterFloorG — base water color floor G
 * @property {number} waterFloorB — base water color floor B
 * @property {string} glitchCharacter — 'chromatic' | 'corruption' | 'mixed'
 * @property {number} snowBrightness — 0→1, dims snow at night
 * @property {number} ambientBrightness — 0→1, overall scene brightness
 */

// --- Mood keyframes ---
// Each stop defines the visual character at that phase point.
// Values between stops are interpolated smoothly.

const STOPS = [
  { // 0.00 — Cold blue (default)
    phase: 0.00,
    skyTop:        [10, 10, 26],
    skyBottom:     [35, 42, 82],
    shadowTint:    [0, 0, 8],
    highlightTint: [0, 4, 12],
    fogDensity:    0.5,
    fogColor:      [30, 35, 60],
    auroraVis:     0.0,
    starVis:       0.0,
    waterTint:     [0.18, 0.38, 0.78],
    waterFloor:    [8, 12, 28],
    glitch:        'mixed',
    snowBright:    0.9,
    ambientBright: 0.85,
  },
  { // 0.20 — Warm amber (low sun)
    phase: 0.20,
    skyTop:        [25, 18, 35],
    skyBottom:     [82, 62, 55],
    shadowTint:    [8, 2, -4],
    highlightTint: [18, 12, -2],
    fogDensity:    0.4,
    fogColor:      [55, 42, 35],
    auroraVis:     0.0,
    starVis:       0.0,
    waterTint:     [0.30, 0.35, 0.55],
    waterFloor:    [14, 10, 16],
    glitch:        'chromatic',
    snowBright:    1.0,
    ambientBright: 1.0,
  },
  { // 0.38 — Deep violet (twilight)
    phase: 0.38,
    skyTop:        [12, 8, 28],
    skyBottom:     [40, 25, 65],
    shadowTint:    [6, -2, 14],
    highlightTint: [4, 0, 10],
    fogDensity:    0.6,
    fogColor:      [28, 20, 48],
    auroraVis:     0.2,
    starVis:       0.4,
    waterTint:     [0.15, 0.28, 0.72],
    waterFloor:    [6, 8, 24],
    glitch:        'mixed',
    snowBright:    0.7,
    ambientBright: 0.7,
  },
  { // 0.55 — Near-black with cyan (deep night, aurora peak)
    // Night phase is the longest segment (0.38→0.55→0.78)
    // This is where aurora and stars live — the most visually rich phase
    phase: 0.55,
    skyTop:        [4, 4, 12],
    skyBottom:     [12, 14, 30],
    shadowTint:    [0, -4, 4],
    highlightTint: [-4, 2, 8],
    fogDensity:    0.15,
    fogColor:      [10, 12, 22],
    auroraVis:     1.0,
    starVis:       1.0,
    waterTint:     [0.10, 0.25, 0.65],
    waterFloor:    [3, 5, 14],
    glitch:        'corruption',
    snowBright:    0.5,
    ambientBright: 0.5,
  },
  { // 0.78 — Pale rose (dawn)
    phase: 0.78,
    skyTop:        [18, 12, 22],
    skyBottom:     [62, 45, 58],
    shadowTint:    [4, 0, 6],
    highlightTint: [10, 4, 8],
    fogDensity:    0.85,
    fogColor:      [45, 35, 48],
    auroraVis:     0.0,
    starVis:       0.15,
    waterTint:     [0.22, 0.32, 0.65],
    waterFloor:    [10, 8, 18],
    glitch:        'chromatic',
    snowBright:    0.8,
    ambientBright: 0.75,
  },
];

// Full cycle duration in seconds (~10 minutes)
const CYCLE_DURATION = 600;

/**
 * Create the light cycle. Call once at init.
 * @returns {LightCycle}
 */
export function createLightCycle() {
  return {
    phase: 0,
    cycleSpeed: 1 / CYCLE_DURATION,
  };
}

/**
 * Advance the light cycle.
 * @param {LightCycle} cycle
 * @param {number} dt — delta seconds
 */
export function updateLightCycle(cycle, dt) {
  cycle.phase = (cycle.phase + dt * cycle.cycleSpeed) % 1;
}

// --- Pre-allocated mood object (reused every frame, zero GC) ---

/** @type {Mood} */
const _mood = {
  phase: 0,
  skyTop: [0, 0, 0],
  skyBottom: [0, 0, 0],
  shadowTint: [0, 0, 0],
  highlightTint: [0, 0, 0],
  fogDensity: 0,
  fogColor: [0, 0, 0],
  auroraVisibility: 0,
  starVisibility: 0,
  waterTint: [0, 0, 0],
  waterFloorR: 0,
  waterFloorG: 0,
  waterFloorB: 0,
  glitchCharacter: 'mixed',
  snowBrightness: 0,
  ambientBrightness: 0,
};

/**
 * Compute the current mood from the light cycle phase.
 * Returns a pre-allocated object — do NOT store references across frames.
 *
 * @param {LightCycle} cycle
 * @returns {Mood}
 */
export function getMood(cycle) {
  const phase = cycle.phase;

  // Find the two surrounding stops
  let a = STOPS[STOPS.length - 1];
  let b = STOPS[0];
  let t = 0;

  for (let i = 0; i < STOPS.length; i++) {
    const next = i + 1 < STOPS.length ? STOPS[i + 1] : STOPS[0];
    const nextPhase = i + 1 < STOPS.length ? next.phase : 1.0;

    if (phase >= STOPS[i].phase && phase < nextPhase) {
      a = STOPS[i];
      b = next;
      const span = nextPhase - STOPS[i].phase;
      t = span > 0 ? (phase - STOPS[i].phase) / span : 0;
      break;
    }
  }

  // Smooth interpolation (cubic ease in-out for imperceptible transitions)
  t = t * t * (3 - 2 * t);

  // Interpolate all derived values
  lerpRGB(_mood.skyTop, a.skyTop, b.skyTop, t);
  lerpRGB(_mood.skyBottom, a.skyBottom, b.skyBottom, t);
  lerpRGB(_mood.shadowTint, a.shadowTint, b.shadowTint, t);
  lerpRGB(_mood.highlightTint, a.highlightTint, b.highlightTint, t);
  lerpRGB(_mood.fogColor, a.fogColor, b.fogColor, t);
  lerpRGB(_mood.waterTint, a.waterTint, b.waterTint, t);

  _mood.phase = phase;
  _mood.fogDensity = a.fogDensity + (b.fogDensity - a.fogDensity) * t;
  _mood.auroraVisibility = a.auroraVis + (b.auroraVis - a.auroraVis) * t;
  _mood.starVisibility = a.starVis + (b.starVis - a.starVis) * t;
  _mood.waterFloorR = a.waterFloor[0] + (b.waterFloor[0] - a.waterFloor[0]) * t;
  _mood.waterFloorG = a.waterFloor[1] + (b.waterFloor[1] - a.waterFloor[1]) * t;
  _mood.waterFloorB = a.waterFloor[2] + (b.waterFloor[2] - a.waterFloor[2]) * t;
  _mood.snowBrightness = a.snowBright + (b.snowBright - a.snowBright) * t;
  _mood.ambientBrightness = a.ambientBright + (b.ambientBright - a.ambientBright) * t;

  // Glitch character: use the nearer stop's character (no interpolation for enums)
  _mood.glitchCharacter = t < 0.5 ? a.glitch : b.glitch;

  return _mood;
}

// --- Util ---

/**
 * Interpolate RGB into a pre-allocated target array. Zero allocation.
 * @param {number[]} out — target [r,g,b] (mutated in place)
 * @param {number[]} a — start [r,g,b]
 * @param {number[]} b — end [r,g,b]
 * @param {number} t — 0→1
 */
function lerpRGB(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}
