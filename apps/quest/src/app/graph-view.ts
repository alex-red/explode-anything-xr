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
import { visibleAtDetail, type DetailLevel } from '@explode/lesson-engine';
import { makeInteractive } from './interactions.ts';
import { conduitMaterial, createDust, createStage, haloMaterial, HoloMaterial, nebulaMaterial, setReveal } from './holo.ts';
import { COLOR, GROUP_HUES } from './palette.ts';
import { partGeometry, softwareGeometry, softwareShape } from './shapes.ts';
import type { Store } from './store.ts';
import { TextPanel } from './text.ts';

export interface GraphHandlers {
  onNodePressed(id: string): void;
  onPlugPressed(edgeId: string): void;
  onSocketPressed(edgeId: string, targetId: string): void;
  /** The "+N hidden" shelf was pressed: show one detail level more. */
  onShelfPressed?(): void;
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
  /** 1 shown, 0 put away on the shelf at this detail level; eased between. */
  vis: number;
  /** Special shapes turn where they stand: the axis and rad/s, or null. */
  turnAxis: Vector3 | null;
  turnRate: number;
  /** This group's cloud in the nebula batch, or -1. */
  nebula: number;
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
/**
 * m above the model's centre: the caption panel's lower edge, less a margin (ui.ts). A label that
 * would rise past it goes under its part instead, so labels never lie across the caption.
 */
const LABEL_CEILING = 0.225;
/** Plug tags ("unplug") are 10 × 2.2 cm; labels keep clear of them too. */
const PLUG_TAG_W = 0.1;
const PLUG_TAG_H = 0.022;
const MAX_LABEL_RECTS = 64;
const PARTICLES = 8;
/**
 * Where parts hidden by the detail level go (EXPLORE_PLAN W11): a small shelf on the stage's
 * front-left rim, labelled with how many are there. Pressing it shows one level more.
 */
const SHELF = new Vector3(-0.15, -0.18, 0.12);
const SHELF_W = 0.13;
const SHELF_H = 0.03;
/** 1/s: how fast parts fly to and from the shelf. */
const SHELF_EASE = 6;
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
// How far a software connection arcs out of the straight line, as a fraction of its length
// (the conduit shader and arcPoint share it).
const EDGE_ARC = 0.08;
// Connections rest dim, so sixty of them read as a web, not a tangle; the ones touching the part
// you point at or select light up in its group's colour.
const EDGE_REST = 0.5;
// Metres across: the cloud behind each group when the model is open.
const NEBULA_SIZE = 0.26;
const NEBULA_GLOW = 0.42;
// Radians: how far parts wheel round the vertical axis in mid-flight when the model opens or closes.
const SWIRL = 0.9;
// Seconds for the stage's shockwave to reach the rim.
const BURST_SECONDS = 0.9;
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const AXIS_TUMBLE = new Vector3(0.45, 0.8, 0.4).normalize();
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
  private readonly dust: ReturnType<typeof createDust>;
  /** Clouds behind the groups of a software system (one draw call); null on a mechanical model. */
  private nebulae: InstancedMesh | null = null;
  /** 0 → 1 while the stage's shockwave runs; above 1 when idle. */
  private burst = 2;
  private wasOpen = false;
  /** 0 → 1 while the model materialises from its stage. */
  private boot = 0;
  private tray: Group;
  private hasPlugs = false;
  private trayLabel: TextPanel;
  private readonly isMechanical: boolean;
  // Twelve rings along its length, so the conduit shader can bend it into an arc.
  private readonly edgeGeo = new CylinderGeometry(1, 1, 1, 6, 12, true);
  private readonly plugHitGeo = new SphereGeometry(PLUG_HIT_RADIUS, 10, 8);
  private readonly mats = {
    edge: conduitMaterial(), // tinted per instance; replaced by an arced one on software systems
    nebula: nebulaMaterial(),
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
  /** Group index of every software node (see assignGroups). Empty on a mechanical model. */
  private groupOf = new Map<string, number>();
  /** Parts shown at the current detail level (software only; every part on a mechanical model). */
  private shown = new Set<string>();
  private hiddenCount = 0;
  private detailLevel: DetailLevel = 'supporting';
  private readonly shelf: TextPanel;
  private readonly shelfEntity: Entity;
  private shelfCount = -1;

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

    if (!this.isMechanical) {
      this.buildNodeBatches(bundle.graph.nodes);
      this.assignGroups(bundle.graph.nodes);
      this.mats.edge.dispose();
      this.mats.edge = conduitMaterial(EDGE_ARC);
    }
    for (const node of bundle.graph.nodes) this.buildNode(node);
    if (this.groupOf.size > 0) {
      const groups = new Set(this.groupOf.values()).size;
      this.nebulae = this.addBatch(this.haloGeo, this.mats.nebula, groups);
      this.nebulae.renderOrder = -1; // behind the parts it surrounds
    }
    for (const edge of bundle.graph.edges) this.buildEdge(edge);
    for (const e of this.edges.values()) this.hasPlugs ||= e.plug !== null;
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
    this.dust = createDust(STAGE_RADIUS * 0.95, 0.42);
    this.dust.points.position.y = STAGE_Y;
    this.root.add(this.dust.points);

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

    this.shelf = new TextPanel({ width: SHELF_W, height: SHELF_H, pxPerMeter: 2400, background: 'rgba(12,18,30,0.85)', border: null, padding: 6, radius: 14, align: 'center' });
    this.shelf.mesh.position.copy(SHELF);
    this.shelf.mesh.rotation.x = -0.35;
    this.shelf.mesh.visible = false;
    this.shelf.mesh.scale.setScalar(1e-4); // rays hit invisible objects: shrunk until it has something to say
    this.shelfEntity = makeInteractive(this.world, this.shelf.mesh, this.rootEntity, {
      press: () => {
        if (this.shelf.mesh.visible) this.handlers.onShelfPressed?.();
      },
      ui: true,
    });
  }

  /** How much of a software graph is shown: key parts, plus supporting parts, or everything. */
  get detail(): DetailLevel {
    return this.detailLevel;
  }

  set detail(level: DetailLevel) {
    if (level === this.detailLevel) return;
    this.detailLevel = level;
    this.derivedFor = null; // re-derive what is shown on the next frame
  }

  /** Parts put away at this detail level (0 on a mechanical model). */
  get hiddenParts(): number {
    return this.hiddenCount;
  }

  /** Whether a part is shown at the current detail level (always, on a mechanical model). */
  isShown(id: string): boolean {
    return this.isMechanical || this.shown.has(id);
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
    // Opening and closing: parts wheel round the vertical axis in mid-flight (nothing at either
    // end, so the layout the cone and target checks were made for is untouched), and the stage
    // throws a shockwave when the model opens.
    const swirl = this.isMechanical ? 0 : SWIRL * 4 * f * (1 - f);
    const swirlCos = Math.cos(swirl);
    const swirlSin = Math.sin(swirl);
    const open = target > 0.5;
    if (open && !this.wasOpen && this.boot >= 1) this.burst = 0;
    this.wasOpen = open;
    if (this.burst <= 1) {
      this.burst += dt / BURST_SECONDS;
      this.stage.burst(this.burst);
    }

    const activePath = s.active_path_id ? this.store.ctx.paths.get(s.active_path_id) : undefined;
    if (s !== this.derivedFor || this.revealConsequences !== this.derivedReveal) this.derive(s, activePath);
    const { highlighted, affected, isolated } = this;

    // Nodes
    const visStep = Math.min(1, dt * SHELF_EASE);
    for (const v of this.nodes.values()) {
      const p = v.mesh.position.lerpVectors(v.collapsed, v.exploded, f);
      if (swirl !== 0) {
        const x = p.x;
        p.x = x * swirlCos + p.z * swirlSin;
        p.z = p.z * swirlCos - x * swirlSin;
      }
      // Parts the detail level puts away fly to the shelf as the model opens; closed, the model is
      // whole. `e` is how present the part is now.
      const shown = this.isMechanical || this.shown.has(v.node.id);
      v.vis += ((shown ? 1 : 0) - v.vis) * visStep;
      if (Math.abs((shown ? 1 : 0) - v.vis) < 0.001) v.vis = shown ? 1 : 0;
      const e = 1 - (1 - v.vis) * f;
      if (e < 1) p.lerpVectors(SHELF, this.tmpA.copy(p), e);
      const dimmed = isolated !== null && !isolated.has(v.node.id);
      const selected = s.selected_id === v.node.id;
      let scale = v.radius * (selected ? 1.3 : v.hovered ? 1.15 : 1) * (dimmed ? 0.6 : 1) * e;
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
        // A part put away takes no ray hits at all: rays hit invisible objects, so it shrinks.
        v.mesh.scale.setScalar(!shown && f > 0.05 ? 1e-4 : v.node.kind === 'cluster' ? Math.max(scale, 1e-4) : Math.max(v.radius, MIN_HIT_RADIUS));
        v.mesh.visible = shown || f <= 0.05;
        const c = this.tmpColor;
        if (affected.has(v.node.id)) c.copy(NODE_FAULT).multiplyScalar(0.8 + 0.2 * Math.sin(this.time * 4));
        else if (highlighted.has(v.node.id)) c.copy(NODE_PATH);
        else if (dimmed) c.copy(NODE_DIM);
        else c.copy(v.baseColor).lerp(WHITE, selected ? 0.45 : v.hovered ? 0.2 : 0);
        const q = v.turnAxis ? this.tmpQ.setFromAxisAngle(v.turnAxis, this.time * v.turnRate) : IDENTITY;
        v.batch.setMatrixAt(v.slot, this.tmpM.compose(p, q, this.tmpS.setScalar(scale)));
        v.batch.setColorAt(v.slot, c);
        if (v.nebula >= 0 && this.nebulae) {
          // The group's cloud swells as the model opens, and stands back when another group is isolated.
          const size = NEBULA_SIZE * f * e;
          this.nebulae.setMatrixAt(v.nebula, size > 0.001 ? this.tmpM.compose(p, IDENTITY, this.tmpS.setScalar(size)) : this.tmpM.makeScale(0, 0, 0));
          this.nebulae.setColorAt(v.nebula, this.tmpColor.copy(v.baseColor).multiplyScalar(NEBULA_GLOW * glowIn * (dimmed ? 0.25 : 1)));
        }
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
      strength *= e;
      const drawn = m ? v.radius : scale;
      this.halos.setMatrixAt(v.halo, strength > 0.001 ? this.tmpM.compose(p, IDENTITY, this.tmpS.setScalar(drawn * HALO_SIZE)) : this.tmpM.makeScale(0, 0, 0));
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
    this.updateShelf(f);
    this.halos.instanceMatrix.needsUpdate = true;
    if (this.halos.instanceColor) this.halos.instanceColor.needsUpdate = true;
    if (this.nebulae) {
      this.nebulae.visible = f > 0.02; // no draw call while the model is closed
      this.nebulae.instanceMatrix.needsUpdate = true;
      if (this.nebulae.instanceColor) this.nebulae.instanceColor.needsUpdate = true;
    }
  }

  private derive(s: SceneState, path: FlowPath | undefined): void {
    this.derivedFor = s;
    this.derivedReveal = this.revealConsequences;
    this.highlighted = new Set(s.highlighted_ids);
    this.affected = new Set(this.revealConsequences ? s.consequences.flatMap((c) => c.affected_ids) : []);
    this.isolated = s.isolated_ids ? new Set(s.isolated_ids) : null;
    this.pathEdges = new Set(path?.edge_ids ?? []);
    this.broken = new Set(s.broken_edge_ids);
    if (!this.isMechanical) {
      this.shown = visibleAtDetail(this.store.ctx, s, this.detailLevel, this.revealConsequences);
      let hidden = 0;
      for (const id of this.nodes.keys()) if (!this.shown.has(id)) hidden++;
      this.hiddenCount = hidden;
    }
    const shown = this.shown;
    this.labelIds = new Set(
      [...this.nodes.values()]
        .map((v) => ({ id: v.node.id, score: this.isMechanical || shown.has(v.node.id) ? labelScore(v.node, s, this.highlighted, this.affected, this.isMechanical) : 0 }))
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
    this.nebulae?.dispose();
    this.haloGeo.dispose();
    this.stage.dispose();
    this.dust.dispose();
    setReveal(null);
    this.plugHitGeo.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.disposeSockets();
    this.trayLabel.dispose();
    this.shelf.dispose();
    this.shelfEntity.dispose({ disposeResources: false });
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
    const baseColor = new Color(part ? part.color : this.softwareColor(node));
    const material = part ? new HoloMaterial(baseColor, 0.62) : null;
    // The ray target of a software node is always a plain round volume, whatever shape is drawn:
    // a knot or a gear has gaps a ray could slip through.
    const mesh: Mesh<BufferGeometry, Material> = material && part ? new Mesh(partGeometry(part), material) : new Mesh(softwareGeometry({ kind: node.kind }), this.mats.hit);
    const shape = softwareShape(node);
    const batch = part ? null : (this.nodeBatches.get(shape) ?? null);
    const group = this.groupOf.get(node.id);
    const slot = batch ? batch.userData.next++ : -1;
    const collapsed = new Vector3(...placement.collapsed);
    const exploded = new Vector3(...placement.exploded);
    mesh.position.copy(collapsed);
    const entity = makeInteractive(this.world, mesh, this.rootEntity, {
      press: () => {
        if (this.isShown(node.id)) this.handlers.onNodePressed(node.id);
      },
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
      vis: 1,
      // An engine turns like the gear it is; an entry knot and a hub star turn slowly, so their
      // shape reads from every side. Each starts at its own angle (the rate differs a little).
      turnAxis: part ? null : shape === 'engine' ? AXIS_Z : shape === 'entry' ? AXIS_Y : shape === 'hub' ? AXIS_TUMBLE : null,
      turnRate: (shape === 'engine' ? 1.1 : 0.45) * (0.8 + 0.4 * ((this.nodes.size * 0.618) % 1)),
      nebula: !part && node.parent_id === null && group !== undefined ? group : -1,
    });
  }

  /**
   * Give every top-level group of a software system an index, in reading order of the open layout
   * (rows from the top, left to right), and every part the index of the group it sits in.
   */
  private assignGroups(nodes: readonly GraphNode[]): void {
    const placements = this.store.ctx.bundle.layout.placements;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const roots = nodes
      .filter((n) => n.parent_id === null && placements[n.id])
      .sort((a, b) => {
        const pa = placements[a.id]!.exploded;
        const pb = placements[b.id]!.exploded;
        return pb[1] - pa[1] || pa[0] - pb[0] || (a.id < b.id ? -1 : 1);
      });
    const index = new Map(roots.map((n, i) => [n.id, i]));
    for (const n of nodes) {
      let cur: GraphNode | undefined = n;
      while (cur && cur.parent_id !== null) cur = byId.get(cur.parent_id);
      const i = cur ? index.get(cur.id) : undefined;
      if (i !== undefined) this.groupOf.set(n.id, i);
    }
  }

  /** A software node's resting colour: its group's hue, paler the deeper it sits; routes stay violet. */
  private softwareColor(node: GraphNode): number | Color {
    const group = this.groupOf.get(node.id);
    if (group === undefined || node.kind === 'route') return colorForKind(node.kind);
    const hue = new Color(GROUP_HUES[group % GROUP_HUES.length]);
    return node.parent_id === null ? hue : hue.lerp(WHITE, node.kind === 'module' ? 0.1 : 0.18);
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

  /** One instanced batch per software node shape (shapes.ts softwareShape): groups, modules, leaves and each special role. */
  private buildNodeBatches(nodes: readonly GraphNode[]): void {
    const counts = new Map<string, { count: number; sample: GraphNode }>();
    for (const n of nodes) {
      const entry = counts.get(softwareShape(n));
      if (entry) entry.count++;
      else counts.set(softwareShape(n), { count: 1, sample: n });
    }
    for (const [key, { count, sample }] of counts) {
      const cluster = key === 'cluster' || key === 'concept';
      // Clusters are see-through shells round their members; everything else is a solid-looking crystal.
      const material = new HoloMaterial(0xffffff, key === 'concept' ? 0.3 : cluster ? 0.12 : 0.55);
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
      const ends = this.isShown(edge.source_id) && this.isShown(edge.target_id);
      const visible = ends && (this.edgeVisible(edge, s, f) || (pathEdges.has(edge.id) && f > 0.2));
      if (visible) {
        anyVisible = true;
        const onPath = pathEdges.has(edge.id);
        const dim = isolated !== null && !(isolated.has(edge.source_id) && isolated.has(edge.target_id));
        const end = isBroken ? this.tmpC.lerpVectors(a, b, 0.4) : b;
        // On a software system a connection rests dim and lights up, in its source's colour, when
        // either end is pointed at or selected.
        const source = this.nodes.get(edge.source_id)!;
        const live = !this.isMechanical && (source.hovered || this.nodes.get(edge.target_id)!.hovered || s.selected_id === edge.source_id || s.selected_id === edge.target_id);
        tubeMatrix(this.tmpM, a, end, onPath || isBroken ? 0.0028 : live ? 0.0022 : this.isMechanical ? 0.0014 : 0.001, this.tmpA, this.tmpB, this.tmpS, this.tmpQ);
        const rest = this.isMechanical ? EDGE_COLOR : this.tmpColor.copy(source.baseColor).multiplyScalar(live ? 1.1 : EDGE_REST);
        batch.setColorAt(ev.slot, isBroken ? EDGE_BROKEN : onPath ? EDGE_PATH : dim ? EDGE_DIM : rest);
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
          pm.scale.setScalar(1);
        } else {
          pm.visible = f > 0.6 && ends;
          pm.scale.setScalar(ends ? 1 : 1e-4); // a plug between parts put away takes no ray hits
          pm.position.lerp(this.isMechanical ? this.tmpB.lerpVectors(a, b, 0.5) : arcPoint(this.tmpB, a, b, 0.5, EDGE_ARC), 0.25);
          if (ev.plug.detached !== false) ev.plug.label.draw([{ text: 'unplug', size: 34, color: '#3ccfcf', bold: true }]);
          ev.plug.detached = false;
        }
      }
    }
    batch.visible = anyVisible; // no draw call while every edge is hidden
    batch.instanceMatrix.needsUpdate = true;
    if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
    if (this.edgeFlow) this.edgeFlow.needsUpdate = true;
    // The tray is where unplugged connections wait; a system with nothing to unplug has none.
    this.tray.visible = broken.size > 0 || (f > 0.6 && this.hasPlugs);
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
        const at = this.isMechanical ? this.tmpA.lerpVectors(seg[0], seg[1], t - k) : arcPoint(this.tmpA, seg[0], seg[1], t - k, EDGE_ARC);
        this.halos.setMatrixAt(halo, this.tmpM.compose(at, IDENTITY, this.tmpS.setScalar(PARTICLE_HALO)));
        this.halos.setColorAt(halo, EDGE_PATH);
        this.tmpM.makeTranslation(at);
      }
      this.particles.setMatrixAt(i, this.tmpM);
    }
    this.particles.visible = segs.length > 0;
    this.particles.instanceMatrix.needsUpdate = true;
  }

  /** The "+N hidden" shelf: shown on an open software model while the detail level hides parts. */
  private updateShelf(f: number): void {
    const count = this.isMechanical ? 0 : this.hiddenCount;
    const on = count > 0 && f > 0.6;
    this.shelf.mesh.visible = on;
    this.shelf.mesh.scale.setScalar(on ? 1 : 1e-4);
    if (on && count !== this.shelfCount) {
      this.shelfCount = count;
      this.shelf.draw([{ text: `+${count} hidden · Show`, size: 34, color: '#3ccfcf', bold: true }]);
    }
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
      // A group the curation step chose is a hypothesis, and says so with the truth badge's glyph.
      const text = `${v.node.truth_status === 'inferred' ? '◌ ' : ''}${v.node.label}${status}`;
      // Redrawn when the words or the colour change: a label that stops being highlighted must
      // lose its gold even though it still says the same thing.
      const color = affected.has(v.node.id) ? '#ff6b5b' : highlighted.has(v.node.id) ? '#f2c14e' : '#f4f7fb';
      const drawn = `${color}${text}`;
      if (drawn !== v.labelText) {
        v.labelText = drawn;
        v.label.draw([{ text, size: 40, color, bold: v.node.kind !== 'function' }]);
      }
      const mesh = v.label.mesh;
      const lift = this.isMechanical ? 0.05 : v.radius * 1.4 + 0.016;
      let placed = false;
      // Above its part, stepping up out of the way of other labels for as long as that stays
      // under the caption panel; after that, under the part, stepping down.
      let below = 0;
      for (let t = 0; t < LABEL_TRIES && !placed; t++) {
        const up = lift + t * LABEL_STEP;
        const fits = v.mesh.position.y + up + LABEL_H / 2 <= LABEL_CEILING;
        mesh.position.copy(v.mesh.position).add(this.tmpA.set(0, fits ? up : -(lift + below++ * LABEL_STEP), 0));
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

/**
 * A point on a software connection's arc, `t` of the way from a to b: the straight-line point
 * pushed sideways by a half sine, exactly as the conduit shader bends the tube (holo.ts).
 */
function arcPoint(out: Vector3, a: Vector3, b: Vector3, t: number, arc: number): Vector3 {
  const mx = a.x + b.x; // twice the midpoint, as the shader's `mid.xy * 2.0`
  const my = a.y + b.y;
  const inv = 1 / Math.hypot(mx, my, 0.35);
  const k = arc * Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * Math.sin(Math.PI * t);
  out.lerpVectors(a, b, t);
  out.x += mx * inv * k;
  out.y += my * inv * k;
  out.z += 0.35 * inv * k;
  return out;
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
