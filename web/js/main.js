import * as THREE from 'three';
import { DEFAULTS, QUALITY, mergeSettings, settingsFromQuery, loadStored, postToHost, hostKind } from './settings.js';
import { createClock } from './clock.js';
import { createEnvironment, createBackdrop, createWall, BACKGROUNDS } from './stage.js';
import { Sky, SKIES, autoSky, skyLight } from './sky.js';
import { Weather } from './weather.js';
import { PhotoSky, photoSkiesAvailable } from './photosky.js';
import { handAngles, nextEvents } from './motion.js';
import { ClockAudio } from './audio.js';

const query = new URLSearchParams(location.search);
const mode = query.get('mode') || 'window';          // 'screensaver' | 'preview' | 'window'
const audioAllowed = query.get('audio') !== '0' && mode !== 'preview';
const capture = query.has('capture');

const log = (message) => postToHost({ type: 'log', message: String(message) });
/** Shows a start-up problem on screen (instead of a black screen) and logs it. */
function showError(e) {
  const msg = (e && (e.message || e.reason)) || String(e);
  log(`error: ${msg}`);
  let el = document.getElementById('error');
  if (!el) {
    el = document.createElement('div');
    el.id = 'error';
    el.style.cssText = 'position:fixed;left:16px;bottom:14px;right:16px;font:13px/1.4 -apple-system,Segoe UI,sans-serif;color:#f88;white-space:pre-wrap;z-index:20';
    document.body.appendChild(el);
  }
  el.textContent = `RailSaver: ${msg}`;
}
window.addEventListener('error', (e) => { log(`error: ${e.message} at ${e.filename}:${e.lineno}`); if (!document.documentElement.dataset.ready) showError(e); });
window.addEventListener('unhandledrejection', (e) => log(`unhandled: ${e.reason && (e.reason.stack || e.reason.message) || e.reason}`));

let settings = mergeSettings(mergeSettings(DEFAULTS, loadStored()), settingsFromQuery(location.search));
if (mode === 'preview') settings = mergeSettings(settings, { quality: 'low', antialias: 2, fps: 30, showFps: false });

// ---- time (?time=10:09:36 shows that time, still running; ?still freezes it) ----
let timeOffset = 0;
if (query.has('time')) {
  const [h, m, s] = query.get('time').split(':').map(Number);
  const target = new Date(); target.setHours(h || 0, m || 0, 0, 0);
  timeOffset = target.getTime() + (s || 0) * 1000 - Date.now();
}
const frozenAt = query.has('still') ? Date.now() : null;
const t0 = performance.now();
const wallNow = () => (frozenAt ?? Date.now()) + timeOffset;
const animTime = () => (frozenAt !== null ? Number(query.get('swingPhase') || 0.2) * settings.swingSeconds : (performance.now() - t0) / 1000 + 12);

// ---- renderer ----
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: capture });
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
{
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  log(`RailSaver ${mode}; WebGL ${renderer.capabilities.isWebGL2 ? '2' : '1'}; GPU: ${dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown'}; ${innerWidth}x${innerHeight} @${devicePixelRatio}`);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); log('WebGL context lost'); });
  canvas.addEventListener('webglcontextrestored', () => location.reload());
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, 16 / 9, 0.1, 100);

const key = new THREE.DirectionalLight(0xfffaf2, 2.3);
key.castShadow = true;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.004;
scene.add(key, key.target);

const fill = new THREE.DirectionalLight(0xdfe8ff, 0.25);
fill.position.set(6, -2, 6);
scene.add(fill);

// Everything that depends on settings is (re)built here.
let clock = null, backdrop = null, wall = null, envRT = null, built = {};
let sky = null, weather = null, skyName = null, envAge = 0;
let photo = null;                 // PhotoSky in use
const photoCache = new Map();     // key -> Promise<PhotoSky|null>
let photoKeys = {};
photoSkiesAvailable().then((m) => { photoKeys = m; if (Object.keys(m).length) build(); });

// How each photographic sky is framed. 'front': the sun is turned to match the
// key light (sharp shadows, sunlit steel); 'behind': the sun or moon is in view
// behind the clock; viewU: this panorama column is behind the clock.
const PHOTO_VIEW = {
  sunset: { sun: 'behind', az: 0.32, lookUp: 0.2 },
  night: { sun: 'behind', az: -0.3, lookUp: 0.22 },
  railway: { viewU: 0.677, lookUp: 0.06 },
  winter: { sun: 'front', lookUp: 0.2 },
  snow: { sun: 'front', lookUp: 0.2 },
  fields: { sun: 'front', lookUp: 0.22 },
};

function wantPhoto() {
  return skyName && settings.skyStyle === 'photo' && photoKeys[skyName] ? skyName : null;
}

function requestPhoto(key) {
  if (!photoCache.has(key)) {
    photoCache.set(key, PhotoSky.load(key, { maxAniso: renderer.capabilities.getMaxAnisotropy() })
      .catch((e) => { log(`photo sky ${key}: ${e.message || e}`); return null; }));
    photoCache.get(key).then((p) => { if (p) readyPhotos.set(key, p); build(); });
  }
  return photoCache.get(key);
}
const pmrem = new THREE.PMREMGenerator(renderer);
const readyPhotos = new Map();

/** The sky preset in use, or null for the studio / wall / black backgrounds. */
function currentSky() {
  const bg = settings.background === 'sky' ? 'overcast' : settings.background;
  if (bg === 'auto') return autoSky(new Date(wallNow()), settings.southern);
  return SKIES[bg] ? bg : null;
}

function refreshEnvironment() {
  const q = QUALITY[settings.quality];
  const old = envRT;
  envRT = photo ? pmrem.fromScene(photo.envScene, 0, 0.1, 100, { size: q.env })
    : skyName ? pmrem.fromScene(sky.envScene, 0, 0.1, 100, { size: q.env })
    : createEnvironment(renderer, settings.background === 'wall' ? 'wall' : 'studio', q.env);
  scene.environment = envRT.texture;
  if (old) old.dispose();
  envAge = 0;
}

function build() {
  const q = QUALITY[settings.quality];
  skyName = currentSky();
  // A photographic sky once its files are loaded; the generated one meanwhile.
  let wantedPhoto = null;
  const pk = wantPhoto();
  if (pk) {
    requestPhoto(pk);
    wantedPhoto = readyPhotos.get(pk) || null;
  }
  const need = {
    quality: settings.quality, caseStyle: settings.caseStyle, finish: settings.finish, glass: settings.glassShape,
    background: (wantedPhoto ? 'photo:' : '') + (skyName || settings.background), weather: settings.weather && skyName ? SKIES[skyName].particles || null : null,
  };
  const same = (k) => built[k] === need[k];

  if (!clock || !same('quality') || !same('caseStyle') || !same('finish') || !same('glass')) {
    if (clock) { scene.remove(clock.group); clock.dispose(); }
    clock = createClock({ caseStyle: settings.caseStyle, finish: settings.finish, glassShape: settings.glassShape, glassReflections: settings.glassReflections, mirror: settings.mirror, lensStrength: settings.lensStrength, segments: q.segments });
    scene.add(clock.group);
    if (wall) wall.position.z = clock.back - 0.002;
  }
  if (!same('background') || !same('quality')) {
    if (backdrop) { scene.remove(backdrop); backdrop.geometry.dispose(); backdrop.material.dispose(); backdrop = null; }
    if (wall) { scene.remove(wall); wall.userData.dispose(); wall = null; }
    if (sky) { scene.remove(sky.mesh); sky.dispose(); sky = null; }
    if (photo) { scene.remove(photo.background); photo = null; }   // kept in the cache
    if (wantedPhoto) {
      photo = wantedPhoto;
      const v = PHOTO_VIEW[skyName] || { sun: 'front' };
      if (v.viewU !== undefined) photo.bgMaterial.uniforms.uYaw.value = v.viewU - 0.5;
      else if (v.sun === 'behind') photo.setSunAzimuth(v.az);
      else photo.setSunAzimuth(Math.atan2(-0.62, -Math.cos(THREE.MathUtils.degToRad(settings.lightAngle)) / Math.sin(THREE.MathUtils.degToRad(settings.lightAngle))));
      photo.view = v;
      scene.add(photo.background);
    } else if (skyName) {
      sky = new Sky(settings.quality === 'low' ? 3 : 5);
      sky.set(skyName);
      sky.update(animTime());
      scene.add(sky.mesh);
    } else if (settings.background === 'wall') { wall = createWall(clock.back); scene.add(wall); }
    else { backdrop = createBackdrop(settings.background); scene.add(backdrop); }
    refreshEnvironment();
  }
  if (!same('weather') || !same('quality')) {
    if (weather) { scene.remove(weather.group); weather.dispose(); weather = null; }
    if (need.weather) {
      weather = new Weather(need.weather, { low: 0.4, medium: 0.7, high: 1, ultra: 1.3 }[settings.quality]);
      scene.add(weather.group);
    }
  }
  // Shadows: map size and softness from quality; the shadow camera tightly
  // wraps the clock (and a patch of wall) for maximum texel density.
  const size = onBattery && settings.batterySaver ? Math.min(q.shadow, 1024) : q.shadow;
  if (key.shadow.mapSize.x !== size) {
    key.shadow.mapSize.set(size, size);
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
  }
  const preset = skyName ? SKIES[skyName] : null;
  key.shadow.radius = q.radius * (preset ? preset.shadowSoft : 1);
  const ext = settings.background === 'wall' && !skyName ? 2.6 : 1.3;
  Object.assign(key.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 30 });
  key.shadow.camera.updateProjectionMatrix();

  const a = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(settings.lightAngle, 10, 70));
  key.position.set(-Math.sin(a) * 0.62, Math.sin(a) * 0.78, Math.cos(a)).multiplyScalar(12);
  if (preset && photo) {
    // Light from the photo: the sun's own colour; ambient normalised to the panorama.
    const l = skyLight(preset);
    key.color.copy(photo.info.sunColor).lerp(l.color, 0.35).lerp(new THREE.Color(1, 1, 1), preset.photoNeutral ?? 0);
    key.intensity = l.intensity * (preset.photoLight ?? 1);
    scene.environmentIntensity = THREE.MathUtils.clamp(0.55 / Math.max(photo.info.mean, 1e-3), 0.15, 4) * (preset.photoEnv ?? 1);
  } else if (preset) {
    const l = skyLight(preset);
    key.color.copy(l.color);
    key.intensity = l.intensity;
    scene.environmentIntensity = preset.env;
  } else {
    const bg = BACKGROUNDS[settings.background] || BACKGROUNDS.studio;
    key.color.set(0xfffaf2);
    key.intensity = bg.light;
    scene.environmentIntensity = bg.env;
  }
  renderer.toneMappingExposure = settings.exposure;
  clock.setGlassReflections(settings.glassReflections);
  clock.setMirror(settings.mirror);
  clock.setLensStrength(settings.lensStrength);
  clock.setDialGlow(preset && preset.dialGlow ? preset.dialGlow : 0);
  built = need;
  resize();
}

// ---- render target (MSAA) + output pass (tone mapping, vignette, dithering) ----
let rt = null;
const out = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { tScene: { value: null }, uVignette: { value: 0.18 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D tScene; uniform float uVignette; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tScene, vUv).rgb;
      vec2 d = vUv - 0.5; c *= 1.0 - uVignette * dot(d, d) * 2.2;
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    }`,
  depthTest: false, depthWrite: false,
}));
out.frustumCulled = false;
const outScene = new THREE.Scene(); outScene.add(out);
const outCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

let width = 0, height = 0;
function resize() {
  const q = QUALITY[settings.quality];
  const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr);
  const scale = dpr * THREE.MathUtils.clamp(settings.renderScale, 0.5, 2) * q.pixel;
  width = Math.max(1, window.innerWidth); height = Math.max(1, window.innerHeight);
  renderer.setPixelRatio(1);
  renderer.setSize(Math.round(width * dpr), Math.round(height * dpr), false);
  canvas.style.width = '100vw'; canvas.style.height = '100vh';
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const samples = Math.min([0, 2, 4, 8].includes(settings.antialias) ? settings.antialias : 4, renderer.capabilities.maxSamples || 4);
  if (!rt || rt.width !== w || rt.height !== h || rt.samples !== samples) {
    if (rt) rt.dispose();
    rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
  }
  out.material.uniforms.tScene.value = rt.texture;
  out.material.uniforms.uVignette.value = skyName ? 0.1 : 0.2;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (backdrop) backdrop.material.uniforms.uAspect.value = width / height;
}
window.addEventListener('resize', resize);

// ---- camera: framing, swing and drift ----
const target = new THREE.Vector3();
function placeCamera(t) {
  const fovY = THREE.MathUtils.degToRad(camera.fov);
  const tanY = Math.tan(fovY / 2), tanX = tanY * camera.aspect;
  const R = clock.radius;
  const frac = THREE.MathUtils.clamp(settings.size, 0.3, 0.98);
  // Fit the clock's diameter to `size` of the shorter side.
  const dist = R / (frac * Math.min(tanY, tanX));

  const P = Math.max(8, settings.swingSeconds);
  const sw = THREE.MathUtils.clamp(settings.swing, 0, 1.5);
  const yaw = THREE.MathUtils.degToRad(24) * sw * Math.sin((2 * Math.PI * t) / P);
  const pitch = THREE.MathUtils.degToRad(11) * sw * Math.sin((2 * Math.PI * t) / (P * 1.618) + 0.9) + THREE.MathUtils.degToRad(3) * sw;
  const roll = THREE.MathUtils.degToRad(1.2) * sw * Math.sin((2 * Math.PI * t) / (P * 2.3) + 2.1);

  // Drift: move the clock slowly around the free space of the screen.
  let dx = 0, dy = 0;
  if (settings.drift) {
    const freeX = Math.max(0, dist * tanX - R * 1.08), freeY = Math.max(0, dist * tanY - R * 1.08);
    dx = 0.55 * freeX * Math.sin((2 * Math.PI * t) / 173 + 0.4);
    dy = 0.55 * freeY * Math.sin((2 * Math.PI * t) / 229 + 1.7);
  }
  target.set(-dx, -dy, 0);
  camera.position.set(
    target.x + dist * Math.sin(yaw) * Math.cos(pitch),
    target.y + dist * Math.sin(pitch),
    dist * Math.cos(yaw) * Math.cos(pitch),
  );
  camera.up.set(Math.sin(roll), Math.cos(roll), 0);
  camera.lookAt(target);
}

// ---- sound ----
const audio = new ClockAudio();
function applyAudio() { audio.setOptions({ sound: settings.sound && audioAllowed, volume: settings.volume }); }
for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, () => audio.unlock(), { passive: true });

function scheduleSounds(now) {
  if (!audio.enabled) return;
  for (const e of nextEvents(now, settings.stopSeconds)) {
    if (e.type === 'latch' && !settings.latchClick) continue;
    if (e.in < 0.25) audio.schedule(e.type, e.in, `${e.type}@${e.at}`);
  }
}

// ---- battery / pause ----
let onBattery = false;
if (navigator.getBattery) {
  navigator.getBattery().then((b) => {
    const upd = () => { const was = onBattery; onBattery = !b.charging; if (was !== onBattery) build(); };
    b.addEventListener('chargingchange', upd); upd();
  }).catch(() => {});
}
let paused = false;
function setPaused(p) {
  paused = p;
  if (p) audio.suspend(); else { audio.resume(); schedule(); }
}
// Screen saver hosts (macOS legacyScreenSaver in particular) often report the
// page as hidden although it is on screen; only a normal window pauses.
if (mode === 'window') document.addEventListener('visibilitychange', () => setPaused(document.hidden));

// ---- settings updates from the host or the settings page ----
function applySettings(patch) {
  settings = mergeSettings(settings, patch);
  build();
  applyAudio();
  fpsEl.hidden = !settings.showFps;
}
function onMessage(data) {
  if (!data || typeof data !== 'object') return;
  if (data.type === 'settings') applySettings(data.settings);
  else if (data.type === 'pause') setPaused(true);
  else if (data.type === 'resume') setPaused(false);
  else if (data.type === 'playSound') { audio.enabled = true; audio.ensure(); setTimeout(() => audio.schedule(data.sound || 'release', 0.02), 60); applyAudio(); }
}
window.addEventListener('message', (e) => onMessage(e.data));
if (window.chrome && window.chrome.webview) window.chrome.webview.addEventListener('message', (e) => onMessage(e.data));
window.railsaver = { onMessage };   // macOS host calls this via evaluateJavaScript

// ---- screensaver: any input ends it (Windows; macOS handles this itself) ----
if (mode === 'screensaver') {
  document.body.classList.add('saver');
  const armedAt = performance.now() + 700;
  let origin = null;
  const quit = () => { if (performance.now() > armedAt) postToHost({ type: 'exit' }); };
  window.addEventListener('mousemove', (e) => {
    if (!origin) { origin = [e.screenX, e.screenY]; return; }
    if (Math.hypot(e.screenX - origin[0], e.screenY - origin[1]) > 12) quit();
  });
  for (const ev of ['mousedown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, quit);
}

// ---- main loop ----
const fpsEl = document.getElementById('fps');
let lastRender = 0, frames = 0, totalFrames = 0, fpsT = performance.now(), lastT = 0, autoCheck = 0;
// requestAnimationFrame, plus a timer fallback for hosts that throttle or stop
// animation frames for a web view they think is occluded (macOS screen savers).
let rafPending = false, lastFrameCall = 0;
function schedule() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame((t) => { rafPending = false; frame(t); });
}
setInterval(() => {
  if (!paused && performance.now() - lastFrameCall > 250) { rafPending = false; frame(performance.now()); }
}, 16);

function frame(now) {
  if (paused) return;
  lastFrameCall = performance.now();
  schedule();
  const cap = onBattery && settings.batterySaver ? Math.min(settings.fps || 60, 30) : settings.fps;
  if (cap > 0 && now - lastRender < 1000 / cap - 1.5) return;
  lastRender = now;

  const t = wallNow();
  const at = animTime();
  const dt = lastT ? (now - lastT) / 1000 : 0;
  lastT = now;
  clock.setAngles(handAngles(t, settings));
  scheduleSounds(t);
  placeCamera(at);
  if (photo) {
    camera.updateMatrixWorld();
    photo.updateBackground(camera, { fov: 62, blur: settings.skyBlur, lookUp: photo.view.lookUp ?? 0.36 });
  }
  if (sky) {
    sky.update(at);
    // Clouds move: refresh the reflections now and then (not on Low).
    envAge += dt;
    if (settings.quality !== 'low' && envAge > (settings.quality === 'ultra' ? 1.5 : 4)) refreshEnvironment();
  }
  if (weather) weather.update(frozenAt !== null ? 0 : dt, at);
  // 'auto' follows the season and the time of day.
  if (settings.background === 'auto' && (autoCheck += dt) > 30) { autoCheck = 0; if (currentSky() !== skyName) build(); }

  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(outScene, outCam);

  frames++; totalFrames++;
  if (now - fpsT > 1000) {
    if (settings.showFps) fpsEl.textContent = `${Math.round((frames * 1000) / (now - fpsT))} fps · ${settings.quality} · MSAA ${rt.samples}x · ${rt.width}×${rt.height}`;
    frames = 0; fpsT = now;
  }
  if (totalFrames === 3) {
    document.documentElement.dataset.ready = '1';
    document.getElementById('fade').classList.add('out');
    postToHost({ type: 'log', message: `first frames rendered (${rt.width}x${rt.height})` });
  }
}

try {
  build();
} catch (e) {
  showError(e);
  throw e;
}
applyAudio();
fpsEl.hidden = !settings.showFps;
postToHost({ type: 'ready', host: hostKind });
// In a screen saver the black fade-in cover goes at once: if frames are slow
// to start, the saver should never look like a blank screen.
if (mode !== 'window') document.getElementById('fade').remove();
schedule();
