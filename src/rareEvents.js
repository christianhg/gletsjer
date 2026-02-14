/**
 * Rare Events — the moments you can't screenshot
 *
 * Poisson-distributed scheduler for infrequent, mood-gated events.
 * Global mutex: only one rare event at a time, 60-90s cooldown after.
 *
 * Events: shooting star, whiteout, deep glitch, ice calving.
 * Each registered with meanInterval, canActivate(mood), duration().
 */

/**
 * @typedef {Object} RareEventDef
 * @property {string} id
 * @property {number} meanInterval — average seconds between events
 * @property {function(import('./lightCycle.js').Mood): boolean} canActivate
 * @property {function(): number} duration — returns seconds
 */

/**
 * @typedef {Object} RareEventState
 * @property {string} id
 * @property {boolean} active
 * @property {number} cooldown
 * @property {number} elapsed
 * @property {number} duration
 * @property {number} progress — 0→1
 * @property {number} intensity — envelope: ramp 10%, sustain, taper 20%
 */

/**
 * @typedef {Object} RareEventScheduler
 * @property {Map<string, RareEventDef>} defs
 * @property {Map<string, RareEventState>} states
 * @property {string|null} activeEvent
 * @property {number} globalCooldown
 */

/** @returns {RareEventScheduler} */
export function createRareEvents() {
  return {
    defs: new Map(),
    states: new Map(),
    activeEvent: null,
    globalCooldown: 30,
  };
}

/**
 * @param {RareEventScheduler} scheduler
 * @param {RareEventDef} def
 */
export function registerEvent(scheduler, def) {
  scheduler.defs.set(def.id, def);
  scheduler.states.set(def.id, {
    id: def.id,
    active: false,
    cooldown: poissonDelay(def.meanInterval),
    elapsed: 0,
    duration: 0,
    progress: 0,
    intensity: 0,
  });
}

/**
 * @param {RareEventScheduler} scheduler
 * @param {number} dt
 * @param {import('./lightCycle.js').Mood} mood
 */
export function updateRareEvents(scheduler, dt, mood) {
  if (scheduler.globalCooldown > 0) {
    scheduler.globalCooldown -= dt;
  }

  if (scheduler.activeEvent) {
    const state = scheduler.states.get(scheduler.activeEvent);
    state.elapsed += dt;
    state.progress = Math.min(1, state.elapsed / state.duration);

    if (state.progress < 0.1) {
      state.intensity = state.progress / 0.1;
    } else if (state.progress > 0.8) {
      state.intensity = (1 - state.progress) / 0.2;
    } else {
      state.intensity = 1;
    }

    if (state.elapsed >= state.duration) {
      state.active = false;
      state.intensity = 0;
      state.progress = 0;
      state.elapsed = 0;
      const def = scheduler.defs.get(scheduler.activeEvent);
      state.cooldown = poissonDelay(def.meanInterval);
      scheduler.globalCooldown = 60 + Math.random() * 30;
      scheduler.activeEvent = null;
    }
    return;
  }

  if (scheduler.globalCooldown > 0) return;

  for (const [id, state] of scheduler.states) {
    state.cooldown -= dt;
    if (state.cooldown <= 0) {
      const def = scheduler.defs.get(id);
      if (def.canActivate(mood)) {
        state.active = true;
        state.elapsed = 0;
        state.duration = def.duration();
        state.progress = 0;
        state.intensity = 0;
        scheduler.activeEvent = id;
        return;
      }
      state.cooldown = 5 + Math.random() * 10;
    }
  }
}

/**
 * @param {RareEventScheduler} scheduler
 * @param {string} id
 * @returns {RareEventState|undefined}
 */
export function getEventState(scheduler, id) {
  return scheduler.states.get(id);
}

function poissonDelay(mean) {
  const u = 0.001 + Math.random() * 0.998;
  return -Math.log(1 - u) * mean;
}
