import * as THREE from 'three';
import { DEFAULTS, QUALITY, mergeSettings, settingsFromQuery, loadStored, postToHost, hostKind } from './settings.js';
import { createClock } from './clock.js';
import { createEnvironment, createBackdrop, createWall, BACKGROUNDS } from './stage.js';
import { handAngles, nextEvents } from './motion.js';
import { ClockAudio } from './audio.js';

const query = new URLSearchParams(location.search);
const mode = query.get('mode') || 'window';          // 'screensaver' | 'preview' | 'window'
const audioAllowed = query.get('audio') !== '0' && mode !== 'preview';
const capture = query.has('capture');

const log = (message) => postToHost({ type: 'log', message: String(message) });
window.addEventListener('error', (e) => log(`error: ${e.message} at ${e.filename}:${e.lineno}`));
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
function build() {
  const q = QUALITY[settings.quality];
  const need = { quality: settings.quality, caseStyle: settings.caseStyle, finish: settings.finish, glass: settings.glass, background: settings.background };
  const same = (k) => built[k] === need[k];

  if (!same('quality') || !same('background') || !envRT) {
    if (envRT) envRT.dispose();
    envRT = createEnvironment(renderer, settings.background === 'black' ? 'studio' : settings.background, q.env);
    scene.environment = envRT.texture;
  }
  if (!clock || !same('quality') || !same('caseStyle') || !same('finish') || !same('glass')) {
    if (clock) { scene.remove(clock.group); clock.dispose(); }
    clock = createClock({ caseStyle: settings.caseStyle, finish: settings.finish, glass: settings.glass, glassReflections: settings.glassReflections, segments: q.segments });
    scene.add(clock.group);
    if (wall) wall.position.z = clock.back - 0.002;
  }
  if (!same('background')) {
    if (backdrop) { scene.remove(backdrop); backdrop.geometry.dispose(); backdrop.material.dispose(); backdrop = null; }
    if (wall) { scene.remove(wall); wall.userData.dispose(); wall = null; }
    if (settings.background === 'wall') { wall = createWall(clock.back); scene.add(wall); }
    else { backdrop = createBackdrop(settings.background); scene.add(backdrop); }
  }
  // Shadows: map size and softness from quality; the shadow camera tightly
  // wraps the clock (and a patch of wall) for maximum texel density.
  const size = onBattery && settings.batterySaver ? Math.min(q.shadow, 1024) : q.shadow;
  if (key.shadow.mapSize.x !== size) {
    key.shadow.mapSize.set(size, size);
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
  }
  key.shadow.radius = q.radius;
  const ext = settings.background === 'wall' ? 2.6 : 1.3;
  Object.assign(key.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 30 });
  key.shadow.camera.updateProjectionMatrix();

  const bg = BACKGROUNDS[settings.background] || BACKGROUNDS.studio;
  const a = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(settings.lightAngle, 10, 70));
  key.position.set(-Math.sin(a) * 0.62, Math.sin(a) * 0.78, Math.cos(a)).multiplyScalar(12);
  key.intensity = bg.light;
  scene.environmentIntensity = bg.env;
  renderer.toneMappingExposure = settings.exposure;
  clock.setGlassReflections(settings.glassReflections);
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
  out.material.uniforms.uVignette.value = settings.background === 'sky' ? 0.08 : 0.2;
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
  if (p) audio.suspend(); else { audio.resume(); requestAnimationFrame(frame); }
}
document.addEventListener('visibilitychange', () => setPaused(document.hidden));

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
let lastRender = 0, frames = 0, totalFrames = 0, fpsT = performance.now();
function frame(now) {
  if (paused) return;
  requestAnimationFrame(frame);
  const cap = onBattery && settings.batterySaver ? Math.min(settings.fps || 60, 30) : settings.fps;
  if (cap > 0 && now - lastRender < 1000 / cap - 1.5) return;
  lastRender = now;

  const t = wallNow();
  clock.setAngles(handAngles(t, settings));
  scheduleSounds(t);
  placeCamera(animTime());

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
  }
}

build();
applyAudio();
fpsEl.hidden = !settings.showFps;
postToHost({ type: 'ready', host: hostKind });
requestAnimationFrame(frame);
