/**
 * The 3D world: ONE scene, ONE camera, ONE clock, two floors side by side
 * (baseline left, improved right) playing the same scenario at the same time t.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type { ReplayBundle } from "../../src/replay.ts";
import { createFloor, type Floor } from "./floor.ts";
import type { Frame } from "./state.ts";

const GAP = 10;
const BG = "#151a21";

export type CameraPreset = "overview" | "closeup";

export interface Warehouse {
  setBundle(bundle: ReplayBundle): void;
  /** Advance both floors to sim time t and draw. Returns [baseline, improved] frames. */
  render(t: number, realTime: number): [Frame, Frame] | null;
  setCounters(base: string, improved: string): void;
  preset(name: CameraPreset, animate?: boolean): void;
  closeupTarget(): string | null;
}

export function createWarehouse(host: HTMLElement): Warehouse {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = "labels";
  host.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 70, 170);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight("#dfe8ff", "#3a3328", 0.7));
  const sun = new THREE.DirectionalLight("#fff4e0", 2.3);
  sun.position.set(18, 40, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ color: "#252a31", roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.13;
  ground.receiveShadow = true;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 3;
  controls.maxDistance = 180;

  let floors: [Floor, Floor] | null = null;
  let bundle: ReplayBundle | null = null;
  let tween: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number; dur: number } | null = null;
  let firstLayout = true;

  function resize() {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  function presetPose(name: CameraPreset): { pos: THREE.Vector3; target: THREE.Vector3 } {
    if (!floors) return { pos: new THREE.Vector3(0, 40, 50), target: new THREE.Vector3() };
    const [a, b] = floors;
    if (name === "closeup" && bundle) {
      const id = bundle.improved.result.metrics.bottleneck;
      const p = b.stationWorld(id);
      if (p) return { pos: p.clone().add(new THREE.Vector3(4.5, 7.5, 10.5)), target: p.clone().add(new THREE.Vector3(0.6, 0.5, 0.4)) };
    }
    const minX = a.originX - 3;
    const maxX = b.originX + b.width + 3;
    const depth = Math.max(a.depth, b.depth);
    const halfW = (maxX - minX) / 2;
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const dist = Math.max(halfW / Math.tan(hfov / 2), (depth / 2 + 6) / Math.tan(vfov / 2)) * 1.08;
    const dir = new THREE.Vector3(0, 0.74, 0.67).normalize();
    const target = new THREE.Vector3((minX + maxX) / 2, 0, 1.2);
    return { pos: target.clone().addScaledVector(dir, dist), target };
  }

  function preset(name: CameraPreset, animate = true) {
    const pose = presetPose(name);
    if (!animate) {
      camera.position.copy(pose.pos);
      controls.target.copy(pose.target);
      controls.update();
      tween = null;
      return;
    }
    tween = { from: camera.position.clone(), to: pose.pos, tFrom: controls.target.clone(), tTo: pose.target, t0: performance.now(), dur: 900 };
  }

  function setBundle(next: ReplayBundle) {
    bundle = next;
    if (floors) for (const f of floors) f.dispose();
    const wa = next.baseline.layout.grid.w;
    const base = createFloor(next.baseline, -GAP / 2 - wa, next.baseline.label || "Gen-0 baseline", "base");
    const imp = createFloor(next.improved, GAP / 2, next.improved.label || "Improved", "improved");
    scene.add(base.group, imp.group);
    floors = [base, imp];
    // Fit the sun's shadow frustum to both floors.
    const half = Math.max(GAP / 2 + Math.max(wa, imp.width), Math.max(base.depth, imp.depth)) + 6;
    const cam = sun.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.updateProjectionMatrix();
    if (firstLayout) {
      preset("overview", false);
      firstLayout = false;
    }
  }

  function render(t: number, realTime: number): [Frame, Frame] | null {
    if (tween) {
      const k = Math.min(1, (performance.now() - tween.t0) / tween.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(tween.from, tween.to, e);
      controls.target.lerpVectors(tween.tFrom, tween.tTo, e);
      if (k >= 1) tween = null;
    }
    controls.update();
    let frames: [Frame, Frame] | null = null;
    if (floors) frames = [floors[0].update(t, realTime), floors[1].update(t, realTime)];
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    return frames;
  }

  return {
    setBundle,
    render,
    setCounters(a, b) {
      floors?.[0].setCounters(a);
      floors?.[1].setCounters(b);
    },
    preset,
    closeupTarget: () => bundle?.improved.result.metrics.bottleneck ?? null,
  };
}
