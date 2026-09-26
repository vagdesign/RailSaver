// Case finishes: chrome/nickel, brushed stainless (inox) and aged steel with
// rust, plus grime and mould on the glass for the aged clock. All textures
// are generated here. The lathe-turned case parts share one UV layout:
// u goes around the clock (u = 0 is the bottom, 6 o'clock), v along the profile.
import * as THREE from 'three';

// ---------------------------------------------------------------- noise helpers

function valueNoise(seed) {
  const N = 256, p = new Float32Array(N * N);
  let s = seed * 7919 + 1;
  for (let i = 0; i < p.length; i++) { s = (s * 16807) % 2147483647; p[i] = s / 2147483647; }
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const q = (i, j) => p[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (q(ix, iy) * (1 - sx) + q(ix + 1, iy) * sx) * (1 - sy) + (q(ix, iy + 1) * (1 - sx) + q(ix + 1, iy + 1) * sx) * sy;
  };
}
function fbm(noise, x, y, oct = 5) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += a * noise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return v / (1 - Math.pow(0.5, oct));
}
function canvasTexture(w, h, fill, { srgb = false, repeat = [1, 1] } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  fill(img.data, w, h);
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- brushed inox

/** Fine circumferential hairlines: roughness streaks (G) and a groove normal map. */
function brushedTextures() {
  const H = 2048, W = 8;
  const n = valueNoise(3);
  const height = new Float32Array(H);
  for (let y = 0; y < H; y++) height[y] = 0.35 * n(y * 0.25, 0.5) + 0.35 * n(y * 0.9, 7.5) + 0.3 * Math.random();
  const rough = canvasTexture(W, H, (d, w, h) => {
    for (let y = 0; y < h; y++) {
      const band = 0.5 + 0.5 * n(y * 0.05, 3.3);
      const r = 0.16 + 0.3 * height[y] + 0.14 * band;
      for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = 255; d[i + 1] = r * 255; d[i + 2] = 255; d[i + 3] = 255; }
    }
  }, { repeat: [24, 1] });
  const normal = canvasTexture(W, H, (d, w, h) => {
    for (let y = 0; y < h; y++) {
      const dh = (height[(y + 1) % h] - height[(y + h - 1) % h]) * 0.5;
      const ny = -dh * 9;
      const len = Math.hypot(ny, 1);
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        d[i] = 128; d[i + 1] = 128 + 127 * (ny / len); d[i + 2] = 255 * (1 / len); d[i + 3] = 255;
      }
    }
  }, { repeat: [24, 1] });
  return { rough, normal };
}

// ---------------------------------------------------------------- aged steel

// The rust photograph (web/textures/rust.jpg), decoded once into pixels.
let rustPhoto = null;
function loadRustPhoto() {
  if (!rustPhoto) {
    rustPhoto = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        resolve({ w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data });
      };
      img.onerror = () => resolve(null);
      img.src = 'textures/rust.jpg';
    });
  }
  return rustPhoto;
}

/**
 * Rust: gathers at the bottom of the case (where water runs and stays), in
 * pits and in drips. Where it is, the rust photograph shows through: its
 * orange rust is rough and dull, its grey-blue scale half metallic. Returns
 * colour (sRGB), roughness/metalness (G/B) and a bump map; drawn procedurally
 * first, then again with the photo once it has loaded.
 */
function agedTextures(amount = 1) {
  const W = 1024, H = 512;
  const n1 = valueNoise(11), n2 = valueNoise(23), n3 = valueNoise(41);
  const mask = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const bottom = 0.5 + 0.5 * Math.cos(2 * Math.PI * u);           // 1 at 6 o'clock
      const blot = fbm(n1, u * 14, v * 7, 5);
      const pits = n3(u * 180, v * 90);
      const drip = fbm(n2, u * 60, v * 3, 3);                          // rust running down
      let m = smooth(0.56 - 0.3 * bottom * amount, 0.72 - 0.26 * bottom * amount, blot);
      m = Math.max(m, smooth(0.8, 0.95, pits) * 0.8 * amount);
      m = Math.max(m, smooth(0.66, 0.8, drip) * bottom * 0.9 * amount);
      mask[y * W + x] = Math.min(1, m);
    }
  }
  const color = canvasTexture(W, H, () => {}, { srgb: true });
  const orm = canvasTexture(W, H, () => {});
  const bump = canvasTexture(W, H, () => {});

  const paint = (photo) => {
    const cd = new Uint8ClampedArray(W * H * 4), od = new Uint8ClampedArray(W * H * 4), bd = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, m = mask[i];
        const t = n2(x * 0.08, y * 0.08);
        const steel = [150 + 20 * t, 150 + 18 * t, 145 + 12 * t];
        let rust, rr, lum;
        if (photo) {
          // Mirror-tile the photo twice around the case so its ends meet invisibly.
          let px = (x / W) * 2; px = px > 1 ? 2 - px : px;
          const sx = Math.min(photo.w - 1, Math.floor(px * (photo.w - 1)));
          const sy = Math.min(photo.h - 1, Math.floor((y / H) * (photo.h - 1)));
          const k = (sy * photo.w + sx) * 4;
          rust = [photo.data[k], photo.data[k + 1], photo.data[k + 2]];
          rr = smooth(0, 70, rust[0] - rust[2]);                        // orange rust vs grey-blue scale
          lum = (rust[0] + rust[1] + rust[2]) / 765;
        } else {
          const dark = [62, 36, 24], orange = [128, 66, 30];
          const k = smooth(0.4, 1, m * (0.7 + 0.6 * t));
          rust = dark.map((c, j) => c + (orange[j] - c) * k);
          rr = 1; lum = 0.3 + 0.4 * k;
        }
        const a = photo ? smooth(0.02, 0.35, m) : smooth(0.05, 0.45, m);
        for (let j = 0; j < 3; j++) cd[i * 4 + j] = steel[j] + (rust[j] - steel[j]) * a;
        cd[i * 4 + 3] = 255;
        od[i * 4] = 255;
        od[i * 4 + 1] = (0.42 + a * (0.2 + 0.35 * rr)) * 255;           // roughness
        od[i * 4 + 2] = (1 - a * (0.45 + 0.45 * rr)) * 255;             // metalness
        od[i * 4 + 3] = 255;
        const b = a * (0.35 + 0.65 * lum) * (0.7 + 0.3 * n3(x * 0.5, y * 0.5));
        bd[i * 4] = bd[i * 4 + 1] = bd[i * 4 + 2] = b * 255; bd[i * 4 + 3] = 255;
      }
    }
    for (const [tex, data] of [[color, cd], [orm, od], [bump, bd]]) {
      tex.image.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0);
      tex.needsUpdate = true;
    }
  };
  paint(null);
  loadRustPhoto().then((photo) => { if (photo) paint(photo); });
  return { color, orm, bump };
}

/** Grime and mould on the inside of the glass: edges, the bottom, water stains. */
function glassGrime() {
  const S = 1024;
  const n1 = valueNoise(5), n2 = valueNoise(9), n3 = valueNoise(17);
  return canvasTexture(S, S / 2, (d, w, h) => {
    for (let y = 0; y < h; y++) {
      const radial = y / h;                // canvas row 0 = v 1 = the centre of the glass; last row = the rim
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const bottom = 0.5 + 0.5 * Math.sin(2 * Math.PI * u);    // condensation collects low
        const edge = smooth(0.55, 1.0, radial);
        const blot = fbm(n1, u * 24, radial * 6, 5);
        const spots = smooth(0.8, 0.88, n2(u * 90, radial * 40)) * smooth(0.35, 0.8, radial);
        let a = edge * smooth(0.45 - 0.2 * bottom, 0.75, blot) * (0.55 + 0.35 * bottom);
        a = Math.max(a, spots * 0.3 * (0.3 + bottom));
        const i = (y * w + x) * 4;
        const t = n2(u * 12, radial * 4);
        // Grey-green mould fading into brown film.
        d[i] = 70 + 34 * t; d[i + 1] = 78 + 30 * t; d[i + 2] = 52 + 16 * t; d[i + 3] = Math.min(1, a) * 200;
      }
    }
  }, { srgb: true });
}

// ---------------------------------------------------------------- materials

/**
 * Materials for a finish. `mirror` (0..1) scales how mirror-like the metal is:
 * reflection strength and sharpness.
 */
export function createFinish(finish) {
  const disposables = [];
  const T = (t) => (disposables.push(t), t);
  const M = (m) => (disposables.push(m), m);
  let body, bezel, inner, grime = null, dialTint = null;

  if (finish === 'chrome') {
    // Chrome over nickel: a near-perfect mirror with a faint warm cast.
    body = M(new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.055 }));
    body.color.setRGB(0.66, 0.66, 0.66);
    bezel = M(new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.035 }));
    bezel.color.setRGB(0.7, 0.7, 0.71);
    inner = M(new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.12 }));
    inner.color.setRGB(0.5, 0.5, 0.5);
  } else if (finish === 'aged') {
    const t = agedTextures(1.15);
    T(t.color); T(t.orm); T(t.bump);
    body = M(new THREE.MeshPhysicalMaterial({
      map: t.color, roughnessMap: t.orm, metalnessMap: t.orm, roughness: 1, metalness: 1,
      bumpMap: t.bump, bumpScale: 1.4,
    }));
    const t2 = agedTextures(0.3);
    T(t2.color); T(t2.orm); T(t2.bump);
    bezel = M(new THREE.MeshPhysicalMaterial({
      map: t2.color, roughnessMap: t2.orm, metalnessMap: t2.orm, roughness: 0.8, metalness: 1,
      bumpMap: t2.bump, bumpScale: 1.0,
    }));
    inner = M(new THREE.MeshStandardMaterial({ metalness: 0.6, roughness: 0.7 }));
    inner.color.setRGB(0.12, 0.08, 0.06);
    grime = T(glassGrime());
    dialTint = new THREE.Color().setRGB(0.83, 0.79, 0.66);   // yellowed enamel
  } else {
    // Brushed stainless (inox) body, polished stainless bezel.
    const t = brushedTextures();
    T(t.rough); T(t.normal);
    body = M(new THREE.MeshPhysicalMaterial({
      metalness: 1, roughness: 1, roughnessMap: t.rough,
      // Note: three.js anisotropy together with a normal map washes out to white,
      // so the brushing comes from the groove normals and roughness streaks.
      normalMap: t.normal, normalScale: new THREE.Vector2(0.9, 0.9),
    }));
    body.color.setRGB(0.42, 0.42, 0.41);
    bezel = M(new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.1 }));
    bezel.color.setRGB(0.6, 0.6, 0.59);
    inner = M(new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.3 }));
    inner.color.setRGB(0.32, 0.33, 0.34);
  }
  for (const m of [body, bezel, inner]) { m.userData.roughness = m.roughness; }

  return {
    body, bezel, inner, grime, dialTint,
    /** 0 = soft, dim reflections … 1 = a crisp mirror. */
    setMirror(v) {
      for (const m of [body, bezel, inner]) {
        m.envMapIntensity = 0.3 + 1.2 * v;
        m.roughness = m.userData.roughness * (1.45 - 0.9 * v);
      }
    },
    dispose() { for (const d of disposables) d.dispose(); },
  };
}
