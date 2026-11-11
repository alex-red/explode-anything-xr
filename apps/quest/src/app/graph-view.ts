import {
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  BoxGeometry,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Entity,
  type Material,
  type World,
} from '@iwsdk/core';
import type { FlowPath, GraphEdge, GraphNode, SceneState } from '@explode/contracts';
import { makeInteractive } from './interactions.ts';
import { conduitMaterial, createStage, haloMaterial, HoloMaterial, setReveal } from './holo.ts';
import { COLOR } from './palette.ts';
import { partGeometry, softwareGeometry } from './shapes.ts';
import type { Store } from './store.ts';
import { TextPanel } from './text.ts';

export interface GraphHandlers {
  onNodePressed(id: string): void;
  onPlugPressed(edgeId: string): void;
  onSocketPressed(edgeId: string, targetId: string): void;
}

interface NodeView {
  node: GraphNode;
  /**
   * The object rays hit and everything else positions against. For a mechanical part it is the
   * visible mesh. For a software node it is an invisible hit volume; the visible shape is one
   * instance in a shared batch (`batch`/`slot`).
   */
  mesh: Mesh<BufferGeometry, Material>;
  /** Own material of a mechanical part; null for software nodes. */
  material: HoloMaterial | null;
  batch: InstancedMesh | null;
  slot: number;
  /** This node's instance in the halo batch. */
  halo: number;
  entity: Entity;
  collapsed: Vector3;
  exploded: Vector3;
  radius: number;
  baseColor: Color;
  hovered: boolean;
  spinAxis: 'x' | 'y' | 'z' | null;
  spinSpeed: number;
  label: TextPanel | null;
  labelText: string;
}

interface EdgeView {
  edge: GraphEdge;
  /** Index of this edge's tube in the shared edge batch. */
  slot: number;
  /** `mesh` is an invisible hit volume; the small visible plug and its label are its children. */
  plug: { mesh: Mesh<BufferGeometry, Material>; body: Mesh<BoxGeometry, MeshStandardMaterial>; entity: Entity; label: TextPanel; detached: boolean | null } | null;
}

const UP = new Vector3(0, 1, 0);
const TRAY = new Vector3(0.3, -0.17, 0.1);
// Each label is its own texture and draw call, so the cap is part of the render budget.
const MAX_LABELS = 18;
// Part labels are 15 × 3 cm panels. One that would overlap a more important label (as seen
// from the eye) moves up by a label's height, at most LABEL_TRIES - 1 times, or is hidden.
const LABEL_W = 0.15;
const LABEL_H = 0.03;
const LABEL_STEP = LABEL_H + 0.004;
const LABEL_TRIES = 3;
/** Plug tags ("unplug") are 10 × 2.2 cm; labels keep clear of them too. */
const PLUG_TAG_W = 0.1;
const PLUG_TAG_H = 0.022;
const MAX_LABEL_RECTS = 64;
const PARTICLES = 8;
// Rays from a real hand wobble, so anything pressable is at least 4 cm across to the ray,
// whatever size it is drawn.
const MIN_HIT_RADIUS = 0.02; // mirrored in tools/content layout.ts
const PLUG_HIT_RADIUS = 0.025;
const IDENTITY = new Quaternion();
const WHITE = new Color(0xffffff);
const EDGE_COLOR = new Color(COLOR.edge).multiplyScalar(0.75);
// Halo size as a multiple of the node's drawn radius, and how bright each state glows.
const HALO_SIZE = 5.5;
const HALO_REST = 0.13;
const HALO_HOVER = 0.4;
const HALO_SELECTED = 0.75;
const HALO_PATH = 0.6;
const HALO_FAULT = 0.6;
const PARTICLE_HALO = 0.07; // metres across
// The projector stage sits just under the lowest parts.
const STAGE_RADIUS = 0.27;
export const STAGE_Y = -0.2;
// Boot-up: the scan front climbs this far above the stage in this many seconds.
const BOOT_SECONDS = 1.3;
const BOOT_HEIGHT = 0.9;
const EDGE_DIM = new Color(COLOR.dim);
const EDGE_PATH = new Color(COLOR.path);
const EDGE_BROKEN = new Color(COLOR.fault);
const NODE_PATH = new Color(COLOR.path);
const NODE_FAULT = new Color(COLOR.fault);
const NODE_DIM = new Color(COLOR.dim);

/**
 * Renders one ContentBundle as a manipulable spatial object.
 * Pure view: reads Store state each frame; all changes go back through handlers → events.
 */
export class GraphView {
  readonly root = new Group();
  readonly rootEntity: Entity;
  /** Explode factor preview while a two-hand pull is in progress (null = follow state). */
  pullPreview: number | null = null;
  displayFactor = 0;
  /** False while the learner is asked to predict, so the answer isn't shown before they commit. */
  revealConsequences = true;

  private nodes = new Map<string, NodeView>();
  private edges = new Map<string, EdgeView>();
  private sockets: Array<{ mesh: Mesh<TorusGeometry, MeshBasicMaterial>; entity: Entity; edgeId: string; targetId: string }> = [];
  private socketKey = '';
  // Software nodes, edges and flow particles are drawn as instanced batches: one draw call per
  // batch instead of one per node or edge (docs/FINAL_PLAN.md B2).
  private nodeBatches = new Map<string, InstancedMesh>();
  private edgeBatch: InstancedMesh | null = null;
  /** Per-edge flag for the conduit shader: 1 on traced-path edges, where pulses travel. */
  private edgeFlow: InstancedBufferAttribute | null = null;
  private particles: InstancedMesh;
  /** Soft additive glows behind nodes and flow pulses: the stand-in for bloom (one draw call). */
  private halos: InstancedMesh;
  private readonly haloGeo = new PlaneGeometry(1, 1);
  private readonly stage: ReturnType<typeof createStage>;
  /** 0 → 1 while the model materialises from its stage. */
  private boot = 0;
  private tray: Group;
  private trayLabel: TextPanel;
  private readonly isMechanical: boolean;
  private readonly edgeGeo = new CylinderGeometry(1, 1, 1, 6, 1, true);
  private readonly plugHitGeo = new SphereGeometry(PLUG_HIT_RADIUS, 10, 8);
  private readonly mats = {
    edge: conduitMaterial(), // tinted per instance
    halo: haloMaterial(),
    particle: new MeshBasicMaterial({ color: 0xfff1c4 }), // a white-hot core; its halo carries the gold
    socket: new MeshBasicMaterial({ color: COLOR.action, transparent: true, opacity: 0.9 }),
    /** Never drawn (no draw call), still hit by rays. */
    hit: new MeshBasicMaterial({ visible: false }),
  };
  private tmpM = new Matrix4();
  private tmpS = new Vector3();
  private tmpColor = new Color();
  private tmpA = new Vector3();
  private tmpB = new Vector3();
  private tmpC = new Vector3();
  private tmpQ = new Quaternion();
  private camPos = new Vector3();
  private camera: Camera | null = null;
  /** Rectangles already taken this frame, as [left, bottom, right, top] in view-tangent units. */
  private readonly rects = new Float32Array(MAX_LABEL_RECTS * 4);
  private rectCount = 0;
  private time = 0;
  // Derived from state; recomputed only when the state object or reveal flag changes (no per-frame allocation).
  private derivedFor: SceneState | null = null;
  private derivedReveal = true;
  private highlighted = new Set<string>();
  private affected = new Set<string>();
  private isolated: Set<string> | null = null;
  private labelIds = new Set<string>();
  private pathEdges = new Set<string>();
  private broken = new Set<string>();
  private segs: Array<[Vector3, Vector3]> = [];

  constructor(
    private readonly world: World,
    private readonly store: Store,
    private readonly handlers: GraphHandlers,
    parent: Entity,
  ) {
    const bundle = store.ctx.bundle;
    this.isMechanical = bundle.graph.system_kind === 'mechanical';
    this.rootEntity = world.createTransformEntity(this.root, { parent });

    const hemi = new HemisphereLight(0xdfe9ff, 0x1a2230, 1.4);
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.4, 1, 0.6);
    this.root.add(hemi, sun);

    if (!this.isMechanical) this.buildNodeBatches(bundle.graph.nodes);
    for (const node of bundle.graph.nodes) this.buildNode(node);
    for (const edge of bundle.graph.edges) this.buildEdge(edge);
    if (this.edges.size > 0) {
      this.edgeFlow = new InstancedBufferAttribute(new Float32Array(this.edges.size), 1);
      this.edgeGeo.setAttribute('aFlow', this.edgeFlow);
      this.edgeBatch = this.addBatch(this.edgeGeo, this.mats.edge, this.edges.size);
    }
    this.particles = this.addBatch(new SphereGeometry(0.005, 8, 6), this.mats.particle, PARTICLES);
    this.halos = this.addBatch(this.haloGeo, this.mats.halo, this.nodes.size + PARTICLES);
    this.halos.renderOrder = 2; // after the bodies they glow around

    this.stage = createStage(STAGE_RADIUS);
    this.stage.group.position.y = STAGE_Y;
    this.root.add(this.stage.group);

    this.tray = new Group();
    const plate = new Mesh(new BoxGeometry(0.16, 0.006, 0.09), new HoloMaterial(COLOR.cluster, 0.4));
    this.tray.add(plate);
    this.trayLabel = new TextPanel({ width: 0.16, height: 0.04, pxPerMeter: 2400, background: null, border: null, padding: 8, align: 'center' });
    this.trayLabel.draw([{ text: this.isMechanical ? 'Sandbox tray' : 'Sandbox tray · the real repo is never edited', size: 34, color: '#a9b6c6' }]);
    this.trayLabel.mesh.position.set(0, 0.03, 0.05);
    this.trayLabel.mesh.rotation.x = -0.5;
    this.tray.add(this.trayLabel.mesh);
    this.tray.position.copy(TRAY);
    this.tray.visible = false;
    this.root.add(this.tray);
  }

  update(dt: number, camera: Camera): void {
    this.time += dt;
    const s = this.store.state;
    const target = this.pullPreview ?? s.explode_factor;
    this.displayFactor += (target - this.displayFactor) * Math.min(1, dt * 5);
    if (Math.abs(target - this.displayFactor) < 0.001) this.displayFactor = target;
    const f = easeInOut(this.displayFactor);
    camera.getWorldPosition(this.camPos);
    this.camera = camera;
    if (this.boot < 1) {
      this.boot = Math.min(1, this.boot + dt / BOOT_SECONDS);
      setReveal(this.boot < 1 ? this.stage.group.getWorldPosition(this.tmpB).y + this.boot * BOOT_HEIGHT : null);
    }
    const glowIn = this.boot * this.boot; // halos fade in behind the scan front

    const activePath = s.active_path_id ? this.store.ctx.paths.get(s.active_path_id) : undefined;
    if (s !== this.derivedFor || this.revealConsequences !== this.derivedReveal) this.derive(s, activePath);
    const { highlighted, affected, isolated } = this;

    // Nodes
    for (const v of this.nodes.values()) {
      const p = v.mesh.position.lerpVectors(v.collapsed, v.exploded, f);
      const dimmed = isolated !== null && !isolated.has(v.node.id);
      const selected = s.selected_id === v.node.id;
      let scale = v.radius * (selected ? 1.3 : v.hovered ? 1.15 : 1) * (dimmed ? 0.6 : 1);
      if (!this.isMechanical && v.node.kind === 'cluster') scale *= 0.25 + 0.75 * (1 - f); // clusters shrink as the system opens
      const m = v.material;
      if (m) {
        // Mechanical part: its own mesh and material.
        v.mesh.scale.setScalar(selected ? 1.12 : v.hovered ? 1.06 : 1);
        if (affected.has(v.node.id)) {
          m.color.setHex(COLOR.fault);
          m.emissive.setHex(COLOR.fault).multiplyScalar(0.25 + 0.2 * Math.sin(this.time * 4));
        } else if (highlighted.has(v.node.id)) {
          m.color.setHex(COLOR.path);
          m.emissive.setHex(COLOR.path).multiplyScalar(0.35);
        } else if (dimmed) {
          m.color.setHex(COLOR.dim);
          m.emissive.setHex(0x000000);
        } else {
          m.color.copy(v.baseColor);
          m.emissive.setHex(selected ? 0x445566 : 0x000000);
        }
      } else if (v.batch) {
        // Software node: the hit volume is the drawn size, never under 4 cm across, and steady
        // while the drawn instance carries the state. The layout keeps these volumes from
        // overlapping (tools/content layout.ts hitRadius), so a ray lands on the part it aims at.
        v.mesh.scale.setScalar(v.node.kind === 'cluster' ? scale : Math.max(v.radius, MIN_HIT_RADIUS));
        const c = this.tmpColor;
        if (affected.has(v.node.id)) c.copy(NODE_FAULT).multiplyScalar(0.8 + 0.2 * Math.sin(this.time * 4));
        else if (highlighted.has(v.node.id)) c.copy(NODE_PATH);
        else if (dimmed) c.copy(NODE_DIM);
        else c.copy(v.baseColor).lerp(WHITE, selected ? 0.45 : v.hovered ? 0.2 : 0);
        v.batch.setMatrixAt(v.slot, this.tmpM.compose(p, IDENTITY, this.tmpS.setScalar(scale)));
        v.batch.setColorAt(v.slot, c);
      }

      // Halo: every node glows a little; state decides how much and in what colour.
      const glow = this.tmpColor;
      let strength = HALO_REST;
      if (affected.has(v.node.id)) {
        glow.copy(NODE_FAULT);
        strength = HALO_FAULT * (0.75 + 0.25 * Math.sin(this.time * 4));
      } else if (highlighted.has(v.node.id)) {
        glow.copy(NODE_PATH);
        strength = HALO_PATH;
      } else if (dimmed) {
        strength = 0;
      } else {
        glow.copy(v.baseColor);
        if (selected) {
          glow.lerp(WHITE, 0.5);
          strength = HALO_SELECTED;
        } else if (v.hovered) strength = HALO_HOVER;
      }
      const drawn = m ? v.radius : scale;
      this.halos.setMatrixAt(v.halo, strength > 0 ? this.tmpM.compose(p, IDENTITY, this.tmpS.setScalar(drawn * HALO_SIZE)) : this.tmpM.makeScale(0, 0, 0));
      this.halos.setColorAt(v.halo, glow.multiplyScalar(strength * glowIn));

      if (v.spinAxis) {
        const live = !affected.has(v.node.id);
        const want = live ? 5 : 0;
        v.spinSpeed += (want - v.spinSpeed) * Math.min(1, dt * 2);
        v.mesh.rotation[v.spinAxis] += v.spinSpeed * dt;
      }
    }

    for (const batch of this.nodeBatches.values()) {
      batch.instanceMatrix.needsUpdate = true;
      if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
    }

    this.updateEdges(s, f, isolated); // plugs first: labels keep clear of their tags
    this.updateLabels(s, f, highlighted, affected);
    this.updateParticles(s, f, activePath);
    this.updateSockets(s, f);
    this.halos.instanceMatrix.needsUpdate = true;
    if (this.halos.instanceColor) this.halos.instanceColor.needsUpdate = true;
  }

  private derive(s: SceneState, path: FlowPath | undefined): void {
    this.derivedFor = s;
    this.derivedReveal = this.revealConsequences;
    this.highlighted = new Set(s.highlighted_ids);
    this.affected = new Set(this.revealConsequences ? s.consequences.flatMap((c) => c.affected_ids) : []);
    this.isolated = s.isolated_ids ? new Set(s.isolated_ids) : null;
    this.pathEdges = new Set(path?.edge_ids ?? []);
    this.broken = new Set(s.broken_edge_ids);
    this.labelIds = new Set(
      [...this.nodes.values()]
        .map((v) => ({ id: v.node.id, score: labelScore(v.node, s, this.highlighted, this.affected, this.isMechanical) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_LABELS)
        .map((x) => x.id),
    );
    // Flow travels along the path's real edges (edge_ids[i] carries flow into node_ids[i+1])
    // and stops at the first disconnected edge.
    this.segs = [];
    if (path) {
      for (const edgeId of path.edge_ids) {
        if (this.revealConsequences && s.broken_edge_ids.includes(edgeId)) break;
        const e = this.store.ctx.edges.get(edgeId);
        const a = e && this.nodes.get(e.source_id);
        const b = e && this.nodes.get(e.target_id);
        if (a && b) this.segs.push([a.mesh.position, b.mesh.position]);
      }
    }
  }

  dispose(): void {
    for (const v of this.nodes.values()) {
      v.label?.dispose();
      // Software hit volumes use shared geometry (shapes.ts) and the shared hit material.
      v.entity.dispose({ disposeResources: this.isMechanical });
    }
    for (const e of this.edges.values()) {
      if (e.plug) {
        e.plug.label.dispose();
        e.plug.body.geometry.dispose();
        e.plug.body.material.dispose();
        e.plug.entity.dispose({ disposeResources: false });
      }
    }
    // Batches: node geometry is shared across views, so only materials and instance buffers go.
    for (const batch of this.nodeBatches.values()) {
      (batch.material as Material).dispose();
      batch.dispose();
    }
    this.edgeBatch?.dispose();
    this.edgeGeo.dispose();
    this.particles.geometry.dispose();
    this.particles.dispose();
    this.halos.dispose();
    this.haloGeo.dispose();
    this.stage.dispose();
    setReveal(null);
    this.plugHitGeo.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.disposeSockets();
    this.trayLabel.dispose();
    this.rootEntity.dispose();
  }

  /** World positions of visible nodes and plugs by id (debug and the emulator walkthrough). */
  targetPositions(tmp: Vector3): { nodes: Record<string, number[]>; plugs: Record<string, number[]> } {
    const nodes: Record<string, number[]> = {};
    const plugs: Record<string, number[]> = {};
    for (const v of this.nodes.values()) if (v.mesh.visible) nodes[v.node.id] = v.mesh.getWorldPosition(tmp).toArray();
    for (const e of this.edges.values()) if (e.plug?.mesh.visible) plugs[e.edge.id] = e.plug.mesh.getWorldPosition(tmp).toArray();
    return { nodes, plugs };
  }

  /**
   * The detached edge this node is offering a socket for, if any. The ring is a thin torus
   * around the part, so a ray aimed at the socket almost always lands on the part inside it;
   * the app treats that as a press on the socket.
   */
  socketEdgeFor(nodeId: string): string | null {
    for (const sk of this.sockets) if (sk.targetId === nodeId && sk.mesh.visible) return sk.edgeId;
    return null;
  }

  /** Socket rings share one material; dispose only their own geometry. */
  private disposeSockets(): void {
    for (const sk of this.sockets) {
      sk.mesh.geometry.dispose();
      sk.entity.dispose({ disposeResources: false });
    }
    this.sockets = [];
  }

  /** World position of a node's current display position (for panels / tutor annotations). */
  nodeWorldPosition(id: string, out: Vector3): Vector3 | null {
    const v = this.nodes.get(id);
    return v ? v.mesh.getWorldPosition(out) : null;
  }

  private buildNode(node: GraphNode): void {
    const bundle = this.store.ctx.bundle;
    const placement = bundle.layout.placements[node.id];
    if (!placement) return;
    const part = bundle.assets?.parts[node.id];
    if (this.isMechanical && !part) return; // cluster-only nodes in mechanical systems are not rendered
    const baseColor = new Color(part ? part.color : colorForKind(node.kind));
    const material = part ? new HoloMaterial(baseColor, 0.62) : null;
    const mesh: Mesh<BufferGeometry, Material> = material && part ? new Mesh(partGeometry(part), material) : new Mesh(softwareGeometry(node), this.mats.hit);
    const batch = part ? null : (this.nodeBatches.get(batchKey(node.kind)) ?? null);
    const slot = batch ? batch.userData.next++ : -1;
    const collapsed = new Vector3(...placement.collapsed);
    const exploded = new Vector3(...placement.exploded);
    mesh.position.copy(collapsed);
    const entity = makeInteractive(this.world, mesh, this.rootEntity, {
      press: () => this.handlers.onNodePressed(node.id),
      hover: (on) => {
        const v = this.nodes.get(node.id);
        if (v) v.hovered = on;
      },
    });
    this.nodes.set(node.id, {
      node,
      mesh,
      material,
      batch,
      slot,
      halo: this.nodes.size,
      entity,
      collapsed,
      exploded,
      radius: placement.radius,
      baseColor,
      hovered: false,
      spinAxis: part?.spin_axis ?? null,
      spinSpeed: 0,
      label: null,
      labelText: '',
    });
  }

  private buildEdge(edge: GraphEdge): void {
    if (!this.nodes.has(edge.source_id) || !this.nodes.has(edge.target_id)) return;
    let plug: EdgeView['plug'] = null;
    if (edge.is_mutable_in_sandbox) {
      // The visible plug is about 2 cm; the ray target around it is a 5 cm sphere.
      const hit = new Mesh(this.plugHitGeo, this.mats.hit);
      const body = new Mesh(new BoxGeometry(0.022, 0.014, 0.014), new MeshStandardMaterial({ color: COLOR.action, emissive: COLOR.action, emissiveIntensity: 0.4 }));
      hit.add(body);
      const entity = makeInteractive(this.world, hit, this.rootEntity, { press: () => this.handlers.onPlugPressed(edge.id) });
      const label = new TextPanel({ width: 0.1, height: 0.022, pxPerMeter: 2400, background: 'rgba(12,18,30,0.8)', border: null, padding: 6, radius: 10, align: 'center' });
      label.draw([{ text: 'unplug', size: 34, color: '#3ccfcf', bold: true }]);
      label.mesh.position.set(0, 0.02, 0);
      hit.add(label.mesh);
      plug = { mesh: hit, body, entity, label, detached: null };
    }
    this.edges.set(edge.id, { edge, slot: this.edges.size, plug });
  }

  /** One instanced batch per software node shape (cluster, module, everything else). */
  private buildNodeBatches(nodes: readonly GraphNode[]): void {
    const counts = new Map<string, { count: number; sample: GraphNode }>();
    for (const n of nodes) {
      const entry = counts.get(batchKey(n.kind));
      if (entry) entry.count++;
      else counts.set(batchKey(n.kind), { count: 1, sample: n });
    }
    for (const [key, { count, sample }] of counts) {
      const cluster = key === 'cluster';
      // Clusters are see-through shells round their members; everything else is a solid-looking crystal.
      const material = new HoloMaterial(0xffffff, cluster ? 0.12 : 0.55);
      if (cluster) material.depthWrite = false;
      const batch = this.addBatch(softwareGeometry(sample), material, count);
      batch.userData.next = 0;
      this.nodeBatches.set(key, batch);
    }
  }

  /** An instanced mesh with every instance hidden (zero scale) and tinted white to start. */
  private addBatch(geometry: BufferGeometry, material: Material, count: number): InstancedMesh {
    const batch = new InstancedMesh(geometry, material, count);
    batch.frustumCulled = false; // instances move every frame; the bounds would be stale
    this.tmpM.makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) {
      batch.setMatrixAt(i, this.tmpM);
      batch.setColorAt(i, WHITE);
    }
    this.root.add(batch);
    return batch;
  }

  private edgeVisible(edge: GraphEdge, s: SceneState, f: number): boolean {
    if (f < 0.35) return false;
    if (this.isMechanical) return true;
    // Import edges are noise at overview scale; show them only for the selected module.
    if (edge.relation === 'imports') return s.selected_id === edge.source_id || s.selected_id === edge.target_id;
    return this.store.ctx.nodes.get(edge.source_id)?.kind !== 'cluster';
  }

  private updateEdges(s: SceneState, f: number, isolated: Set<string> | null): void {
    const { pathEdges, broken } = this;
    const batch = this.edgeBatch;
    if (!batch) return;
    let anyVisible = false;
    for (const ev of this.edges.values()) {
      const { edge } = ev;
      const a = this.nodes.get(edge.source_id)!.mesh.position;
      const b = this.nodes.get(edge.target_id)!.mesh.position;
      const isBroken = broken.has(edge.id);
      const visible = this.edgeVisible(edge, s, f) || (pathEdges.has(edge.id) && f > 0.2);
      if (visible) {
        anyVisible = true;
        const onPath = pathEdges.has(edge.id);
        const dim = isolated !== null && !(isolated.has(edge.source_id) && isolated.has(edge.target_id));
        const end = isBroken ? this.tmpC.lerpVectors(a, b, 0.4) : b;
        tubeMatrix(this.tmpM, a, end, onPath || isBroken ? 0.0028 : 0.0014, this.tmpA, this.tmpB, this.tmpS, this.tmpQ);
        batch.setColorAt(ev.slot, isBroken ? EDGE_BROKEN : onPath ? EDGE_PATH : dim ? EDGE_DIM : EDGE_COLOR);
        this.edgeFlow?.setX(ev.slot, onPath && !isBroken ? 1 : 0);
      } else {
        this.tmpM.makeScale(0, 0, 0); // hidden
      }
      batch.setMatrixAt(ev.slot, this.tmpM);
      if (ev.plug) {
        const pm = ev.plug.mesh;
        if (isBroken) {
          pm.visible = true;
          pm.position.lerp(this.tmpB.copy(TRAY).add(this.tmpA.set(0, 0.02, 0)), 0.15);
          if (ev.plug.detached !== true) ev.plug.label.draw([{ text: 'detached', size: 34, color: '#ff6b5b', bold: true }]);
          ev.plug.detached = true;
        } else {
          pm.visible = f > 0.6;
          pm.position.lerp(this.tmpB.lerpVectors(a, b, 0.5), 0.25);
          if (ev.plug.detached !== false) ev.plug.label.draw([{ text: 'unplug', size: 34, color: '#3ccfcf', bold: true }]);
          ev.plug.detached = false;
        }
      }
    }
    batch.visible = anyVisible; // no draw call while every edge is hidden
    batch.instanceMatrix.needsUpdate = true;
    if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
    if (this.edgeFlow) this.edgeFlow.needsUpdate = true;
    this.tray.visible = broken.size > 0 || f > 0.6;
  }

  private updateParticles(s: SceneState, f: number, path: FlowPath | undefined): void {
    const show = !!path && s.flow_animating && f > 0.3;
    const segs = show ? this.segs : [];
    for (let i = 0; i < PARTICLES; i++) {
      const halo = this.nodes.size + i;
      if (segs.length === 0) {
        this.tmpM.makeScale(0, 0, 0);
        this.halos.setMatrixAt(halo, this.tmpM);
      } else {
        const t = ((this.time * 0.35 + i / PARTICLES) % 1) * segs.length;
        const k = Math.min(Math.floor(t), segs.length - 1);
        const seg = segs[k]!;
        const at = this.tmpA.lerpVectors(seg[0], seg[1], t - k);
        this.halos.setMatrixAt(halo, this.tmpM.compose(at, IDENTITY, this.tmpS.setScalar(PARTICLE_HALO)));
        this.halos.setColorAt(halo, EDGE_PATH);
        this.tmpM.makeTranslation(at);
      }
      this.particles.setMatrixAt(i, this.tmpM);
    }
    this.particles.visible = segs.length > 0;
    this.particles.instanceMatrix.needsUpdate = true;
  }

  private updateSockets(s: SceneState, f: number): void {
    const brokenId = s.broken_edge_ids[0] ?? null;
    const lesson = s.lesson ? this.store.ctx.lessons.get(s.lesson.lesson_id) : undefined;
    let candidates: string[] = [];
    if (brokenId) {
      const edge = this.store.ctx.edges.get(brokenId)!;
      candidates = lesson?.break_edge_id === brokenId && lesson.repair_candidates.length ? lesson.repair_candidates : [edge.target_id];
    }
    const key = `${brokenId}|${candidates.join(',')}`;
    if (key !== this.socketKey) {
      this.disposeSockets();
      this.socketKey = key;
      if (brokenId) {
        for (const targetId of candidates) {
          const v = this.nodes.get(targetId);
          if (!v) continue;
          const ring = new Mesh(new TorusGeometry(Math.max(0.03, v.radius * 1.9), 0.004, 8, 32), this.mats.socket);
          const entity = makeInteractive(this.world, ring, this.rootEntity, { press: () => this.handlers.onSocketPressed(brokenId, targetId) });
          this.sockets.push({ mesh: ring, entity, edgeId: brokenId, targetId });
        }
      }
    }
    for (const sk of this.sockets) {
      const v = this.nodes.get(sk.targetId)!;
      sk.mesh.position.copy(v.mesh.position);
      sk.mesh.rotation.set(0, 0, 0);
      sk.mesh.scale.setScalar(1 + 0.08 * Math.sin(this.time * 5));
      sk.mesh.visible = f > 0.3;
    }
  }

  private updateLabels(s: SceneState, f: number, highlighted: Set<string>, affected: Set<string>): void {
    const shown = this.labelIds;
    // Hide every label first; the wanted ones are then placed in score order (labelIds is
    // sorted), each kept clear of the ones before it and of the plug tags.
    for (const v of this.nodes.values()) if (v.label && !shown.has(v.node.id)) v.label.mesh.visible = false;
    this.rectCount = 0;
    this.root.updateMatrixWorld();
    for (const e of this.edges.values()) {
      if (e.plug?.mesh.visible) this.claim(this.tmpC.copy(e.plug.mesh.position).add(this.tmpA.set(0, 0.02, 0)), PLUG_TAG_W, PLUG_TAG_H, true);
    }
    for (const id of shown) {
      const v = this.nodes.get(id);
      if (!v) continue;
      const want = f > 0.45 || v.node.id === s.selected_id;
      if (!want) {
        if (v.label) v.label.mesh.visible = false;
        continue;
      }
      if (!v.label) {
        v.label = new TextPanel({ width: 0.15, height: 0.03, pxPerMeter: 2400, background: 'rgba(12,18,30,0.78)', border: null, padding: 6, radius: 14, align: 'center' });
        this.root.add(v.label.mesh);
      }
      const status = affected.has(v.node.id) ? ' · stopped' : '';
      const text = `${v.node.label}${status}`;
      if (text !== v.labelText) {
        v.labelText = text;
        v.label.draw([{ text, size: 40, color: affected.has(v.node.id) ? '#ff6b5b' : highlighted.has(v.node.id) ? '#f2c14e' : '#f4f7fb', bold: v.node.kind !== 'function' }]);
      }
      const mesh = v.label.mesh;
      const lift = this.isMechanical ? 0.05 : v.radius * 1.4 + 0.016;
      let placed = false;
      for (let t = 0; t < LABEL_TRIES && !placed; t++) {
        mesh.position.copy(v.mesh.position).add(this.tmpA.set(0, lift + t * LABEL_STEP, 0));
        // The selected part's label always shows, at its first spot, whatever it overlaps.
        placed = this.claim(mesh.position, LABEL_W, LABEL_H, v.node.id === s.selected_id);
      }
      mesh.visible = placed;
      if (placed) mesh.lookAt(this.camPos); // billboard toward the viewer (lookAt takes world space)
    }
  }

  /**
   * Take the view-space rectangle of a w × h panel centred at `local` (root space), unless it
   * overlaps one already taken (then return false), or `force` is set. No allocation.
   */
  private claim(local: Vector3, w: number, h: number, force: boolean): boolean {
    const cam = this.camera;
    if (!cam || this.rectCount >= MAX_LABEL_RECTS) return true;
    const p = this.tmpB.copy(local).applyMatrix4(this.root.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
    const depth = -p.z;
    if (depth <= 0.01) return true; // behind the eye: nothing to compare
    const scale = this.root.matrixWorld.getMaxScaleOnAxis();
    const hw = (w * scale) / 2 / depth;
    const hh = (h * scale) / 2 / depth;
    const cx = p.x / depth;
    const cy = p.y / depth;
    const r = this.rects;
    if (!force) {
      for (let i = 0; i < this.rectCount * 4; i += 4) {
        if (cx - hw < r[i + 2]! && cx + hw > r[i]! && cy - hh < r[i + 3]! && cy + hh > r[i + 1]!) return false;
      }
    }
    const k = this.rectCount * 4;
    r[k] = cx - hw;
    r[k + 1] = cy - hh;
    r[k + 2] = cx + hw;
    r[k + 3] = cy + hh;
    this.rectCount++;
    return true;
  }
}

function labelScore(n: GraphNode, s: SceneState, hi: Set<string>, af: Set<string>, mech: boolean): number {
  if (n.id === s.selected_id) return 100;
  if (af.has(n.id)) return 90;
  if (hi.has(n.id)) return 80;
  if (mech) return 50 + n.importance;
  if (s.isolated_ids && !s.isolated_ids.includes(n.id)) return 0;
  if (n.kind === 'cluster') return 45 + n.importance; // the subsystems
  if (n.kind === 'route') return 40 + n.importance;
  if (n.kind === 'module') return 30 + n.importance;
  return n.importance > 0.6 ? 20 + n.importance : 0;
}

function colorForKind(kind: GraphNode['kind']): number {
  switch (kind) {
    case 'cluster':
      return COLOR.cluster;
    case 'module':
      return COLOR.module;
    case 'route':
      return COLOR.route;
    default:
      return COLOR.node;
  }
}

/** Software node shapes share three batches: clusters, modules, and everything else. */
function batchKey(kind: GraphNode['kind']): string {
  return kind === 'cluster' || kind === 'module' ? kind : 'leaf';
}

/** Matrix for a unit cylinder stretched from a to b with the given radius. */
function tubeMatrix(out: Matrix4, a: Vector3, b: Vector3, radius: number, dir: Vector3, mid: Vector3, scale: Vector3, q: Quaternion): Matrix4 {
  dir.subVectors(b, a);
  const len = dir.length();
  mid.copy(a).addScaledVector(dir, 0.5);
  if (len > 1e-6) q.setFromUnitVectors(UP, dir.multiplyScalar(1 / len));
  else q.identity();
  return out.compose(mid, q, scale.set(radius, Math.max(len, 1e-4), radius));
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
