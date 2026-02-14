/**
 * Dev Panel — hidden tuning overlay
 *
 * Triggered by Konami code (↑↑↓↓←→←→BA) or 5-tap bottom-right corner.
 * Toggle on/off. Zero cost when hidden (display:none, no timers).
 *
 * 7 controls: event triggers, cycle speed, phase scrub, freeze,
 * drift overrides, reset drift, audio toggle.
 */

import { devAPI } from './scene.js';
import { toggleAudio, isAudioActive } from './audio.js';

// --- Konami code detection (event.code, not deprecated keyCode) ---
const KONAMI = [
  'ArrowUp','ArrowUp','ArrowDown','ArrowDown',
  'ArrowLeft','ArrowRight','ArrowLeft','ArrowRight',
  'KeyB','KeyA',
];
const keyBuf = [];

// --- 5-tap detection (bottom-right 80×80, sliding 1500ms window) ---
const tapTimes = [];
const TAP_ZONE = 80;
const TAP_COUNT = 5;
const TAP_WINDOW = 1500;

let panel = null;
let syncInterval = null;
let visible = false;

// Drift slider drag state — while dragging, slider owns the value
const driftDragging = { speedDrift: false, skyWarmth: false, fogMod: false, auroraMod: false, brightMod: false };

export function initDevPanel() {
  // Keyboard listener: D key toggle + Konami code
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyD') { togglePanel(); return; }
    keyBuf.push(e.code);
    if (keyBuf.length > 10) keyBuf.shift();
    if (keyBuf.length === 10 && keyBuf.every((k, i) => k === KONAMI[i])) {
      togglePanel();
      keyBuf.length = 0;
    }
  });

  // 5-tap listener (read viewport at tap time, not cached)
  document.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (touch.clientX >= vw - TAP_ZONE && touch.clientY >= vh - TAP_ZONE) {
      const now = performance.now();
      tapTimes.push(now);
      // Sliding window: discard stale taps
      while (tapTimes.length && tapTimes[0] < now - TAP_WINDOW) tapTimes.shift();
      if (tapTimes.length >= TAP_COUNT) {
        togglePanel();
        tapTimes.length = 0;
      }
    }
  }, { passive: true });
}

function togglePanel() {
  if (!panel) buildPanel();
  visible = !visible;
  panel.style.display = visible ? 'block' : 'none';
  if (visible) {
    syncInterval = setInterval(syncReadouts, 100);
    syncReadouts();
  } else {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

// --- Panel DOM ---

/** @type {Object<string, HTMLElement>} */
const els = {};

function buildPanel() {
  panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed', top: '8px', right: '8px', zIndex: '9999',
    background: 'rgba(0,0,0,0.82)', color: '#b0b0b0',
    fontFamily: 'monospace', fontSize: '11px', lineHeight: '1.5',
    padding: '10px 12px', borderRadius: '4px', maxWidth: '260px',
    pointerEvents: 'none', display: 'none',
    maxHeight: 'calc(100vh - 16px)', overflowY: 'auto',
  });

  const html = `
<div style="pointer-events:auto">
<div style="color:#666;margin-bottom:6px">DEV PANEL</div>

<div style="margin-bottom:8px">
<div style="color:#888;margin-bottom:3px">Events</div>
<div style="display:flex;flex-wrap:wrap;gap:3px">
${['calving','shootingStar','whiteout','deepGlitch','stillness'].map(id =>
  `<button data-evt="${id}" style="all:unset;cursor:pointer;padding:2px 6px;background:#222;color:#999;border:1px solid #444;border-radius:2px;font:inherit">${id.replace(/([A-Z])/g,' $1').trim()}</button>`
).join('')}
</div>
</div>

<div style="margin-bottom:8px">
<div style="color:#888;margin-bottom:3px">Cycle speed: <span id="dp-speed-val">1.0×</span></div>
<input id="dp-speed" type="range" min="0.25" max="4" step="0.25" value="1" style="width:100%">
</div>

<div style="margin-bottom:8px">
<div style="color:#888;margin-bottom:3px">Phase: <span id="dp-phase-val">0.00</span> <span id="dp-phase-name" style="color:#666">cold blue</span></div>
<input id="dp-phase" type="range" min="0" max="1" step="0.005" value="0" style="width:100%">
</div>

<div style="margin-bottom:8px">
<label style="cursor:pointer"><input id="dp-freeze" type="checkbox"> <span style="color:#888">Freeze time</span></label>
</div>

<div style="margin-bottom:8px">
<div style="color:#888;margin-bottom:3px">Drift overrides</div>
${driftSlider('speedDrift', -0.3, 0.3, 0.005)}
${driftSlider('skyWarmth', -1.0, 1.0, 0.01)}
${driftSlider('fogMod', -0.3, 0.3, 0.005)}
${driftSlider('auroraMod', -0.2, 0.2, 0.005)}
${driftSlider('brightMod', -0.15, 0.15, 0.005)}
<button id="dp-reset-drift" style="all:unset;cursor:pointer;padding:2px 6px;background:#222;color:#999;border:1px solid #444;border-radius:2px;font:inherit;margin-top:4px">Reset drift</button>
</div>

<div>
<button id="dp-audio" style="all:unset;cursor:pointer;padding:2px 6px;background:#222;color:#999;border:1px solid #444;border-radius:2px;font:inherit">Audio: off</button>
</div>
</div>`;

  panel.innerHTML = html;
  document.body.appendChild(panel);

  // Cache element refs
  els.speed = panel.querySelector('#dp-speed');
  els.speedVal = panel.querySelector('#dp-speed-val');
  els.phase = panel.querySelector('#dp-phase');
  els.phaseVal = panel.querySelector('#dp-phase-val');
  els.phaseName = panel.querySelector('#dp-phase-name');
  els.freeze = panel.querySelector('#dp-freeze');
  els.resetDrift = panel.querySelector('#dp-reset-drift');
  els.audio = panel.querySelector('#dp-audio');

  for (const key of Object.keys(driftDragging)) {
    els[key] = panel.querySelector(`#dp-${key}`);
    els[key + 'Val'] = panel.querySelector(`#dp-${key}-val`);
  }

  // --- Event listeners ---

  // Event trigger buttons
  panel.querySelectorAll('[data-evt]').forEach(btn => {
    btn.addEventListener('click', () => devAPI.forceEvent(btn.dataset.evt));
  });

  // Cycle speed
  els.speed.addEventListener('input', () => {
    const v = parseFloat(els.speed.value);
    devAPI.speedMultiplier = v;
    els.speedVal.textContent = v.toFixed(2) + '×';
  });

  // Phase scrub — writes cycle.phase only (not drift values)
  els.phase.addEventListener('input', () => {
    const cycle = devAPI.getLightCycle();
    if (cycle) cycle.phase = parseFloat(els.phase.value);
  });

  // Freeze
  els.freeze.addEventListener('change', () => {
    devAPI.frozen = els.freeze.checked;
  });

  // Drift sliders — on input, override the cycle value
  for (const key of Object.keys(driftDragging)) {
    els[key].addEventListener('pointerdown', () => { driftDragging[key] = true; });
    els[key].addEventListener('pointerup', () => { driftDragging[key] = false; });
    els[key].addEventListener('pointercancel', () => { driftDragging[key] = false; });
    els[key].addEventListener('input', () => {
      const cycle = devAPI.getLightCycle();
      if (cycle) cycle[key] = parseFloat(els[key].value);
    });
  }

  // Reset drift
  els.resetDrift.addEventListener('click', () => {
    const cycle = devAPI.getLightCycle();
    if (!cycle) return;
    for (const key of Object.keys(driftDragging)) {
      cycle[key] = 0;
    }
  });

  // Audio toggle
  els.audio.addEventListener('click', () => toggleAudio(false));

  // Prevent panel touches from reaching canvas (audio opt-in)
  panel.querySelector('[style*="pointer-events:auto"]').addEventListener('touchstart', (e) => {
    e.stopPropagation();
  });
  panel.querySelector('[style*="pointer-events:auto"]').addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

function driftSlider(key, min, max, step) {
  return `<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">
<span style="width:72px;color:#777">${key}</span>
<input id="dp-${key}" type="range" min="${min}" max="${max}" step="${step}" value="0" style="flex:1">
<span id="dp-${key}-val" style="width:40px;text-align:right;color:#666">0.000</span>
</div>`;
}

// --- Phase name lookup ---
const PHASE_NAMES = [
  [0.00, 'cold blue'], [0.20, 'warm amber'], [0.38, 'deep violet'],
  [0.55, 'near-black'], [0.78, 'pale rose'],
];

function phaseName(p) {
  let name = PHASE_NAMES[PHASE_NAMES.length - 1][1];
  for (let i = 0; i < PHASE_NAMES.length; i++) {
    const next = i + 1 < PHASE_NAMES.length ? PHASE_NAMES[i + 1][0] : 1.0;
    if (p >= PHASE_NAMES[i][0] && p < next) { name = PHASE_NAMES[i][1]; break; }
  }
  return name;
}

// --- Sync readouts (100ms interval, only when visible) ---

function syncReadouts() {
  const cycle = devAPI.getLightCycle();
  if (!cycle) return;

  // Phase
  els.phaseVal.textContent = cycle.phase.toFixed(3);
  els.phaseName.textContent = phaseName(cycle.phase);
  els.phase.value = cycle.phase;

  // Drift readouts — update slider + value unless user is dragging
  for (const key of Object.keys(driftDragging)) {
    if (!driftDragging[key]) {
      els[key].value = cycle[key];
    }
    els[key + 'Val'].textContent = cycle[key].toFixed(3);
  }

  // Audio state
  els.audio.textContent = 'Audio: ' + (isAudioActive() ? 'on' : 'off');
}
