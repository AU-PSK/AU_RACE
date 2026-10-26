import * as THREE from "three";
import { campus } from "./campus-data.js";
import type { PlayerState, RaceObject } from "./race.js";
import { route, TRACK_WIDTH, trackPosition } from "./track.js";
import { trees } from "./world.js";

interface KartMesh {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Mesh[];
  sparks: THREE.Mesh[];
  sparkMaterial: THREE.MeshBasicMaterial;
  flame: THREE.Mesh;
  color: string;
  name: string;
  nameCanvas: HTMLCanvasElement;
  nameLabel: THREE.Sprite;
  target: PlayerState;
  heading: number;
  slide: number;
}

export class RaceScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private karts = new Map<string, KartMesh>();
  private objectMeshes = new Map<string, THREE.Group>();
  private focusKart: KartMesh | null = null;
  private sun: THREE.DirectionalLight;
  private lastTime = 0;
  private running = true;

  constructor(private container: HTMLElement, private mySessionId: string) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#a9c5c0");
    this.scene.fog = new THREE.Fog("#a9c5c0", 110, 280);
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 420);
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
    this.sun = sun;
    sun.position.set(-36, 56, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    sun.shadow.camera.far = 200;
    this.scene.add(sun, sun.target);
    this.addWorld();
    window.addEventListener("resize", this.resize);
    this.renderer.setAnimationLoop(this.render);
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
        kart.root.position.set(data.x, 0.12, data.z);
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
        mesh = this.createObjectMesh(object.kind);
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

  private createObjectMesh(kind: RaceObject["kind"]): THREE.Group {
    const group = new THREE.Group();
    group.userData.kind = kind;
    if (kind === "box") {
      const shell = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 1.2, 1.2),
        new THREE.MeshStandardMaterial({
          color: "#d7f36a", emissive: "#7d9b28", emissiveIntensity: 0.8,
          transparent: true, opacity: 0.55, roughness: 0.2,
        }),
      );
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.38, 0),
        new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#f4f6e2", emissiveIntensity: 1.2 }),
      );
      shell.castShadow = true;
      group.add(shell, core);
      group.position.y = 1.2;
    } else if (kind === "paper") {
      const paper = new THREE.MeshStandardMaterial({ color: "#f3efe2", roughness: 0.9 });
      for (let i = 0; i < 4; i++) {
        const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 1.25), paper);
        sheet.position.y = 0.06 + i * 0.12;
        sheet.rotation.y = (i % 2 === 0 ? 1 : -1) * 0.12 * i;
        sheet.castShadow = true;
        group.add(sheet);
      }
    } else {
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 0.1, 20),
        new THREE.MeshStandardMaterial({ color: "#ff8a3d", emissive: "#a33f0a", emissiveIntensity: 0.6, roughness: 0.4 }),
      );
      disc.castShadow = true;
      group.add(disc);
      group.position.y = 0.8;
    }
    return group;
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
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshStandardMaterial({ color: "#81966b", roughness: 1 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.16;
    grass.receiveShadow = true;
    this.scene.add(grass);

    this.addRoad();
    this.addCampus();
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
    const flatMesh = (flat: readonly number[], material: THREE.Material, y: number): void => {
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(toShape(flat)), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    };

    const forestMaterial = new THREE.MeshStandardMaterial({ color: "#6b8559", roughness: 1 });
    const parkMaterial = new THREE.MeshStandardMaterial({ color: "#8ba56b", roughness: 1 });
    const pitchMaterial = new THREE.MeshStandardMaterial({ color: "#78a35c", roughness: 1 });
    const waterMaterial = new THREE.MeshStandardMaterial({ color: "#6fa5b8", roughness: 0.25, metalness: 0.1 });
    for (const polygon of campus.parks) flatMesh(polygon, parkMaterial, -0.13);
    for (const polygon of campus.pitches) flatMesh(polygon, pitchMaterial, -0.12);
    for (const polygon of campus.forests) flatMesh(polygon, forestMaterial, -0.11);
    for (const polygon of campus.water) flatMesh(polygon, waterMaterial, -0.09);
    for (const stream of campus.streams) {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i < stream.length; i += 2) points.push(new THREE.Vector3(stream[i], 0, stream[i + 1]));
      if (points.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(points);
      const ribbon = new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 4, 0.45, 4, false), waterMaterial);
      // Fladtrykt og under vejen, så bækken løber under vejen i stedet for ovenpå.
      ribbon.scale.y = 0.15;
      ribbon.position.y = -0.07;
      this.scene.add(ribbon);
    }

    const roofMaterial = new THREE.MeshStandardMaterial({ color: "#7a5f4d", roughness: 0.8 });
    const wallMaterials = ["#cdb98a", "#c4a77a", "#d2c4a0"].map(
      (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.86 }),
    );
    campus.buildings.forEach((building, index) => {
      const mesh = new THREE.Mesh(
        new THREE.ExtrudeGeometry(toShape(building.p), { depth: building.h, bevelEnabled: false }),
        [roofMaterial, wallMaterials[index % wallMaterials.length]],
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      if (building.n) {
        let sumX = 0;
        let sumZ = 0;
        for (let i = 0; i < building.p.length; i += 2) {
          sumX += building.p[i];
          sumZ += building.p[i + 1];
        }
        const count = building.p.length / 2;
        const label = this.createTextSprite(building.n, "#e9ecd9");
        label.position.set(sumX / count, building.h + 2.2, sumZ / count);
        this.scene.add(label);
      }
    });

    this.addTrees();
  }

  // Træerne er placeret i world.ts, så simuleringen kan køre ind i de samme træer, som vises.
  // Instansering holder antallet af meshes nede.
  private addTrees(): void {
    if (!trees.length) return;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.16, 0.26, 2, 7),
      new THREE.MeshStandardMaterial({ color: "#594a38", roughness: 1 }),
      trees.length,
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1.1, 1),
      new THREE.MeshStandardMaterial({ color: "#526a48", roughness: 1, flatShading: true }),
      trees.length,
    );
    const matrix = new THREE.Matrix4();
    trees.forEach(({ x, z, scale }, index) => {
      matrix.makeScale(scale, scale, scale).setPosition(x, scale, z);
      trunks.setMatrixAt(index, matrix);
      matrix.makeScale(scale, scale, scale).setPosition(x, 2.5 * scale, z);
      crowns.setMatrixAt(index, matrix);
    });
    trunks.castShadow = true;
    crowns.castShadow = true;
    this.scene.add(trunks, crowns);
  }

  private createTextSprite(text: string, color: string): THREE.Sprite {
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
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
    );
    sprite.scale.set(7, 1.3, 1);
    return sprite;
  }

  // root bærer position og kørselsretning (dem følger kameraet); body bærer drift-skrid og spin.
  private createKart(data: PlayerState): KartMesh {
    const { color, name } = data;
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    root.position.set(data.x, 0.12, data.z);
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.16 });
    const dark = new THREE.MeshStandardMaterial({ color: "#202724", roughness: 0.7 });
    const seatMat = new THREE.MeshStandardMaterial({ color: "#303b37", roughness: 0.65 });
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.38, 2.1), paint);
    chassis.position.y = 0.48;
    chassis.castShadow = true;
    body.add(chassis);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 0.55), paint);
    nose.position.set(0, 0.53, -1.17);
    nose.castShadow = true;
    body.add(nose);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.57, 0.72), seatMat);
    seat.position.set(0, 0.86, 0.28);
    seat.castShadow = true;
    body.add(seat);

    const wheelGeometry = new THREE.CylinderGeometry(0.32, 0.32, 0.26, 12);
    const wheels: THREE.Mesh[] = [];
    for (const x of [-0.78, 0.78]) {
      for (const z of [-0.72, 0.76]) {
        const wheel = new THREE.Mesh(wheelGeometry, dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.35, z);
        wheel.castShadow = true;
        body.add(wheel);
        wheels.push(wheel);
      }
    }

    const front = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.14), dark);
    front.position.set(0, 0.25, -1.22);
    body.add(front);

    // Gnister ved baghjulene under drift; farven viser, hvor stor turboen bliver.
    const sparkMaterial = new THREE.MeshBasicMaterial({ color: "#f4f1e0" });
    const sparks: THREE.Mesh[] = [];
    for (const x of [-0.8, 0.8]) {
      const spark = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), sparkMaterial);
      spark.position.set(x, 0.18, 1.1);
      spark.visible = false;
      body.add(spark);
      sparks.push(spark);
    }
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 1.1, 10),
      new THREE.MeshBasicMaterial({ color: "#ffb347", transparent: true, opacity: 0.85 }),
    );
    flame.rotation.x = Math.PI / 2;
    flame.position.set(0, 0.5, 1.6);
    flame.visible = false;
    body.add(flame);

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
    const kart: KartMesh = {
      root, body, wheels, sparks, sparkMaterial, flame, color, name,
      nameCanvas: labelCanvas, nameLabel: label, target: data, heading: data.heading, slide: 0,
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
    const follow = 1 - Math.exp(-delta * 14);

    for (const kart of this.karts.values()) {
      const data = kart.target;
      kart.root.position.x += (data.x - kart.root.position.x) * follow;
      kart.root.position.z += (data.z - kart.root.position.z) * follow;
      const turn = data.heading - kart.heading;
      kart.heading += Math.atan2(Math.sin(turn), Math.cos(turn)) * follow;
      kart.root.rotation.y = kart.heading;
      kart.slide += (data.driftDir * 0.38 - kart.slide) * (1 - Math.exp(-delta * 8));
      kart.body.rotation.y = kart.slide + (data.spin > 0 ? data.spin * Math.PI * 4 : 0);
      for (const wheel of kart.wheels) wheel.rotation.x -= (data.speed / 0.32) * delta;
      const drifting = data.driftDir !== 0;
      for (const spark of kart.sparks) {
        spark.visible = drifting && Math.floor(time / 60) % 2 === 0;
        spark.scale.setScalar(0.7 + Math.random() * 0.6);
      }
      kart.sparkMaterial.color.set(data.driftCharge >= 1.6 ? "#ff9a3c" : data.driftCharge >= 0.7 ? "#5ab4ff" : "#f4f1e0");
      kart.flame.visible = data.boost > 0;
      kart.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
      // Blink mens kartet sættes tilbage på banen.
      kart.root.visible = data.respawn <= 0 || Math.floor(time / 120) % 2 === 0;
    }

    for (const mesh of this.objectMeshes.values()) {
      mesh.position.x += ((mesh.userData.targetX as number) - mesh.position.x) * follow;
      mesh.position.z += ((mesh.userData.targetZ as number) - mesh.position.z) * follow;
      if (mesh.userData.kind === "box") {
        mesh.rotation.y += delta * 1.2;
        mesh.rotation.x += delta * 0.7;
        mesh.position.y = 1.2 + Math.sin(time * 0.003 + mesh.position.x) * 0.15;
      }
      if (mesh.userData.kind === "frisbee") mesh.rotation.y += delta * 18;
    }

    const focusKart = this.focusKart;
    if (focusKart) {
      const position = focusKart.root.position;
      const forward = new THREE.Vector3(-Math.sin(focusKart.heading), 0, -Math.cos(focusKart.heading));
      const target = position.clone().addScaledVector(forward, -8.5).add(new THREE.Vector3(0, 4.6, 0));
      this.camera.position.lerp(target, 1 - Math.exp(-delta * 5));
      const look = position.clone().addScaledVector(forward, 6).add(new THREE.Vector3(0, 1, 0));
      this.camera.lookAt(look);
      // Skyggekortet følger kartet, så skyggerne er skarpe, uanset hvor på banen man er.
      this.sun.target.position.copy(position);
      this.sun.position.copy(position).add(new THREE.Vector3(-36, 56, 30));
    }
    this.renderer.render(this.scene, this.camera);
  };
}
