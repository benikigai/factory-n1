/**
 * One factory floor: slab, walls, stations, conveyors actually used by the trace,
 * and an InstancedMesh of packages whose every transform comes from frameAt().
 */
import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ReplaySide } from "../../../../src/replay.ts";
import type { Layout, PackageTrace, Station } from "../../../../src/sim/types.ts";
import { SERVICE_TOP, SIZE_EDGE, ZONE_COLORS, mats, packModel, receivingModel, shippingModel, sorterModel, stackLight, type StackLight } from "../../../../web/world/machines.ts";
import { frameAt, traceMeta, type Frame, type GridPos, type TraceMeta } from "../../../../web/world/state.ts";

import type { AgentNode } from "../../runtime";

export interface AgentFloor { layout: Layout; agents: AgentNode[] }
export interface FloorOptions { onStation?(id:string):void; onAgent?(node:AgentNode):void }

const BELT_TOP = 0.42;
const STACK_PITCH = 0.42;
const SHIP_FADE = 8; // sim seconds a shipped package takes to fade into the dock
const COLOR_DAMAGED = new THREE.Color("#ef4444");
const COLOR_MISSORT = new THREE.Color("#f59e0b");
const COLOR_STRANDED = new THREE.Color("#b91c1c");

export interface Floor {
  group: THREE.Group;
  side: ReplaySide | AgentFloor;
  width: number;
  depth: number;
  originX: number;
  center: THREE.Vector3;
  meta: TraceMeta;
  stationWorld(id: string): THREE.Vector3 | null;
  update(t: number, realTime: number): Frame;
  setCounters(text: string): void;
  dispose(): void;
}

let concreteTex: THREE.CanvasTexture | null = null;
function concrete(): THREE.CanvasTexture {
  if (concreteTex) return concreteTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#9da3a8";
  g.fillRect(0, 0, 256, 256);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    const v = 130 + Math.floor(rnd() * 60);
    g.fillStyle = `rgba(${v},${v + 2},${v + 5},${0.25 + rnd() * 0.3})`;
    const s = rnd() * 2.2;
    g.fillRect(rnd() * 256, rnd() * 256, s, s);
  }
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = `rgba(80,84,90,${0.05 + rnd() * 0.08})`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(rnd() * 256, rnd() * 256);
    g.bezierCurveTo(rnd() * 256, rnd() * 256, rnd() * 256, rnd() * 256, rnd() * 256, rnd() * 256);
    g.stroke();
  }
  concreteTex = new THREE.CanvasTexture(c);
  concreteTex.colorSpace = THREE.SRGBColorSpace;
  concreteTex.wrapS = concreteTex.wrapT = THREE.RepeatWrapping;
  concreteTex.anisotropy = 4;
  return concreteTex;
}

type Wall = "north" | "south" | "west" | "east";
/** Which outer wall a dock sits on. Corners prefer north/south so trucks stay out of the gap between floors. */
function dockWall(s: Station, w: number, h: number): Wall {
  if (s.y === 0) return "north";
  if (s.y === h - 1) return "south";
  if (s.x === 0) return "west";
  if (s.x === w - 1) return "east";
  const d = { north: s.y, south: h - 1 - s.y, west: s.x, east: w - 1 - s.x };
  return (Object.keys(d) as Wall[]).sort((a, b) => d[a] - d[b])[0];
}
const WALL_NORMAL: Record<Wall, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

function label(text: string, cls: string): CSS2DObject {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  return new CSS2DObject(el);
}

export function createFloor(side: ReplaySide | AgentFloor, originX: number, title: string, accent: "base" | "improved", options:FloorOptions={}): Floor {
  const { layout } = side;
  const agents = "agents" in side ? side.agents : null;
  const traces:PackageTrace[] = "result" in side ? side.result.trace : [];
  const W = layout.grid.w;
  const H = layout.grid.h;
  const originZ = -H / 2;
  const group = new THREE.Group();
  group.name = `floor:${title}`;
  const disposables: { dispose(): void }[] = [];
  const meta = traceMeta(traces, layout);
  const byId = new Map(layout.stations.map((s) => [s.id, s]));
  const wx = (x: number) => originX + x + 0.5;
  const wz = (z: number) => originZ + z + 0.5;

  // --- slab, grid, safety line, walls
  const tex = concrete().clone();
  tex.needsUpdate = true;
  tex.repeat.set(W / 6, H / 6);
  const slabMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.0 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(W, 0.12, H), slabMat);
  slab.position.set(originX + W / 2, -0.06, 0);
  slab.receiveShadow = true;
  group.add(slab);
  disposables.push(slab.geometry, slabMat, tex);

  const gridPts: number[] = [];
  for (let x = 0; x <= W; x++) gridPts.push(originX + x, 0.004, originZ, originX + x, 0.004, originZ + H);
  for (let z = 0; z <= H; z++) gridPts.push(originX, 0.004, originZ + z, originX + W, 0.004, originZ + z);
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridPts, 3));
  const gridMat = new THREE.LineBasicMaterial({ color: "#2b3036", transparent: true, opacity: 0.22 });
  group.add(new THREE.LineSegments(gridGeo, gridMat));
  disposables.push(gridGeo, gridMat);

  const lineMat = new THREE.MeshStandardMaterial({ color: "#f2c230", roughness: 0.6 });
  const lines: THREE.BufferGeometry[] = [];
  const inset = 0.3;
  const addStrip = (cx: number, cz: number, sx: number, sz: number) => {
    const g = new THREE.BoxGeometry(sx, 0.006, sz);
    g.translate(cx, 0.003, cz);
    lines.push(g);
  };
  addStrip(originX + W / 2, originZ + inset, W - 2 * inset, 0.07);
  addStrip(originX + W / 2, originZ + H - inset, W - 2 * inset, 0.07);
  addStrip(originX + inset, 0, 0.07, H - 2 * inset);
  addStrip(originX + W - inset, 0, 0.07, H - 2 * inset);
  const lineGeo = mergeGeometries(lines)!;
  lines.forEach((g) => g.dispose());
  group.add(new THREE.Mesh(lineGeo, lineMat));
  disposables.push(lineGeo, lineMat);

  // Low perimeter walls with openings at dock cells.
  const docks = layout.stations.filter((s) => s.kind === "receiving" || s.kind === "shipping");
  const openings: Record<Wall, number[]> = { north: [], south: [], west: [], east: [] };
  for (const d of docks) {
    const wall = dockWall(d, W, H);
    openings[wall].push(wall === "north" || wall === "south" ? d.x : d.y);
  }
  const wallMat = new THREE.MeshStandardMaterial({ color: "#c9cdd2", roughness: 0.85 });
  const wallGeos: THREE.BufferGeometry[] = [];
  const WALL_H = 0.55;
  const WALL_T = 0.16;
  const buildWall = (wall: Wall) => {
    const len = wall === "north" || wall === "south" ? W : H;
    const holes = [...openings[wall]].sort((a, b) => a - b);
    let start = 0;
    const spans: [number, number][] = [];
    for (const c of holes) {
      if (c > start) spans.push([start, c]);
      start = Math.max(start, c + 1);
    }
    if (start < len) spans.push([start, len]);
    for (const [a, b] of spans) {
      const n = b - a;
      const g = wall === "north" || wall === "south" ? new THREE.BoxGeometry(n, WALL_H, WALL_T) : new THREE.BoxGeometry(WALL_T, WALL_H, n);
      const mid = (a + b) / 2;
      if (wall === "north") g.translate(originX + mid, WALL_H / 2, originZ - WALL_T / 2);
      if (wall === "south") g.translate(originX + mid, WALL_H / 2, originZ + H + WALL_T / 2);
      if (wall === "west") g.translate(originX - WALL_T / 2, WALL_H / 2, originZ + mid);
      if (wall === "east") g.translate(originX + W + WALL_T / 2, WALL_H / 2, originZ + mid);
      wallGeos.push(g);
    }
  };
  (["north", "south", "west", "east"] as Wall[]).forEach(buildWall);
  // corner posts
  for (const [x, z] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    const g = new THREE.BoxGeometry(WALL_T * 1.6, WALL_H + 0.1, WALL_T * 1.6);
    g.translate(originX + x + (x ? WALL_T / 2 : -WALL_T / 2), (WALL_H + 0.1) / 2, originZ + z + (z ? WALL_T / 2 : -WALL_T / 2));
    wallGeos.push(g);
  }
  const wallGeo = mergeGeometries(wallGeos)!;
  wallGeos.forEach((g) => g.dispose());
  const walls = new THREE.Mesh(wallGeo, wallMat);
  walls.castShadow = walls.receiveShadow = true;
  group.add(walls);
  disposables.push(wallGeo, wallMat);

  // --- conveyors: one L-shaped strip per from->to pair actually used by legs (x first, then y)
  const pairs = new Set<string>();
  for (const p of traces) for (const l of p.legs) pairs.add(`${l.from}\u0000${l.to}`);
  if(agents) for(let i=1;i<layout.stations.length;i++) pairs.add(`${layout.stations[i-1].id}\u0000${layout.stations[i].id}`);
  const unit = new Set<string>();
  for (const key of pairs) {
    const [fromId, toId] = key.split("\u0000");
    const a = byId.get(fromId);
    const b = byId.get(toId);
    if (!a || !b) continue;
    const sx = Math.sign(b.x - a.x);
    for (let x = a.x; x !== b.x; x += sx) unit.add(`h:${Math.min(x, x + sx)}:${a.y}`);
    const sy = Math.sign(b.y - a.y);
    for (let y = a.y; y !== b.y; y += sy) unit.add(`v:${b.x}:${Math.min(y, y + sy)}`);
  }
  const bedGeos: THREE.BufferGeometry[] = [];
  const beltGeos: THREE.BufferGeometry[] = [];
  for (const u of unit) {
    const [dir, xs, ys] = u.split(":");
    const x = Number(xs);
    const y = Number(ys);
    const horizontal = dir === "h";
    const cx = horizontal ? wx(x) + 0.5 : wx(x);
    const cz = horizontal ? wz(y) : wz(y) + 0.5;
    const bed = horizontal ? new THREE.BoxGeometry(1.0, BELT_TOP - 0.05, 0.5) : new THREE.BoxGeometry(0.5, BELT_TOP - 0.05, 1.0);
    bed.translate(cx, (BELT_TOP - 0.05) / 2, cz);
    bedGeos.push(bed);
    const belt = horizontal ? new THREE.BoxGeometry(1.0, 0.05, 0.4) : new THREE.BoxGeometry(0.4, 0.05, 1.0);
    belt.translate(cx, BELT_TOP - 0.025, cz);
    beltGeos.push(belt);
  }
  if (bedGeos.length) {
    const bedGeo = mergeGeometries(bedGeos)!;
    const beltGeo = mergeGeometries(beltGeos)!;
    bedGeos.concat(beltGeos).forEach((g) => g.dispose());
    const bedMat = new THREE.MeshStandardMaterial({ color: "#5d6670", roughness: 0.5, metalness: 0.55 });
    const beltMat = new THREE.MeshStandardMaterial({ color: "#1c1f24", roughness: 0.95 });
    const bedMesh = new THREE.Mesh(bedGeo, bedMat);
    const beltMesh = new THREE.Mesh(beltGeo, beltMat);
    bedMesh.castShadow = bedMesh.receiveShadow = true;
    beltMesh.receiveShadow = true;
    group.add(bedMesh, beltMesh);
    disposables.push(bedGeo, beltGeo, bedMat, beltMat);
  }

  // --- stations
  const cx = (W - 1) / 2;
  const cz = (H - 1) / 2;
  const lights = new Map<string, StackLight>();
  const diverters = new Map<string, { obj: THREE.Object3D; angle: number }>();
  const operators = new Map<string, THREE.Object3D>();
  const queueAnchor = new Map<string, { x: number; z: number; sx: number; sz: number }>();
  const labels: CSS2DObject[] = [];
  const bottleneck = "result" in side ? side.result.metrics.bottleneck : null;
  for (const s of layout.stations) {
    const pos = new THREE.Vector3(wx(s.x), 0, wz(s.y));
    let model: THREE.Object3D;
    let lightLocal = new THREE.Vector3(0.68, 0, -0.68);
    if (s.kind === "receiving" || s.kind === "shipping") {
      model = s.kind === "receiving" ? receivingModel() : shippingModel(s.zones ?? []);
      const [nx, nz] = WALL_NORMAL[dockWall(s, W, H)];
      model.rotation.y = Math.atan2(nx, nz);
      lightLocal = new THREE.Vector3(-nz * 0.75 - nx * 0.3, 0, nx * 0.75 - nz * 0.3);
    } else if (s.kind === "sorter") {
      const m = sorterModel();
      model = m.group;
      diverters.set(s.id, { obj: m.diverter, angle: 0 });
    } else {
      const m = packModel(s);
      model = m.group;
      // Operator stands on the far (north) side, facing the default camera.
      operators.set(s.id, m.operator);
    }
    model.userData.stationId=s.id;
    model.position.copy(pos);
    group.add(model);

    const light = stackLight();
    light.group.position.copy(pos).add(lightLocal);
    light.set(0);
    group.add(light.group);
    lights.set(s.id, light);

    const sx = Math.sign(cx - s.x) || 1;
    const sz = Math.sign(cz - s.y) || 1;
    queueAnchor.set(s.id, { x: s.x + sx * 1.15, z: s.y + sz * 1.15, sx, sz });

    const agent=agents?.find(n=>n.id===s.id);
    const text = agent ? `${agent.name}${agent.children.length ? " ↗" : ""}` : s.id;
    const l = label(text, `st-label st-${s.kind}${s.id === bottleneck ? " st-bottleneck" : ""}`);
    l.element.setAttribute("role","button");l.element.tabIndex=0;
    l.element.setAttribute("aria-label",agent?`${agent.children.length?'Enter':'Inspect'} ${agent.name}`:`Inspect ${accent==='base'?'baseline':'champion'} ${s.id}`);
    l.element.title=agent?`${agent.role} · ${agent.children.length} children`:`Inspect ${s.id}`;
    if(!agent&&'result' in side){const stats=side.result.metrics.stations[s.id];if(stats)l.element.title=`${stats.processed} processed · ${(stats.utilization*100).toFixed(1)}% busy. Click for details.`;}
    if(agent)l.element.dataset.status=agent.status;
    const select=()=>agent?options.onAgent?.(agent):options.onStation?.(s.id);
    l.element.addEventListener('click',e=>{e.stopPropagation();select();});
    l.element.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();select();}});
    if (s.id === bottleneck) l.element.title = "bottleneck (most total wait) in this run";
    l.position.set(pos.x, s.kind === "receiving" || s.kind === "shipping" ? 2.75 : 2.5, pos.z);
    group.add(l);
    labels.push(l);
  }

  // --- floor title with live counters (DOM via CSS2D)
  const titleEl = document.createElement("div");
  titleEl.className = `floor-title floor-${accent}`;
  const titleName = document.createElement("div");
  titleName.className = "floor-name";
  titleName.textContent = title;
  const titleCounters = document.createElement("div");
  titleCounters.className = "floor-counters";
  titleEl.append(titleName, titleCounters);
  const titleObj = new CSS2DObject(titleEl);
  titleObj.position.set(originX + W / 2, 0, originZ + H + 1.9);
  group.add(titleObj);
  labels.push(titleObj);

  // --- packages
  const N = traces.length;
  const pkgMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.55, metalness: 0.05 });
  const pkgMesh = new THREE.InstancedMesh(mats().box, pkgMat, Math.max(1, N));
  pkgMesh.count=N;
  pkgMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pkgMesh.castShadow = true;
  pkgMesh.receiveShadow = true;
  pkgMesh.frustumCulled = false;
  const outlineMat = new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.BackSide });
  const outline = new THREE.InstancedMesh(mats().box, outlineMat, Math.max(1, N));
  outline.count=N;
  outline.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  outline.frustumCulled = false;
  group.add(pkgMesh, outline);
  disposables.push(pkgMat, outlineMat);
  const zoneColor = Object.fromEntries(Object.entries(ZONE_COLORS).map(([k, v]) => [k, new THREE.Color(v)])) as Record<string, THREE.Color>;
  for (let i = 0; i < N; i++) pkgMesh.setColorAt(i, zoneColor[traces[i].zone]);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const tmpColor = new THREE.Color();

  const stackPos = (anchor: { x: number; z: number; sx: number; sz: number }, idx: number, edge: number, out: THREE.Vector3) => {
    const layer = Math.floor(idx / 9);
    const k = idx % 9;
    const col = (k % 3) - 1;
    const row = Math.floor(k / 3) - 1;
    out.set(wx(anchor.x + col * STACK_PITCH * anchor.sx), layer * STACK_PITCH + edge / 2 + 0.01, wz(anchor.z + row * STACK_PITCH * anchor.sz));
  };

  function update(t: number, realTime: number): Frame {
    const frame = frameAt(traces, layout, t, meta);
    const blink = Math.floor(realTime * 3) % 2 === 0;
    for (let i = 0; i < N; i++) {
      const tr = traces[i];
      const v = frame.views[i];
      const st = v.station ? byId.get(v.station) : undefined;
      let edge = SIZE_EDGE[tr.size];
      let visible = true;
      switch (v.state) {
        case "not_arrived":
          visible = false;
          break;
        case "traveling":
          p3.set(wx(v.position.x), BELT_TOP + edge / 2, wz(v.position.z));
          break;
        case "in_service": {
          const top = st ? SERVICE_TOP[st.kind] : BELT_TOP;
          p3.set(wx(v.position.x), top + edge / 2, wz(v.position.z));
          break;
        }
        case "queued": {
          const a = st ? queueAnchor.get(st.id) : undefined;
          if (a) stackPos(a, frame.queueIndex[i], edge, p3);
          else p3.set(wx(v.position.x), edge / 2, wz(v.position.z));
          break;
        }
        case "shipped": {
          const age = t - (tr.shippedAt ?? t);
          if (age >= SHIP_FADE) visible = false;
          else {
            edge *= 1 - age / SHIP_FADE;
            p3.set(wx(v.position.x), BELT_TOP + edge / 2, wz(v.position.z));
          }
          break;
        }
        case "stranded": {
          const a = st ? queueAnchor.get(st.id) : undefined;
          if (a) stackPos({ x: a.x - 2.3 * a.sx, z: a.z, sx: -a.sx, sz: a.sz }, frame.strandIndex[i], edge, p3);
          else p3.set(wx(v.position.x), edge / 2, wz(v.position.z));
          break;
        }
      }
      if (!visible || edge <= 0.001) {
        pkgMesh.setMatrixAt(i, zero);
        outline.setMatrixAt(i, zero);
        continue;
      }
      s3.setScalar(edge);
      m4.compose(p3, q, s3);
      pkgMesh.setMatrixAt(i, m4);
      if (tr.fragile) {
        s3.setScalar(edge * 1.16);
        m4.compose(p3, q, s3);
        outline.setMatrixAt(i, m4);
      } else outline.setMatrixAt(i, zero);

      const dAt = meta.damagedAt[i];
      const mAt = meta.missortedAt[i];
      if (v.state === "stranded") tmpColor.copy(COLOR_STRANDED);
      else if (dAt !== null && t >= dAt) tmpColor.copy(COLOR_DAMAGED);
      else tmpColor.copy(zoneColor[tr.zone]);
      if (mAt !== null && t >= mAt && blink) tmpColor.copy(COLOR_MISSORT);
      pkgMesh.setColorAt(i, tmpColor);
    }
    pkgMesh.instanceMatrix.needsUpdate = true;
    outline.instanceMatrix.needsUpdate = true;
    if (pkgMesh.instanceColor) pkgMesh.instanceColor.needsUpdate = true;

    for (const [id, light] of lights) {
      const n = frame.queueByStation.get(id) ?? 0;
      light.set(n >= 8 ? 2 : n >= 3 ? 1 : 0);
    }
    for (const [id, d] of diverters) {
      const pkg = frame.serviceByStation.get(id);
      const self = byId.get(id)!;
      if (pkg !== undefined) {
        const step = frame.views[pkg].step ?? 0;
        const leg = traces[pkg].legs[step];
        const to = leg ? byId.get(leg.to) : undefined;
        if (to) {
          const dx = to.x - self.x;
          const dz = to.y - self.y;
          const dir: GridPos = dx !== 0 ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) };
          const target = Math.atan2(-dir.z, dir.x);
          let diff = target - d.angle;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          d.angle += diff * 0.25;
        }
      }
      d.obj.rotation.y = d.angle;
    }
    for (const [id, op] of operators) {
      const busy = frame.serviceByStation.has(id);
      op.position.y = busy ? Math.abs(Math.sin(realTime * 7)) * 0.05 : 0;
      op.rotation.y = busy ? Math.sin(realTime * 3.5) * 0.25 : 0;
    }
    return frame;
  }

  return {
    group,
    side,
    width: W,
    depth: H,
    originX,
    center: new THREE.Vector3(originX + W / 2, 0, 0),
    meta,
    stationWorld(id) {
      const s = byId.get(id);
      return s ? new THREE.Vector3(wx(s.x), 0, wz(s.y)) : null;
    },
    update,
    setCounters(text) {
      const value=agents?`${agents.length} child entries · recorded workflow`:text;
      if (titleCounters.textContent !== value) titleCounters.textContent = value;
    },
    dispose() {
      for (const l of labels) l.element.remove();
      group.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial && o.material.name === "stack") o.material.dispose();
      });
      pkgMesh.dispose();
      outline.dispose();
      for (const d of disposables) d.dispose();
      group.removeFromParent();
    },
  };
}
