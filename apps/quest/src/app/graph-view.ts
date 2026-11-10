import {
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  BoxGeometry,
  Vector3,
  type Camera,
  type Entity,
  type World,
} from '@iwsdk/core';
import type { FlowPath, GraphEdge, GraphNode, SceneState } from '@explode/contracts';
import { makeInteractive } from './interactions.ts';
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
  mesh: Mesh<any, MeshStandardMaterial>;
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
  mesh: Mesh<CylinderGeometry, MeshBasicMaterial>;
  plug: { mesh: Mesh<BoxGeometry, MeshStandardMaterial>; entity: Entity; label: TextPanel; detached: boolean | null } | null;
}

const UP = new Vector3(0, 1, 0);
const TRAY = new Vector3(0.3, -0.17, 0.1);
const MAX_LABELS = 30;
const PARTICLES = 8;

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
  private particles: Mesh<SphereGeometry, MeshBasicMaterial>[] = [];
  private tray: Group;
  private trayLabel: TextPanel;
  private readonly isMechanical: boolean;
  private readonly edgeGeo = new CylinderGeometry(1, 1, 1, 6, 1, true);
  private readonly mats = {
    edge: new MeshBasicMaterial({ color: COLOR.edge, transparent: true, opacity: 0.55 }),
    edgePath: new MeshBasicMaterial({ color: COLOR.path }),
    edgeBroken: new MeshBasicMaterial({ color: COLOR.fault }),
    edgeDim: new MeshBasicMaterial({ color: COLOR.dim, transparent: true, opacity: 0.25 }),
    particle: new MeshBasicMaterial({ color: COLOR.path }),
    socket: new MeshBasicMaterial({ color: COLOR.action, transparent: true, opacity: 0.9 }),
  };
  private tmpA = new Vector3();
  private tmpB = new Vector3();
  private tmpC = new Vector3();
  private tmpQ = new Quaternion();
  private camPos = new Vector3();
  private time = 0;
  // Derived from state; recomputed only when the state object or reveal flag changes (no per-frame allocation).
  private derivedFor: SceneState | null = null;
  private derivedReveal = true;
  private highlighted = new Set<string>();
  private affected = new Set<string>();
  private isolated: Set<string> | null = null;
  private labelIds = new Set<string>();
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

    for (const node of bundle.graph.nodes) this.buildNode(node);
    for (const edge of bundle.graph.edges) this.buildEdge(edge);

    const pGeo = new SphereGeometry(0.006, 8, 6);
    for (let i = 0; i < PARTICLES; i++) {
      const p = new Mesh(pGeo, this.mats.particle);
      p.visible = false;
      this.root.add(p);
      this.particles.push(p);
    }

    this.tray = new Group();
    const plate = new Mesh(new BoxGeometry(0.16, 0.006, 0.09), new MeshStandardMaterial({ color: 0x22303f, roughness: 0.8 }));
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
      if (this.isMechanical) v.mesh.scale.setScalar(selected ? 1.12 : v.hovered ? 1.06 : 1);
      else v.mesh.scale.setScalar(scale);

      const m = v.mesh.material;
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

      if (v.spinAxis) {
        const live = !affected.has(v.node.id);
        const want = live ? 5 : 0;
        v.spinSpeed += (want - v.spinSpeed) * Math.min(1, dt * 2);
        v.mesh.rotation[v.spinAxis] += v.spinSpeed * dt;
      }
    }

    this.updateLabels(s, f, highlighted, affected);
    this.updateEdges(s, f, isolated, activePath);
    this.updateParticles(s, f, activePath);
    this.updateSockets(s, f);
  }

  private derive(s: SceneState, path: FlowPath | undefined): void {
    this.derivedFor = s;
    this.derivedReveal = this.revealConsequences;
    this.highlighted = new Set(s.highlighted_ids);
    this.affected = new Set(this.revealConsequences ? s.consequences.flatMap((c) => c.affected_ids) : []);
    this.isolated = s.isolated_ids ? new Set(s.isolated_ids) : null;
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
      // Software node geometry is shared across views (shapes.ts); keep it, dispose the material.
      if (!this.isMechanical) v.mesh.material.dispose();
      v.entity.dispose({ disposeResources: this.isMechanical });
    }
    for (const e of this.edges.values()) {
      if (e.plug) {
        e.plug.label.dispose();
        e.plug.entity.dispose();
      }
    }
    this.disposeSockets();
    this.trayLabel.dispose();
    this.rootEntity.dispose();
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
    const material = new MeshStandardMaterial({
      color: baseColor,
      roughness: part ? 0.45 : 0.35,
      metalness: part ? 0.35 : 0.1,
      flatShading: !part,
      transparent: !part && node.kind === 'cluster',
      opacity: !part && node.kind === 'cluster' ? 0.35 : 1,
    });
    const mesh = new Mesh(part ? partGeometry(part) : softwareGeometry(node), material);
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
    const mesh = new Mesh(this.edgeGeo, this.mats.edge);
    mesh.visible = false;
    this.root.add(mesh);
    let plug: EdgeView['plug'] = null;
    if (edge.is_mutable_in_sandbox) {
      const pm = new Mesh(new BoxGeometry(0.022, 0.014, 0.014), new MeshStandardMaterial({ color: COLOR.action, emissive: COLOR.action, emissiveIntensity: 0.4 }));
      const entity = makeInteractive(this.world, pm, this.rootEntity, { press: () => this.handlers.onPlugPressed(edge.id) });
      const label = new TextPanel({ width: 0.1, height: 0.022, pxPerMeter: 2400, background: 'rgba(12,18,30,0.8)', border: null, padding: 6, radius: 10, align: 'center' });
      label.draw([{ text: 'unplug', size: 34, color: '#3ccfcf', bold: true }]);
      label.mesh.position.set(0, 0.02, 0);
      pm.add(label.mesh);
      plug = { mesh: pm, entity, label, detached: null };
    }
    this.edges.set(edge.id, { edge, mesh, plug });
  }

  private edgeVisible(edge: GraphEdge, s: SceneState, f: number): boolean {
    if (f < 0.35) return false;
    if (this.isMechanical) return true;
    // Import edges are noise at overview scale; show them only for the selected module.
    if (edge.relation === 'imports') return s.selected_id === edge.source_id || s.selected_id === edge.target_id;
    return this.store.ctx.nodes.get(edge.source_id)?.kind !== 'cluster';
  }

  private updateEdges(s: SceneState, f: number, isolated: Set<string> | null, path: FlowPath | undefined): void {
    const pathEdges = new Set(path?.edge_ids ?? []);
    const broken = new Set(s.broken_edge_ids);
    for (const ev of this.edges.values()) {
      const { edge, mesh } = ev;
      const a = this.nodes.get(edge.source_id)!.mesh.position;
      const b = this.nodes.get(edge.target_id)!.mesh.position;
      const isBroken = broken.has(edge.id);
      const visible = this.edgeVisible(edge, s, f) || (pathEdges.has(edge.id) && f > 0.2);
      mesh.visible = visible;
      if (visible) {
        const onPath = pathEdges.has(edge.id);
        const dim = isolated !== null && !(isolated.has(edge.source_id) && isolated.has(edge.target_id));
        const end = isBroken ? this.tmpC.lerpVectors(a, b, 0.4) : b;
        placeCylinder(mesh, a, end, onPath || isBroken ? 0.0028 : 0.0014, this.tmpA, this.tmpQ);
        mesh.material = isBroken ? this.mats.edgeBroken : onPath ? this.mats.edgePath : dim ? this.mats.edgeDim : this.mats.edge;
      }
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
    this.tray.visible = broken.size > 0 || f > 0.6;
  }

  private updateParticles(s: SceneState, f: number, path: FlowPath | undefined): void {
    const show = !!path && s.flow_animating && f > 0.3;
    const segs = show ? this.segs : [];
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      if (segs.length === 0) {
        p.visible = false;
        continue;
      }
      const t = ((this.time * 0.35 + i / this.particles.length) % 1) * segs.length;
      const k = Math.min(Math.floor(t), segs.length - 1);
      const [a, b] = segs[k]!;
      p.position.lerpVectors(a, b, t - k);
      p.visible = true;
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
    for (const v of this.nodes.values()) {
      const want = shown.has(v.node.id) && (f > 0.45 || v.node.id === s.selected_id);
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
      mesh.visible = true;
      const lift = this.isMechanical ? 0.05 : v.radius * 1.4 + 0.016;
      mesh.position.copy(v.mesh.position).add(this.tmpA.set(0, lift, 0));
      mesh.lookAt(this.camPos); // billboard toward the viewer (lookAt takes world space)
    }
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

function placeCylinder(mesh: Mesh, a: Vector3, b: Vector3, radius: number, tmp: Vector3, q: Quaternion): void {
  const dir = tmp.subVectors(b, a);
  const len = dir.length();
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  if (len > 1e-6) mesh.quaternion.copy(q.setFromUnitVectors(UP, dir.multiplyScalar(1 / len)));
  mesh.scale.set(radius, Math.max(len, 1e-4), radius);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
