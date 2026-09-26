// Procedural 3D model of the Swiss railway clock. Units: the dial radius is 1.
// The dial lies in the XY plane at z = 0, facing +Z; 12 o'clock is +Y.
import * as THREE from 'three';
import { createFinish } from './finishes.js';

export const DIAL_R = 1.0;
const LIP_R = 1.02;          // inner edge of the bezel (the dial's visible edge)

// Height of each part above the dial. Generous gaps so the hands throw
// visible shadows on the dial and on each other.
export const Z = {
  markers: 0.0012,
  hour: 0.026,
  minute: 0.052,
  second: 0.078,
  glassEdge: 0.105,
  glassSag: 0.026,
};

const CASES = {
  //            outer r, back z, bezel side top, bezel crown height
  station: { r: 1.135, back: -0.46, side: 0.06, crown: 0.095 },
  wall:    { r: 1.10,  back: -0.14, side: 0.05, crown: 0.075 },
};

const RED = 0xd4151b;       // SBB red, as printed
const BLACK = 0x0e0e0f;

// ---------------------------------------------------------------- textures

/** Soft ambient occlusion for the dial: darker under the bezel lip and around the hub. */
function dialAO(size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0.0, '#d8d8d8');
  grad.addColorStop(0.06, '#ffffff');
  grad.addColorStop(0.86, '#ffffff');
  grad.addColorStop(0.955, '#dcdcdc');
  grad.addColorStop(0.985, '#8a8a8a');
  grad.addColorStop(1.0, '#555555');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// ---------------------------------------------------------------- geometry helpers

function arc(pts, cx, cz, rx, rz, a0, a1, n) {
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push(new THREE.Vector2(cx + rx * Math.cos(a), cz + rz * Math.sin(a)));
  }
}

/** Lathe around Z from (r, z) profile points. */
function lathe(pts, segments) {
  // LatheGeometry turns around +Y with points (x = r, y = height); rotate Y -> Z.
  const g = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p.x, p.y)), segments);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Tapered bar from `r0` to `r1` along +Y, width w0 -> w1, as a Shape. */
function taperShape(r0, r1, w0, w1) {
  const s = new THREE.Shape();
  s.moveTo(-w0 / 2, r0);
  s.lineTo(w0 / 2, r0);
  s.lineTo(w1 / 2, r1);
  s.lineTo(-w1 / 2, r1);
  s.closePath();
  return s;
}

function extrude(shape, depth, bevel, curveSegments = 12) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0005, depth - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8,
    bevelSegments: 2, curveSegments,
  });
  g.translate(0, 0, bevel);   // bottom of the bevel sits on z = 0
  return g;
}

/** Flat quads for the 60 dial markers, merged in one geometry. */
function markersGeometry() {
  const pos = [], idx = [];
  const add = (angle, r0, r1, w) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    // local: x across, y along the radius
    const corners = [[-w / 2, r0], [w / 2, r0], [w / 2, r1], [-w / 2, r1]];
    const base = pos.length / 3;
    for (const [x, y] of corners) pos.push(x * c + y * s, -x * s + y * c, 0);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    if (i % 5 === 0) add(a, 0.705, 0.945, 0.074);   // hour bars
    else add(a, 0.875, 0.945, 0.024);               // minute bars
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------- the clock

export function createClock({ caseStyle = 'station', finish = 'brushed', glassShape = 'flat', glassReflections = 1, mirror = 0.6, segments = 160 } = {}) {
  const C = CASES[caseStyle] || CASES.station;
  const group = new THREE.Group();
  const disposables = [];
  const track = (x) => (disposables.push(x), x);

  // --- materials ---
  const fin = createFinish(finish === 'polished' ? 'chrome' : finish);
  disposables.push(fin);
  const steel = fin.body, bezelMat = fin.bezel, innerMat = fin.inner;
  const arborMat = track(new THREE.MeshStandardMaterial({ color: 0x9a9ea3, metalness: 1, roughness: 0.3 }));
  const ao = track(dialAO(512));
  const dialMat = track(new THREE.MeshPhysicalMaterial({
    color: fin.dialTint || 0xf4f4f1, roughness: 0.62, metalness: 0, aoMap: ao, aoMapIntensity: 1, sheen: 0.0,
    specularIntensity: 0.35,
  }));
  const printMat = track(new THREE.MeshStandardMaterial({ color: BLACK, roughness: 0.72, metalness: 0 }));
  const blackMat = track(new THREE.MeshPhysicalMaterial({ color: BLACK, roughness: 0.5, metalness: 0.0, clearcoat: 0.18, clearcoatRoughness: 0.4, envMapIntensity: 0.6 }));
  const redMat = track(new THREE.MeshPhysicalMaterial({ color: RED, roughness: 0.4, metalness: 0.0, clearcoat: 0.3, clearcoatRoughness: 0.3 }));

  // --- case body (brushed) ---
  const rb = 0.05;
  const body = [];
  body.push(new THREE.Vector2(0.0001, C.back));
  body.push(new THREE.Vector2(C.r - rb, C.back));
  arc(body, C.r - rb, C.back + rb, rb, rb, -Math.PI / 2, 0, 8);
  body.push(new THREE.Vector2(C.r, 0.0));
  const bodyMesh = new THREE.Mesh(track(lathe(body, segments)), steel);
  bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // A shallow ring groove where the bezel meets the body.
  const groove = new THREE.Mesh(track(new THREE.TorusGeometry(C.r + 0.001, 0.006, 8, segments)), innerMat);
  groove.position.z = 0.0;
  group.add(groove);

  // --- bezel (polished), a rounded crown with an inner wall down to the dial ---
  const bz = [];
  bz.push(new THREE.Vector2(C.r, 0.0));
  bz.push(new THREE.Vector2(C.r, C.side * 0.5));
  const w = (C.r - LIP_R) / 2;
  arc(bz, LIP_R + w, C.side * 0.5, w, C.crown, 0, Math.PI, 24);
  bz.push(new THREE.Vector2(LIP_R, 0.012));
  bz.push(new THREE.Vector2(LIP_R - 0.004, -0.004));
  const bezel = new THREE.Mesh(track(lathe(bz, segments)), bezelMat);
  bezel.castShadow = true; bezel.receiveShadow = true;
  group.add(bezel);

  // --- dial ---
  const dial = new THREE.Mesh(track(new THREE.CircleGeometry(LIP_R, segments)), dialMat);
  dial.receiveShadow = true;
  group.add(dial);

  const markers = new THREE.Mesh(track(markersGeometry()), printMat);
  markers.position.z = Z.markers;
  markers.receiveShadow = true;
  group.add(markers);

  // --- hands ---
  const bevel = 0.0018;
  const hourGeo = track(extrude(taperShape(-0.25, 0.64, 0.112, 0.086), 0.012, bevel));
  const minuteGeo = track(extrude(taperShape(-0.24, 0.925, 0.094, 0.064), 0.012, bevel));

  const hour = new THREE.Group();
  const hourMesh = new THREE.Mesh(hourGeo, blackMat);
  hourMesh.castShadow = true; hourMesh.receiveShadow = true;
  hour.add(hourMesh);
  hour.position.z = Z.hour;

  const minute = new THREE.Group();
  const minuteMesh = new THREE.Mesh(minuteGeo, blackMat);
  minuteMesh.castShadow = true; minuteMesh.receiveShadow = true;
  minute.add(minuteMesh);
  minute.position.z = Z.minute;

  // Second hand: a thin red shaft with the famous disc ("the station master's signal").
  const secShape = taperShape(-0.33, 0.56, 0.026, 0.02);
  const second = new THREE.Group();
  const secMesh = new THREE.Mesh(track(extrude(secShape, 0.006, 0.0012)), redMat);
  const discShape = new THREE.Shape(); discShape.absarc(0, 0.615, 0.103, 0, Math.PI * 2, false);
  const disc = new THREE.Mesh(track(extrude(discShape, 0.008, 0.0016, 48)), redMat);
  disc.position.z = -0.001;
  const hubShape = new THREE.Shape(); hubShape.absarc(0, 0, 0.034, 0, Math.PI * 2, false);
  const secHub = new THREE.Mesh(track(extrude(hubShape, 0.012, 0.002, 32)), redMat);
  secHub.position.z = -0.002;
  for (const m of [secMesh, disc, secHub]) { m.castShadow = true; m.receiveShadow = true; second.add(m); }
  second.position.z = Z.second;

  // Arbor: a short steel post through the hubs.
  const arbor = new THREE.Mesh(track(new THREE.CylinderGeometry(0.014, 0.018, Z.second + 0.014, 24)), arborMat);
  arbor.rotation.x = Math.PI / 2;
  arbor.position.z = (Z.second + 0.014) / 2;
  arbor.castShadow = true;
  const cap = new THREE.Mesh(track(new THREE.SphereGeometry(0.02, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), redMat);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = Z.second + 0.012;
  cap.castShadow = true;
  group.add(hour, minute, second, arbor, cap);

  // --- glass: a crystal that shows reflections only (additive), either almost
  // flat (a slight dome) or strongly spherical, which bends the reflections
  // of the sky round like the bulging glass of old station clocks ---
  let glassMesh = null, grimeMesh = null, lensMat = null;
  const glassMat = track(new THREE.MeshPhysicalMaterial({
    color: 0x000000, metalness: 0, roughness: 0.02, ior: 1.52, specularIntensity: 1,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, premultipliedAlpha: false,
  }));
  if (glassShape === 'dome') {
    // A thick, solid crystal: a strongly curved outer surface over a flatter
    // inner one, with a thick rim. Real (screen-space) refraction through it
    // bends and magnifies the dial towards the edge, like a lens.
    const rimR = LIP_R - 0.004, rimBottom = 0.07, rimTop = 0.17, topZ = 0.34, innerTop = 0.25;
    const pts = [];
    const cap = (r0, z0, zTop, n, out) => {         // spherical arc from the rim (r0, z0) to the axis
      const sag = zTop - z0, Rs = (r0 * r0 + sag * sag) / (2 * sag), zc = zTop - Rs;
      const a0 = Math.asin(r0 / Rs);
      for (let k = 0; k <= n; k++) {
        const a = out ? a0 * (1 - k / n) : a0 * (k / n);
        pts.push(new THREE.Vector2(Rs * Math.sin(a), zc + Rs * Math.cos(a)));
      }
    };
    cap(rimR - 0.035, rimBottom + 0.005, innerTop, 40, false);   // inner surface, axis -> rim
    pts.push(new THREE.Vector2(rimR - 0.012, rimBottom));
    pts.push(new THREE.Vector2(rimR, rimBottom + 0.012));
    pts.push(new THREE.Vector2(rimR, rimTop - 0.012));
    pts.push(new THREE.Vector2(rimR - 0.01, rimTop));
    cap(rimR - 0.01, rimTop, topZ, 64, true);                     // outer surface, rim -> axis
    pts[0].x = pts[pts.length - 1].x = 0.0001;
    const lg = track(lathe(pts, segments));
    lensMat = track(new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.015, transmission: 1, thickness: 0.22, ior: 1.52,
      specularIntensity: 1, attenuationColor: new THREE.Color(0.93, 0.97, 0.95), attenuationDistance: 2.5,
    }));
    glassMesh = new THREE.Mesh(lg, lensMat);
    glassMesh.renderOrder = 10;
    group.add(glassMesh);
    // Keep the bezel above the thick rim so the crystal sits in it.
  } else if (glassShape !== 'none') {
    const a = LIP_R - 0.002, sag = Z.glassSag;
    const Rs = (a * a + sag * sag) / (2 * sag);
    const theta = Math.asin(a / Rs);
    const gg = track(new THREE.SphereGeometry(Rs, segments, 24, 0, Math.PI * 2, 0, theta));
    gg.rotateX(Math.PI / 2);
    gg.translate(0, 0, Z.glassEdge + sag - Rs);
    glassMesh = new THREE.Mesh(gg, glassMat);
    glassMesh.renderOrder = 10;
    group.add(glassMesh);
  }
  // Aged clock: mould and grime on the glass (a thin film just inside the outer surface).
  if (glassMesh && fin.grime) {
    const gm = track(new THREE.MeshStandardMaterial({ map: fin.grime, transparent: true, roughness: 0.95, metalness: 0, depthWrite: false }));
    let film = glassMesh.geometry;
    if (glassShape === 'dome') {
      const a = LIP_R - 0.016, sag = 0.34 - 0.17 - 0.004;
      const Rs = (a * a + sag * sag) / (2 * sag);
      film = track(new THREE.SphereGeometry(Rs, segments, 48, 0, Math.PI * 2, 0, Math.asin(a / Rs)));
      film.rotateX(Math.PI / 2);
      film.translate(0, 0, 0.34 - 0.004 - Rs);
    }
    grimeMesh = new THREE.Mesh(film, gm);
    grimeMesh.renderOrder = 11;
    group.add(grimeMesh);
  }
  const reflect = { glass: glassReflections, mirror };
  const applyReflections = () => {
    fin.setMirror(reflect.mirror);
    glassMat.envMapIntensity = 1.6 * reflect.glass * (0.4 + 1.2 * reflect.mirror);
    if (lensMat) lensMat.envMapIntensity = reflect.glass * (0.5 + 1.0 * reflect.mirror);
  };
  applyReflections();

  return {
    group,
    depth: -C.back,
    radius: C.r + 0.01,
    back: C.back,
    setAngles({ hour: h, minute: m, second: s }) {
      const k = -Math.PI / 180;
      hour.rotation.z = h * k;
      minute.rotation.z = m * k;
      second.rotation.z = s * k;
    },
    /** Lit dial (night): the dial glows from inside like the real station clocks. */
    setDialGlow(v) { dialMat.emissive.setRGB(1, 0.97, 0.9); dialMat.emissiveIntensity = v; },
    setGlassReflections(v) { reflect.glass = v; applyReflections(); },
    /** How mirror-like the metal (and the glass) is, 0..1. */
    setMirror(v) { reflect.mirror = v; applyReflections(); },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
