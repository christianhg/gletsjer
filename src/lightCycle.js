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
 * @property {number[]} snowTint — [r,g,b] per-channel multiplier for snow color (blue shift at night)
 * @property {number} ambientBrightness — 0→1, overall scene brightness
 * @property {number[]} waterDeep — [r,g,b] water's own deep color (what reflection fades toward)
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
    snowTint:      [0.90, 0.90, 0.95],  // Cool blue-white
    ambientBright: 0.85,
    waterDeep:     [12, 22, 42],         // Dark blue-green, glacial — headroom for banding
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
    snowTint:      [1.00, 0.98, 0.92],  // Slightly golden
    ambientBright: 1.0,
    waterDeep:     [18, 24, 35],         // Warmer dark — headroom for banding
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
    snowTint:      [0.75, 0.78, 0.90],  // Violet-shifted
    ambientBright: 0.7,
    waterDeep:     [10, 16, 38],         // Purple-tinged deep
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
    snowTint:      [0.55, 0.60, 0.75],  // Blue-shifted, dim — moonlit snow
    ambientBright: 0.5,
    waterDeep:     [4, 7, 16],           // Near-black, barely visible
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
    snowTint:      [0.82, 0.80, 0.85],  // Faint rose warmth
    ambientBright: 0.75,
    waterDeep:     [14, 18, 32],         // Cool pre-dawn
  },
];

// --- Doomsday palette: collapsed warm range ---
// Blue suppressed across all stops. The glacier can't get cold.
const DOOMSDAY_STOPS = [
  { // 0.00 — Warm baseline (was: cold blue)
    phase: 0.00,
    skyTop:        [22, 16, 20],
    skyBottom:     [68, 52, 48],
    shadowTint:    [6, 2, 0],
    highlightTint: [14, 8, 2],
    fogDensity:    0.65,
    fogColor:      [48, 38, 32],
    auroraVis:     0.0,
    starVis:       0.0,
    waterTint:     [0.28, 0.32, 0.52],
    waterFloor:    [14, 12, 18],
    glitch:        'mixed',
    snowBright:    0.85,
    snowTint:      [0.95, 0.92, 0.88],
    ambientBright: 0.90,
    waterDeep:     [16, 20, 30],
  },
  { // 0.20 — Warm amber (slightly hotter)
    phase: 0.20,
    skyTop:        [28, 20, 24],
    skyBottom:     [85, 62, 45],
    shadowTint:    [10, 4, -2],
    highlightTint: [20, 14, 0],
    fogDensity:    0.55,
    fogColor:      [58, 44, 32],
    auroraVis:     0.0,
    starVis:       0.0,
    waterTint:     [0.32, 0.34, 0.48],
    waterFloor:    [16, 12, 14],
    glitch:        'chromatic',
    snowBright:    0.95,
    snowTint:      [1.00, 0.96, 0.88],
    ambientBright: 1.0,
    waterDeep:     [20, 22, 28],
  },
  { // 0.38 — Dusky rose (was: deep violet)
    phase: 0.38,
    skyTop:        [18, 12, 16],
    skyBottom:     [52, 35, 42],
    shadowTint:    [8, 0, 4],
    highlightTint: [12, 4, 6],
    fogDensity:    0.70,
    fogColor:      [42, 30, 35],
    auroraVis:     0.10,
    starVis:       0.25,
    waterTint:     [0.24, 0.28, 0.50],
    waterFloor:    [10, 8, 16],
    glitch:        'mixed',
    snowBright:    0.65,
    snowTint:      [0.82, 0.78, 0.80],
    ambientBright: 0.72,
    waterDeep:     [14, 16, 28],
  },
  { // 0.55 — Warm night (was: near-black with cyan)
    phase: 0.55,
    skyTop:        [14, 8, 8],
    skyBottom:     [32, 20, 18],
    shadowTint:    [4, 0, 0],
    highlightTint: [6, 2, 0],
    fogDensity:    0.50,
    fogColor:      [22, 16, 14],
    auroraVis:     0.35,
    starVis:       0.60,
    waterTint:     [0.18, 0.22, 0.42],
    waterFloor:    [8, 6, 10],
    glitch:        'corruption',
    snowBright:    0.50,
    snowTint:      [0.65, 0.58, 0.55],
    ambientBright: 0.55,
    waterDeep:     [8, 8, 12],
  },
  { // 0.78 — Warm dawn (was: pale rose)
    phase: 0.78,
    skyTop:        [20, 14, 16],
    skyBottom:     [65, 48, 42],
    shadowTint:    [6, 2, 2],
    highlightTint: [12, 6, 4],
    fogDensity:    0.80,
    fogColor:      [50, 38, 34],
    auroraVis:     0.0,
    starVis:       0.10,
    waterTint:     [0.26, 0.30, 0.50],
    waterFloor:    [12, 10, 14],
    glitch:        'chromatic',
    snowBright:    0.78,
    snowTint:      [0.88, 0.82, 0.80],
    ambientBright: 0.80,
    waterDeep:     [16, 18, 24],
  },
];

// --- Day tier: date-seeded daily personality ---

/** @type {'common'|'mood'|'extreme'|'doomsday'} */
let _dayTier = 'common';
let _isDoomsday = false;

function getDayTier() {
  const tierRoll = dateHash(60);
  if (tierRoll < 0.01) return 'doomsday';
  if (tierRoll < 0.09) return 'extreme';
  if (tierRoll < 0.29) return 'mood';
  return 'common';
}

/** Read-only exports for scene.js */
export function isDoomsday() { return _isDoomsday; }
export function dayTier() { return _dayTier; }

// Full cycle duration in seconds (~10 minutes)
const CYCLE_DURATION = 600;

// --- Drift: Ornstein-Uhlenbeck + random walk ---
// The glacier never repeats. Speed wanders (OU, mean-reverts),
// palette wanders (random walk, hard-clamped).

/** Box-Muller transform. Zero allocation. */
function gaussianRandom() {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 || 0.001)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Ornstein-Uhlenbeck step (Euler-Maruyama discretization).
 * When θ=0, degenerates to pure random walk (no mean reversion).
 * @param {number} x — current deviation from mean
 * @param {number} dt — time step (seconds)
 * @param {number} θ — mean reversion rate (0 = pure random walk)
 * @param {number} σ — volatility
 */
function ouStep(x, dt, θ, σ) {
  return x - θ * x * dt + σ * Math.sqrt(dt) * gaussianRandom();
}

// Speed drift: OU process, mean-reverts. Cycle duration wanders 510-690s.
const SPEED_θ = 0.002;  // τ_revert ≈ 500s ≈ 8 min
const SPEED_σ = 0.003;  // 95% range ≈ ±9.4%, 3σ excursions to ±14%

// Palette drift: random walk (θ=0), hard-clamped to ±max.
const PAL_DRIFT = {
  skyWarmth: { σ: 0.002, max: 1.0 },   // Shifts sky R↑B↓ or R↓B↑
  fog:       { σ: 0.003, max: 0.15 },   // Shifts fogDensity
  aurora:    { σ: 0.002, max: 0.20 },   // Shifts auroraVisibility (cubic downstream)
  bright:    { σ: 0.002, max: 0.12 },   // Shifts ambientBrightness
};

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

/**
 * Date hash: deterministic [0,1) from calendar date + field index.
 * Same date + index always produces the same value. Different days diverge.
 */
export function dateHash(fieldIndex) {
  const d = new Date();
  const str = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  let h = fieldIndex * 2654435761; // Knuth multiplicative hash seed per field
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return ((h >>> 0) % 10000) / 10000; // Normalize to [0, 1)
}

// Center-of-gravity pull for daily bias — OU centered on dayBias instead of zero
// τ_revert ≈ 1000s ≈ 16min — gentle pull, doesn't kill volatility
const BIAS_θ = 0.001;

/**
 * Create the light cycle. Call once at init.
 * @returns {LightCycle}
 */
export function createLightCycle() {
  // Determine day tier and set module-level flags
  _dayTier = getDayTier();
  _isDoomsday = _dayTier === 'doomsday';

  const d = PAL_DRIFT;
  const ampScale = { common: 0.275, mood: 0.55, extreme: 0.75, doomsday: 1.0 }[_dayTier];

  // Daily bias center: gravitational center the walk orbits
  const dayBias = {
    skyWarmth: _isDoomsday ? 0.85  : (dateHash(61) - 0.5) * 2 * ampScale * d.skyWarmth.max,
    fog:       _isDoomsday ? 0.12  : (dateHash(62) - 0.5) * 2 * ampScale * d.fog.max,
    aurora:    _isDoomsday ? -0.16 : (dateHash(63) - 0.5) * 2 * ampScale * d.aurora.max,
    bright:    _isDoomsday ? 0.08  : (dateHash(64) - 0.5) * 2 * ampScale * d.bright.max,
  };

  // Speed bias: modifies base cycle speed (not OU drift)
  const speedAmp = { common: 0.05, mood: 0.15, extreme: 0.25, doomsday: 1.0 }[_dayTier];
  const speedBias = _isDoomsday ? -0.20 : (dateHash(65) - 0.5) * 2 * speedAmp;

  return {
    phase: dateHash(0),
    cycleSpeed: (1 / CYCLE_DURATION) * (1 + speedBias),
    speedDrift: 0,
    // Init position = daily bias center (drift evolves from here)
    skyWarmth:  dayBias.skyWarmth,
    fogMod:     dayBias.fog,
    auroraMod:  dayBias.aurora,
    brightMod:  dayBias.bright,
    dayBias,
    revolutionCount: 0,
  };
}

/**
 * Advance the light cycle. Speed drift makes every revolution unique.
 * @param {LightCycle} cycle
 * @param {number} dt — delta seconds
 */
export function updateLightCycle(cycle, dt) {
  // Speed drift: OU mean-reverts, cycle duration wanders 510-690s
  cycle.speedDrift = ouStep(cycle.speedDrift, dt, SPEED_θ, SPEED_σ);
  const effectiveSpeed = cycle.cycleSpeed * Math.max(0.5, 1 + cycle.speedDrift);
  const prevPhase = cycle.phase;
  cycle.phase = (cycle.phase + dt * effectiveSpeed) % 1;
  if (cycle.phase < prevPhase) cycle.revolutionCount++;

  // Palette drift: OU centered on daily bias (θ_bias pulls toward day's center)
  // After ~50min (5 revolutions), palette wanders 1.5× faster
  const palAccel = cycle.revolutionCount >= 5 ? 1.5 : 1.0;
  const d = PAL_DRIFT;
  const b = cycle.dayBias;
  // OU with mean = dayBias: offset → step → re-offset
  cycle.skyWarmth = clamp(ouStep(cycle.skyWarmth - b.skyWarmth, dt, BIAS_θ, d.skyWarmth.σ * palAccel) + b.skyWarmth, -d.skyWarmth.max, d.skyWarmth.max);
  cycle.fogMod    = clamp(ouStep(cycle.fogMod    - b.fog,      dt, BIAS_θ, d.fog.σ       * palAccel) + b.fog,       -d.fog.max,       d.fog.max);
  cycle.auroraMod = clamp(ouStep(cycle.auroraMod - b.aurora,   dt, BIAS_θ, d.aurora.σ    * palAccel) + b.aurora,    -d.aurora.max,    d.aurora.max);
  cycle.brightMod = clamp(ouStep(cycle.brightMod - b.bright,   dt, BIAS_θ, d.bright.σ    * palAccel) + b.bright,    -d.bright.max,    d.bright.max);
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
  snowTint: [0, 0, 0],
  ambientBrightness: 0,
  waterDeep: [0, 0, 0],
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
  const stops = _isDoomsday ? DOOMSDAY_STOPS : STOPS;

  // Find the two surrounding stops
  let a = stops[stops.length - 1];
  let b = stops[0];
  let t = 0;

  for (let i = 0; i < stops.length; i++) {
    const next = i + 1 < stops.length ? stops[i + 1] : stops[0];
    const nextPhase = i + 1 < stops.length ? next.phase : 1.0;

    if (phase >= stops[i].phase && phase < nextPhase) {
      a = stops[i];
      b = next;
      const span = nextPhase - stops[i].phase;
      t = span > 0 ? (phase - stops[i].phase) / span : 0;
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
  lerpRGB(_mood.snowTint, a.snowTint, b.snowTint, t);
  lerpRGB(_mood.waterDeep, a.waterDeep, b.waterDeep, t);
  _mood.ambientBrightness = a.ambientBright + (b.ambientBright - a.ambientBright) * t;

  // Glitch character: use the nearer stop's character (no interpolation for enums)
  _mood.glitchCharacter = t < 0.5 ? a.glitch : b.glitch;

  // --- Palette drift: every revolution is unique ---
  // Sky warmth: shift R up + B down (positive = warmer, negative = cooler)
  const sw = cycle.skyWarmth;
  _mood.skyTop[0]    = clamp(_mood.skyTop[0]    + sw * 8,  0, 255);
  _mood.skyTop[2]    = clamp(_mood.skyTop[2]    - sw * 5,  0, 255);
  _mood.skyBottom[0] = clamp(_mood.skyBottom[0] + sw * 12, 0, 255);
  _mood.skyBottom[2] = clamp(_mood.skyBottom[2] - sw * 8,  0, 255);
  // Fog, aurora, brightness
  _mood.fogDensity       = clamp(_mood.fogDensity       + cycle.fogMod,    0, 1);
  _mood.auroraVisibility = clamp(_mood.auroraVisibility + cycle.auroraMod, 0, 1);
  _mood.ambientBrightness = clamp(_mood.ambientBrightness + cycle.brightMod, 0.3, 1);

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
