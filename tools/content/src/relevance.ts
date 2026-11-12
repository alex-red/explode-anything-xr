import type { Evidence, FlowPath, GraphEdge, GraphNode, NodeRole, SystemGraph } from '@explode/contracts';
import type { IndexResult, PathSpec } from '@explode/indexer';
import { z } from 'zod';

/**
 * Choosing what to draw from a large repository (docs/RELEVANCE_PLAN.md).
 *
 * The indexer reads every file. This module then keeps only the parts worth a newcomer's first
 * look, in three steps:
 *
 * 1. Fold the index down to **parts**: classes and top-level functions. A method counts as its
 *    class, so a call between two methods becomes a call between their classes.
 * 2. **Rank** the parts from the call graph alone (PageRank, how many other parts call in, whether
 *    it is exported), plus the parts the curation step singled out.
 * 3. **Group** them under the parent nodes the curation step chose, and keep the best of each
 *    group inside a fixed budget.
 *
 * Truth contract (ADR-0007): every part and every connection kept here is still `static_verified`
 * and cites the source lines it came from. A parent node is the curation step's reading of the
 * code, so it is `inferred` and cites nothing. Ranking and roles are presentation, never evidence.
 */

const Slug = z.string().regex(/^[a-z][a-z0-9-]{1,30}$/);

/** What the curation step (tools/content/src/curate.ts) writes and the generator reads. */
export const Curation = z.object({
  schema_version: z.literal('1'),
  source: z.object({ repository: z.string().min(1), commit: z.string().min(7) }),
  /** Who chose this. Recorded as returned by the provider; never edited by hand. */
  produced_by: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    created_at: z.string().min(1),
    /** sha256 of the digest text the model was shown. */
    digest_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  /** The parent nodes, in the order they should be read. */
  groups: z
    .array(
      z.object({
        id: Slug,
        label: z.string().min(2).max(28),
        summary: z.string().min(10).max(230),
        /** Directory paths (or single files) from the digest. The longest match wins. */
        members: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(4)
    .max(8),
  /** Parts the model found most worth showing, with its reason. Always kept. */
  spotlight: z.array(z.object({ id: z.string().min(1), why: z.string().min(4).max(160) })).max(16),
  /** Where a newcomer should start reading. */
  entry_points: z.array(z.string().min(1)).max(3),
});
export type Curation = z.infer<typeof Curation>;

export interface Part {
  id: string;
  kind: 'class' | 'function';
  label: string;
  file: string;
  dir: string;
  doc: string;
  exported: boolean;
  lines: number;
  has_update: boolean;
  /** Distinct parts in other files that call or construct this one. */
  callers: number;
  /** Distinct parts in other files this one calls or constructs. */
  callees: number;
  /** PageRank over the part graph, scaled so the best part is 1. */
  rank: number;
  /** 0..1: the structural score parts are ordered by (see `scoreParts`). */
  score: number;
}

interface Link {
  source: string;
  target: string;
  /** Underlying indexed edges (call sites and constructions), ids sorted. */
  edges: GraphEdge[];
}

export interface PartGraph {
  parts: Map<string, Part>;
  links: Link[];
}

const DAMPING = 0.85;
const RANK_PASSES = 40;
/** A call inside one file passes on this fraction of the rank a call across files does. */
const LOCAL_CALL_WEIGHT = 0.05;
/** Parts shorter than this many lines are scaled down: one-line guards and getters are rarely the story. */
const SMALL_PART_LINES = 8;
/** A hub is called by at least this many of the parts shown; at most MAX_HUBS parts are hubs. */
const HUB_MIN_CALLERS = 4;
const MAX_HUBS = 4;

/** The file an indexed id (`fn:path#name`, `class:path#name`, `mod:path`) belongs to. */
function fileOf(id: string): string {
  const body = id.slice(id.indexOf(':') + 1);
  const hash = body.indexOf('#');
  return hash === -1 ? body : body.slice(0, hash);
}

/** Fold the index to classes and top-level functions, with the calls between them, and rank them. */
export function partGraph(index: IndexResult): PartGraph {
  const byId = new Map(index.graph.nodes.map((n) => [n.id, n]));
  /** A method is its class; a class or top-level function is itself; anything else is not a part. */
  const partOf = (id: string): string | null => {
    const n = byId.get(id);
    if (!n) return null;
    if (n.kind === 'class') return n.id;
    if (n.kind !== 'function') return null;
    const parent = n.parent_id ? byId.get(n.parent_id) : undefined;
    return parent?.kind === 'class' ? parent.id : n.id;
  };

  const parts = new Map<string, Part>();
  for (const n of index.graph.nodes) {
    if (partOf(n.id) !== n.id) continue;
    const file = fileOf(n.id);
    const fact = index.facts[n.id];
    parts.set(n.id, {
      id: n.id,
      kind: n.kind as 'class' | 'function',
      label: n.label,
      file,
      dir: file.slice(0, file.lastIndexOf('/')),
      doc: n.summary,
      exported: fact?.exported ?? false,
      lines: fact?.lines ?? 0,
      has_update: fact?.has_update ?? false,
      callers: 0,
      callees: 0,
      rank: 0,
      score: 0,
    });
  }

  const linkByKey = new Map<string, Link>();
  for (const e of index.graph.edges) {
    if (e.relation === 'imports') continue;
    const source = partOf(e.source_id);
    const target = partOf(e.target_id);
    if (!source || !target || source === target) continue;
    const key = `${source}\0${target}`;
    const link = linkByKey.get(key);
    if (link) link.edges.push(e);
    else linkByKey.set(key, { source, target, edges: [e] });
  }
  const links = [...linkByKey.values()].sort((a, b) => cmp(a.source, b.source) || cmp(a.target, b.target));
  for (const l of links) {
    l.edges.sort((a, b) => cmp(a.id, b.id));
    // Calls inside one file say "local helper", not "the rest of the system leans on this".
    if (parts.get(l.source)!.file === parts.get(l.target)!.file) continue;
    parts.get(l.source)!.callees++;
    parts.get(l.target)!.callers++;
  }

  // PageRank: a part called by well-connected parts ranks high. Weight grows slowly with the
  // number of call sites, so one chatty caller does not outvote several quiet ones.
  const ids = [...parts.keys()].sort();
  const at = new Map(ids.map((id, i) => [id, i]));
  const out = ids.map(() => [] as Array<{ to: number; w: number }>);
  const outSum = ids.map(() => 0);
  for (const l of links) {
    const local = parts.get(l.source)!.file === parts.get(l.target)!.file;
    const w = (1 + Math.log2(l.edges.length)) * (local ? LOCAL_CALL_WEIGHT : 1);
    const i = at.get(l.source)!;
    out[i]!.push({ to: at.get(l.target)!, w });
    outSum[i]! += w;
  }
  let rank = ids.map(() => 1 / ids.length);
  for (let pass = 0; pass < RANK_PASSES; pass++) {
    const next = ids.map(() => (1 - DAMPING) / ids.length);
    let sink = 0;
    for (let i = 0; i < ids.length; i++) {
      if (outSum[i] === 0) sink += rank[i]!;
      else for (const { to, w } of out[i]!) next[to]! += (DAMPING * rank[i]! * w) / outSum[i]!;
    }
    for (let i = 0; i < ids.length; i++) next[i]! += (DAMPING * sink) / ids.length;
    rank = next;
  }
  const best = Math.max(...rank, 1e-12);
  ids.forEach((id, i) => (parts.get(id)!.rank = rank[i]! / best));
  scoreParts(parts);
  return { parts, links };
}

/**
 * The structural score, 0..1: mostly PageRank, then how many parts in other files call in, then
 * how many it calls out to (an orchestrator), with a little for being exported or for having a per-frame
 * `update`. Very short parts are scaled down. Nothing here reads truth status or test results.
 */
function scoreParts(parts: Map<string, Part>): void {
  let maxIn = 1;
  let maxOut = 1;
  for (const p of parts.values()) {
    maxIn = Math.max(maxIn, p.callers);
    maxOut = Math.max(maxOut, p.callees);
  }
  for (const p of parts.values()) {
    const callIn = Math.log1p(p.callers) / Math.log1p(maxIn);
    const callOut = Math.log1p(p.callees) / Math.log1p(maxOut);
    const size = p.lines >= SMALL_PART_LINES ? 1 : 0.6 + (0.4 * p.lines) / SMALL_PART_LINES;
    // A class with an `update` method is run by the frame loop, which no call site in the repo shows.
    const driven = p.has_update ? 0.1 : 0;
    p.score = round3(Math.min(1, (0.45 * Math.sqrt(p.rank) + 0.25 * callIn + 0.22 * callOut + (p.exported ? 0.08 : 0) + driven) * size));
  }
}

/** The compact text the curation model is shown: every directory, with its strongest parts. */
export function buildDigest(pg: PartGraph, opts: { partsPerDir?: number } = {}): { text: string; dirs: string[]; part_ids: string[] } {
  const perDir = opts.partsPerDir ?? 6;
  const byDir = new Map<string, Part[]>();
  for (const p of pg.parts.values()) {
    const list = byDir.get(p.dir) ?? [];
    list.push(p);
    byDir.set(p.dir, list);
  }
  const dirGroup = new Map<string, Map<string, number>>();
  for (const l of pg.links) {
    const a = pg.parts.get(l.source)!.dir;
    const b = pg.parts.get(l.target)!.dir;
    if (a === b) continue;
    const m = dirGroup.get(a) ?? new Map<string, number>();
    m.set(b, (m.get(b) ?? 0) + l.edges.length);
    dirGroup.set(a, m);
  }
  const dirs = [...byDir.keys()].sort();
  const partIds: string[] = [];
  const lines: string[] = [];
  for (const dir of dirs) {
    const list = byDir.get(dir)!.sort((a, b) => b.score - a.score || cmp(a.id, b.id));
    const calls = [...(dirGroup.get(dir) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, 4);
    lines.push(`DIR ${dir} (${list.length} parts)${calls.length ? ` calls into: ${calls.map(([d, n]) => `${d} ×${n}`).join(', ')}` : ''}`);
    for (const p of list.slice(0, perDir)) {
      partIds.push(p.id);
      const doc = p.doc ? ` — ${p.doc.slice(0, 110)}` : '';
      lines.push(`  PART ${p.id} [${p.kind}${p.exported ? ', exported' : ''}${p.has_update ? ', per-frame update' : ''}; ${p.lines} lines; called by ${p.callers}, calls ${p.callees}; score ${p.score}]${doc}`);
    }
  }
  return { text: lines.join('\n'), dirs, part_ids: partIds.sort() };
}

export interface SelectOptions {
  /** Parts drawn, not counting the parent nodes. */
  budget: number;
  /** Every group shows at least this many parts (when it has them). */
  perGroupMin: number;
  /** And at most this many. */
  perGroupMax: number;
  /** Connections drawn at most; the strongest are kept, and every path connection always is. */
  maxEdges: number;
  paths: PathSpec[];
  systemId: string;
  displayName: string;
}

export interface Selection {
  graph: SystemGraph;
  evidence: Evidence[];
  stats: {
    indexed: { files: number; declarations: number; parts: number; connections: number };
    shown: { groups: number; parts: number; connections: number };
    /** Parts in no group's directories: indexed, never drawn. */
    ungrouped_parts: number;
    groups: Array<{ id: string; parts: number; shown: number }>;
  };
}

/** Problems that make a curation unusable for this index; empty when it fits. */
export function curationProblems(curation: Curation, pg: PartGraph): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const g of curation.groups) {
    if (ids.has(g.id)) out.push(`duplicate group ${g.id}`);
    ids.add(g.id);
    for (const m of g.members) {
      if (![...pg.parts.values()].some((p) => inPrefix(p.file, m))) out.push(`group ${g.id}: member ${m} matches no indexed part`);
    }
  }
  const claimed = new Map<string, string>();
  for (const g of curation.groups) {
    for (const m of g.members) {
      const prev = claimed.get(m);
      if (prev && prev !== g.id) out.push(`member ${m} is in both ${prev} and ${g.id}`);
      claimed.set(m, g.id);
    }
  }
  for (const s of curation.spotlight) if (!pg.parts.has(s.id)) out.push(`spotlight ${s.id} is not an indexed part`);
  for (const id of curation.entry_points) if (!pg.parts.has(id)) out.push(`entry point ${id} is not an indexed part`);
  return out;
}

function inPrefix(file: string, member: string): boolean {
  const m = member.replace(/\/+$/, '');
  return file === m || file.startsWith(`${m}/`);
}

/** Keep the most relevant parts of each curated group, and the connections between them. */
export function selectRelevant(index: IndexResult, curation: Curation, opts: SelectOptions): Selection {
  const pg = partGraph(index);
  const problems = curationProblems(curation, pg);
  if (problems.length) throw new Error(`curation does not fit the index:\n${problems.join('\n')}`);

  // Group of each part: the group whose member path is the longest match for its file.
  const groupOf = new Map<string, string>();
  for (const p of pg.parts.values()) {
    let best = -1;
    for (const g of curation.groups) {
      for (const m of g.members) {
        const len = m.replace(/\/+$/, '').length;
        if (len > best && inPrefix(p.file, m)) {
          best = len;
          groupOf.set(p.id, g.id);
        }
      }
    }
  }

  const forced = new Set<string>([...opts.paths.flatMap((p) => p.node_ids), ...curation.entry_points, ...curation.spotlight.map((s) => s.id)]);
  for (const id of forced) {
    if (!pg.parts.has(id)) throw new Error(`${id} must be shown but is not an indexed part`);
    if (!groupOf.has(id)) throw new Error(`${id} must be shown but is in no group's directories`);
  }

  const ranked = [...pg.parts.values()].filter((p) => groupOf.has(p.id)).sort((a, b) => b.score - a.score || cmp(a.id, b.id));
  const chosen = new Set<string>(forced);
  const perGroup = new Map<string, number>();
  const bump = (id: string) => perGroup.set(groupOf.get(id)!, (perGroup.get(groupOf.get(id)!) ?? 0) + 1);
  for (const id of chosen) bump(id);
  // Every group gets its strongest parts first, then the rest of the budget goes to the best overall.
  for (const g of curation.groups) {
    for (const p of ranked) {
      if ((perGroup.get(g.id) ?? 0) >= opts.perGroupMin) break;
      if (groupOf.get(p.id) !== g.id || chosen.has(p.id)) continue;
      chosen.add(p.id);
      bump(p.id);
    }
  }
  for (const p of ranked) {
    if (chosen.size >= opts.budget) break;
    if (chosen.has(p.id) || (perGroup.get(groupOf.get(p.id)!) ?? 0) >= opts.perGroupMax) continue;
    chosen.add(p.id);
    bump(p.id);
  }
  for (const g of curation.groups) if (!perGroup.get(g.id)) throw new Error(`group ${g.id} has no parts to show`);

  // Connections between the chosen parts. Each stands for one or more real call sites and cites the first.
  const candidateLinks = pg.links.filter((l) => chosen.has(l.source) && chosen.has(l.target));
  // Ids are capped at 200 characters and two full part ids do not fit, so a connection is named by
  // its ends' labels (`edge:calls:grabsystem->multipointer`); labels are checked to be unique below.
  const shortName = (id: string) => pg.parts.get(id)!.label.toLowerCase().replace(/[^a-z0-9_.]/g, '');
  const names = new Set<string>();
  for (const id of chosen) {
    if (names.has(shortName(id))) throw new Error(`two parts shown are both named ${shortName(id)}; connection ids would collide`);
    names.add(shortName(id));
  }
  const edgeId = (l: Link) => `edge:${l.edges.some((e) => e.relation === 'calls') ? 'calls' : l.edges[0]!.relation}:${shortName(l.source)}->${shortName(l.target)}`;
  const linkBetween = (source: string, target: string) => candidateLinks.find((l) => l.source === source && l.target === target);

  const pathLinks = new Set<Link>();
  const paths: FlowPath[] = opts.paths.map((spec) => {
    const edgeIds: string[] = [];
    const evidenceIds: string[] = [];
    for (let i = 1; i < spec.node_ids.length; i++) {
      let found: Link | undefined;
      for (let j = i - 1; j >= 0 && !found; j--) found = linkBetween(spec.node_ids[j]!, spec.node_ids[i]!);
      if (!found) throw new Error(`path ${spec.id}: no indexed call into ${spec.node_ids[i]} from an earlier part on the path`);
      pathLinks.add(found);
      edgeIds.push(edgeId(found));
      evidenceIds.push(found.edges[0]!.evidence_ids[0]!);
    }
    return { id: spec.id, label: spec.label, flow: spec.flow, node_ids: [...spec.node_ids], edge_ids: edgeIds, truth_status: 'static_verified', evidence_ids: [...new Set(evidenceIds)] };
  });

  const weight = (l: Link) => l.edges.length * (1 + pg.parts.get(l.target)!.score + pg.parts.get(l.source)!.score);
  const keptLinks = new Set<Link>(pathLinks);
  for (const l of [...candidateLinks].sort((a, b) => weight(b) - weight(a) || cmp(edgeId(a), edgeId(b)))) {
    if (keptLinks.size >= opts.maxEdges) break;
    keptLinks.add(l);
  }

  // Roles. Entry points are the curation's. A hub is one of the parts most others here call into.
  // An engine has a per-frame `update` and no caller anywhere in the repository: the frame loop runs it.
  const entries = new Set(curation.entry_points);
  const shownCallers = new Map<string, number>();
  for (const l of candidateLinks) shownCallers.set(l.target, (shownCallers.get(l.target) ?? 0) + 1);
  const hubs = new Set(
    [...chosen]
      .filter((id) => !entries.has(id) && (shownCallers.get(id) ?? 0) >= HUB_MIN_CALLERS)
      .sort((a, b) => (shownCallers.get(b) ?? 0) - (shownCallers.get(a) ?? 0) || cmp(a, b))
      .slice(0, MAX_HUBS),
  );
  const roleOf = (p: Part): NodeRole | undefined => (entries.has(p.id) ? 'entry' : hubs.has(p.id) ? 'hub' : p.has_update && p.callers === 0 ? 'engine' : undefined);

  // Importance carries the ranking into size, label priority and detail tier (lesson-engine detail.ts):
  // the top third of what is shown is key, the next third supporting, the rest extras.
  const order = [...chosen].sort((a, b) => pg.parts.get(b)!.score - pg.parts.get(a)!.score || cmp(a, b));
  const onPath = new Set(opts.paths.flatMap((p) => p.node_ids));
  const importance = new Map<string, number>();
  order.forEach((id, i) => {
    const r = i / order.length;
    const v = r < 1 / 3 ? 0.62 + 0.26 * (1 - r * 3) : r < 2 / 3 ? 0.46 + 0.13 * (1 - (r - 1 / 3) * 3) : 0.3 + 0.14 * (1 - (r - 2 / 3) * 3);
    importance.set(id, round3(Math.max(v, onPath.has(id) || entries.has(id) ? 0.7 : 0)));
  });

  const indexed = new Map(index.graph.nodes.map((n) => [n.id, n]));
  const totals = new Map<string, number>();
  for (const id of groupOf.values()) totals.set(id, (totals.get(id) ?? 0) + 1);
  const nodes: GraphNode[] = [];
  for (const g of curation.groups) {
    nodes.push({
      id: `concept:${g.id}`,
      kind: 'cluster',
      label: g.label,
      summary: g.summary,
      parent_id: null,
      truth_status: 'inferred',
      evidence_ids: [],
      importance: 0.9,
      role: 'concept',
    });
  }
  for (const id of chosen) {
    const n = indexed.get(id)!;
    const role = roleOf(pg.parts.get(id)!);
    nodes.push({ ...n, parent_id: `concept:${groupOf.get(id)!}`, importance: importance.get(id)!, ...(role ? { role } : {}) });
  }

  const edges: GraphEdge[] = [...keptLinks].map((l) => {
    const first = l.edges[0]!;
    const calls = l.edges.some((e) => e.relation === 'calls');
    return {
      id: edgeId(l),
      source_id: l.source,
      target_id: l.target,
      relation: calls ? 'calls' : first.relation,
      flows: ['control'],
      truth_status: 'static_verified',
      evidence_ids: [first.evidence_ids[0]!],
      is_mutable_in_sandbox: false,
      label: l.edges.length > 1 ? `${l.edges.length} call sites` : calls ? 'calls' : 'constructs',
    };
  });

  const cited = new Set<string>([...nodes.flatMap((n) => n.evidence_ids), ...edges.flatMap((e) => e.evidence_ids), ...paths.flatMap((p) => p.evidence_ids)]);
  const evidence = index.evidence.filter((e) => cited.has(e.id));
  const graph: SystemGraph = {
    schema_version: '1.0',
    system_id: opts.systemId,
    system_kind: 'software',
    display_name: opts.displayName,
    revision: index.graph.revision,
    nodes: nodes.sort((a, b) => cmp(a.id, b.id)),
    edges: edges.sort((a, b) => cmp(a.id, b.id)),
    paths,
  };
  return {
    graph,
    evidence,
    stats: {
      indexed: {
        files: index.graph.nodes.filter((n) => n.kind === 'module').length,
        declarations: index.graph.nodes.filter((n) => n.kind === 'class' || n.kind === 'function').length,
        parts: pg.parts.size,
        connections: pg.links.length,
      },
      shown: { groups: curation.groups.length, parts: chosen.size, connections: edges.length },
      ungrouped_parts: pg.parts.size - groupOf.size,
      groups: curation.groups.map((g) => ({ id: g.id, parts: totals.get(g.id) ?? 0, shown: perGroup.get(g.id) ?? 0 })),
    },
  };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
