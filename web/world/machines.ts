/**
 * Procedural station models built from primitives (no GLTF). 1 unit = 1 m = 1 grid cell.
 * Each builder returns a group centered on its cell; docks face local +z (out through the wall).
 */
import * as THREE from "three";
import type { Size, Station, Zone } from "../../src/sim/types.ts";

export const ZONE_COLORS: Record<Zone, string> = { A: "#3b82f6", B: "#a855f7", C: "#14b8a6" };
export const SIZE_EDGE: Record<Size, number> = { S: 0.24, M: 0.31, L: 0.38 };

/** Height of the surface a package rests on while in service, per station kind. */
export const SERVICE_TOP: Record<Station["kind"], number> = { receiving: 0.42, sorter: 0.86, pack: 0.86, shipping: 0.42 };

let shared: ReturnType<typeof makeShared> | null = null;
function makeShared() {
  const std = (color: string, roughness = 0.6, metalness = 0.1) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    steel: std("#8b949e", 0.38, 0.65),
    darkSteel: std("#3b424b", 0.5, 0.5),
    safety: std("#f2c230", 0.5, 0.1),
    bench: std("#c4a27a", 0.75, 0.0),
    vest: std("#ff7a1a", 0.7, 0.0),
    skin: std("#d9a77c", 0.8, 0.0),
    helmet: std("#ffd400", 0.35, 0.1),
    trailer: std("#eef1f4", 0.55, 0.2),
    cab: std("#d1d5db", 0.4, 0.3),
    glass: std("#1f2937", 0.15, 0.6),
    tire: std("#15171a", 0.9, 0.0),
    chipOff: new THREE.MeshStandardMaterial({ color: "#475569", roughness: 0.8, transparent: true, opacity: 0.35 }),
    chipOn: new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.4, emissive: new THREE.Color("#e2e8f0"), emissiveIntensity: 0.35 }),
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 20),
    sphere: new THREE.SphereGeometry(1, 20, 14),
  };
}
export function mats() {
  return (shared ??= makeShared());
}

function box(mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(mats().box, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cyl(mat: THREE.Material, r: number, h: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(mats().cyl, mat);
  m.scale.set(r, h, r);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function sphere(mat: THREE.Material, r: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(mats().sphere, mat);
  m.scale.setScalar(r);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

const zoneMatCache = new Map<string, THREE.MeshStandardMaterial>();
export function zoneMat(zone: Zone, emissive = 0): THREE.MeshStandardMaterial {
  const key = `${zone}:${emissive}`;
  let m = zoneMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: ZONE_COLORS[zone], roughness: 0.5, metalness: 0.1, emissive: new THREE.Color(ZONE_COLORS[zone]), emissiveIntensity: emissive });
    zoneMatCache.set(key, m);
  }
  return m;
}

/** Box truck backed up to a dock door. Local +z points away from the building. */
function truck(stripe: THREE.Material) {
  const g = new THREE.Group();
  const m = mats();
  const doorZ = 0.62;
  const trailerLen = 2.3;
  const tz = doorZ + 0.12 + trailerLen / 2;
  g.add(box(m.trailer, 1.2, 1.25, trailerLen, 0, 0.47 + 0.62, tz));
  g.add(box(stripe, 1.22, 0.16, trailerLen * 0.9, 0, 0.8, tz));
  const cabZ = doorZ + 0.12 + trailerLen + 0.5;
  g.add(box(m.cab, 1.15, 1.0, 0.85, 0, 0.47 + 0.5, cabZ));
  g.add(box(m.glass, 1.0, 0.36, 0.04, 0, 1.18, cabZ + 0.43));
  for (const [x, z] of [[-0.56, tz - 0.75], [0.56, tz - 0.75], [-0.56, tz + 0.75], [0.56, tz + 0.75], [-0.56, cabZ], [0.56, cabZ]]) {
    const w = cyl(m.tire, 0.22, 0.16, x, 0.22, z);
    w.rotation.z = Math.PI / 2;
    g.add(w);
  }
  return g;
}

/** Dock door frame with a roll-up door, leveler plate inside, truck outside. */
function dock(doorMat: THREE.Material, padMat: THREE.Material, stripe: THREE.Material) {
  const g = new THREE.Group();
  const m = mats();
  g.add(box(m.darkSteel, 0.95, 0.4, 0.95, 0, 0.2, 0));
  g.add(box(padMat, 0.95, 0.02, 0.12, 0, 0.41, 0.42));
  const z = 0.56;
  g.add(box(m.safety, 0.12, 2.2, 0.12, -0.64, 1.1, z));
  g.add(box(m.safety, 0.12, 2.2, 0.12, 0.64, 1.1, z));
  g.add(box(m.steel, 1.4, 0.16, 0.16, 0, 2.24, z));
  const roll = cyl(m.steel, 0.12, 1.24, 0, 2.02, z);
  roll.rotation.z = Math.PI / 2;
  g.add(roll);
  g.add(box(doorMat, 1.16, 0.5, 0.04, 0, 1.68, z + 0.02));
  g.add(truck(stripe));
  return g;
}

export function receivingModel() {
  const m = mats();
  return dock(m.steel, m.safety, m.darkSteel);
}

export function shippingModel(zones: Zone[]) {
  const z = zones[0] ?? "A";
  const g = dock(zoneMat(z, 0.15), zoneMat(z, 0.4), zoneMat(z));
  // Extra served zones as small swatches on the header.
  zones.slice(1).forEach((zz, i) => g.add(box(zoneMat(zz, 0.4), 0.22, 0.12, 0.04, -0.4 + i * 0.3, 2.42, 0.6)));
  return g;
}

export function sorterModel() {
  const g = new THREE.Group();
  const m = mats();
  g.add(box(m.darkSteel, 1.4, 0.68, 1.4, 0, 0.34, 0));
  g.add(box(m.safety, 1.42, 0.06, 1.42, 0, 0.7, 0));
  g.add(cyl(m.steel, 0.62, 0.1, 0, 0.78, 0));
  const diverter = new THREE.Group();
  diverter.position.y = 0.86;
  diverter.add(cyl(m.darkSteel, 0.12, 0.12, 0, 0.02, 0));
  diverter.add(box(m.safety, 0.62, 0.1, 0.14, 0.31, 0.05, 0));
  g.add(diverter);
  return { group: g, diverter };
}

export function packModel(st: Station) {
  const g = new THREE.Group();
  const m = mats();
  g.add(box(m.bench, 1.45, 0.08, 0.82, 0, 0.82, 0));
  for (const [x, z] of [[-0.66, -0.34], [0.66, -0.34], [-0.66, 0.34], [0.66, 0.34]]) g.add(box(m.steel, 0.06, 0.78, 0.06, x, 0.39, z));
  g.add(box(m.steel, 1.3, 0.04, 0.7, 0, 0.3, 0));
  const operator = new THREE.Group();
  operator.position.set(0, 0, -0.68);
  operator.add(cyl(m.darkSteel, 0.13, 0.62, 0, 0.31, 0));
  operator.add(cyl(m.vest, 0.19, 0.5, 0, 0.86, 0));
  operator.add(sphere(m.skin, 0.13, 0, 1.24, 0));
  const hat = sphere(m.helmet, 0.145, 0, 1.28, 0);
  hat.scale.y = 0.09;
  operator.add(hat);
  g.add(operator);
  // Accepted sizes as chips on the bench (lit = accepted).
  const sizes = st.sizes ?? [];
  (["S", "M", "L"] as Size[]).forEach((s, i) => {
    const e = SIZE_EDGE[s] * 0.75;
    g.add(box(sizes.includes(s) ? m.chipOn : m.chipOff, e, e * 0.5, e, 0.22 + i * 0.26, 0.86 + e * 0.25, 0.22));
  });
  // Accepted zones as colored studs (dim when not accepted).
  const zones = st.zones ?? [];
  (["A", "B", "C"] as Zone[]).forEach((z, i) => {
    g.add(cyl(zones.includes(z) ? zoneMat(z, 0.5) : m.chipOff, 0.06, 0.04, -0.58 + i * 0.16, 0.88, 0.3));
  });
  return { group: g, operator };
}

export interface StackLight {
  group: THREE.Group;
  set(level: 0 | 1 | 2): void;
}

/** Andon stack light: green idle, amber queue >= 3, red queue >= 8. */
export function stackLight(): StackLight {
  const g = new THREE.Group();
  const m = mats();
  g.add(cyl(m.darkSteel, 0.025, 1.7, 0, 0.85, 0));
  const colors = ["#22c55e", "#f59e0b", "#ef4444"];
  const lamps = colors.map((c, i) => {
    const mat = new THREE.MeshStandardMaterial({ color: c, emissive: new THREE.Color(c), emissiveIntensity: 0.05, roughness: 0.3, transparent: true, opacity: 0.9 });
    mat.name = "stack";
    const lamp = cyl(mat, 0.075, 0.14, 0, 1.78 + i * 0.15, 0);
    lamp.castShadow = false;
    g.add(lamp);
    return mat;
  });
  g.add(cyl(m.darkSteel, 0.08, 0.04, 0, 2.21, 0));
  let current = -1;
  return {
    group: g,
    set(level) {
      if (level === current) return;
      current = level;
      lamps.forEach((mat, i) => {
        const on = i === level;
        mat.emissiveIntensity = on ? 2.4 : 0.04;
        mat.opacity = on ? 1 : 0.55;
      });
    },
  };
}
