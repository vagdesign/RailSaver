// Procedural skies: gradient, sun (or moon), drifting clouds, stars, ground.
// The same sky dome is the visible background AND, rendered into a cube map,
// the reflection environment of the steel case and the glass, so the metal
// always mirrors the sky behind the clock.
import * as THREE from 'three';

// Colours are linear HDR. `sun` is [azimuth°, elevation°] in the sky; 0° azimuth
// is behind the clock (in view), positive to the right. `light` is the key light
// on the clock (colour, intensity) and `shadowSoft` how diffuse its shadows are.
export const SKIES = {
  summer: {
    label: 'Summer · blue sky with clouds',
    zenith: [0.11, 0.26, 0.72], horizon: [0.62, 0.76, 0.95], ground: [0.16, 0.2, 0.12],
    sun: [-38, 58], sunColor: [1.0, 0.96, 0.88], sunSize: 0.9, glow: 0.6,
    cover: 0.42, cloudLight: [1.25, 1.25, 1.25], cloudDark: [0.52, 0.56, 0.64], cloudScale: 1.0, wind: 0.012,
    haze: 0.25, intensity: 1.6, light: [[1.0, 0.97, 0.9], 2.7], env: 0.9, shadowSoft: 1, tilt: 30,
  },
  spring: {
    label: 'Spring · soft sky, blossom petals',
    zenith: [0.2, 0.38, 0.78], horizon: [0.78, 0.84, 0.94], ground: [0.2, 0.3, 0.14],
    sun: [-30, 48], sunColor: [1.0, 0.97, 0.92], sunSize: 0.9, glow: 0.5,
    cover: 0.5, cloudLight: [1.2, 1.2, 1.22], cloudDark: [0.6, 0.64, 0.72], cloudScale: 1.3, wind: 0.009,
    haze: 0.4, intensity: 1.55, light: [[1.0, 0.97, 0.93], 2.4], env: 0.9, shadowSoft: 1.4, tilt: 30,
    particles: 'petals',
  },
  autumn: {
    label: 'Autumn · golden afternoon, falling leaves',
    zenith: [0.16, 0.28, 0.58], horizon: [0.95, 0.72, 0.46], ground: [0.26, 0.14, 0.05],
    sun: [-48, 22], sunColor: [1.0, 0.72, 0.4], sunSize: 1.0, glow: 1.2,
    cover: 0.46, cloudLight: [1.35, 1.0, 0.72], cloudDark: [0.42, 0.36, 0.38], cloudScale: 0.9, wind: 0.015,
    haze: 0.5, intensity: 1.45, light: [[1.0, 0.8, 0.56], 2.5], env: 0.85, shadowSoft: 1.2, tilt: 22,
    particles: 'leaves',
  },
  winter: {
    label: 'Winter · cold clear sky, snowy ground',
    zenith: [0.1, 0.22, 0.52], horizon: [0.55, 0.64, 0.78], ground: [0.8, 0.84, 0.9],
    sun: [-26, 16], sunColor: [1.0, 0.9, 0.78], sunSize: 0.9, glow: 0.8,
    cover: 0.28, cloudLight: [1.2, 1.2, 1.25], cloudDark: [0.62, 0.66, 0.74], cloudScale: 0.8, wind: 0.006,
    haze: 0.35, intensity: 1.25, light: [[0.95, 0.94, 1.0], 2.3], env: 0.75, shadowSoft: 1.3, tilt: 18,
    particles: 'flurries',
  },
  sunset: {
    label: 'Sunset',
    zenith: [0.07, 0.09, 0.26], horizon: [0.95, 0.38, 0.12], ground: [0.05, 0.035, 0.035],
    sun: [13, 6], sunColor: [1.3, 0.5, 0.16], sunSize: 1.5, glow: 1.4,
    cover: 0.55, cloudLight: [1.5, 0.55, 0.3], cloudDark: [0.14, 0.08, 0.14], cloudScale: 0.8, wind: 0.008,
    haze: 0.2, intensity: 1.15, light: [[1.0, 0.64, 0.4], 2.5], env: 0.8, photoEnv: 0.3, photoLight: 1.0, photoNeutral: 0.55, shadowSoft: 1.5, tilt: 11,
  },
  rain: {
    label: 'Rainy day',
    zenith: [0.2, 0.22, 0.25], horizon: [0.42, 0.44, 0.47], ground: [0.07, 0.075, 0.08],
    sun: [-30, 45], sunColor: [0.3, 0.3, 0.3], sunSize: 0.0, glow: 0.0,
    cover: 0.92, cloudLight: [0.55, 0.57, 0.6], cloudDark: [0.2, 0.21, 0.23], cloudScale: 1.4, wind: 0.03,
    haze: 0.8, intensity: 1.2, light: [[0.86, 0.9, 1.0], 0.9], env: 1.25, shadowSoft: 5, tilt: 20,
    particles: 'rain',
  },
  snow: {
    label: 'Snowfall',
    zenith: [0.36, 0.38, 0.42], horizon: [0.62, 0.64, 0.68], ground: [0.9, 0.92, 0.95],
    sun: [-30, 40], sunColor: [0.5, 0.5, 0.5], sunSize: 0.0, glow: 0.0,
    cover: 0.9, cloudLight: [0.72, 0.74, 0.78], cloudDark: [0.4, 0.42, 0.47], cloudScale: 1.2, wind: 0.01,
    haze: 0.7, intensity: 1.1, light: [[0.93, 0.95, 1.0], 1.2], env: 0.85, shadowSoft: 5, tilt: 20,
    particles: 'snow',
  },
  overcast: {
    label: 'Overcast',
    zenith: [0.62, 0.64, 0.68], horizon: [0.86, 0.87, 0.89], ground: [0.3, 0.3, 0.28],
    sun: [-30, 45], sunColor: [0.6, 0.6, 0.6], sunSize: 0.0, glow: 0.2,
    cover: 0.85, cloudLight: [1.05, 1.06, 1.08], cloudDark: [0.62, 0.64, 0.68], cloudScale: 1.1, wind: 0.008,
    haze: 0.7, intensity: 1.3, light: [[1.0, 1.0, 1.0], 1.3], env: 1.0, shadowSoft: 4, tilt: 20,
  },
  night: {
    label: 'Night · moon and stars',
    zenith: [0.004, 0.007, 0.02], horizon: [0.03, 0.045, 0.08], ground: [0.01, 0.01, 0.012],
    sun: [28, 32], sunColor: [0.9, 0.93, 1.0], sunSize: 0.8, glow: 0.25, moon: true,
    cover: 0.3, cloudLight: [0.09, 0.1, 0.13], cloudDark: [0.01, 0.012, 0.02], cloudScale: 0.9, wind: 0.006,
    haze: 0.3, intensity: 1.0, stars: 1, light: [[0.75, 0.82, 1.0], 0.6], env: 1.6, shadowSoft: 2, tilt: 25,
    dialGlow: 0.85,   // the real station clocks are lit from inside at night
  },
};

// Photographic-only themes fall back to a similar generated sky.
SKIES.railway = { ...SKIES.summer, label: 'Railway track under clouds', cover: 0.62 };
SKIES.fields = { ...SKIES.summer, label: 'Sunflower field' };
SKIES.beach = { ...SKIES.summer, label: 'Mediterranean beach', cover: 0.3 };
SKIES.ruins = { ...SKIES.summer, label: 'Ancient ruins', cover: 0.2 };
SKIES.cliffs = { ...SKIES.summer, label: 'Sea cliff', cover: 0.45 };

/** 'auto': the season of today's date and, around dusk and at night, sunset / night. */
export function autoSky(date = new Date(), southern = false) {
  const h = date.getHours() + date.getMinutes() / 60;
  let m = date.getMonth();                       // 0 = January
  if (southern) m = (m + 6) % 12;
  // Rough dusk times by season (northern mid-latitudes).
  const dusk = [17, 17.8, 18.8, 20, 20.8, 21.3, 21.2, 20.6, 19.6, 18.6, 17.3, 16.8][m];
  const dawn = [7.8, 7.2, 6.3, 6.4, 5.8, 5.4, 5.6, 6.1, 6.8, 7.4, 7.3, 7.9][m];
  if (h >= dusk - 0.75 && h < dusk + 0.5) return 'sunset';
  if (h >= dusk + 0.5 || h < dawn - 0.25) return 'night';
  if (h < dawn + 0.75) return 'sunset';          // sunrise looks alike
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'autumn';
}

const VERT = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;   // always at the far plane
  }`;

const FRAG = `
  uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor, uCloudLight, uCloudDark;
  uniform float uSunSize, uGlow, uCover, uCloudScale, uTime, uHaze, uIntensity, uStars, uTilt, uMoon;
  uniform vec2 uWind;
  varying vec3 vDir;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < OCTAVES; i++) { v += a * noise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    // Tilt the sky so the view past the clock looks a little upwards.
    float c = cos(uTilt), s = sin(uTilt);
    d = vec3(d.x, d.y * c - d.z * s, d.y * s + d.z * c);
    float h = d.y;

    // Sky gradient and ground.
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
    vec3 col = h >= 0.0 ? sky : mix(uHorizon * 0.8, uGround, smoothstep(0.0, 0.12, -h));

    // Sun or moon, with its glow.
    float mu = dot(d, uSunDir);
    float rad = radians(uSunSize);
    float glow = uGlow * (0.35 * pow(max(mu, 0.0), 6.0) + 0.9 * pow(max(mu, 0.0), 60.0));
    col += uSunColor * glow;
    float disc = smoothstep(cos(rad), cos(rad * 0.85), mu);

    // Stars.
    if (uStars > 0.0 && h > 0.0) {
      vec2 g = d.xz / (h + 0.25) * 90.0;
      vec2 cell = floor(g);
      float r = hash(cell);
      vec2 pos = fract(g) - vec2(hash(cell + 3.1), hash(cell + 7.3));
      float star = smoothstep(0.06, 0.0, length(pos)) * step(0.93, r);
      star *= 0.5 + 0.5 * sin(uTime * (1.0 + r * 3.0) + r * 40.0);
      col += vec3(0.9, 0.95, 1.0) * star * uStars * 1.5 * smoothstep(0.0, 0.2, h);
    }

    // Clouds on a plane above the viewer, drifting with the wind.
    float cloud = 0.0;
    if (h > 0.0 && uCover > 0.0) {
      vec2 p = d.xz / (h + 0.3) * 2.2 * uCloudScale + uWind * uTime;
      float n = fbm(p + 0.03 * uTime * vec2(0.3, -0.2));
      float n2 = fbm(p + uSunDir.xz * 0.12 + 0.03 * uTime * vec2(0.3, -0.2));
      float edge = 1.0 - uCover;
      cloud = smoothstep(edge, edge + 0.22, n) * smoothstep(0.0, 0.1, h);
      float lit = clamp(0.55 + (n - n2) * 4.0, 0.0, 1.0);
      vec3 cc = mix(uCloudDark, uCloudLight, lit);
      cc += uSunColor * uGlow * 0.6 * pow(max(mu, 0.0), 5.0) * (1.0 - cloud * 0.6);   // silver lining
      col = mix(col, cc, cloud);
    }
    // Moon: a pale disc with a hint of craters; the sun: a bright disc.
    if (uMoon > 0.5) {
      float cr = noise(d.xy * 900.0) * 0.25;
      col = mix(col, uSunColor * (1.6 - cr), disc * (1.0 - cloud));
    } else {
      col += uSunColor * 30.0 * disc * (1.0 - cloud);
    }
    // Haze towards the horizon.
    col = mix(col, uHorizon, uHaze * (1.0 - smoothstep(0.0, 0.14, abs(h))) * 0.8);
    gl_FragColor = vec4(col * uIntensity, 1.0);
  }`;

const col = (a) => new THREE.Color().setRGB(...a);

export class Sky {
  constructor(octaves = 5) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false,
      defines: { OCTAVES: octaves },
      uniforms: {
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
        uCloudLight: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() },
        uSunSize: { value: 1 }, uGlow: { value: 1 }, uCover: { value: 0.4 }, uCloudScale: { value: 1 },
        uTime: { value: 0 }, uHaze: { value: 0.3 }, uIntensity: { value: 1 }, uStars: { value: 0 },
        uTilt: { value: THREE.MathUtils.degToRad(18) }, uMoon: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0.3) },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    // A scene holding only the sky, for the reflection cube map.
    this.envScene = new THREE.Scene();
    // Reflections use the untilted sky: straight ahead is the horizon, up is the zenith.
    this.envMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, defines: { OCTAVES: octaves },
      uniforms: { ...this.material.uniforms, uTilt: { value: 0 } },
    });
    this.envMesh = new THREE.Mesh(this.mesh.geometry, this.envMaterial);
    this.envScene.add(this.envMesh);
  }

  set(name) {
    const p = SKIES[name] || SKIES.summer;
    this.preset = p;
    const u = this.material.uniforms;
    u.uZenith.value.copy(col(p.zenith));
    u.uHorizon.value.copy(col(p.horizon));
    u.uGround.value.copy(col(p.ground));
    u.uSunColor.value.copy(col(p.sunColor));
    u.uCloudLight.value.copy(col(p.cloudLight));
    u.uCloudDark.value.copy(col(p.cloudDark));
    const az = THREE.MathUtils.degToRad(p.sun[0]), el = THREE.MathUtils.degToRad(p.sun[1]);
    // In the (tilted) sky frame: -Z is behind the clock.
    u.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    u.uSunSize.value = p.sunSize;
    u.uGlow.value = p.glow;
    u.uCover.value = p.cover;
    u.uCloudScale.value = p.cloudScale;
    u.uHaze.value = p.haze;
    u.uIntensity.value = p.intensity;
    u.uStars.value = p.stars || 0;
    u.uMoon.value = p.moon ? 1 : 0;
    u.uWind.value.set(1, 0.35).multiplyScalar(p.wind * 10);
    u.uTilt.value = THREE.MathUtils.degToRad(p.tilt ?? 22);
    return p;
  }

  update(t) { this.material.uniforms.uTime.value = t; }

  dispose() { this.material.dispose(); this.envMaterial.dispose(); this.mesh.geometry.dispose(); }
}

/** Key light for a sky preset: colour + intensity, kept in front of the clock. */
export function skyLight(p) {
  return { color: col(p.light[0]), intensity: p.light[1] };
}
