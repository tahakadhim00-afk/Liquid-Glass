import { LiquidGlassPanel } from '../src/core/panel.js';

const PRESETS = {
  // The library's material and its defaults. Fat, round, low-power bevel
  // = a dome; heavy bend, near-clear surface, and it wobbles.
  water:   { ior: 1.33, thickness: 86, bevel: 90, bevelPower: 1.8, profile: 0.0, dispersion: 0.012,
             frost: 0.05, splay: 0.55, specular: 1.20, saturation: 1.10, tint: 0.02, radius: 110, motion: 1.4,
             lightRadius: 0.12, edgeLine: 0.0, rimWidth: 0.55 },
};

const SLIDERS = ['ior', 'thickness', 'bevel', 'bevelPower', 'profile', 'splay', 'dispersion',
                 'frost', 'specular', 'saturation', 'tint', 'radius', 'motion'];

const stage = document.getElementById('stage');

const panel = new LiquidGlassPanel(stage, {
  ...PRESETS.water,
  width: 400,
  height: 220,
  x: Math.round(window.innerWidth / 2 - 200),
  y: Math.round(window.innerHeight / 2 - 110),
  // Set window.__forceTier to exercise a fallback tier on capable hardware.
  forceTier: window.__forceTier,
});

if (import.meta.env.DEV) window.__panel = panel;

// --- stats -------------------------------------------------------------
const tierEl = document.getElementById('stat-tier');
const fpsEl = document.getElementById('stat-fps');
const TIER_LABEL = {
  webgl: 'WebGL2 (full)',
  'webgl-static': 'WebGL2 (reduced motion)',
  svg: 'SVG displacement',
  blur: 'CSS blur fallback',
};
tierEl.textContent = TIER_LABEL[panel.tier] ?? panel.tier;
panel.onStats = ({ fps }) => { fpsEl.textContent = String(fps); };

// --- sliders -----------------------------------------------------------
function syncSlider(id) {
  const input = document.getElementById(id);
  const out = document.getElementById(`out-${id}`);
  const value = parseFloat(input.value);
  // Fractional controls keep a fixed decimal count so the readout does not
  // jump width as the value crosses a whole number.
  const DECIMALS = { dispersion: 3, profile: 2, splay: 2,
    frost: 2, ior: 2, bevelPower: 1, saturation: 2, specular: 2, tint: 2, motion: 2 };
  const dp = DECIMALS[id];
  out.textContent = dp == null ? String(value) : value.toFixed(dp);
  panel.setOption(id, value);
}

for (const id of SLIDERS) {
  const input = document.getElementById(id);
  if (!input) continue;
  input.addEventListener('input', () => syncSlider(id));
  syncSlider(id);
}

// --- presets -----------------------------------------------------------
for (const button of document.querySelectorAll('.presets button')) {
  button.addEventListener('click', () => {
    const preset = PRESETS[button.dataset.preset];
    if (!preset) return;
    for (const [key, value] of Object.entries(preset)) {
      const input = document.getElementById(key);
      if (input) { input.value = String(value); syncSlider(key); }
      else panel.setOption(key, value);
    }
  });
}

// --- backdrop image ----------------------------------------------------
// A photo is the honest test: synthetic gradients are smooth enough to
// hide sampling errors that real detail and hard edges expose immediately.
const uploadBtn = document.getElementById('upload-btn');
const uploadInput = document.getElementById('upload-input');
const resetBtn = document.getElementById('reset-backdrop');
const nameEl = document.getElementById('upload-name');

let objectURL = null;   // revoked on replace, so repeat uploads do not leak

function clearObjectURL() {
  if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
}

function loadImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    nameEl.hidden = false;
    nameEl.textContent = 'Not an image file.';
    return;
  }

  clearObjectURL();
  objectURL = URL.createObjectURL(file);

  const img = new Image();
  img.onload = () => {
    panel.backdrop.setImage(img);
    panel.backdrop.invalidate();
    resetBtn.hidden = false;
    nameEl.hidden = false;
    nameEl.textContent = `${file.name} · ${img.naturalWidth}×${img.naturalHeight}`;
  };
  img.onerror = () => {
    clearObjectURL();
    nameEl.hidden = false;
    nameEl.textContent = 'Could not decode that image.';
  };
  img.src = objectURL;
}

uploadBtn.addEventListener('click', () => uploadInput.click());
uploadInput.addEventListener('change', (e) => {
  loadImageFile(e.target.files?.[0]);
  // Reset so re-picking the same file still fires a change event.
  e.target.value = '';
});

resetBtn.addEventListener('click', () => {
  clearObjectURL();
  panel.backdrop.setImage(null);
  panel.backdrop.invalidate();
  resetBtn.hidden = true;
  nameEl.hidden = true;
});

// Drop anywhere on the page.
const stopDefault = (e) => { e.preventDefault(); e.stopPropagation(); };
window.addEventListener('dragover', (e) => {
  stopDefault(e);
  document.body.classList.add('dropping');
});
window.addEventListener('dragleave', (e) => {
  stopDefault(e);
  if (e.relatedTarget === null) document.body.classList.remove('dropping');
});
window.addEventListener('drop', (e) => {
  stopDefault(e);
  document.body.classList.remove('dropping');
  loadImageFile(e.dataTransfer?.files?.[0]);
});

// --- collapse ----------------------------------------------------------
const controls = document.getElementById('panel-controls');
const toggle = document.getElementById('toggle-controls');

function setCollapsed(collapsed) {
  controls.classList.toggle('collapsed', collapsed);
  toggle.textContent = collapsed ? 'Show' : 'Hide';
  toggle.setAttribute('aria-expanded', String(!collapsed));
}

toggle.addEventListener('click', () => {
  setCollapsed(!controls.classList.contains('collapsed'));
});

// On a phone the controls dock as a bottom sheet, and opening by default
// would hide the glass behind the very sliders meant to tune it. Start
// collapsed there so the panel is the first thing visible.
if (matchMedia('(max-width: 640px)').matches) setCollapsed(true);
