import type { Layout, NodePlacement, SystemGraph, Vec3 } from '@explode/contracts';

/** Glasses-safe angular budget and anchor distance (ADR-0014). */
export const CONE_DEG = { horizontal: 60, vertical: 50 } as const;
export const ANCHOR_DISTANCE = 0.65;
export const BOUNDS = { x: 0.33, y: 0.28, collapsedRadius: 0.12 } as const;

const RING_RADIUS = [0, 0.06, 0.03, 0.016]; // by depth below a cluster
const COLUMNS: number = 4;
const COLUMN_SPAN = 0.22;
const ROW_SPAN = 0.12;
const ARC_DEPTH = 0.08;

/**
 * Smallest ray target radius the app gives a part (apps/quest graph-view MIN_HIT_RADIUS): every
 * part is at least 4 cm across to a ray. The app's hit sphere is max(drawn radius, this).
 */
export const MIN_HIT_RADIUS = 0.02;
/** m of clear space kept between the hit spheres of any two parts in the exploded layout. */
export const TARGET_GAP = 0.004;
const SPREAD_ITERATIONS = 300;
/** m kept inside the cone edge, so rounding never puts a spread part just outside it. */
const CONE_MARGIN = 0.002;
/**
 * Where the app puts the eyes relative to a floating model (apps/quest app.ts ANCHOR_DISTANCE
 * and ANCHOR_DROP): 0.7 m away and 0.14 m above its centre. Spreading keeps every part inside
 * the cone as seen from there too, since a part nearer the viewer subtends a steeper angle.
 */
const VIEW = { distance: 0.7, drop: 0.14 } as const;
/** Exploded clusters are drawn at a quarter of their radius (graph-view), so they need less room. */
const CLUSTER_EXPLODED_SCALE = 0.25;

/** The radius a ray can hit in the exploded layout (mirrors graph-view). */
export function hitRadius(kind: string, radius: number): number {
  return kind === 'cluster' ? radius * CLUSTER_EXPLODED_SCALE : Math.max(radius, MIN_HIT_RADIUS);
}

export function radiusFor(importance: number): number {
  return round(0.012 + 0.023 * Math.min(1, Math.max(0, importance)));
}

/**
 * Deterministic precomputed layout for a software graph.
 * Exploded: top-level clusters on a shallow arc (2 rows), children in rings around their parent.
 * Collapsed: every node packed inside a small sphere (volume-uniform Fibonacci spiral).
 */
export function layoutSoftware(graph: SystemGraph, clusterOrder: readonly string[] = []): Layout {
  const children = new Map<string | null, string[]>();
  for (const n of graph.nodes) {
    const list = children.get(n.parent_id) ?? [];
    list.push(n.id);
    children.set(n.parent_id, list);
  }
  for (const list of children.values()) list.sort();

  const roots = [...(children.get(null) ?? [])].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
  function rank(id: string) {
    const i = clusterOrder.indexOf(id);
    return i === -1 ? clusterOrder.length : i;
  }

  const exploded = new Map<string, Vec3>();
  const rows = Math.max(1, Math.ceil(roots.length / COLUMNS));
  roots.forEach((id, i) => {
    const col = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);
    const x = COLUMNS === 1 ? 0 : -COLUMN_SPAN + (2 * COLUMN_SPAN * col) / (COLUMNS - 1);
    const y = rows === 1 ? 0 : ROW_SPAN - (2 * ROW_SPAN * row) / (rows - 1);
    const z = ARC_DEPTH * (x / COLUMN_SPAN) ** 2;
    exploded.set(id, [x, y, z]);
    placeChildren(id, 1);
  });

  function placeChildren(parentId: string, depth: number) {
    const kids = children.get(parentId) ?? [];
    const [px, py, pz] = exploded.get(parentId)!;
    const r = RING_RADIUS[Math.min(depth, RING_RADIUS.length - 1)]!;
    kids.forEach((kid, i) => {
      const angle = Math.PI / 2 + (2 * Math.PI * i) / kids.length;
      const rr = kids.length === 1 ? r * 0.6 : r;
      exploded.set(kid, [px + rr * Math.cos(angle), py + rr * 0.8 * Math.sin(angle), pz + 0.012 * depth]);
      placeChildren(kid, depth + 1);
    });
  }

  const depthOf = (id: string): number => {
    let d = 0;
    let cur = graph.nodes.find((n) => n.id === id)?.parent_id ?? null;
    while (cur) {
      d++;
      cur = graph.nodes.find((n) => n.id === cur)?.parent_id ?? null;
    }
    return d;
  };
  const packed = [...graph.nodes].sort((a, b) => depthOf(b.id) - depthOf(a.id) || (a.id < b.id ? -1 : 1));
  const collapsed = new Map<string, Vec3>();
  const golden = Math.PI * (3 - Math.sqrt(5));
  packed.forEach((n, i) => {
    const N = packed.length;
    const y = 1 - (2 * (i + 0.5)) / N;
    const ring = Math.sqrt(1 - y * y);
    const theta = golden * i;
    const r = 0.1 * Math.cbrt((i + 0.5) / N);
    collapsed.set(n.id, [r * ring * Math.cos(theta), r * y, r * ring * Math.sin(theta)]);
  });

  const sorted = [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : 1));
  const spread = spreadApart(
    sorted.map((n) => ({ at: clampExploded(exploded.get(n.id) ?? [0, 0, 0]), reach: hitRadius(n.kind, radiusFor(n.importance)) })),
  );
  const placements: Record<string, NodePlacement> = {};
  sorted.forEach((n, i) => {
    placements[n.id] = {
      collapsed: vec(collapsed.get(n.id)!),
      exploded: vec(spread[i]!),
      radius: radiusFor(n.importance),
    };
  });
  return { system_id: graph.system_id, anchor_distance: ANCHOR_DISTANCE, cone_deg: { ...CONE_DEG }, placements };
}

/** Problems with a layout's bounds; empty when it fits the cone and the collapsed sphere. */
export function layoutProblems(layout: Layout): string[] {
  const out: string[] = [];
  for (const [id, p] of Object.entries(layout.placements)) {
    const [x, y] = p.exploded;
    if (Math.abs(x) > BOUNDS.x + 1e-9) out.push(`${id} exploded x ${x} outside ±${BOUNDS.x}`);
    if (Math.abs(y) > BOUNDS.y + 1e-9) out.push(`${id} exploded y ${y} outside ±${BOUNDS.y}`);
    if (Math.hypot(...p.collapsed) > BOUNDS.collapsedRadius + 1e-9) out.push(`${id} collapsed outside ${BOUNDS.collapsedRadius} m sphere`);
    if (p.radius < 0.012 - 1e-9 || p.radius > 0.035 + 1e-9) out.push(`${id} radius ${p.radius} outside 0.012–0.035`);
  }
  const halfH = (layout.cone_deg.horizontal / 2) * (Math.PI / 180);
  const halfV = (layout.cone_deg.vertical / 2) * (Math.PI / 180);
  for (const [id, p] of Object.entries(layout.placements)) {
    const depth = layout.anchor_distance - p.exploded[2];
    if (Math.abs(Math.atan2(p.exploded[0], depth)) > halfH) out.push(`${id} outside horizontal cone`);
    if (Math.abs(Math.atan2(p.exploded[1], depth)) > halfV) out.push(`${id} outside vertical cone`);
  }
  return out;
}

/**
 * Push apart, across the viewer's x/y plane, any two parts whose ray targets would overlap, so a
 * ray aimed at one part never lands on its neighbour. Rings around a class can put its methods
 * a couple of centimetres apart while each is at least 4 cm across. Deterministic: a fixed
 * number of passes over the pairs in id order, and parts stay inside the cone bounds. Depth (z)
 * is left alone, since rays come from in front and depth does not separate targets for them.
 */
function spreadApart(items: Array<{ at: Vec3; reach: number }>): Vec3[] {
  const pos = items.map((it) => [...it.at] as [number, number, number]);
  // Spreading never grows the layout: parts stay inside the outline the rings gave them, which
  // the app's own framing (the model sits below eye level) and the cone tests were tuned for.
  const lowX = Math.min(...pos.map((p) => p[0]));
  const highX = Math.max(...pos.map((p) => p[0]));
  const lowY = Math.min(...pos.map((p) => p[1]));
  const highY = Math.max(...pos.map((p) => p[1]));
  for (let pass = 0; pass < SPREAD_ITERATIONS; pass++) {
    let moved = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i]!;
        const b = pos[j]!;
        const need = items[i]!.reach + items[j]!.reach + TARGET_GAP;
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let d = Math.hypot(dx, dy);
        if (d >= need) continue;
        if (d < 1e-6) {
          // Same spot: separate along a direction fixed by the pair's indices.
          const angle = ((i * 7 + j * 13) % 360) * (Math.PI / 180);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = 1;
        }
        const push = ((need - Math.hypot(b[0] - a[0], b[1] - a[1])) / 2) * 1.01;
        a[0] -= (dx / d) * push;
        a[1] -= (dy / d) * push;
        b[0] += (dx / d) * push;
        b[1] += (dy / d) * push;
        moved = true;
      }
    }
    for (const p of pos) {
      // Inside the box bounds and the glasses-safe cone as seen from the anchor distance.
      const depth = ANCHOR_DISTANCE - p[2];
      const coneX = Math.min(BOUNDS.x, depth * Math.tan(((CONE_DEG.horizontal / 2) * Math.PI) / 180) - CONE_MARGIN);
      const coneY = Math.min(BOUNDS.y, depth * Math.tan(((CONE_DEG.vertical / 2) * Math.PI) / 180) - CONE_MARGIN);
      const tanV = Math.tan(((CONE_DEG.vertical / 2) * Math.PI) / 180);
      const viewDepth = VIEW.distance - p[2];
      const viewLow = VIEW.drop - viewDepth * tanV + CONE_MARGIN;
      const viewHigh = VIEW.drop + viewDepth * tanV - CONE_MARGIN;
      p[0] = Math.max(Math.max(-coneX, lowX), Math.min(Math.min(coneX, highX), p[0]));
      p[1] = Math.max(Math.max(-coneY, lowY, viewLow), Math.min(Math.min(coneY, highY, viewHigh), p[1]));
    }
    if (!moved) break;
  }
  return pos;
}

/** Pairs of parts whose ray targets overlap in the exploded layout (see spreadApart). */
export function targetOverlaps(graph: SystemGraph, layout: Layout): string[] {
  const out: string[] = [];
  const nodes = [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const pa = layout.placements[a.id]!;
      const pb = layout.placements[b.id]!;
      const d = Math.hypot(pa.exploded[0] - pb.exploded[0], pa.exploded[1] - pb.exploded[1]);
      const need = hitRadius(a.kind, pa.radius) + hitRadius(b.kind, pb.radius);
      if (d < need - 1e-4) out.push(`${a.id} and ${b.id}: ${(d * 100).toFixed(1)} cm apart, targets need ${(need * 100).toFixed(1)} cm`);
    }
  }
  return out;
}

function clampExploded([x, y, z]: Vec3): Vec3 {
  return vec([Math.max(-BOUNDS.x, Math.min(BOUNDS.x, x)), Math.max(-BOUNDS.y, Math.min(BOUNDS.y, y)), z]);
}

function vec([x, y, z]: Vec3): Vec3 {
  return [round(x), round(y), round(z)];
}

function round(v: number): number {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? 0 : r;
}
