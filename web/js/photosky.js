// Photographic skies: 360° HDR panoramas from Poly Haven (CC0).
//  - background: a 4096×2048 tonemapped JPEG, drawn with its own wider lens
//    (so a 4K panorama stays sharp enough) and a touch of soft focus, as if
//    photographed behind the clock with a shallow depth of field;
//  - reflections and ambient light: the real HDR panorama (sun clamped), so
//    the steel and the glass mirror the actual sky, clouds and landscape;
//  - the panorama is turned so its sun matches the key light and shadows.
// Files live in web/skies/ (from the `sky-assets` branch; see README).
import * as THREE from 'three';

const DIR = 'skies/';
let manifest;   // key -> Poly Haven id, or {} when the files are not installed

export async function photoSkiesAvailable() {
  if (manifest === undefined) {
    try {
      const r = await fetch(DIR + 'fetched.json', { cache: 'no-cache' });
      manifest = r.ok ? await r.json() : {};
    } catch { manifest = {}; }
  }
  return manifest;
}

// ---------------------------------------------------------------- Radiance .hdr

/** Minimal Radiance RGBE (.hdr) reader → Float32 RGBA pixels. */
export function parseHDR(buffer) {
  const bytes = new Uint8Array(buffer);
  let pos = 0;
  const line = () => {
    let s = '';
    while (pos < bytes.length && bytes[pos] !== 10) s += String.fromCharCode(bytes[pos++]);
    pos++;
    return s;
  };
  if (!line().startsWith('#?')) throw new Error('not a Radiance HDR file');
  for (let l = line(); l !== ''; l = line()) { if (pos >= bytes.length) throw new Error('bad header'); }
  const m = /-Y (\d+) \+X (\d+)/.exec(line());
  if (!m) throw new Error('unsupported HDR orientation');
  const h = +m[1], w = +m[2];
  const rgbe = new Uint8Array(w * h * 4);
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (bytes[pos] === 2 && bytes[pos + 1] === 2 && ((bytes[pos + 2] << 8) | bytes[pos + 3]) === w) {
      pos += 4;   // new RLE: four channels one after another
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w) {
          let n = bytes[pos++];
          if (n > 128) { n -= 128; const v = bytes[pos++]; while (n--) scan[(x++) * 4 + c] = v; }
          else { while (n--) scan[(x++) * 4 + c] = bytes[pos++]; }
        }
      }
      rgbe.set(scan, y * w * 4);
    } else {
      rgbe.set(bytes.subarray(pos, pos + w * 4), y * w * 4);   // flat
      pos += w * 4;
    }
  }
  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const e = rgbe[i * 4 + 3];
    const f = e ? Math.pow(2, e - 136) : 0;
    out[i * 4] = rgbe[i * 4] * f; out[i * 4 + 1] = rgbe[i * 4 + 1] * f; out[i * 4 + 2] = rgbe[i * 4 + 2] * f; out[i * 4 + 3] = 1;
  }
  return { width: w, height: h, data: out };
}

/** Sun (brightest area) direction, colour and the mean sky luminance. */
function analyse(hdr) {
  const { width: w, height: h, data } = hdr;
  let best = -1, bi = 0, sum = 0, n = 0;
  for (let y = 0; y < h / 2; y++) {                 // the sun is above the horizon
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const L = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (L > best) { best = L; bi = i / 4; }
    }
  }
  for (let i = 0; i < w * h; i++) {
    const L = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
    sum += Math.min(L, 50); n++;
  }
  const u = ((bi % w) + 0.5) / w, v = (Math.floor(bi / w) + 0.5) / h;
  const i = bi * 4, m = Math.max(data[i], data[i + 1], data[i + 2], 1e-6);
  return {
    sunU: u, sunElevation: (0.5 - v) * Math.PI, sunPeak: best,
    sunColor: new THREE.Color(data[i] / m, data[i + 1] / m, data[i + 2] / m),
    mean: sum / n,
  };
}

// Direction <-> panorama. u = 0.5 looks towards -Z (behind the clock); the
// seam is at +Z, behind the camera, where it is never seen.
const PANO = `
  uniform float uYaw;
  vec2 panoUv(vec3 d) {
    float a = atan(d.x, -d.z);
    return vec2(a / 6.28318530718 + 0.5 + uYaw, asin(clamp(d.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
  }`;

export class PhotoSky {
  /** Loads one sky; resolves to null if its files are missing. */
  static async load(key, { maxAniso = 8 } = {}) {
    const m = await photoSkiesAvailable();
    const id = m[key];
    if (!id) return null;
    const [jpg, hdrBuf] = await Promise.all([
      new THREE.TextureLoader().loadAsync(`${DIR}${id}.jpg`),
      fetch(`${DIR}${id}_1k.hdr`).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }),
    ]);
    const hdr = parseHDR(hdrBuf);
    return new PhotoSky(key, id, jpg, hdr, maxAniso);
  }

  constructor(key, id, jpg, hdr, maxAniso) {
    this.key = key;
    this.id = id;
    this.info = analyse(hdr);

    jpg.colorSpace = THREE.SRGBColorSpace;
    jpg.wrapS = THREE.RepeatWrapping;
    jpg.wrapT = THREE.ClampToEdgeWrapping;
    jpg.anisotropy = maxAniso;
    jpg.generateMipmaps = true;
    jpg.minFilter = THREE.LinearMipmapLinearFilter;
    this.jpg = jpg;

    // The HDR, with the sun clamped: the directional light supplies the sun's
    // strength (and its shadows); the panorama supplies sky, clouds and ground.
    const clampTo = 40;
    for (let i = 0; i < hdr.data.length; i += 4) {
      const L = Math.max(hdr.data[i], hdr.data[i + 1], hdr.data[i + 2]);
      if (L > clampTo) { const k = clampTo / L; hdr.data[i] *= k; hdr.data[i + 1] *= k; hdr.data[i + 2] *= k; }
    }
    // Float → half for broad GPU support with linear filtering.
    // Rows are stored top first; textures start at the bottom row.
    const half = new Uint16Array(hdr.data.length);
    const row = hdr.width * 4;
    for (let y = 0; y < hdr.height; y++) {
      const src = y * row, dst = (hdr.height - 1 - y) * row;
      for (let i = 0; i < row; i++) half[dst + i] = THREE.DataUtils.toHalfFloat(hdr.data[src + i]);
    }
    this.hdr = new THREE.DataTexture(half, hdr.width, hdr.height, THREE.RGBAFormat, THREE.HalfFloatType);
    this.hdr.colorSpace = THREE.LinearSRGBColorSpace;
    this.hdr.wrapS = THREE.RepeatWrapping;
    this.hdr.magFilter = this.hdr.minFilter = THREE.LinearFilter;
    this.hdr.generateMipmaps = false;
    this.hdr.needsUpdate = true;

    // Background: full-screen quad, own lens, follows the camera's orientation.
    this.bgMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tPano: { value: jpg }, uYaw: { value: 0 }, uRot: { value: new THREE.Matrix3() },
        uTan: { value: new THREE.Vector2(1, 1) }, uBlur: { value: 1.0 }, uExposure: { value: 1 },
      },
      vertexShader: 'varying vec2 vNdc; void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
      fragmentShader: `uniform sampler2D tPano; uniform mat3 uRot; uniform vec2 uTan; uniform float uBlur, uExposure;
        varying vec2 vNdc;
        ${PANO}
        void main(){
          vec3 d = normalize(uRot * vec3(vNdc * uTan, -1.0));
          vec4 c = texture2D(tPano, panoUv(d), uBlur);
          gl_FragColor = vec4(c.rgb * uExposure, 1.0);
        }`,
      depthWrite: false,
    });
    this.background = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMaterial);
    this.background.frustumCulled = false;
    this.background.renderOrder = -100;

    // Environment: a sphere showing the HDR, rendered into the reflection map.
    this.envMaterial = new THREE.ShaderMaterial({
      uniforms: { tPano: { value: this.hdr }, uYaw: this.bgMaterial.uniforms.uYaw },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tPano; varying vec3 vDir;
        ${PANO}
        void main(){ gl_FragColor = vec4(texture2D(tPano, panoUv(normalize(vDir))).rgb, 1.0); }`,
      side: THREE.BackSide, depthWrite: false,
    });
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), this.envMaterial));
  }

  /**
   * Turn the panorama so its sun sits at `azimuth` (radians, 0 = behind the
   * clock, positive = right; π = behind the camera).
   */
  setSunAzimuth(azimuth) {
    // Pixel column u appears at azimuth a where u = a/2π + 0.5 + yaw.
    this.bgMaterial.uniforms.uYaw.value = this.info.sunU - (azimuth / (2 * Math.PI) + 0.5);
  }

  /** Background lens: vertical field of view (degrees), soft focus, look-up angle. */
  updateBackground(camera, { fov = 62, blur = 1.0, lookUp = 0.2, exposure = 1 } = {}) {
    const u = this.bgMaterial.uniforms;
    const t = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    u.uTan.value.set(t * camera.aspect, t);
    u.uBlur.value = blur;
    u.uExposure.value = exposure;
    // Camera orientation, tipped up a little so more sky shows behind the clock.
    const m = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    m.multiply(new THREE.Matrix4().makeRotationX(lookUp));
    u.uRot.value.setFromMatrix4(m);
  }

  dispose() {
    this.jpg.dispose(); this.hdr.dispose();
    this.bgMaterial.dispose(); this.envMaterial.dispose();
    this.background.geometry.dispose();
    this.envScene.children[0].geometry.dispose();
  }
}
