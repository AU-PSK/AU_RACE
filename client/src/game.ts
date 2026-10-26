import * as THREE from "three";
import { route, TRACK_WIDTH, trackPosition } from "./track.js";

export interface PlayerView {
  name: string;
  role: string;
  color: string;
  progress: number;
  speed: number;
  lane: number;
  lap: number;
  place: number;
  finished: boolean;
  finishTime: number;
  host: boolean;
  hasItem: boolean;
}

export interface PickupView {
  id: string;
  progress: number;
  lane: number;
  active: boolean;
}

interface KartMesh {
  root: THREE.Group;
  wheels: THREE.Mesh[];
  color: string;
  name: string;
  nameCanvas: HTMLCanvasElement;
  nameLabel: THREE.Sprite;
}

export class RaceScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private karts = new Map<string, KartMesh>();
  private pickupMeshes = new Map<string, THREE.Mesh>();
  private focusKart: THREE.Group | null = null;
  private lastTime = 0;
  private running = true;

  constructor(private container: HTMLElement, private mySessionId: string) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#a9c5c0");
    this.scene.fog = new THREE.Fog("#a9c5c0", 75, 180);
    this.camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.1, 240);
    this.camera.position.set(0, 19, 28);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight("#eef5da", "#58694d", 2.2));
    const sun = new THREE.DirectionalLight("#fff0d1", 3);
    sun.position.set(-36, 56, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    this.scene.add(sun);
    this.addWorld();
    window.addEventListener("resize", this.resize);
    this.renderer.setAnimationLoop(this.render);
  }

  updatePlayers(players: Iterable<[string, PlayerView]>): void {
    const activeIds = new Set<string>();
    let leader: KartMesh | null = null;
    let leaderProgress = -1;
    for (const [id, data] of players) {
      if (data.role !== "racer") continue;
      activeIds.add(id);
      let kart = this.karts.get(id);
      if (!kart) {
        kart = this.createKart(data.color, data.name);
        this.karts.set(id, kart);
        this.scene.add(kart.root);
      } else if (kart.name !== data.name) {
        this.updateNameLabel(kart, data.name);
      }

      const progress = data.finished ? 0.998 : data.progress;
      const position = trackPosition(progress, data.lane);
      const tangent = route.getTangentAt(((progress % 1) + 1) % 1);
      kart.root.position.set(position.x, 0.12, position.z);
      kart.root.rotation.y = Math.atan2(tangent.x, tangent.z);
      for (const wheel of kart.wheels) wheel.rotation.x += data.speed * 0.22;
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
    this.focusKart = this.karts.get(this.mySessionId)?.root ?? leader?.root ?? null;
  }

  updatePickups(pickups: Iterable<[string, PickupView]>): void {
    const activeIds = new Set<string>();
    for (const [id, pickup] of pickups) {
      activeIds.add(id);
      let mesh = this.pickupMeshes.get(id);
      if (!mesh) {
        const material = new THREE.MeshStandardMaterial({
          color: "#d7f36a",
          emissive: "#7d9b28",
          emissiveIntensity: 1.4,
          metalness: 0.2,
          roughness: 0.3,
        });
        mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.72, 0), material);
        mesh.castShadow = true;
        this.pickupMeshes.set(id, mesh);
        this.scene.add(mesh);
      }
      mesh.visible = pickup.active;
      const position = trackPosition(pickup.progress, pickup.lane);
      mesh.position.set(position.x, 1.35, position.z);
    }
    for (const [id, mesh] of this.pickupMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.pickupMeshes.delete(id);
      }
    }
  }

  dispose(): void {
    this.running = false;
    window.removeEventListener("resize", this.resize);
    this.renderer.setAnimationLoop(null);
    this.disposeTree(this.scene);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  private disposeTree(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      if (object instanceof THREE.Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
      }
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
  }

  private addWorld(): void {
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(230, 230),
      new THREE.MeshStandardMaterial({ color: "#81966b", roughness: 1 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.16;
    grass.receiveShadow = true;
    this.scene.add(grass);

    this.addRoad();
    this.addGarden();
    this.addBuildingsAndTrees();
  }

  private addRoad(): void {
    const segments = 420;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const center = route.getPointAt(t);
      const tangent = route.getTangentAt(t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      for (const side of [-1, 1]) {
        const edge = center.clone().addScaledVector(normal, side * TRACK_WIDTH / 2);
        positions.push(edge.x, 0, edge.z);
      }
      if (i < segments) {
        const n = i * 2;
        indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const road = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: "#515653", roughness: 0.94, side: THREE.DoubleSide }),
    );
    road.position.y = 0.015;
    road.receiveShadow = true;
    this.scene.add(road);

    for (const side of [-1, 1]) {
      const pointsOnEdge: THREE.Vector3[] = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const center = route.getPointAt(t);
        const tangent = route.getTangentAt(t);
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
        pointsOnEdge.push(center.addScaledVector(normal, side * (TRACK_WIDTH / 2 + 0.13)).setY(0.2));
      }
      const curb = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pointsOnEdge), segments, 0.16, 6, true),
        new THREE.MeshStandardMaterial({ color: side === 1 ? "#d7f36a" : "#e2ddd0", roughness: 0.68 }),
      );
      curb.castShadow = true;
      this.scene.add(curb);
    }

    for (let i = 0; i < 22; i++) {
      const t = i / 22;
      const p = route.getPointAt(t);
      const tangent = route.getTangentAt(t);
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(0.23, 0.018, 0.55),
        new THREE.MeshBasicMaterial({ color: "#d8d8c7" }),
      );
      marker.position.set(p.x, 0.045, p.z);
      marker.rotation.y = Math.atan2(tangent.x, tangent.z);
      this.scene.add(marker);
    }

    const line = new THREE.Mesh(
      new THREE.BoxGeometry(TRACK_WIDTH - 0.3, 0.045, 0.55),
      new THREE.MeshStandardMaterial({ color: "#eee9d6" }),
    );
    line.position.copy(trackPosition(0)).setY(0.07);
    line.rotation.y = Math.atan2(route.getTangentAt(0).x, route.getTangentAt(0).z);
    this.scene.add(line);
  }

  private addGarden(): void {
    const garden = new THREE.Mesh(
      new THREE.CircleGeometry(13, 48),
      new THREE.MeshStandardMaterial({ color: "#607650", roughness: 1 }),
    );
    garden.rotation.x = -Math.PI / 2;
    garden.position.y = -0.12;
    this.scene.add(garden);

    const paths = [
      [new THREE.Vector3(-6, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(6, 0, 0)],
      [new THREE.Vector3(0, 0, -6), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 6)],
    ];
    for (const path of paths) {
      const walk = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), 20, 0.65, 6, false),
        new THREE.MeshStandardMaterial({ color: "#c4b99d", roughness: 1 }),
      );
      walk.position.y = -0.03;
      this.scene.add(walk);
    }
    this.addTree(0, -1, 0.85);
    this.addTree(2.2, 1, 0.7);
    this.addTree(-2, 2, 0.72);
  }

  private addBuildingsAndTrees(): void {
    const buildings = [
      [-43, -34, 15, 12], [-5, -47, 21, 12], [40, -27, 15, 17],
      [45, 22, 14, 18], [12, 47, 18, 12], [-44, 35, 16, 13],
      [-48, 1, 12, 16], [1, -50, 13, 9],
    ];
    for (const [x, z, width, depth] of buildings) {
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(width, 6.5, depth),
        new THREE.MeshStandardMaterial({ color: "#c3bda7", roughness: 0.86 }),
      );
      building.position.set(x, 3.1, z);
      building.castShadow = true;
      building.receiveShadow = true;
      this.scene.add(building);
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.8, 0.4, depth + 0.8),
        new THREE.MeshStandardMaterial({ color: "#745b48", roughness: 0.8 }),
      );
      roof.position.set(x, 6.55, z);
      roof.castShadow = true;
      this.scene.add(roof);
    }

    let seed = 4813;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < 95; i++) {
      const x = random() * 110 - 55;
      const z = random() * 110 - 55;
      const p = new THREE.Vector3(x, 0, z);
      const trackDistance = Math.min(...Array.from({ length: 48 }, (_, j) =>
        p.distanceTo(route.getPointAt(j / 48))));
      if (trackDistance < 9 || (Math.abs(x) < 16 && Math.abs(z) < 16)) continue;
      this.addTree(x, z, 0.65 + random() * 0.75);
    }
  }

  private addTree(x: number, z: number, scale: number): void {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16 * scale, 0.26 * scale, 2 * scale, 7),
      new THREE.MeshStandardMaterial({ color: "#594a38", roughness: 1 }),
    );
    trunk.position.set(x, scale, z);
    trunk.castShadow = true;
    this.scene.add(trunk);

    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.1 * scale, 1),
      new THREE.MeshStandardMaterial({ color: "#526a48", roughness: 1, flatShading: true }),
    );
    crown.position.set(x, 2.5 * scale, z);
    crown.castShadow = true;
    this.scene.add(crown);
  }

  private createKart(color: string, name: string): KartMesh {
    const root = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.16 });
    const dark = new THREE.MeshStandardMaterial({ color: "#202724", roughness: 0.7 });
    const seatMat = new THREE.MeshStandardMaterial({ color: "#303b37", roughness: 0.65 });
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.38, 2.1), paint);
    chassis.position.y = 0.48;
    chassis.castShadow = true;
    root.add(chassis);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 0.55), paint);
    nose.position.set(0, 0.53, -1.17);
    nose.castShadow = true;
    root.add(nose);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.57, 0.72), seatMat);
    seat.position.set(0, 0.86, 0.28);
    seat.castShadow = true;
    root.add(seat);

    const wheelGeometry = new THREE.CylinderGeometry(0.32, 0.32, 0.26, 12);
    const wheels: THREE.Mesh[] = [];
    for (const x of [-0.78, 0.78]) {
      for (const z of [-0.72, 0.76]) {
        const wheel = new THREE.Mesh(wheelGeometry, dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.35, z);
        wheel.castShadow = true;
        root.add(wheel);
        wheels.push(wheel);
      }
    }

    const front = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.14), dark);
    front.position.set(0, 0.25, -1.22);
    root.add(front);

    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 512;
    labelCanvas.height = 128;
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthWrite: false }),
    );
    label.position.set(0, 2.45, 0);
    label.scale.set(3.4, 0.85, 1);
    root.add(label);
    const kart = { root, wheels, color, name, nameCanvas: labelCanvas, nameLabel: label };
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
    context.font = "700 52px Manrope, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(name, 256, 64, 460);
    const material = kart.nameLabel.material;
    if (material.map) material.map.needsUpdate = true;
    kart.name = name;
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
    for (const pickup of this.pickupMeshes.values()) {
      if (pickup.visible) {
        pickup.rotation.y += delta * 1.4;
        pickup.position.y = 1.3 + Math.sin(time * 0.002 + pickup.position.x) * 0.16;
      }
    }
    const focusKart = this.focusKart;
    if (focusKart) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(focusKart.quaternion);
      const target = focusKart.position.clone().addScaledVector(forward, -10).add(new THREE.Vector3(0, 7, 0));
      this.camera.position.lerp(target, 1 - Math.exp(-delta * 3));
      const look = focusKart.position.clone().addScaledVector(forward, 4).add(new THREE.Vector3(0, 1, 0));
      this.camera.lookAt(look);
    }
    this.renderer.render(this.scene, this.camera);
  };
}
