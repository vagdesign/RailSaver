// Falling things in front of and behind the clock: rain, snow, winter
// flurries, spring blossom petals and autumn leaves.
import * as THREE from 'three';

const BOX = { x: 7, yTop: 5, yBottom: -5, zNear: 3.2, zFar: -7 };

function rnd(a, b) { return a + Math.random() * (b - a); }

function flakeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function leafShape(kind) {
  const s = new THREE.Shape();
  if (kind === 'petals') {
    s.moveTo(0, -0.5);
    s.bezierCurveTo(0.45, -0.3, 0.4, 0.35, 0.08, 0.5);
    s.lineTo(0, 0.4); s.lineTo(-0.08, 0.5);
    s.bezierCurveTo(-0.4, 0.35, -0.45, -0.3, 0, -0.5);
  } else {
    // A simple maple-ish leaf.
    const pts = [[0, -0.5], [0.12, -0.2], [0.45, -0.25], [0.3, 0], [0.5, 0.2], [0.2, 0.2], [0.25, 0.5], [0, 0.3],
      [-0.25, 0.5], [-0.2, 0.2], [-0.5, 0.2], [-0.3, 0], [-0.45, -0.25], [-0.12, -0.2]];
    s.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
    s.closePath();
  }
  return new THREE.ShapeGeometry(s, 6);
}

export class Weather {
  constructor(kind, density = 1) {
    this.kind = kind;
    this.group = new THREE.Group();
    this.items = [];
    this.disposables = [];
    if (!kind) return;
    if (kind === 'rain') this.makeRain(Math.round(1400 * density));
    else if (kind === 'snow') this.makeSnow(Math.round(1600 * density), 1);
    else if (kind === 'flurries') this.makeSnow(Math.round(350 * density), 0.8);
    else this.makeLeaves(kind, Math.round((kind === 'petals' ? 160 : 90) * density));
  }

  spawn(p, anywhere) {
    p.x = rnd(-BOX.x, BOX.x);
    p.y = anywhere ? rnd(BOX.yBottom, BOX.yTop) : BOX.yTop + rnd(0, 1.5);
    p.z = rnd(BOX.zFar, BOX.zNear);
    // Keep a clear pocket right in front of the dial.
    if (Math.abs(p.x) < 1.4 && Math.abs(p.y) < 1.4 && p.z > -0.3) p.z = rnd(BOX.zFar, -0.8);
  }

  makeRain(n) {
    const pos = new Float32Array(n * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({ color: 0xc8d2dc, transparent: true, opacity: 0.35, depthWrite: false });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    this.disposables.push(geo, mat);
    for (let i = 0; i < n; i++) {
      const p = { v: rnd(9, 13), len: rnd(0.18, 0.34) };
      this.spawn(p, true);
      this.items.push(p);
    }
    this.wind = -0.12;
  }

  makeSnow(n, size) {
    const pos = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const tex = flakeTexture();
    const mat = new THREE.PointsMaterial({ size: 0.13 * size, map: tex, transparent: true, depthWrite: false, color: 0xffffff, opacity: 0.95 });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this.disposables.push(geo, mat, tex);
    for (let i = 0; i < n; i++) {
      const p = { v: rnd(0.35, 0.8), ph: rnd(0, 6.3), sw: rnd(0.2, 0.6) };
      this.spawn(p, true);
      this.items.push(p);
    }
  }

  makeLeaves(kind, n) {
    const geo = leafShape(kind);
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    const palette = kind === 'petals'
      ? [0xf7c6d4, 0xfbe0e8, 0xf2aac0, 0xffffff]
      : [0xc0461a, 0xd9831f, 0xa3301a, 0xe0a82e, 0x8a4b1c];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const p = {
        v: rnd(0.35, 0.75), ph: rnd(0, 6.3), sw: rnd(0.4, 1.0), spin: new THREE.Vector3(rnd(-2, 2), rnd(-2, 2), rnd(-1, 1)),
        rot: new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6)), s: kind === 'petals' ? rnd(0.05, 0.08) : rnd(0.1, 0.16),
      };
      this.spawn(p, true);
      this.items.push(p);
      this.mesh.setColorAt(i, c.set(palette[i % palette.length]));
    }
    this.group.add(this.mesh);
    this.disposables.push(geo, mat);
    this.dummy = new THREE.Object3D();
  }

  update(dt, t) {
    if (!this.kind) return;
    dt = Math.min(dt, 0.1);
    if (this.lines) {
      const a = this.lines.geometry.attributes.position.array;
      this.items.forEach((p, i) => {
        p.y -= p.v * dt; p.x += this.wind * p.v * dt;
        if (p.y < BOX.yBottom) this.spawn(p, false);
        const o = i * 6;
        a[o] = p.x; a[o + 1] = p.y; a[o + 2] = p.z;
        a[o + 3] = p.x - this.wind * p.len; a[o + 4] = p.y + p.len; a[o + 5] = p.z;
      });
      this.lines.geometry.attributes.position.needsUpdate = true;
    } else if (this.points) {
      const a = this.points.geometry.attributes.position.array;
      this.items.forEach((p, i) => {
        p.y -= p.v * dt;
        const x = p.x + Math.sin(t * 0.7 + p.ph) * p.sw * 0.35;
        if (p.y < BOX.yBottom) this.spawn(p, false);
        a[i * 3] = x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z;
      });
      this.points.geometry.attributes.position.needsUpdate = true;
    } else if (this.mesh) {
      const d = this.dummy;
      this.items.forEach((p, i) => {
        p.y -= p.v * dt;
        p.x += Math.sin(t * 0.9 + p.ph) * p.sw * dt * 0.8 + 0.12 * dt;
        p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt;
        if (p.y < BOX.yBottom || p.x > BOX.x + 1) this.spawn(p, false);
        d.position.set(p.x, p.y, p.z);
        d.rotation.copy(p.rot);
        d.scale.setScalar(p.s);
        d.updateMatrix();
        this.mesh.setMatrixAt(i, d.matrix);
      });
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() { for (const d of this.disposables) d.dispose(); if (this.mesh) this.mesh.dispose(); }
}
