import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { campus } from "./campus-data.js";
import { selectedInstitute } from "./institutes.js";
import { DRIFT_LEVELS, type PlayerState, type RaceObject } from "./race.js";
import { roadWeightAt, terrainBounds, terrainFrame, terrainHeightAt, terrainStep } from "./terrain.js";
import { BASE_SPEED, route, ROUTE_LENGTH, TRACK_WIDTH } from "./track.js";
import { buildingColliders, pointInPolygon, trees } from "./world.js";

const SKY = "#a9dcff";
const OUTLINE = new THREE.MeshBasicMaterial({ color: "#0f1519", side: THREE.BackSide });
const DRIFT_COLORS = ["#f4f1e0", "#4db4ff", "#ff9a3c", "#c77dff"];
const KART_SCALE = 1.2;
const ROAD_MESH_DIP = 0.3;

interface KartMesh {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Mesh[];
  frontPivots: THREE.Group[];
  steeringWheel: THREE.Group;
  flames: THREE.Mesh[];
  color: string;
  name: string;
  nameCanvas: HTMLCanvasElement;
  nameLabel: THREE.Sprite;
  target: PlayerState;
  heading: number;
  slide: number;
  lean: number;
  pitch: number;
  roll: number;
}

interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  growth: number;
  opacity: number;
}

const toonGradient = (): THREE.DataTexture => {
  const texture = new THREE.DataTexture(new Uint8Array([110, 175, 255]), 3, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
};

function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) draw(context);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

export class RaceScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private karts = new Map<string, KartMesh>();
  private objectMeshes = new Map<string, THREE.Group>();
  private focusKart: KartMesh | null = null;
  private sun: THREE.DirectionalLight;
  private clouds = new THREE.Group();
  private buildingLabels = new Map<string, THREE.Sprite>();
  private tmpForward = new THREE.Vector3();
  private tmpRight = new THREE.Vector3();
  private tmpTarget = new THREE.Vector3();
  private tmpEye = new THREE.Vector3();
  private tmpLook = new THREE.Vector3();
  private gradient = toonGradient();
  private padTexture: THREE.CanvasTexture;
  private boxMaterial: THREE.MeshBasicMaterial;
  private particles: Particle[] = [];
  private particleTexture: THREE.CanvasTexture;
  private lastTime = 0;
  private running = true;
  private fov = 62;

  constructor(private container: HTMLElement, private mySessionId: string) {
    this.scene = new THREE.Scene();
    this.scene.background = canvasTexture(4, 256, (context) => {
      const sky = context.createLinearGradient(0, 0, 0, 256);
      sky.addColorStop(0, "#2d8cf0");
      sky.addColorStop(0.45, SKY);
      sky.addColorStop(1, SKY);
      context.fillStyle = sky;
      context.fillRect(0, 0, 4, 256);
    });
    this.scene.fog = new THREE.Fog(SKY, 130, 330);
    this.camera = new THREE.PerspectiveCamera(this.fov, window.innerWidth / window.innerHeight, 0.3, 420);
    this.camera.position.set(0, 19, 28);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight("#ffffff", "#9fd37c", 1.9));
    const sun = new THREE.DirectionalLight("#fff4d6", 2.4);
    this.sun = sun;
    sun.position.set(-36, 56, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun, sun.target);

    this.particleTexture = canvasTexture(64, 64, (context) => {
      const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      glow.addColorStop(0, "#ffffffff");
      glow.addColorStop(0.5, "#ffffff88");
      glow.addColorStop(1, "#ffffff00");
      context.fillStyle = glow;
      context.fillRect(0, 0, 64, 64);
    });
    this.padTexture = canvasTexture(64, 128, (context) => {
      context.fillStyle = "#2a2f45";
      context.fillRect(0, 0, 64, 128);
      context.fillStyle = "#ffd23f";
      for (const y of [8, 52]) {
        context.beginPath();
        context.moveTo(32, y);
        context.lineTo(60, y + 34);
        context.lineTo(60, y + 52);
        context.lineTo(32, y + 18);
        context.lineTo(4, y + 52);
        context.lineTo(4, y + 34);
        context.closePath();
        context.fill();
      }
    });
    const question = canvasTexture(128, 128, (context) => {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 128, 128);
      context.fillStyle = "#1c2a4a";
      context.font = "900 104px Fredoka, Arial Black, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("?", 64, 70);
    });
    this.boxMaterial = new THREE.MeshBasicMaterial({ map: question, transparent: true, opacity: 0.92 });

    this.addSky();
    this.addWorld();
    window.addEventListener("resize", this.resize);
    this.renderer.setAnimationLoop(this.render);
  }

  private toon(color: string, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
    return new THREE.MeshToonMaterial({ color, gradientMap: this.gradient, ...extra });
  }

  // Simuleringen kører med 30 Hz; her gemmes kun målet, og render() glider blødt derhen.
  // focusId er den lokale spiller; en gæst kender først sit id, når værten har sagt velkommen.
  updatePlayers(players: Iterable<[string, PlayerState]>, focusId = this.mySessionId): void {
    const activeIds = new Set<string>();
    let leader: KartMesh | null = null;
    let leaderProgress = -Infinity;
    for (const [id, data] of players) {
      if (data.role !== "racer") continue;
      activeIds.add(id);
      let kart = this.karts.get(id);
      if (!kart) {
        kart = this.createKart(data);
        this.karts.set(id, kart);
        this.scene.add(kart.root);
      } else if (kart.name !== data.name) {
        this.updateNameLabel(kart, data.name);
      }
      // Store spring (genstart på banen) tages med det samme i stedet for at glide hen over græsset.
      if (Math.hypot(kart.root.position.x - data.x, kart.root.position.z - data.z) > 12) {
        kart.root.position.set(data.x, terrainHeightAt(data.x, data.z) + 0.03, data.z);
        kart.heading = data.heading;
      }
      kart.target = data;
      if (!data.finished && data.progress > leaderProgress) {
        leader = kart;
        leaderProgress = data.progress;
      }
    }

    for (const [id, kart] of this.karts) {
      if (!activeIds.has(id)) {
        this.scene.remove(kart.root);
        this.disposeTree(kart.root);
        this.karts.delete(id);
      }
    }
    this.focusKart = this.karts.get(focusId) ?? leader ?? null;
  }

  updateObjects(objects: Iterable<[string, RaceObject]>): void {
    const activeIds = new Set<string>();
    for (const [id, object] of objects) {
      activeIds.add(id);
      let mesh = this.objectMeshes.get(id);
      if (!mesh) {
        mesh = this.createObjectMesh(object);
        mesh.position.set(object.x, mesh.position.y, object.z);
        this.objectMeshes.set(id, mesh);
        this.scene.add(mesh);
      }
      mesh.visible = object.active;
      mesh.userData.targetX = object.x;
      mesh.userData.targetZ = object.z;
      if (object.kind === "paper") mesh.rotation.y = object.heading;
    }
    for (const [id, mesh] of this.objectMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.disposeTree(mesh);
        this.objectMeshes.delete(id);
      }
    }
  }

  private createObjectMesh(object: RaceObject): THREE.Group {
    const group = new THREE.Group();
    group.userData.kind = object.kind;
    let lift = 0;
    if (object.kind === "box") {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), this.boxMaterial);
      const frame = new THREE.LineSegments(
        new THREE.EdgesGeometry(cube.geometry),
        new THREE.LineBasicMaterial({ color: "#ffffff" }),
      );
      group.add(cube, frame);
      lift = 1.4;
    } else if (object.kind === "pad") {
      const geometry = new THREE.PlaneGeometry(2.3, 3.6, 3, 4);
      geometry.rotateX(-Math.PI / 2);
      const base = this.drape(geometry, object.x, object.z, object.heading);
      const pad = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ map: this.padTexture, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      );
      group.add(pad);
      group.rotation.y = object.heading;
      group.position.y = base + 0.1;
    } else if (object.kind === "paper") {
      const paper = this.toon("#fbf6e6");
      for (let i = 0; i < 4; i++) {
        const sheet = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 1.4), paper);
        sheet.position.y = 0.08 + i * 0.14;
        sheet.rotation.y = (i % 2 === 0 ? 1 : -1) * 0.12 * i;
        sheet.castShadow = true;
        this.outline(sheet, 1.06);
        group.add(sheet);
      }
    } else {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.14, 24), this.toon("#ff7a2f"));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.07, 8, 24), this.toon("#ffffff"));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.09;
      disc.castShadow = true;
      this.outline(disc, 1.1);
      group.add(disc, ring);
      lift = 0.9;
    }
    if (object.kind !== "pad") {
      group.userData.lift = lift;
      group.position.y = lift + terrainHeightAt(object.x, object.z);
    }
    return group;
  }

  /** Lægger en vandret flade (i lokale koordinater om et punkt og en retning) ned over terrænet. Returnerer terrænets højde i midten. */
  private drape(geometry: THREE.BufferGeometry, centerX: number, centerZ: number, heading: number): number {
    const base = terrainHeightAt(centerX, centerZ);
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    for (let i = 0; i < positions.count; i++) {
      const lx = positions.getX(i);
      const lz = positions.getZ(i);
      positions.setY(i, terrainHeightAt(centerX + lx * cos + lz * sin, centerZ - lx * sin + lz * cos) - base);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return base;
  }

  dispose(): void {
    this.running = false;
    window.removeEventListener("resize", this.resize);
    this.renderer.setAnimationLoop(null);
    this.disposeTree(this.scene);
    this.gradient.dispose();
    this.padTexture.dispose();
    this.particleTexture.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  private disposeTree(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) if (material !== OUTLINE) material.dispose();
      }
      if (object instanceof THREE.Sprite && object.userData.label) {
        object.material.map?.dispose();
        object.material.dispose();
      }
    });
  }

  /** Sort kontur som i tegnefilm: en let forstørret kopi, der kun viser sine bagsider. */
  private outline(mesh: THREE.Mesh, scale = 1.08): void {
    const shell = new THREE.Mesh(mesh.geometry, OUTLINE);
    shell.scale.setScalar(scale);
    mesh.add(shell);
  }

  private addSky(): void {
    const cloud = new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false });
    for (let i = 0; i < 16; i++) {
      const puff = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), cloud);
        ball.position.set((j - 1.5) * 1.1, Math.sin(j * 2.1) * 0.35, Math.cos(j * 1.3) * 0.4);
        ball.scale.set(1.25, 0.8 + 0.25 * (j % 2), 1);
        puff.add(ball);
      }
      const angle = (i / 16) * Math.PI * 2 + (i % 3) * 0.2;
      const radius = 260 + (i % 4) * 25;
      puff.position.set(Math.cos(angle) * radius, 85 + (i % 5) * 14, Math.sin(angle) * radius);
      puff.scale.setScalar(16 + (i % 4) * 5);
      puff.rotation.y = -angle;
      this.clouds.add(puff);
    }
    this.scene.add(this.clouds);
  }

  private addWorld(): void {
    const grassTexture = canvasTexture(128, 128, (context) => {
      context.fillStyle = "#79cf55";
      context.fillRect(0, 0, 128, 128);
      context.fillStyle = "#6cc44a";
      context.fillRect(0, 0, 64, 64);
      context.fillRect(64, 64, 64, 64);
    });
    // ShapeGeometry har UV i verdensenheder, så én teksturperiode pr. 20 enheder.
    grassTexture.repeat.set(1 / 20, 1 / 20);
    // Omlandet uden for højdedataene: en flad plan lige under terrænets kant. Der er et hul over terrænet, ellers dækker planen alt lavere end y=-0.12 (udgravet vej, dale).
    const half = 1200;
    const hole = 0.5;
    const outline = new THREE.Shape();
    outline.moveTo(-half, -half);
    outline.lineTo(half, -half);
    outline.lineTo(half, half);
    outline.lineTo(-half, half);
    outline.closePath();
    // Planen roteres -90° om x, så formens y svarer til -z.
    const cutout = new THREE.Path();
    cutout.moveTo(terrainBounds.minX + hole, -(terrainBounds.minZ + hole));
    cutout.lineTo(terrainBounds.minX + hole, -(terrainBounds.maxZ - hole));
    cutout.lineTo(terrainBounds.maxX - hole, -(terrainBounds.maxZ - hole));
    cutout.lineTo(terrainBounds.maxX - hole, -(terrainBounds.minZ + hole));
    cutout.closePath();
    outline.holes.push(cutout);
    const outer = new THREE.Mesh(new THREE.ShapeGeometry(outline), new THREE.MeshLambertMaterial({ map: grassTexture }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.12;
    outer.receiveShadow = true;
    this.scene.add(outer);

    this.addTerrain();
    this.addRoad();
    this.addCampus();
  }

  // Terrænmeshet har samme gitter som højdedataene. Arealanvendelsen (græs, park, skov, vand) males i teksturen.
  private addTerrain(): void {
    const { minX, maxX, minZ, maxZ } = terrainBounds;
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const cols = Math.max(2, Math.ceil(width / terrainStep) + 1);
    const rows = Math.max(2, Math.ceil(depth / terrainStep) + 1);
    const positions = new Float32Array(cols * rows * 3);
    const uvs = new Float32Array(cols * rows * 2);
    for (let j = 0; j < rows; j++) {
      const z = Math.min(maxZ, minZ + j * terrainStep);
      for (let i = 0; i < cols; i++) {
        const x = Math.min(maxX, minX + i * terrainStep);
        const n = j * cols + i;
        // Under vejen sænkes meshet en smule, så trekanternes skrå flader aldrig stikker op gennem vejbåndet i sving.
        positions.set([x, terrainHeightAt(x, z) - ROAD_MESH_DIP * roadWeightAt(x, z), z], n * 3);
        uvs.set([(x - minX) / width, 1 - (z - minZ) / depth], n * 2);
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i;
        indices.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Højdeskygge: lavt terræn er mørkere og højt lysere, så bakker og dale kan aflæses selv uden skarpe skygger.
    let lowest = Infinity;
    let highest = -Infinity;
    for (let n = 0; n < cols * rows; n++) {
      lowest = Math.min(lowest, positions[n * 3 + 1]);
      highest = Math.max(highest, positions[n * 3 + 1]);
    }
    const colors = new Float32Array(cols * rows * 3);
    for (let n = 0; n < cols * rows; n++) {
      const shade = 0.72 + 0.28 * ((positions[n * 3 + 1] - lowest) / Math.max(0.001, highest - lowest));
      colors.set([shade, shade, shade], n * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const pixelsPerUnit = Math.min(4, 2048 / Math.max(width, depth));
    const landUse = canvasTexture(Math.ceil(width * pixelsPerUnit), Math.ceil(depth * pixelsPerUnit), (context) => {
      const px = (x: number): number => (x - minX) * pixelsPerUnit;
      const pz = (z: number): number => (z - minZ) * pixelsPerUnit;
      const trace = (flat: readonly number[]): void => {
        context.beginPath();
        for (let i = 0; i < flat.length; i += 2) {
          if (i === 0) context.moveTo(px(flat[i]), pz(flat[i + 1]));
          else context.lineTo(px(flat[i]), pz(flat[i + 1]));
        }
      };
      const fill = (color: string, polygons: readonly (readonly number[])[]): void => {
        context.fillStyle = color;
        for (const polygon of polygons) {
          trace(polygon);
          context.closePath();
          context.fill();
        }
      };
      const square = 10 * pixelsPerUnit;
      context.fillStyle = "#79cf55";
      context.fillRect(0, 0, width * pixelsPerUnit, depth * pixelsPerUnit);
      context.fillStyle = "#6cc44a";
      for (let gx = 0; gx * square < width * pixelsPerUnit; gx++) {
        for (let gz = 0; gz * square < depth * pixelsPerUnit; gz++) {
          if ((gx + gz) % 2 === 0) context.fillRect(gx * square, gz * square, square, square);
        }
      }
      fill("#8fdb62", campus.parks);
      fill("#5cc85a", campus.pitches);
      fill("#4eb04a", campus.forests);
      fill("#3fb7f2", campus.water);
      fill("#8fdb62", campus.islands);
      context.strokeStyle = "#3fb7f2";
      context.lineWidth = 0.9 * pixelsPerUnit;
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const stream of campus.streams) {
        trace(stream);
        context.stroke();
      }
    });
    landUse.wrapS = THREE.ClampToEdgeWrapping;
    landUse.wrapT = THREE.ClampToEdgeWrapping;

    const ground = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: landUse, vertexColors: true }));
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  // Et bånd langs ruten fra sidelinje inner til outer, lagt ned over terrænet. v løber langs banen, så teksturen gentages hver `period` enhed.
  private ribbon(inner: number, outer: number, lift: number, material: THREE.Material, period: number): THREE.Mesh {
    const segments = 480;
    const across = 5;
    const repeats = Math.max(1, Math.round(ROUTE_LENGTH / period));
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const center = route.getPointAt(t);
      const tangent = route.getTangentAt(t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      for (let k = 0; k < across; k++) {
        const u = k / (across - 1);
        const edge = center.clone().addScaledVector(normal, inner + (outer - inner) * u);
        positions.push(edge.x, terrainHeightAt(edge.x, edge.z) + lift, edge.z);
        uvs.push(u, t * repeats);
      }
      if (i < segments) {
        for (let k = 0; k < across - 1; k++) {
          const a = i * across + k;
          indices.push(a, a + across, a + 1, a + 1, a + across, a + across + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  private addRoad(): void {
    const asphalt = canvasTexture(128, 256, (context) => {
      context.fillStyle = "#4b5160";
      context.fillRect(0, 0, 128, 256);
      for (let i = 0; i < 900; i++) {
        context.fillStyle = Math.random() < 0.5 ? "#555c6b" : "#434957";
        context.fillRect(Math.random() * 128, Math.random() * 256, 2, 2);
      }
      context.fillStyle = "#f4f4ea";
      context.fillRect(6, 0, 4, 256);
      context.fillRect(118, 0, 4, 256);
      context.fillStyle = "#ffe066";
      context.fillRect(62, 20, 4, 90);
      context.fillRect(62, 148, 4, 90);
    });
    asphalt.wrapS = THREE.ClampToEdgeWrapping;
    const road = this.ribbon(-TRACK_WIDTH / 2, TRACK_WIDTH / 2, 0.03, new THREE.MeshLambertMaterial({ map: asphalt, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 14);
    this.scene.add(road);

    const kerb = canvasTexture(16, 64, (context) => {
      context.fillStyle = "#e8402f";
      context.fillRect(0, 0, 16, 32);
      context.fillStyle = "#fafafa";
      context.fillRect(0, 32, 16, 32);
    });
    kerb.wrapS = THREE.ClampToEdgeWrapping;
    const kerbMaterial = new THREE.MeshLambertMaterial({ map: kerb, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.scene.add(
      this.ribbon(TRACK_WIDTH / 2, TRACK_WIDTH / 2 + 0.9, 0.05, kerbMaterial, 3.6),
      this.ribbon(-TRACK_WIDTH / 2 - 0.9, -TRACK_WIDTH / 2, 0.05, kerbMaterial, 3.6),
    );

    // Start/mål: tern på vejen og en bue med skilt, som man kører under.
    const start = route.getPointAt(0);
    const tangent = route.getTangentAt(0);
    const heading = Math.atan2(tangent.x, tangent.z);
    const gate = new THREE.Group();
    gate.rotation.y = heading;
    const checker = canvasTexture(128, 32, (context) => {
      for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 4; y++) {
          context.fillStyle = (x + y) % 2 === 0 ? "#ffffff" : "#15181d";
          context.fillRect(x * 8, y * 8, 8, 8);
        }
      }
    });
    const lineGeometry = new THREE.PlaneGeometry(TRACK_WIDTH, 1.6, 6, 1);
    lineGeometry.rotateX(-Math.PI / 2);
    const gateBase = this.drape(lineGeometry, start.x, start.z, heading);
    gate.position.set(start.x, gateBase, start.z);
    const line = new THREE.Mesh(
      lineGeometry,
      new THREE.MeshBasicMaterial({ map: checker, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    );
    line.position.y = 0.07;
    gate.add(line);
    const post = new THREE.CylinderGeometry(0.28, 0.34, 6, 10);
    let pillarTop = 6;
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(post, this.toon("#f2f2f2"));
      const lx = side * (TRACK_WIDTH / 2 + 1.1);
      const ground = terrainHeightAt(start.x + lx * Math.cos(heading), start.z - lx * Math.sin(heading)) - gateBase;
      pillar.position.set(lx, ground + 3, 0);
      pillarTop = Math.max(pillarTop, ground + 6);
      pillar.castShadow = true;
      this.outline(pillar, 1.12);
      gate.add(pillar);
    }
    const bannerFace = new THREE.MeshBasicMaterial({
      map: canvasTexture(512, 128, (context) => {
        context.fillStyle = "#1c2a4a";
        context.fillRect(0, 0, 512, 128);
        for (let x = 0; x < 32; x++) {
          context.fillStyle = x % 2 === 0 ? "#ffffff" : "#1c2a4a";
          context.fillRect(x * 16, 0, 16, 12);
          context.fillStyle = x % 2 === 0 ? "#1c2a4a" : "#ffffff";
          context.fillRect(x * 16, 116, 16, 12);
        }
        context.fillStyle = "#ffe066";
        context.font = "900 70px Fredoka, Arial Black, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("START · MÅL", 256, 66);
      }),
    });
    const bannerEdge = this.toon("#e8402f");
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(TRACK_WIDTH + 2.6, 1.3, 0.4),
      [bannerEdge, bannerEdge, bannerEdge, bannerEdge, bannerFace, bannerFace],
    );
    banner.position.y = pillarTop;
    banner.castShadow = true;
    this.outline(banner, 1.04);
    gate.add(banner);
    this.scene.add(gate);
  }

  // Bygninger, skov, parker, sø og bæk fra OpenStreetMap, så omgivelserne ligner Universitetsparken.
  private addCampus(): void {
    const toShape = (flat: readonly number[]): THREE.Shape => {
      const shape = new THREE.Shape();
      for (let i = 0; i < flat.length; i += 2) {
        if (i === 0) shape.moveTo(flat[i], -flat[i + 1]);
        else shape.lineTo(flat[i], -flat[i + 1]);
      }
      return shape;
    };

    // Græs, parker, skov, vand og bække er malet i terrænets tekstur (addTerrain).

    // Ét vindueslag pr. etage; teksturen ganges med væggens farve.
    const windows = canvasTexture(64, 64, (context) => {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 64, 64);
      context.fillStyle = "#7d93ad";
      context.fillRect(10, 14, 44, 30);
      context.fillStyle = "#b9cfe6";
      context.fillRect(10, 14, 44, 8);
      context.fillStyle = "#d8d8d8";
      context.fillRect(0, 56, 64, 8);
    });
    windows.repeat.set(1 / 1.7, 1 / 1.05);
    const roofs = ["#a8442f", "#7f8f9e", "#9c6a45"].map((color) => this.toon(color));
    const walls = ["#f2c230", "#e8b52a", "#f7d04a", "#ecbd38", "#f4c94f"].map(
      (color) => this.toon(color, { map: windows }),
    );
    const highlighted = selectedInstitute()?.building;
    // Bygninger med samme materialer slås sammen til ét mesh for at spare draw calls.
    const buildingGeometries = new Map<number, THREE.BufferGeometry[]>();
    campus.buildings.forEach((building, index) => {
      // Soklen følger det laveste terræn under fodaftrykket; væggene forlænges, så de når ned til det.
      let low = Infinity;
      let high = -Infinity;
      let sumX = 0;
      let sumZ = 0;
      const count = building.p.length / 2;
      for (let i = 0; i < building.p.length; i += 2) {
        const x = building.p[i];
        const z = building.p[i + 1];
        const next = (i + 2) % building.p.length;
        sumX += x;
        sumZ += z;
        for (const f of [0, 0.5]) {
          const ground = terrainHeightAt(x + (building.p[next] - x) * f, z + (building.p[next + 1] - z) * f);
          low = Math.min(low, ground);
          high = Math.max(high, ground);
        }
      }
      const centerGround = terrainHeightAt(sumX / count, sumZ / count);
      low = Math.min(low, centerGround);
      high = Math.max(high, centerGround);
      const geometry = new THREE.ExtrudeGeometry(toShape(building.p), {
        depth: building.h + (high - low) + 0.05,
        bevelEnabled: false,
      });
      geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(0, low - 0.05, 0));
      const roofIndex = index % roofs.length;
      const wallIndex = (index * 7) % walls.length;
      const key = roofIndex * walls.length + wallIndex;
      const group = buildingGeometries.get(key);
      if (group) group.push(geometry);
      else buildingGeometries.set(key, [geometry]);
      if (building.n) {
        const label = this.createTextSprite(building.n, building.n === highlighted ? "#ffd23f" : "#e9ecd9");
        label.position.set(sumX / count, high + building.h + 2.2, sumZ / count);
        this.scene.add(label);
        this.buildingLabels.set(building.n, label);
      }
    });
    for (const [key, geometries] of buildingGeometries) {
      const merged = mergeGeometries(geometries, true);
      for (const geometry of geometries) geometry.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, [roofs[Math.floor(key / walls.length)], walls[key % walls.length]]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    this.addTrees();
  }

  // Træerne er placeret i world.ts, så simuleringen kan køre ind i de samme træer, som vises.
  // Instansering holder antallet af meshes nede.
  private addTrees(): void {
    if (!trees.length) return;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.2, 0.3, 2, 7),
      this.toon("#8a5a3b"),
      trees.length,
    );
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.25, 1), this.toon("#ffffff"), trees.length);
    const tops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.85, 1), this.toon("#ffffff"), trees.length);
    const greens = ["#2f9e44", "#3fb54e", "#58c75a", "#7ad05f"].map((color) => new THREE.Color(color));
    const matrix = new THREE.Matrix4();
    trees.forEach(({ x, z, scale }, index) => {
      const ground = terrainHeightAt(x, z) - 0.1;
      matrix.makeScale(scale, scale, scale).setPosition(x, ground + scale, z);
      trunks.setMatrixAt(index, matrix);
      matrix.makeScale(scale, scale * 0.9, scale).setPosition(x, ground + 2.5 * scale, z);
      crowns.setMatrixAt(index, matrix);
      matrix.makeScale(scale, scale, scale).setPosition(x, ground + 3.7 * scale, z);
      tops.setMatrixAt(index, matrix);
      const tint = greens[Math.floor(((x * 12.9898 + z * 78.233) % 1 + 1) * 7) % greens.length];
      crowns.setColorAt(index, tint);
      tops.setColorAt(index, tint);
    });
    for (const mesh of [trunks, crowns, tops]) mesh.castShadow = true;
    this.scene.add(trunks, crowns, tops);
  }

  // Opdaterer fremhævningen af institutbygningen, når brugeren skifter institut efter scenen er bygget.
  refreshInstituteHighlight(): void {
    const highlighted = selectedInstitute()?.building;
    for (const [name, sprite] of this.buildingLabels) {
      const material = sprite.material as THREE.SpriteMaterial;
      material.map?.dispose();
      material.map = this.labelTexture(name, name === highlighted ? "#ffd23f" : "#e9ecd9");
      material.needsUpdate = true;
    }
  }

  private createTextSprite(text: string, color: string): THREE.Sprite {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.labelTexture(text, color), transparent: true, depthWrite: false }),
    );
    sprite.userData.label = true;
    sprite.scale.set(7, 1.3, 1);
    return sprite;
  }

  private labelTexture(text: string, color: string): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#101719b3";
      context.beginPath();
      context.roundRect(4, 4, 504, 88, 20);
      context.fill();
      context.fillStyle = color;
      context.font = "600 42px Manrope, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(text, 256, 50, 480);
    }
    return new THREE.CanvasTexture(canvas);
  }

  private wheelPart(radius: number, width: number, material: THREE.Material, hub: THREE.Material): THREE.Mesh {
    const geometry = new THREE.CylinderGeometry(radius, radius, width, 18);
    geometry.rotateZ(Math.PI / 2);
    const tire = new THREE.Mesh(geometry, material);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.04, 12), hub);
    cap.rotation.z = Math.PI / 2;
    tire.add(cap);
    tire.castShadow = true;
    this.outline(tire, 1.1);
    return tire;
  }

  // root bærer position og kørselsretning (dem følger kameraet); body bærer drift-skrid, læning og spin.
  private createKart(data: PlayerState): KartMesh {
    const { color, name } = data;
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.scale.setScalar(KART_SCALE);
    root.add(body);
    root.position.set(data.x, terrainHeightAt(data.x, data.z) + 0.03, data.z);
    root.rotation.order = "YXZ";
    const paint = this.toon(color);
    const trim = this.toon(`#${new THREE.Color(color).multiplyScalar(0.6).getHexString()}`);
    const dark = this.toon("#252b33");
    const steel = this.toon("#b8c0c8");
    const white = this.toon("#fafafa");
    const skin = this.toon("#ffcfa3");

    const hullGeometry = new THREE.CapsuleGeometry(0.42, 1.2, 4, 12);
    hullGeometry.rotateX(Math.PI / 2);
    const hull = new THREE.Mesh(hullGeometry, paint);
    hull.scale.set(1.5, 0.62, 1);
    hull.position.y = 0.55;
    hull.castShadow = true;
    this.outline(hull, 1.06);
    body.add(hull);

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), trim);
    nose.scale.set(1.25, 0.5, 0.95);
    nose.position.set(0, 0.5, -1.15);
    nose.castShadow = true;
    this.outline(nose, 1.08);
    body.add(nose);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.22), trim);
    seat.position.set(0, 0.95, 0.6);
    seat.castShadow = true;
    this.outline(seat, 1.1);
    body.add(seat);

    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.5), dark);
    engine.position.set(0, 0.7, 1.12);
    this.outline(engine, 1.08);
    body.add(engine);
    const flames: THREE.Mesh[] = [];
    for (const x of [-0.28, 0.28]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 8), steel);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(x, 0.62, 1.5);
      body.add(pipe);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 1.4, 10),
        new THREE.MeshBasicMaterial({ color: "#ffb347", transparent: true, opacity: 0.9 }),
      );
      flame.rotation.x = Math.PI / 2;
      flame.position.set(x, 0.62, 2.2);
      flame.visible = false;
      body.add(flame);
      flames.push(flame);
    }

    const wheels: THREE.Mesh[] = [];
    const frontPivots: THREE.Group[] = [];
    for (const x of [-1, 1]) {
      const rear = this.wheelPart(0.52, 0.5, dark, steel);
      rear.position.set(x * 0.95, 0.52, 0.75);
      body.add(rear);
      wheels.push(rear);
      const pivot = new THREE.Group();
      pivot.position.set(x * 0.88, 0.36, -0.85);
      const front = this.wheelPart(0.37, 0.3, dark, steel);
      pivot.add(front);
      body.add(pivot);
      wheels.push(front);
      frontPivots.push(pivot);
    }

    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), white);
    torso.scale.set(0.95, 1.05, 0.8);
    torso.position.set(0, 1.0, 0.3);
    this.outline(torso, 1.08);
    body.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), skin);
    head.position.set(0, 1.55, 0.25);
    this.outline(head, 1.1);
    body.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), paint);
    helmet.position.set(0, 1.56, 0.26);
    helmet.rotation.x = -0.25;
    this.outline(helmet, 1.1);
    body.add(helmet);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.13, 0.12), dark);
    visor.position.set(0, 1.58, -0.04);
    body.add(visor);

    const steeringWheel = new THREE.Group();
    steeringWheel.position.set(0, 1.0, -0.3);
    steeringWheel.rotation.x = -0.9;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 8, 18), dark);
    steeringWheel.add(ring);
    body.add(steeringWheel);
    for (const x of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.55, 8), white);
      arm.position.set(x * 0.32, 1.0, 0.02);
      arm.rotation.set(Math.PI / 2 - 0.4, 0, -x * 0.25);
      body.add(arm);
    }

    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 512;
    labelCanvas.height = 128;
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthWrite: false }),
    );
    label.userData.label = true;
    label.position.set(0, 3.1, 0);
    label.scale.set(2.4, 0.6, 1);
    root.add(label);
    const kart: KartMesh = {
      root, body, wheels, frontPivots, steeringWheel, flames, color, name,
      nameCanvas: labelCanvas, nameLabel: label, target: data, heading: data.heading, slide: 0, lean: 0, pitch: 0, roll: 0,
    };
    this.updateNameLabel(kart, name);
    return kart;
  }

  private updateNameLabel(kart: KartMesh, name: string): void {
    const context = kart.nameCanvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, kart.nameCanvas.width, kart.nameCanvas.height);
    context.fillStyle = "#101719dd";
    context.beginPath();
    context.roundRect(8, 8, 496, 112, 24);
    context.fill();
    context.strokeStyle = kart.color;
    context.lineWidth = 8;
    context.stroke();
    context.fillStyle = "#f0f1e9";
    context.font = "700 52px Fredoka, Manrope, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(name, 256, 64, 460);
    const material = kart.nameLabel.material;
    if (material.map) material.map.needsUpdate = true;
    kart.name = name;
  }

  private emit(position: THREE.Vector3, velocity: THREE.Vector3, color: string, life: number, size: number, growth: number, additive: boolean, opacity = 0.8): void {
    let particle = this.particles.find((candidate) => candidate.life <= 0);
    if (!particle) {
      if (this.particles.length >= 140) return;
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.particleTexture, transparent: true, depthWrite: false, fog: true }),
      );
      sprite.visible = false;
      this.scene.add(sprite);
      particle = { sprite, velocity: new THREE.Vector3(), life: 0, maxLife: 1, size: 1, growth: 0, opacity: 1 };
      this.particles.push(particle);
    }
    const material = particle.sprite.material;
    material.color.set(color);
    material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    particle.sprite.position.copy(position);
    particle.velocity.copy(velocity);
    particle.life = particle.maxLife = life;
    particle.size = size;
    particle.growth = growth;
    particle.opacity = opacity;
    particle.sprite.visible = true;
  }

  private updateParticles(delta: number): void {
    for (const particle of this.particles) {
      if (particle.life <= 0) continue;
      particle.life -= delta;
      if (particle.life <= 0) {
        particle.sprite.visible = false;
        continue;
      }
      const age = 1 - particle.life / particle.maxLife;
      particle.sprite.position.addScaledVector(particle.velocity, delta);
      particle.sprite.scale.setScalar(particle.size + particle.growth * age);
      particle.sprite.material.opacity = particle.opacity * (1 - age);
    }
  }

  private emitKartEffects(kart: KartMesh, delta: number): void {
    const data = kart.target;
    const forward = new THREE.Vector3(-Math.sin(kart.heading), 0, -Math.cos(kart.heading));
    const right = new THREE.Vector3(Math.cos(kart.heading), 0, -Math.sin(kart.heading));
    const rate = delta * 60;
    const ground = (point: THREE.Vector3, height: number): THREE.Vector3 =>
      point.setY(terrainHeightAt(point.x, point.z) + height);
    const rearAt = (side: number, height: number): THREE.Vector3 =>
      ground(kart.root.position.clone().addScaledVector(forward, -1.2).addScaledVector(right, side * 1.2), height);

    if (data.driftDir !== 0 && data.respawn <= 0) {
      const level = DRIFT_LEVELS.filter((threshold) => data.driftCharge >= threshold).length;
      for (const side of [-1, 1]) {
        if (Math.random() > 0.7 * rate) continue;
        const spread = new THREE.Vector3((Math.random() - 0.5) * 3, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 3);
        spread.addScaledVector(forward, -2).addScaledVector(right, side * 2.5);
        this.emit(rearAt(side, 0.25), spread, DRIFT_COLORS[level], 0.35, level ? 0.7 : 0.4, -0.2, true, 1);
      }
      if (Math.random() < 0.5 * rate) this.emit(rearAt(Math.random() < 0.5 ? -1 : 1, 0.3), new THREE.Vector3(0, 0.8, 0), "#ffffff", 0.7, 0.8, 2.2, false, 0.45);
    }
    if (data.offroad && Math.abs(data.speed) > 3 && Math.random() < 0.8 * rate) {
      const puff = new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2);
      this.emit(rearAt(Math.random() < 0.5 ? -1 : 1, 0.3), puff, "#cfe8a8", 0.7, 0.9, 2.4, false, 0.6);
    }
    if (data.boost > 0) {
      for (const side of [-0.34, 0.34]) {
        if (Math.random() > 0.9 * rate) continue;
        const jet = forward.clone().multiplyScalar(-9).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.2, (Math.random() - 0.5) * 1.5));
        const origin = ground(kart.root.position.clone().addScaledVector(forward, -1.9).addScaledVector(right, side * KART_SCALE), 0.85);
        this.emit(origin, jet, Math.random() < 0.5 ? "#ffb347" : "#ff5a36", 0.35, 0.9, 0.6, true, 0.95);
      }
    }
    if (data.spin > 0 && Math.random() < 0.4 * rate) {
      this.emit(ground(kart.root.position.clone(), 2.8), new THREE.Vector3((Math.random() - 0.5) * 3, 0.5, (Math.random() - 0.5) * 3), "#ffe066", 0.6, 0.8, 0.3, true, 1);
    }
    
  }

  private resize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private render = (time: number): void => {
    if (!this.running) return;
    const delta = this.lastTime ? Math.min((time - this.lastTime) / 1000, 0.06) : 0;
    this.lastTime = time;
    const follow = 1 - Math.exp(-delta * 14);

    for (const kart of this.karts.values()) {
      const data = kart.target;
      kart.root.position.x += (data.x - kart.root.position.x) * follow;
      kart.root.position.z += (data.z - kart.root.position.z) * follow;
      const turn = data.heading - kart.heading;
      kart.heading += Math.atan2(Math.sin(turn), Math.cos(turn)) * follow;
      kart.root.rotation.y = kart.heading;

      const speedRatio = Math.min(1.6, Math.abs(data.speed) / BASE_SPEED);
      // Under drift peger karten ind i svinget, som i racerspil; hoppet løfter den et øjeblik.
      kart.slide += (-data.driftDir * 0.42 - kart.slide) * (1 - Math.exp(-delta * 9));
      kart.lean += (data.steerAmt * 0.09 * speedRatio - kart.lean) * (1 - Math.exp(-delta * 8));
      kart.body.rotation.y = kart.slide + (data.spin > 0 ? data.spin * Math.PI * 4 : 0);
      kart.body.rotation.z = kart.lean;
      const hop = data.hop > 0 ? Math.sin((data.hop / 0.28) * Math.PI) * 0.45 : 0;
      const rumble = data.offroad ? Math.sin(time * 0.06) * 0.05 * speedRatio : 0;
      const ground = terrainFrame(kart.root.position.x, kart.root.position.z, kart.heading, 1.3 * KART_SCALE, KART_SCALE);
      const tilt = 1 - Math.exp(-delta * 10);
      kart.pitch += (ground.pitch - kart.pitch) * tilt;
      kart.roll += (ground.roll - kart.roll) * tilt;
      kart.root.rotation.x = kart.pitch;
      kart.root.rotation.z = kart.roll;
      kart.root.position.y = ground.y + 0.03 + hop + rumble;
      for (const wheel of kart.wheels) wheel.rotation.x -= (data.speed / 0.45) * delta;
      for (const pivot of kart.frontPivots) pivot.rotation.y = -data.steerAmt * 0.45;
      kart.steeringWheel.rotation.z = -data.steerAmt * 1.2;
      for (const flame of kart.flames) {
        flame.visible = data.boost > 0;
        flame.scale.set(1, 0.8 + Math.random() * 0.6, 1);
      }
      // Blink mens kartet sættes tilbage på banen.
      kart.root.visible = data.respawn <= 0 || Math.floor(time / 120) % 2 === 0;
      // Navneskilte vises kun over de andre, og ikke når de er så tæt på, at skiltet fylder skærmen.
      kart.nameLabel.visible = kart !== this.focusKart && kart.root.position.distanceTo(this.camera.position) > 11;
      this.emitKartEffects(kart, delta);
    }

    for (const mesh of this.objectMeshes.values()) {
      mesh.position.x += ((mesh.userData.targetX as number) - mesh.position.x) * follow;
      mesh.position.z += ((mesh.userData.targetZ as number) - mesh.position.z) * follow;
      const lift = mesh.userData.lift as number | undefined;
      if (lift !== undefined) {
        const bob = mesh.userData.kind === "box" ? Math.sin(time * 0.003 + mesh.position.x) * 0.2 : 0;
        mesh.position.y = lift + terrainHeightAt(mesh.position.x, mesh.position.z) + bob;
      }
      if (mesh.userData.kind === "box") {
        mesh.rotation.y += delta * 1.6;
        mesh.rotation.x += delta * 0.8;
      }
      if (mesh.userData.kind === "frisbee") mesh.rotation.y += delta * 18;
    }
    this.boxMaterial.color.setHSL((time * 0.0003) % 1, 0.85, 0.62);
    this.padTexture.offset.y = -((time * 0.0012) % 1);
    this.updateParticles(delta);

    const focusKart = this.focusKart;
    if (focusKart) {
      const position = focusKart.root.position;
      const data = focusKart.target;
      const forward = this.tmpForward.set(-Math.sin(focusKart.heading), 0, -Math.cos(focusKart.heading));
      const right = this.tmpRight.set(Math.cos(focusKart.heading), 0, -Math.sin(focusKart.heading));
      const speedRatio = Math.min(1.7, Math.max(0, data.speed) / BASE_SPEED);
      const distance = 7.2 + speedRatio * 0.9;
      const target = this.tmpTarget.copy(position)
        .addScaledVector(forward, -distance)
        .addScaledVector(right, -focusKart.slide * 3.2);
      target.y += 3.7 + speedRatio * 0.3;
      // Ligger kameraet inde i en bygning, trækkes det ind mod karten, til det er frit igen.
      const eye = this.tmpEye.copy(target);
      for (let fraction = 1; fraction > 0.3; fraction -= 0.1) {
        eye.lerpVectors(position, target, fraction);
        if (!buildingColliders.some((building) => pointInPolygon(building, eye.x, eye.z))) break;
      }
      // Kameraet må ikke ligge under terrænet, og terrænet må ikke skygge for sigtelinjen til karten (fx over en bakketop).
      const lookTarget = this.tmpLook.copy(position);
      lookTarget.y += 1.2;
      eye.y = Math.max(eye.y, terrainHeightAt(eye.x, eye.z) + 1.4);
      for (let fraction = 0.1; fraction < 0.95; fraction += 0.1) {
        const sx = eye.x + (lookTarget.x - eye.x) * fraction;
        const sz = eye.z + (lookTarget.z - eye.z) * fraction;
        const needed = (terrainHeightAt(sx, sz) + 0.8 - lookTarget.y * fraction) / (1 - fraction);
        if (needed > eye.y) eye.y = needed;
      }
      this.camera.position.lerp(eye, 1 - Math.exp(-delta * 8));
      const floor = terrainHeightAt(this.camera.position.x, this.camera.position.z) + 1.2;
      if (this.camera.position.y < floor) this.camera.position.y = floor;
      if (data.boost > 0) {
        this.camera.position.x += (Math.random() - 0.5) * 0.08;
        this.camera.position.y += (Math.random() - 0.5) * 0.08;
      }
      const look = this.tmpLook.copy(position).addScaledVector(forward, 7);
      look.y += 1.2;
      this.camera.lookAt(look);
      // Synsfeltet udvides med farten og i boost; det giver fornemmelsen af fart.
      const wantedFov = 60 + Math.min(1, speedRatio) * 4 + (data.boost > 0 ? 12 : 0);
      this.fov += (wantedFov - this.fov) * (1 - Math.exp(-delta * 6));
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
      // Skyggekortet følger kartet, så skyggerne er skarpe, uanset hvor på banen man er.
      this.sun.target.position.copy(position);
      this.sun.position.copy(position);
      this.sun.position.x -= 36;
      this.sun.position.y += 56;
      this.sun.position.z += 30;
    }
    this.clouds.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.renderer.render(this.scene, this.camera);
  };
}
