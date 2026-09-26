// RailSaver settings. The same keys are stored by the Windows host
// (%APPDATA%\RailSaver\settings.json), the macOS host (ScreenSaverDefaults)
// and, in a plain browser, localStorage. The URL query string overrides any of
// them (e.g. ?quality=ultra&stopSeconds=1.5).

export const DEFAULTS = {
  // --- clock ---
  caseStyle: 'station',   // 'station' (deep drum, like the platform clocks) | 'wall' (slim case)
  finish: 'brushed',      // 'brushed' | 'polished' stainless steel
  glass: true,
  glassReflections: 1.0,  // strength of reflections on the glass, 0..2
  stopSeconds: 6,         // how long the second hand waits at 12 (the real clock: 1.5 s)
  minuteJump: true,       // animated minute-hand jump with a mechanical overshoot
  // --- camera & scene ---
  background: 'studio',   // 'studio' | 'wall' | 'black' | a sky: 'auto' | 'summer' | 'spring' | 'autumn' |
                          // 'winter' | 'sunset' | 'rain' | 'snow' | 'overcast' | 'night'  (see sky.js)
  skyStyle: 'photo',      // 'photo' (360° photographs, Poly Haven CC0) | 'generated' (animated clouds)
  skyBlur: 1.2,           // soft focus of the photographic background, 0 (sharp) .. 3
  weather: true,          // rain, snow, petals and leaves with the skies that have them
  southern: false,        // 'auto' sky: southern-hemisphere seasons
  size: 0.78,             // clock diameter as a fraction of the screen's shorter side
  swing: 0.5,             // amount of tilt/swing, 0..1
  swingSeconds: 40,       // seconds per swing cycle
  drift: true,            // slow drift across the screen (protects OLED/plasma screens)
  lightAngle: 40,         // key-light elevation from the dial normal, degrees (longer shadows when larger)
  exposure: 1.0,
  // --- sound ---
  sound: true,
  volume: 0.6,
  latchClick: true,       // soft click when the second hand arrives at 12
  // --- performance ---
  quality: 'high',        // 'low' | 'medium' | 'high' | 'ultra'
  antialias: 4,           // 0 | 2 | 4 | 8
  fps: 60,                // 15 | 24 | 30 | 60 | 120 | 0 (= display refresh)
  renderScale: 1,         // 0.5..2 (supersampling above 1)
  batterySaver: true,     // cap to 30 fps and medium shadows on battery
  showFps: false,
  // --- host only (ignored by the page) ---
  monitors: 'all',        // 'all' | 'primary' (other screens black)
};

// What each quality level means. Also shown in the settings page.
export const QUALITY = {
  low:    { shadow: 1024, radius: 2, segments: 64,  env: 64,  pixel: 0.75, maxDpr: 1 },
  medium: { shadow: 2048, radius: 3, segments: 96,  env: 128, pixel: 1.0, maxDpr: 1.5 },
  high:   { shadow: 2048, radius: 4, segments: 160, env: 256, pixel: 1.0, maxDpr: 2 },
  ultra:  { shadow: 4096, radius: 5, segments: 256, env: 256, pixel: 1.0, maxDpr: 3 },
};

export const PRESETS = {
  showcase: { quality: 'ultra', antialias: 8, fps: 60, renderScale: 1, swing: 0.6, background: 'studio', caseStyle: 'station' },
  authentic: { stopSeconds: 1.5, minuteJump: true, swing: 0.35, background: 'wall', caseStyle: 'station', finish: 'brushed' },
  balanced: { quality: 'high', antialias: 4, fps: 60, renderScale: 1 },
  saver: { quality: 'low', antialias: 2, fps: 30, renderScale: 0.85, batterySaver: true },
  seasons: { background: 'auto', weather: true, swing: 0.5, caseStyle: 'station' },
  rainy: { background: 'rain', weather: true, swing: 0.4, caseStyle: 'station' },
};

const NUMERIC = Object.keys(DEFAULTS).filter((k) => typeof DEFAULTS[k] === 'number');
const BOOL = Object.keys(DEFAULTS).filter((k) => typeof DEFAULTS[k] === 'boolean');

export function mergeSettings(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULTS) || v === null || v === undefined) continue;
    if (NUMERIC.includes(k)) { const n = Number(v); if (Number.isFinite(n)) out[k] = n; }
    else if (BOOL.includes(k)) out[k] = v === true || v === 'true' || v === '1' || v === 1;
    else out[k] = String(v);
  }
  if (!QUALITY[out.quality]) out.quality = DEFAULTS.quality;
  out.stopSeconds = Math.min(10, Math.max(0, out.stopSeconds));
  return out;
}

export function settingsFromQuery(search) {
  const p = new URLSearchParams(search);
  const o = {};
  for (const k of Object.keys(DEFAULTS)) if (p.has(k)) o[k] = p.get(k);
  return o;
}

// ---- host bridge: Windows (WebView2), macOS (WKWebView) or a plain browser ----
const win = typeof window !== 'undefined' && window.chrome && window.chrome.webview ? window.chrome.webview : null;
const mac = typeof window !== 'undefined' && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.railsaver
  ? window.webkit.messageHandlers.railsaver : null;

export const hostKind = win ? 'windows' : mac ? 'mac' : 'browser';

export function postToHost(msg) {
  try {
    if (win) win.postMessage(msg);
    else if (mac) mac.postMessage(msg);
  } catch { /* the host went away */ }
}

const STORE = 'railsaver.settings';

/** Settings saved by the host (injected before the page loads) or by the browser demo. */
export function loadStored() {
  if (typeof window === 'undefined') return {};
  if (window.RAILSAVER_SETTINGS && typeof window.RAILSAVER_SETTINGS === 'object') return window.RAILSAVER_SETTINGS;
  try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; }
}

export function saveStored(s) {
  if (hostKind !== 'browser') { postToHost({ type: 'save', settings: s }); return; }
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private mode */ }
}
