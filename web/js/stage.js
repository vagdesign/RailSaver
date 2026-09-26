// Lighting, reflections and backgrounds around the clock.
import * as THREE from 'three';

/**
 * A procedural photo studio used as the reflection map for the steel and the
 * glass: a dark room with a large softbox, a strip light and a low fill card.
 * 'sky' swaps it for a bright, overcast outdoor environment.
 */
function studioScene(kind) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(20, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() }, uMid: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uTop, uBottom, uMid; varying vec3 vP;
        void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(uMid, uTop, smoothstep(0.0, 0.9, y)) : mix(uMid, uBottom, smoothstep(0.0, 0.6, -y));
        gl_FragColor = vec4(c, 1.0); }`,
    }),
  );
  const u = room.material.uniforms;
  const panel = (w, h, pos, intensity, color = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.material.color.multiplyScalar(intensity);
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
    return m;
  };
  if (kind === 'sky') {
    u.uTop.value.setRGB(2.4, 2.45, 2.55);
    u.uMid.value.setRGB(1.6, 1.62, 1.66);
    u.uBottom.value.setRGB(0.35, 0.34, 0.33);
    panel(18, 6, new THREE.Vector3(-4, 12, 8), 3.2);
  } else if (kind === 'wall') {
    u.uTop.value.setRGB(0.9, 0.9, 0.92);
    u.uMid.value.setRGB(0.55, 0.54, 0.52);
    u.uBottom.value.setRGB(0.18, 0.17, 0.16);
    panel(10, 7, new THREE.Vector3(-7, 9, 10), 7);
    panel(2, 12, new THREE.Vector3(12, 2, 6), 3.5);
  } else {
    u.uTop.value.setRGB(0.42, 0.42, 0.44);
    u.uMid.value.setRGB(0.16, 0.16, 0.17);
    u.uBottom.value.setRGB(0.05, 0.05, 0.055);
    panel(14, 9, new THREE.Vector3(-8, 9, 9), 9);           // key softbox, upper left
    panel(2.2, 16, new THREE.Vector3(13, 1, 5), 5);          // strip light, right
    panel(16, 3, new THREE.Vector3(0, -8, 10), 1.6, 0xfff4e8); // warm floor bounce
    panel(8, 6, new THREE.Vector3(3, 6, -14), 3);            // rim/back light
    panel(20, 5, new THREE.Vector3(0, 14, 2), 4);            // ceiling bank
    panel(9, 3.5, new THREE.Vector3(-5, 6, 16), 2.2);         // window behind the camera (glare on the glass)
  }
  scene.add(room);
  return scene;
}

export function createEnvironment(renderer, kind, size) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = studioScene(kind);
  const rt = pmrem.fromScene(scene, 0.02, 0.1, 100, { size });
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  pmrem.dispose();
  return rt;
}

// ---------------------------------------------------------------- backgrounds

const BG_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }';
const BG_FRAG = `
  uniform vec3 uInner, uOuter; uniform vec2 uCenter; uniform float uAspect;
  varying vec2 vUv;
  void main(){
    vec2 p = vUv - uCenter; p.x *= uAspect;
    float d = length(p) * 1.25;
    vec3 c = mix(uInner, uOuter, smoothstep(0.0, 1.0, d));
    gl_FragColor = vec4(c, 1.0);
  }`;

export const BACKGROUNDS = {
  studio: { inner: [0.052, 0.054, 0.06], outer: [0.004, 0.004, 0.005], light: 2.3, env: 1.0 },
  black:  { inner: [0, 0, 0], outer: [0, 0, 0], light: 2.3, env: 1.0 },
  sky:    { inner: [0.86, 0.87, 0.89], outer: [0.62, 0.63, 0.66], light: 1.4, env: 0.6 },
  wall:   { inner: [0, 0, 0], outer: [0, 0, 0], light: 2.6, env: 0.9 },
};

/** Full-screen gradient drawn behind everything (not used for 'wall'). */
export function createBackdrop(kind) {
  const b = BACKGROUNDS[kind] || BACKGROUNDS.studio;
  const mat = new THREE.ShaderMaterial({
    vertexShader: BG_VERT, fragmentShader: BG_FRAG, depthWrite: false, depthTest: true,
    uniforms: {
      uInner: { value: new THREE.Color().setRGB(...b.inner) },
      uOuter: { value: new THREE.Color().setRGB(...b.outer) },
      uCenter: { value: new THREE.Vector2(0.5, 0.52) },
      uAspect: { value: 1 },
    },
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

/** A light concrete facade behind the clock (catches the clock's shadow). */
export function createWall(back) {
  const S = 1024;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  // Value noise, a few octaves, for a fine-grained concrete look.
  const grid = (n, seed) => {
    const a = new Float32Array((n + 1) * (n + 1));
    let s = seed;
    for (let i = 0; i < a.length; i++) { s = (s * 16807) % 2147483647; a[i] = s / 2147483647; }
    for (let i = 0; i <= n; i++) { a[i * (n + 1) + n] = a[i * (n + 1)]; a[n * (n + 1) + i] = a[i]; }
    return (x, y) => {
      const fx = x * n, fy = y * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const q = (i, j) => a[(j % n) * (n + 1) + (i % n)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return (q(ix, iy) * (1 - sx) + q(ix + 1, iy) * sx) * (1 - sy) + (q(ix, iy + 1) * (1 - sx) + q(ix + 1, iy + 1) * sx) * sy;
    };
  };
  const o = [grid(4, 7), grid(16, 11), grid(64, 13), grid(256, 17)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const n = 0.35 * o[0](u, v) + 0.3 * o[1](u, v) + 0.2 * o[2](u, v) + 0.15 * o[3](u, v);
      const k = 172 + (n - 0.5) * 46 + (Math.random() - 0.5) * 10;
      const i = (y * S + x) * 4;
      img.data[i] = k; img.data[i + 1] = k * 0.985; img.data[i + 2] = k * 0.955; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.93, metalness: 0, envMapIntensity: 0.6 });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat);
  wall.position.z = back - 0.002;
  wall.receiveShadow = true;
  wall.userData.dispose = () => { tex.dispose(); mat.dispose(); wall.geometry.dispose(); };
  return wall;
}
