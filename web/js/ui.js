// Settings page: edits the settings, shows them live in the preview and
// hands them to the host (Windows / macOS) or localStorage (browser).
import { DEFAULTS, QUALITY, PRESETS, mergeSettings, loadStored, saveStored, postToHost, hostKind } from './settings.js';
import { ClockAudio } from './audio.js';

let settings = mergeSettings(DEFAULTS, loadStored());
const preview = document.getElementById('preview');
const status = document.getElementById('status');

const fmt = {
  glassReflections: (v) => `${Math.round(v * 100)}%`,
  mirror: (v) => `${Math.round(v * 100)}%`,
  lensStrength: (v) => `${Math.round(v * 100)}%`,
  stopSeconds: (v) => (v === 0 ? 'off' : `${v.toFixed(1)} s`),
  volume: (v) => `${Math.round(v * 100)}%`,
  size: (v) => `${Math.round(v * 100)}%`,
  swing: (v) => (v === 0 ? 'off' : `${Math.round(v * 100)}%`),
  swingSeconds: (v) => `${v} s`,
  lightAngle: (v) => `${v}°`,
  lightDirection: (v) => { const h = ((v / 30) + 11) % 12 + 1; const m = Math.round(((v / 30) % 1) * 60); return `from ${Math.floor(h)}:${String(m).padStart(2, '0')}`; },
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
  document.getElementById('glassReflections').disabled = settings.glassShape === 'none';
  document.getElementById('lensStrengthRow').hidden = settings.glassShape !== 'lens';
  document.getElementById('lightPointer').style.transform = `rotate(${settings.lightDirection}deg)`;
  document.getElementById('lightKnob').setAttribute('aria-valuenow', settings.lightDirection);
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

// Light-direction knob: drag the sun round, or use the arrow keys.
{
  const knob = document.getElementById('lightKnob');
  const input = document.getElementById('lightDirection');
  const set = (deg) => { input.value = String(Math.round(((deg % 360) + 360) % 360)); input.dispatchEvent(new Event('input')); };
  const fromEvent = (e) => {
    const r = knob.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    set((Math.atan2(dx, -dy) * 180) / Math.PI);
  };
  knob.addEventListener('pointerdown', (e) => { knob.setPointerCapture(e.pointerId); knob.style.cursor = 'grabbing'; fromEvent(e); });
  knob.addEventListener('pointermove', (e) => { if (knob.hasPointerCapture(e.pointerId)) fromEvent(e); });
  knob.addEventListener('pointerup', () => { knob.style.cursor = ''; });
  knob.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 15 : 3;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { set(settings.lightDirection + step); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { set(settings.lightDirection - step); e.preventDefault(); }
  });
}

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
if (ver) document.getElementById('credVer').textContent = ver;
if (hostKind === 'browser') status.textContent = 'Browser demo: settings are kept in this browser.';

// ---- updates: GitHub Releases of this repository ----
const REPO = 'vagdesign/RailSaver';
const installed = ver || '';
const updStatus = document.getElementById('updStatus');
const updInstall = document.getElementById('updInstall');
document.getElementById('updInstalled').textContent = installed || 'browser demo';
if (hostKind === 'mac') {
  document.getElementById('autoUpdateRow').hidden = true;   // macOS: the new .saver is installed by double-click
}
const newer = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
};
let latest = null;
async function checkUpdates() {
  updStatus.textContent = 'Checking…';
  updInstall.hidden = true;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    latest = await r.json();
    const v = String(latest.tag_name || '').replace(/^v/i, '');
    if (installed && newer(v, installed)) {
      updStatus.textContent = `Version ${v} is available.`;
      updInstall.hidden = false;
      updInstall.textContent = hostKind === 'windows' ? `Install ${v}` : `Download ${v}`;
    } else {
      updStatus.textContent = installed ? `Up to date (latest is ${v}).` : `Latest release: ${v}.`;
    }
  } catch (e) {
    latest = null;
    updStatus.textContent = `Could not check (${e.message}).`;
    updInstall.hidden = false;
    updInstall.textContent = 'Open the releases page';
  }
}
document.getElementById('updCheck').addEventListener('click', checkUpdates);
updInstall.addEventListener('click', () => {
  if (hostKind === 'windows' && latest) {
    saveStored(settings);   // keep unsaved changes
    postToHost({ type: 'installUpdate' });
    updStatus.textContent = 'Downloading…';
    updInstall.disabled = true;
  } else {
    const mac = latest && (latest.assets || []).find((a) => /mac.*\.zip$/i.test(a.name));
    window.open(hostKind === 'mac' && mac ? mac.browser_download_url : (latest ? latest.html_url : `https://github.com/${REPO}/releases/latest`), '_blank');
  }
});
// Progress from the Windows host.
if (window.chrome && window.chrome.webview) {
  window.chrome.webview.addEventListener('message', (e) => {
    const m = e.data;
    if (m && m.type === 'updateStatus') { updStatus.textContent = m.text; if (m.failed) updInstall.disabled = false; }
  });
}
if (installed) checkUpdates();

show();
