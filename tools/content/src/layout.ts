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

  const placements: Record<string, NodePlacement> = {};
  for (const n of [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    placements[n.id] = {
      collapsed: vec(collapsed.get(n.id)!),
      exploded: clampExploded(exploded.get(n.id) ?? [0, 0, 0]),
      radius: radiusFor(n.importance),
    };
  }
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
