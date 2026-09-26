// Settings page: edits the settings, shows them live in the preview and
// hands them to the host (Windows / macOS) or localStorage (browser).
import { DEFAULTS, QUALITY, PRESETS, mergeSettings, loadStored, saveStored, postToHost, hostKind } from './settings.js';
import { ClockAudio } from './audio.js';

let settings = mergeSettings(DEFAULTS, loadStored());
const preview = document.getElementById('preview');
const status = document.getElementById('status');

const fmt = {
  glassReflections: (v) => `${Math.round(v * 100)}%`,
  stopSeconds: (v) => (v === 0 ? 'off' : `${v.toFixed(1)} s`),
  volume: (v) => `${Math.round(v * 100)}%`,
  size: (v) => `${Math.round(v * 100)}%`,
  swing: (v) => (v === 0 ? 'off' : `${Math.round(v * 100)}%`),
  swingSeconds: (v) => `${v} s`,
  lightAngle: (v) => `${v}°`,
  exposure: (v) => `${Math.round(v * 100)}%`,
  renderScale: (v) => `${Math.round(v * 100)}%`,
  skyBlur: (v) => (v === 0 ? 'sharp' : v.toFixed(1)),
};

const fields = Object.keys(DEFAULTS).map((k) => document.getElementById(k)).filter(Boolean);

function show() {
  for (const el of fields) {
    const v = settings[el.id];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = String(v);
    const o = el.parentElement.querySelector('output');
    if (o) o.textContent = (fmt[el.id] || String)(Number(v));
  }
  const q = QUALITY[settings.quality];
  document.getElementById('qualityHint').textContent =
    `Shadows ${q.shadow}px, ${q.segments} segments, reflections ${q.env}px${q.pixel < 1 ? `, ${Math.round(q.pixel * 100)}% resolution` : ''}.`;
  document.getElementById('volume').disabled = !settings.sound;
  document.getElementById('latchClick').disabled = !settings.sound;
  document.getElementById('glassReflections').disabled = !settings.glass;
  const skyBg = !['studio', 'wall', 'black'].includes(settings.background);
  document.getElementById('weatherRow').hidden = !skyBg;
  document.getElementById('skyStyleRow').hidden = !skyBg;
  document.getElementById('skyBlurRow').hidden = !skyBg || settings.skyStyle !== 'photo';
  document.getElementById('southernRow').hidden = settings.background !== 'auto';
}

function read(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'range' || typeof DEFAULTS[el.id] === 'number') return Number(el.value);
  return el.value;
}

function push() {
  show();
  try { preview.contentWindow.postMessage({ type: 'settings', settings }, '*'); } catch { /* not loaded yet */ }
}

for (const el of fields) {
  el.addEventListener('input', () => { settings = mergeSettings(settings, { [el.id]: read(el) }); push(); dirty(); });
}
preview.addEventListener('load', push);

for (const b of document.querySelectorAll('[data-preset]')) {
  b.addEventListener('click', () => { settings = mergeSettings(settings, PRESETS[b.dataset.preset]); push(); dirty(`Preset “${b.firstChild.textContent.trim()}” applied.`); });
}
document.getElementById('reset').addEventListener('click', () => { settings = mergeSettings(DEFAULTS, {}); push(); dirty('Defaults restored.'); });

// The test sound plays here (a click on this page allows audio in any browser).
const audio = new ClockAudio();
document.getElementById('testSound').addEventListener('click', () => {
  audio.setOptions({ sound: true, volume: settings.volume });
  setTimeout(() => audio.schedule('release', 0.03), 80);
});

function dirty(msg = 'Unsaved changes.') { status.textContent = msg; }

document.getElementById('ok').addEventListener('click', () => {
  saveStored(settings);
  if (hostKind === 'browser') status.textContent = 'Saved in this browser.';
  else postToHost({ type: 'close' });
});
document.getElementById('cancel').addEventListener('click', () => {
  if (hostKind === 'browser') { settings = mergeSettings(DEFAULTS, loadStored()); push(); status.textContent = 'Changes discarded.'; }
  else postToHost({ type: 'close' });
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && hostKind !== 'browser') postToHost({ type: 'close' }); });

// Host-specific bits.
if (hostKind === 'mac') document.getElementById('monitorsRow').hidden = true;
const ver = new URLSearchParams(location.search).get('version');
if (ver) document.getElementById('ver').textContent = `Version ${ver}.`;
if (hostKind === 'browser') status.textContent = 'Browser demo: settings are kept in this browser.';

show();
