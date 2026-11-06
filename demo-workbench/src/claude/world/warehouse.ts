/**
 * The 3D world: ONE scene, ONE camera, ONE clock, two floors side by side
 * (baseline left, improved right) playing the same scenario at the same time t.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type { ReplayBundle } from "../../../../src/replay.ts";
import { createFloor, type Floor } from "./floor.ts";
import type { AgentNode } from "../../runtime";
import { teamLayout } from "./team-layout";
import type { Frame } from "../../../../web/world/state.ts";

const GAP = 10;
const BG = "#151a21";

export type CameraPreset = "overview" | "closeup";

export interface Warehouse {
  setBundle(bundle: ReplayBundle): void;
  setAgents(scope:AgentNode):void;
  /** Advance both floors to sim time t and draw. Returns [baseline, improved] frames. */
  render(t: number, realTime: number): [Frame, Frame] | null;
  setCounters(base: string, improved: string): void;
  preset(name: CameraPreset, animate?: boolean): void;
  closeupTarget(): string | null;
}

export type Selection = {type:"station";side:"baseline"|"improved";id:string}|{type:"agent";node:AgentNode};
export function createWarehouse(host: HTMLElement,onSelect:(selection:Selection)=>void): Warehouse {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute("aria-label","Factory floors. Drag to orbit. Select a station label to inspect.");
  host.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = "labels";
  host.appendChild(labelRenderer.domElement);
  const leaders=document.createElementNS('http://www.w3.org/2000/svg','svg');
  leaders.classList.add('station-leaders');leaders.setAttribute('aria-hidden','true');host.append(leaders);
  const leaderLines=new Map<HTMLElement,SVGLineElement>();
  function clearLeaders(){leaders.replaceChildren();leaderLines.clear();}

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

  let floors: Floor[] = [];
  let agentScope:AgentNode|null=null;
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
    if (!floors.length) return { pos: new THREE.Vector3(0, 40, 50), target: new THREE.Vector3() };
    const a=floors[0],b=floors.at(-1)!;
    if (name === "closeup" && bundle && !agentScope) {
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
    clearLeaders();
    const leavingAgents=!!agentScope;
    bundle = next;agentScope=null;
    if (floors) for (const f of floors) f.dispose();
    const wa = next.baseline.layout.grid.w;
    const base = createFloor(next.baseline, -GAP / 2 - wa, next.baseline.label || "Gen-0 baseline", "base",{onStation:id=>onSelect({type:"station",side:"baseline",id})});
    const imp = createFloor(next.improved, GAP / 2, next.improved.label || "Improved", "improved",{onStation:id=>onSelect({type:"station",side:"improved",id})});
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
    if (firstLayout||leavingAgents) {
      preset("overview", false);
      firstLayout = false;
    }
  }

  function setAgents(scope:AgentNode){
    clearLeaders();
    for(const f of floors)f.dispose();
    agentScope=scope;
    const layout=teamLayout(scope);
    const floor=createFloor({layout,agents:scope.children},-layout.grid.w/2,scope.name,"improved",{onAgent:node=>onSelect({type:"agent",node})});
    floors=[floor];scene.add(floor.group);floor.setCounters('');preset("overview",false);
  }
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down:{x:number;y:number}|null=null;
  renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5){down=null;return;}down=null;
    const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);
    for(const hit of raycaster.intersectObjects(floors.map(f=>f.group),true)){
      let obj:THREE.Object3D|null=hit.object;while(obj&&!obj.userData.stationId)obj=obj.parent;
      if(!obj)continue;const id=obj.userData.stationId as string;
      if(agentScope){const node=agentScope.children.find(n=>n.id===id);if(node)onSelect({type:"agent",node});}
      else{const side=floors[0].group.getObjectById(obj.id)?"baseline":"improved";onSelect({type:"station",side,id});}break;
    }
  });

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
    if(floors.length===2)frames=[floors[0].update(t,realTime),floors[1].update(t,realTime)];
    else floors[0]?.update(0,realTime);
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    if(floors.length){
      const bounds=host.getBoundingClientRect(),crumbs=document.getElementById('breadcrumbs')?.getBoundingClientRect();
      const top=agentScope?Math.max(bounds.top+60,(crumbs?.bottom??bounds.top)+10):bounds.top+70;
      const placed:DOMRect[]=agentScope?[]:Array.from(host.querySelectorAll('.floor-title')).map(el=>el.getBoundingClientRect());
      for(const label of Array.from(host.querySelectorAll<HTMLElement>('.st-label'))){
        label.style.marginLeft='0px';label.style.marginTop='0px';const rect=label.getBoundingClientRect();
        const offsets=[];for(let row=-12;row<=12;row++)for(let col=-3;col<=3;col++)offsets.push({x:col*(rect.width+6),y:row*(rect.height+6)});
        offsets.sort((a,b)=>a.x*a.x+a.y*a.y-b.x*b.x-b.y*b.y);
        for(const offset of offsets){const x=rect.x+offset.x,y=rect.y+offset.y;
          if(x<bounds.left+6||x+rect.width>bounds.right-6||y<top||y+rect.height>bounds.bottom-120)continue;
          if(placed.some(p=>x<p.right+4&&x+rect.width+4>p.left&&y<p.bottom+4&&y+rect.height+4>p.top))continue;
          label.style.marginLeft=`${offset.x}px`;label.style.marginTop=`${offset.y}px`;placed.push(new DOMRect(x,y,rect.width,rect.height));
          if(!agentScope){
            let line=leaderLines.get(label);if(!line){line=document.createElementNS('http://www.w3.org/2000/svg','line');leaders.append(line);leaderLines.set(label,line);}
            line.setAttribute('x1',String(rect.x+rect.width/2-bounds.left));line.setAttribute('y1',String(rect.y+rect.height/2-bounds.top));
            line.setAttribute('x2',String(x+rect.width/2-bounds.left));line.setAttribute('y2',String(y+rect.height/2-bounds.top));
          }
          break;
        }
      }
    }
    return frames;
  }

  return {
    setBundle,
    setAgents,
    render,
    setCounters(a, b) {
      floors[0]?.setCounters(a);
      floors[1]?.setCounters(b);
    },
    preset,
    closeupTarget: () => agentScope?null:bundle?.improved.result.metrics.bottleneck ?? null,
  };
}
