// The interactive 3D house.
//
// Levels are stacked boxes sized by the number of rooms; the roof carries solar
// panels when the house has them; battery, heat pump, car(s) and the grid
// connection stand around the house, linked to an energy meter on the facade by
// paths whose moving particles show where power is flowing.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

const ROOM_W = 4;
const HOUSE_D = 8;
const LEVEL_H = 3;
const WALL = 0.16;
const SLAB = 0.22;
const ROOF_H = 2.3;
const ROOF_OVERHANG = 0.45;
const LIFT = 5.5;
const PARTICLES = 7;

export const FLOW_COLORS = {
  solar: 0xff9800,
  gridIn: 0x488fc2,
  gridOut: 0x8353d1,
  batteryIn: 0xf06292,
  batteryOut: 0x4db6ac,
  car: 0x26a69a,
  heat: 0xef6c3a,
  home: 0x5d7df7,
};

const PALETTES = {
  light: {
    ground: 0xe4ebdd,
    wall: 0xf6f3ee,
    slab: 0xd6cfc2,
    roof: 0xb4533f,
    roofSide: 0xe9e4db,
    room: 0xefe6d6,
    roomAlt: 0xe6dac6,
    interior: 0xd9d1c3,
    glass: 0x9db6c8,
    lit: 0xffc45e,
    panel: 0x1f3b63,
    metal: 0xc8ced5,
    dark: 0x3b4046,
    tire: 0x262626,
    carBody: 0x6f8fae,
    pole: 0x8a7760,
    path: 0xb9b2a4,
    hemiSky: 0xffffff,
    hemiGround: 0x9aa08a,
    hemi: 1.7,
    sun: 2.3,
  },
  dark: {
    ground: 0x1f2922,
    wall: 0xd7d2c8,
    slab: 0x9d968a,
    roof: 0x8f4234,
    roofSide: 0xbab4aa,
    room: 0xcfc5b3,
    roomAlt: 0xc4b8a2,
    interior: 0xa9a194,
    glass: 0x4b6173,
    lit: 0xffc45e,
    panel: 0x1b2f4f,
    metal: 0x9aa1a8,
    dark: 0x2e3237,
    tire: 0x1a1a1a,
    carBody: 0x5d7c99,
    pole: 0x6e604e,
    path: 0x55524c,
    hemiSky: 0xcfd8ff,
    hemiGround: 0x3a3f35,
    hemi: 1.1,
    sun: 1.5,
  },
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const approach = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
}

function box(w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function label(element) {
  const object = new CSS2DObject(element);
  object.center.set(0.5, 1);
  return object;
}

/** Split a floor's rooms into cells that exactly cover the house footprint. */
export function roomCells(count, width, depth) {
  if (count === 0) return [];
  const rows = count >= 2 ? 2 : 1;
  const perRow = Math.ceil(count / rows);
  const cells = [];
  let index = 0;
  for (let row = 0; row < rows; row++) {
    const inRow = row === rows - 1 ? count - perRow * (rows - 1) : perRow;
    const cellW = width / inRow;
    const cellD = depth / rows;
    for (let col = 0; col < inRow; col++) {
      cells.push({
        index: index++,
        row,
        rows,
        x: -width / 2 + cellW * (col + 0.5),
        z: depth / 2 - cellD * (row + 0.5),
        w: cellW,
        d: cellD,
      });
    }
  }
  return cells;
}

export function houseSize(floors) {
  const maxRooms = Math.max(1, ...floors.map((f) => f.rooms.length));
  return { width: Math.max(8, Math.ceil(maxRooms / 2) * ROOM_W), depth: HOUSE_D };
}

export class HouseScene {
  constructor(container, { onSelectLevel, onSelectRoom } = {}) {
    this.container = container;
    this.onSelectLevel = onSelectLevel || (() => {});
    this.onSelectRoom = onSelectRoom || (() => {});
    this.dark = false;
    this.palette = PALETTES.light;
    this.levels = [];
    this.flows = {};
    this.selectedLevel = null;
    this.selectedRoom = null;
    this.hovered = null;
    this.insets = { right: 0, bottom: 0 };
    this.live = null;
    this.time = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = "webgl";
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = "labels";
    container.appendChild(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);
    this.camera.position.set(18, 14, 26);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 120;
    this.controls.addEventListener("start", () => {
      this.controls.autoRotate = false;
      this.cameraAnim = null;
      this.userMoved = true;
    });

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x999999, 1.5);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.position.set(-18, 30, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    this.groundMat = std(this.palette.ground);
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(60, 72), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._down = null;
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => (this._down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener("pointerup", (e) => this._onPointerUp(e));
    canvas.addEventListener("pointermove", (e) => this._onPointerMove(e));
    canvas.addEventListener("pointerleave", () => this._setHover(null));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.clock = new THREE.Clock();
    this._frame = () => {
      this._raf = requestAnimationFrame(this._frame);
      if (document.hidden) return;
      this._tick(Math.min(this.clock.getDelta(), 0.1));
    };
    this._raf = requestAnimationFrame(this._frame);
  }

  // ---------------------------------------------------------------- public

  setTheme(dark) {
    if (this.dark === dark && this.levels.length) return;
    this.dark = dark;
    this.palette = dark ? PALETTES.dark : PALETTES.light;
    this.groundMat.color.set(this.palette.ground);
    this.hemi.color.set(this.palette.hemiSky);
    this.hemi.groundColor.set(this.palette.hemiGround);
    this.hemi.intensity = this.palette.hemi;
    this.sun.intensity = this.palette.sun;
    if (this.model) this.setModel(this.model, { keepCamera: true });
  }

  /** Space covered by overlays (px), so the house is centered in what's left. */
  setInsets(insets) {
    const next = { right: 0, bottom: 0, ...insets };
    const changed = Math.abs(next.right - this.insets.right) + Math.abs(next.bottom - this.insets.bottom) > 20;
    this.insets = next;
    this.resize();
    // Overlays settle after the first layout; re-frame unless the user took over.
    if (changed && !this.userMoved) this._frameCamera();
  }

  setModel(model, { keepCamera = false } = {}) {
    this.model = model;
    this._clearHouse();
    this._buildHouse(model);
    if (this.selectedLevel != null && this.selectedLevel >= this.levels.length) {
      this.selectedLevel = null;
    }
    this._applySelection(!keepCamera);
    if (this.live) this.setLive(this.live);
  }

  /** Live values, already formatted for the labels by the panel. */
  setLive(live) {
    this.live = live;
    if (!this.house) return;
    const { flows } = this;
    const pv = live.pv ?? 0;
    const grid = live.grid ?? 0;
    const battery = live.battery ?? 0;

    this._setFlow(flows.solar, pv, 1);
    this._setFlow(flows.grid, grid, 1, grid >= 0 ? FLOW_COLORS.gridIn : FLOW_COLORS.gridOut);
    this._setFlow(
      flows.battery,
      battery,
      -1,
      battery > 0 ? FLOW_COLORS.batteryOut : FLOW_COLORS.batteryIn,
    );
    this._setFlow(flows.heat, live.heatPumpBoost ? 2000 : 0, 1);
    (live.cars || []).forEach((car, i) => this._setFlow(flows[`car${i}`], car.charging ? car.power || 1500 : 0, 1));

    this.solarGlow = Math.min(1, pv / 8000);
    this.heatPumpBoost = !!live.heatPumpBoost;
    this.batterySoc = live.batterySoc;

    for (const level of this.levels) {
      for (const room of level.rooms) {
        const state = live.rooms?.[room.id] || {};
        room.lit = state.lights > 0;
        room.heating = !!state.heating;
        room.labelInfo.textContent = state.summary || "";
      }
    }

    (this.cars || []).forEach((car, i) => {
      const state = live.cars?.[i] || {};
      car.body.visible = !!state.connected;
      car.cable.visible = !!state.connected;
      car.ledTarget = state.charging ? 1 : state.connected ? 0.35 : 0;
      car.ledMat.color.set(state.charging ? FLOW_COLORS.car : 0xffb300);
    });

    for (const [key, chip] of Object.entries(this.chips || {})) {
      const text = live.labels?.[key];
      chip.object.visible = text != null;
      if (text != null) chip.value.textContent = text;
    }
  }

  selectLevel(index) {
    this.selectedLevel = index;
    this.selectedRoom = null;
    this._applySelection(true);
  }

  selectRoom(roomId) {
    this.selectedRoom = roomId;
    if (roomId != null) {
      const level = this.levels.findIndex((l) => l.rooms.some((r) => r.id === roomId));
      if (level >= 0 && level !== this.selectedLevel) {
        this.selectedLevel = level;
        this._applySelection(true);
        return;
      }
    }
    this._applySelection(false);
  }

  resetView() {
    this.selectedLevel = null;
    this.selectedRoom = null;
    this._applySelection(true);
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    // Shift the picture so the house sits in the middle of the uncovered area.
    this.camera.setViewOffset(w, h, this.insets.right / 2, this.insets.bottom / 2, w, h);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this.resizeObserver.disconnect();
    this._clearHouse();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }

  // ---------------------------------------------------------------- build

  _clearHouse() {
    if (!this.house) return;
    this.scene.remove(this.house);
    this.house.traverse((obj) => {
      if (obj.isCSS2DObject) obj.element.remove();
      obj.geometry?.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => m?.dispose());
    });
    this.house = null;
    this.levels = [];
    this.flows = {};
    this.chips = {};
    this.cars = [];
  }

  _buildHouse(model) {
    const floors = model.floors.length ? model.floors : [{ id: "_", name: "", rooms: [] }];
    const { width: W, depth: D } = houseSize(floors);
    this.size = { W, D, H: floors.length * LEVEL_H };
    this.levels = [];
    this.flows = {};
    this.chips = {};
    this.cars = [];
    this.house = new THREE.Group();
    this.scene.add(this.house);

    floors.forEach((floor, i) => this.levels.push(this._buildLevel(floor, i, W, D)));
    this._buildRoof(W, D, floors.length * LEVEL_H, model.energy?.has_solar);
    this._buildSurroundings(W, D, model.energy || {});

    // Keep the sun's shadow camera tight around whatever we built.
    const span = Math.max(W, D) + 22;
    Object.assign(this.sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, far: 120 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.ground.scale.setScalar(Math.max(1, span / 30));
  }

  _buildLevel(floor, index, W, D) {
    const p = this.palette;
    const group = new THREE.Group();
    group.position.y = index * LEVEL_H;
    this.house.add(group);

    const wallMat = std(p.wall, { transparent: true });
    const slabMat = std(p.slab, { transparent: true });
    const interiorMat = std(p.interior, { transparent: true });
    const contentMats = [interiorMat];
    const wallH = LEVEL_H - SLAB;

    const slab = box(W + 0.12, SLAB, D + 0.12, slabMat);
    slab.position.y = SLAB / 2;
    group.add(slab);

    const walls = [
      [W, wallH, WALL, 0, D / 2 - WALL / 2],
      [W, wallH, WALL, 0, -D / 2 + WALL / 2],
      [WALL, wallH, D - 2 * WALL, -W / 2 + WALL / 2, 0],
      [WALL, wallH, D - 2 * WALL, W / 2 - WALL / 2, 0],
    ].map(([w, h, d, x, z]) => {
      const wall = box(w, h, d, wallMat);
      wall.position.set(x, SLAB + h / 2, z);
      group.add(wall);
      return wall;
    });

    const rooms = [];
    const cells = roomCells(floor.rooms.length, W - 2 * WALL, D - 2 * WALL);
    floor.rooms.forEach((room, i) => {
      const cell = cells[i];
      const mat = std(i % 2 ? p.roomAlt : p.room, { emissive: 0x000000, transparent: true });
      contentMats.push(mat);
      const tile = new THREE.Mesh(new THREE.BoxGeometry(cell.w - 0.1, 0.05, cell.d - 0.1), mat);
      tile.position.set(cell.x, SLAB + 0.03, cell.z);
      tile.receiveShadow = true;
      tile.userData = { kind: "room", roomId: room.id, level: index };
      group.add(tile);

      const windows = [];
      const faces = cell.rows === 1 ? [1, -1] : [cell.row === 0 ? 1 : -1];
      for (const side of faces) {
        const glassMat = std(p.glass, { roughness: 0.2, metalness: 0.1, emissive: p.lit, emissiveIntensity: 0, transparent: true });
        contentMats.push(glassMat);
        const win = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(1.7, cell.w * 0.45), 1.15), glassMat);
        win.position.set(cell.x, SLAB + 1.55, side * (D / 2 + 0.012));
        if (side < 0) win.rotation.y = Math.PI;
        group.add(win);
        windows.push(glassMat);
      }

      const el = document.createElement("div");
      el.className = "room-label";
      const name = document.createElement("b");
      name.textContent = room.name;
      const info = document.createElement("span");
      el.append(name, info);
      el.addEventListener("click", () => this.onSelectRoom(room.id));
      const tag = label(el);
      tag.center.set(0.5, 0.5);
      tag.position.set(cell.x, SLAB + 0.5, cell.z);
      tag.visible = false;
      group.add(tag);

      rooms.push({ id: room.id, tile, mat, baseColor: mat.color.clone(), windows, label: tag, labelInfo: info, lit: false, heating: false });
    });

    // Low partition walls between rooms read as a floor plan in the cut-away view.
    for (const cell of cells) {
      if (cell.x + cell.w / 2 < W / 2 - WALL - 0.01) {
        const part = box(0.1, 1.0, cell.d, interiorMat);
        part.position.set(cell.x + cell.w / 2, SLAB + 0.5, cell.z);
        group.add(part);
      }
      if (cell.row === 0 && cell.rows === 2) {
        const part = box(cell.w, 1.0, 0.1, interiorMat);
        part.position.set(cell.x, SLAB + 0.5, cell.z - cell.d / 2);
        group.add(part);
      }
    }

    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.3, LEVEL_H, D + 0.3),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.y = LEVEL_H / 2;
    hit.userData = { kind: "level", level: index };
    group.add(hit);

    const nameEl = document.createElement("div");
    nameEl.className = "level-label";
    nameEl.textContent = floor.name;
    const nameTag = label(nameEl);
    nameTag.center.set(0, 0.5);
    nameTag.position.set(W / 2 + 0.4, LEVEL_H / 2, D / 2);
    nameTag.visible = false;
    group.add(nameTag);

    return {
      id: floor.id,
      group,
      baseY: index * LEVEL_H,
      offset: 0,
      targetOffset: 0,
      wallMat,
      slabMat,
      contentMats,
      walls,
      opacity: 1,
      targetOpacity: 1,
      content: 1,
      targetContent: 1,
      hover: 0,
      rooms,
      hit,
      nameTag,
    };
  }

  _buildRoof(W, D, y, hasSolar) {
    const p = this.palette;
    const x0 = -W / 2 - ROOF_OVERHANG;
    const x1 = W / 2 + ROOF_OVERHANG;
    const zf = D / 2 + ROOF_OVERHANG;
    const top = y + ROOF_H;
    const roof = new THREE.Group();

    // Two slopes, built from triangles so each face keeps a flat normal.
    const slopes = new THREE.BufferGeometry();
    // prettier-ignore
    slopes.setAttribute("position", new THREE.Float32BufferAttribute([
      x0, y, zf,   x1, y, zf,   x1, top, 0,
      x0, y, zf,   x1, top, 0,  x0, top, 0,
      x1, y, -zf,  x0, y, -zf,  x0, top, 0,
      x1, y, -zf,  x0, top, 0,  x1, top, 0,
    ], 3));
    slopes.computeVertexNormals();
    this.roofMat = std(p.roof, { side: THREE.DoubleSide, transparent: true });
    const slopeMesh = new THREE.Mesh(slopes, this.roofMat);
    slopeMesh.castShadow = true;
    slopeMesh.receiveShadow = true;
    roof.add(slopeMesh);

    // Gable triangles close the ends between the wall top and the ridge.
    const gables = new THREE.BufferGeometry();
    const hw = W / 2;
    const hd = D / 2;
    const gableTop = y + ROOF_H * (hd / zf);
    // prettier-ignore
    gables.setAttribute("position", new THREE.Float32BufferAttribute([
      -hw, y, hd,  -hw, gableTop, 0,  -hw, y, -hd,
      hw, y, -hd,  hw, gableTop, 0,  hw, y, hd,
    ], 3));
    gables.computeVertexNormals();
    this.gableMat = std(p.roofSide, { side: THREE.DoubleSide, transparent: true });
    const gableMesh = new THREE.Mesh(gables, this.gableMat);
    gableMesh.castShadow = true;
    roof.add(gableMesh);

    this.solarMats = [];
    if (hasSolar) {
      const angle = Math.atan2(ROOF_H, zf);
      const slopeLen = Math.hypot(ROOF_H, zf);
      const panels = new THREE.Group();
      panels.position.set(0, y + ROOF_H / 2, zf / 2);
      panels.rotation.x = angle;
      panels.translateY(0.06);
      const cols = Math.max(2, Math.floor((W - 1) / 1.15));
      const rows = slopeLen > 4.2 ? 2 : 1;
      const pw = 1.05;
      const pd = Math.min(1.7, (slopeLen - 1.2) / rows);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const mat = std(p.panel, { roughness: 0.35, metalness: 0.4, emissive: FLOW_COLORS.solar, emissiveIntensity: 0 });
          const panel = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.05, pd), mat);
          panel.position.set((c - (cols - 1) / 2) * (pw + 0.1), 0, (r - (rows - 1) / 2) * (pd + 0.1));
          panel.castShadow = true;
          panels.add(panel);
          this.solarMats.push(mat);
        }
      }
      roof.add(panels);
    }

    this.roof = { group: roof, offset: 0, targetOffset: 0, opacity: 1, targetOpacity: 1 };
    this.house.add(roof);
    this.anchors = { solar: new THREE.Vector3(0, y + ROOF_H * 0.55, zf * 0.45), roofTop: new THREE.Vector3(0, top + 0.6, 0) };
  }

  _buildSurroundings(W, D, energy) {
    const p = this.palette;
    const hub = new THREE.Vector3(-W / 2 + 0.7, 1.0, D / 2 + 0.16);
    this.anchors.hub = hub;

    // Energy meter on the facade: every flow starts or ends here.
    const meter = box(0.55, 0.75, 0.14, std(p.metal));
    meter.position.set(hub.x, hub.y, D / 2 + 0.07);
    this.house.add(meter);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.1), std(0x7a5a3c));
    door.position.set(-W / 2 + 2.0, SLAB + 1.05, D / 2 + 0.011);
    this.house.add(door);

    const addChip = (key, position, icon, color) => {
      const el = document.createElement("div");
      el.className = "chip";
      el.style.setProperty("--c", `#${color.toString(16).padStart(6, "0")}`);
      const iconEl = document.createElement("ha-icon");
      iconEl.setAttribute("icon", icon);
      const value = document.createElement("span");
      el.append(iconEl, value);
      const object = label(el);
      object.position.copy(position);
      object.visible = false;
      this.house.add(object);
      this.chips[key] = { object, value };
    };

    const flowPath = (key, points, color) => {
      const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.2);
      const line = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 64, 0.035, 6, false),
        std(p.path, { transparent: true, opacity: 0.55 }),
      );
      this.house.add(line);
      const mat = new THREE.MeshBasicMaterial({ color });
      const geo = new THREE.SphereGeometry(0.11, 12, 10);
      const dots = [];
      for (let i = 0; i < PARTICLES; i++) {
        const dot = new THREE.Mesh(geo, mat);
        dot.visible = false;
        this.house.add(dot);
        dots.push(dot);
      }
      this.flows[key] = { curve, line, dots, mat, speed: 0, direction: 1, phase: 0, color };
    };

    if (energy.has_solar) {
      const eave = new THREE.Vector3(hub.x, this.size.H + 0.1, D / 2 + ROOF_OVERHANG);
      flowPath(
        "solar",
        [this.anchors.solar.clone(), eave, new THREE.Vector3(hub.x, this.size.H - 0.4, D / 2 + 0.2), hub.clone().add(new THREE.Vector3(0, 0.4, 0))],
        FLOW_COLORS.solar,
      );
      addChip("solar", this.anchors.roofTop.clone(), "mdi:solar-power-variant", FLOW_COLORS.solar);
    }
    addChip("home", new THREE.Vector3(hub.x, LEVEL_H + 0.1, D / 2 + 0.3), "mdi:home-lightning-bolt", FLOW_COLORS.home);

    // Grid connection: a pole by the street with an overhead line to the house.
    const poleBase = new THREE.Vector3(-W / 2 - 3.6, 0, D / 2 + 4.2);
    const pole = box(0.25, 6.5, 0.25, std(p.pole));
    pole.position.set(poleBase.x, 3.25, poleBase.z);
    const arm = box(1.6, 0.14, 0.14, std(p.pole));
    arm.position.set(poleBase.x, 6.1, poleBase.z);
    this.house.add(pole, arm);
    const corner = new THREE.Vector3(-W / 2 + 0.1, Math.min(this.size.H, LEVEL_H) - 0.25, D / 2 + 0.1);
    flowPath(
      "grid",
      [
        new THREE.Vector3(poleBase.x, 6.0, poleBase.z),
        new THREE.Vector3((poleBase.x + corner.x) / 2, 3.9, (poleBase.z + corner.z) / 2),
        corner,
        new THREE.Vector3(hub.x - 0.25, 1.9, D / 2 + 0.18),
        hub.clone().add(new THREE.Vector3(-0.2, 0.3, 0)),
      ],
      FLOW_COLORS.gridIn,
    );
    addChip("grid", new THREE.Vector3(poleBase.x, 7.2, poleBase.z), "mdi:transmission-tower", FLOW_COLORS.gridIn);

    if (energy.has_battery) {
      // Wall battery on the front facade, to the right of the door.
      const pos = new THREE.Vector3(-W / 2 + 3.3, 0, D / 2 + 0.2);
      const shell = box(0.9, 1.05, 0.3, std(p.metal, { roughness: 0.5 }));
      shell.position.set(pos.x, SLAB + 0.62, pos.z);
      const gauge = box(0.14, 0.8, 0.03, std(p.dark));
      gauge.position.set(pos.x + 0.28, SLAB + 0.62, pos.z + 0.155);
      const fillMat = std(FLOW_COLORS.batteryOut, { emissive: FLOW_COLORS.batteryOut, emissiveIntensity: 0.6 });
      const fill = box(0.09, 0.72, 0.035, fillMat);
      fill.geometry.translate(0, 0.36, 0);
      fill.position.set(pos.x + 0.28, SLAB + 0.26, pos.z + 0.16);
      this.house.add(shell, gauge, fill);
      this.batteryFill = fill;
      flowPath(
        "battery",
        [hub.clone().add(new THREE.Vector3(0.28, -0.3, 0)), new THREE.Vector3(hub.x + 1.3, 0.45, D / 2 + 0.2), new THREE.Vector3(pos.x - 0.45, 0.6, pos.z + 0.05)],
        FLOW_COLORS.batteryIn,
      );
      addChip("battery", new THREE.Vector3(pos.x, SLAB + 1.55, pos.z + 0.2), "mdi:home-battery", FLOW_COLORS.batteryIn);
    }

    if (energy.has_heat_pump) {
      const pos = new THREE.Vector3(-W / 2 - 1.5, 0, D / 2 + 0.9);
      const unit = box(1.2, 0.95, 0.5, std(p.metal, { roughness: 0.6 }));
      unit.position.set(pos.x, 0.5, pos.z);
      this.house.add(unit);
      const grille = new THREE.Mesh(new THREE.CircleGeometry(0.34, 32), std(p.dark));
      grille.position.set(pos.x - 0.15, 0.5, pos.z + 0.252);
      this.house.add(grille);
      const ringMat = std(FLOW_COLORS.heat, { emissive: FLOW_COLORS.heat, emissiveIntensity: 0 });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.4, 32), ringMat);
      ring.position.set(pos.x - 0.15, 0.5, pos.z + 0.253);
      this.house.add(ring);
      const fan = new THREE.Group();
      fan.position.set(pos.x - 0.15, 0.5, pos.z + 0.26);
      for (let i = 0; i < 3; i++) {
        const blade = box(0.08, 0.3, 0.015, std(p.metal));
        blade.position.y = 0.14;
        const holder = new THREE.Group();
        holder.rotation.z = (i * Math.PI * 2) / 3;
        holder.add(blade);
        fan.add(holder);
      }
      this.house.add(fan);
      this.heatPump = { fan, ringMat, spin: 0 };
      flowPath(
        "heat",
        [hub.clone().add(new THREE.Vector3(-0.2, -0.4, 0)), new THREE.Vector3(-W / 2 - 0.15, 0.45, D / 2 + 0.3), new THREE.Vector3(pos.x + 0.7, 0.6, pos.z - 0.1), new THREE.Vector3(pos.x + 0.45, 0.98, pos.z)],
        FLOW_COLORS.heat,
      );
      addChip("heat_pump", new THREE.Vector3(pos.x - 0.3, 1.5, pos.z), "mdi:heat-pump", FLOW_COLORS.heat);
    }

    const cars = Math.min(energy.cars || 0, 3);
    for (let i = 0; i < cars; i++) this._buildCar(i, W, D, hub, addChip, flowPath);
  }

  _buildCar(i, W, D, hub, addChip, flowPath) {
    const p = this.palette;
    const x = W / 2 + 2.4 + i * 2.9;
    const z = D / 2 - 1.2;
    const drive = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.6), std(p.slab));
    drive.rotation.x = -Math.PI / 2;
    drive.position.set(x, 0.012, z + 0.4);
    drive.receiveShadow = true;
    this.house.add(drive);

    // Wallbox on the side wall (or a post for further parking spots).
    const wbPos = i === 0 ? new THREE.Vector3(W / 2 + 0.1, 1.2, z - 1.3) : new THREE.Vector3(x - 1.4, 1.2, z - 2.2);
    if (i > 0) {
      const post = box(0.14, 1.3, 0.14, std(p.metal));
      post.position.set(wbPos.x, 0.65, wbPos.z);
      this.house.add(post);
    }
    const wb = box(0.16, 0.5, 0.36, std(p.dark));
    wb.position.copy(wbPos);
    const ledMat = new THREE.MeshBasicMaterial({ color: FLOW_COLORS.car, transparent: true, opacity: 0 });
    const led = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.05), ledMat);
    led.rotation.y = Math.PI / 2;
    led.position.set(wbPos.x + 0.09, wbPos.y + 0.12, wbPos.z);
    this.house.add(wb, led);

    const body = new THREE.Group();
    body.position.set(x, 0, z + 0.4);
    const paint = std(p.carBody, { roughness: 0.35, metalness: 0.3 });
    const lower = box(1.8, 0.55, 4.1, paint);
    lower.position.y = 0.55;
    const cabin = box(1.6, 0.5, 2.2, std(0x2c3b4a, { roughness: 0.15, metalness: 0.3 }));
    cabin.position.set(0, 1.07, -0.2);
    body.add(lower, cabin);
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 20);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const [wx, wz] of [[-0.88, 1.3], [0.88, 1.3], [-0.88, -1.35], [0.88, -1.35]]) {
      const wheel = new THREE.Mesh(wheelGeo, std(p.tire));
      wheel.position.set(wx, 0.36, wz);
      wheel.castShadow = true;
      body.add(wheel);
    }
    body.visible = false;
    this.house.add(body);

    const port = new THREE.Vector3(x - 0.92, 0.75, z - 0.9);
    const cableCurve = new THREE.CatmullRomCurve3([
      wbPos.clone().add(new THREE.Vector3(0.05, -0.25, 0)),
      new THREE.Vector3((wbPos.x + port.x) / 2, 0.15, (wbPos.z + port.z) / 2),
      port,
    ]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 24, 0.04, 6, false), std(0x222222));
    cable.visible = false;
    this.house.add(cable);

    flowPath(
      `car${i}`,
      [hub.clone().add(new THREE.Vector3(0.25, -0.35, 0)), new THREE.Vector3(W / 2 - 0.2, 0.55, D / 2 + 0.25), new THREE.Vector3(W / 2 + 0.2, 0.6, wbPos.z + 0.4), ...cableCurve.points.slice(1)],
      FLOW_COLORS.car,
    );
    addChip(`car${i}`, new THREE.Vector3(x, 2.1, z + 0.4), "mdi:car-electric", FLOW_COLORS.car);
    this.cars.push({ body, cable, ledMat, led: 0, ledTarget: 0 });
  }

  // ---------------------------------------------------------------- state

  _setFlow(flow, power, sign, color) {
    if (!flow) return;
    const magnitude = Math.abs(power || 0);
    const active = magnitude > 30;
    flow.speed = active ? 0.12 + 0.3 * Math.min(1, Math.log10(1 + magnitude / 100) / 2) : 0;
    flow.direction = (power || 0) * sign >= 0 ? 1 : -1;
    if (color != null) flow.mat.color.set(color);
    flow.dots.forEach((d) => (d.visible = active));
  }

  _applySelection(moveCamera) {
    if (moveCamera) this.userMoved = false;
    const selected = this.selectedLevel;
    this.levels.forEach((level, i) => {
      const above = selected != null && i > selected;
      level.targetOffset = above ? LIFT : 0;
      level.targetOpacity = selected == null ? 1 : i === selected ? 0.14 : above ? 0 : 1;
      level.targetContent = above ? 0 : 1;
      level.nameTag.visible = false;
      for (const room of level.rooms) room.label.visible = i === selected;
    });
    if (this.roof) {
      this.roof.targetOffset = selected != null ? LIFT : 0;
      this.roof.targetOpacity = selected != null ? 0 : 1;
    }
    this._updateRoomColors();
    if (moveCamera) this._frameCamera();
  }

  _updateRoomColors() {
    const primary = new THREE.Color(0x03a9f4);
    for (const level of this.levels) {
      for (const room of level.rooms) {
        const color = room.baseColor.clone();
        if (room.id === this.selectedRoom) color.lerp(primary, 0.55);
        else if (this.hovered?.roomId === room.id) color.lerp(primary, 0.25);
        room.mat.color.copy(color);
      }
    }
  }

  _frameCamera() {
    if (!this.size) return;
    const { W, D, H } = this.size;
    const { clientWidth: w, clientHeight: h } = this.container;
    // Fit the subject into the part of the canvas not covered by overlays.
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const visibleH = h ? Math.max(0.3, (h - this.insets.bottom) / h) : 1;
    const visibleW = w ? Math.max(0.3, (w - this.insets.right) / w) : 1;
    const aspect = w && h ? w / h : 1.6;
    const tanY = tanV * visibleH;
    const tanX = tanV * aspect * visibleW;
    const fit = (spanX, spanY) => Math.max(spanX / 2 / tanX, spanY / 2 / tanY);

    let target;
    let direction;
    let dist;
    if (this.selectedLevel == null) {
      target = new THREE.Vector3(-0.8, (H + ROOF_H) / 2, 1.5);
      direction = new THREE.Vector3(0.5, 0.42, 1);
      // Include the grid pole and car when there is room; portrait screens crop them.
      dist = fit(W + (aspect < 1 ? 8 : 12), H + ROOF_H + 4) * 1.2;
    } else {
      target = new THREE.Vector3(0, this.selectedLevel * LEVEL_H + 0.8, 0);
      direction = new THREE.Vector3(0.28, 0.95, 0.75);
      const span = Math.max(W, D);
      dist = fit(span + 3, span + 4) * 1.45;
    }
    const offset = direction.normalize().multiplyScalar(THREE.MathUtils.clamp(dist, 8, 110));
    this.cameraAnim = {
      t: 0,
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: target.clone().add(offset),
      toTarget: target,
    };
    this.controls.autoRotate = false;
  }

  _pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [];
    if (this.selectedLevel != null) targets.push(...this.levels[this.selectedLevel].rooms.map((r) => r.tile));
    targets.push(...this.levels.filter((_, i) => i !== this.selectedLevel).map((l) => l.hit));
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData : null;
  }

  _onPointerUp(event) {
    const down = this._down;
    this._down = null;
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
    const hit = this._pick(event);
    if (!hit) {
      if (this.selectedRoom != null) this.onSelectRoom(null);
      return;
    }
    if (hit.kind === "room") this.onSelectRoom(hit.roomId);
    else if (hit.kind === "level") this.onSelectLevel(hit.level);
  }

  _onPointerMove(event) {
    if (event.buttons) return;
    this._setHover(this._pick(event));
  }

  _setHover(hit) {
    const key = hit ? `${hit.kind}:${hit.roomId ?? hit.level}` : null;
    if (key === this._hoverKey) return;
    this._hoverKey = key;
    this.hovered = hit;
    this.renderer.domElement.style.cursor = hit ? "pointer" : "";
    this.levels.forEach((level, i) => {
      level.nameTag.visible = hit?.kind === "level" && hit.level === i;
    });
    this._updateRoomColors();
  }

  // ---------------------------------------------------------------- frame

  _tick(dt) {
    this.time += dt;

    if (this.cameraAnim) {
      const a = this.cameraAnim;
      a.t = Math.min(1, a.t + dt / 0.9);
      const k = ease(a.t);
      this.camera.position.lerpVectors(a.fromPos, a.toPos, k);
      this.controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
      if (a.t >= 1) this.cameraAnim = null;
    }

    const fade = (mat, opacity) => {
      mat.opacity = opacity;
      const transparent = opacity < 0.995;
      if (mat.transparent !== transparent) {
        mat.transparent = transparent;
        mat.needsUpdate = true; // opaque shaders ignore opacity, so recompile
      }
      mat.depthWrite = opacity > 0.5;
    };

    this.levels.forEach((level, i) => {
      level.offset = approach(level.offset, level.targetOffset, 7, dt);
      level.opacity = approach(level.opacity, level.targetOpacity, 7, dt);
      level.group.position.y = level.baseY + level.offset;
      const hovered = this.hovered?.kind === "level" && this.hovered.level === i;
      level.hover = approach(level.hover, hovered ? 1 : 0, 12, dt);
      fade(level.wallMat, level.opacity);
      level.content = approach(level.content, level.targetContent, 7, dt);
      // Faded-out levels must not keep casting shadows onto the level below.
      level.group.visible = level.content > 0.02;
      for (const wall of level.walls) wall.castShadow = level.opacity > 0.5;
      fade(level.slabMat, Math.min(level.content, Math.max(level.opacity, i === this.selectedLevel ? 1 : 0)));
      for (const mat of level.contentMats) fade(mat, level.content);
      level.wallMat.emissive.setRGB(0.012, 0.35, 0.6).multiplyScalar(level.hover * 0.25);
      for (const room of level.rooms) {
        const glow = room.lit ? 1.1 : 0;
        for (const glass of room.windows) glass.emissiveIntensity = approach(glass.emissiveIntensity, glow, 6, dt);
        const heat = room.heating ? 0.18 : room.lit ? 0.12 : 0;
        room.mat.emissive.set(room.heating ? FLOW_COLORS.heat : this.palette.lit);
        room.mat.emissiveIntensity = approach(room.mat.emissiveIntensity || 0, heat, 6, dt);
      }
    });

    if (this.roof) {
      const r = this.roof;
      r.offset = approach(r.offset, r.targetOffset, 7, dt);
      r.opacity = approach(r.opacity, r.targetOpacity, 7, dt);
      r.group.position.y = r.offset;
      r.group.visible = r.opacity > 0.02;
      if (this.flows.solar) {
        // The solar path starts on the roof; hide it while the roof is lifted away.
        this.flows.solar.line.visible = r.group.visible;
        this.flows.solar.hidden = !r.group.visible;
      }
      fade(this.roofMat, r.opacity);
      fade(this.gableMat, r.opacity);
      for (const mat of this.solarMats) {
        fade(mat, r.opacity);
        mat.emissiveIntensity = approach(mat.emissiveIntensity, (this.solarGlow || 0) * 0.45, 3, dt);
      }
      if (this.chips.solar) this.chips.solar.object.position.y = this.anchors.roofTop.y + r.offset;
    }

    if (this.heatPump) {
      const hp = this.heatPump;
      hp.spin = approach(hp.spin, this.heatPumpBoost ? 9 : 0.6, 2, dt);
      hp.fan.rotation.z -= hp.spin * dt;
      hp.ringMat.emissiveIntensity = approach(hp.ringMat.emissiveIntensity, this.heatPumpBoost ? 0.9 + 0.3 * Math.sin(this.time * 4) : 0, 5, dt);
    }

    if (this.batteryFill) {
      const soc = Math.max(0.02, Math.min(1, (this.batterySoc ?? 0) / 100));
      this.batteryFill.scale.y = approach(this.batteryFill.scale.y, soc, 4, dt);
    }

    for (const car of this.cars) {
      car.led = approach(car.led, car.ledTarget * (0.75 + 0.25 * Math.sin(this.time * 3)), 6, dt);
      car.ledMat.opacity = car.led;
    }

    for (const flow of Object.values(this.flows)) {
      if (flow.hidden) {
        flow.dots.forEach((d) => (d.visible = false));
        continue;
      }
      if (!flow.speed) continue;
      flow.dots.forEach((d) => (d.visible = true));
      flow.phase = (flow.phase + flow.speed * dt * flow.direction + 1) % 1;
      flow.dots.forEach((dot, i) => {
        const t = (flow.phase + i / PARTICLES) % 1;
        dot.position.copy(flow.curve.getPointAt(t));
        dot.scale.setScalar(0.6 + 0.4 * Math.sin(Math.PI * t));
      });
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
