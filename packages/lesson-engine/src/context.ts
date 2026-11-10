import type { ContentBundle, Evidence, FlowPath, GraphEdge, GraphNode, Lesson } from '@explode/contracts';

/** Read-only indexes over one bundle. Build once per loaded system. */
export interface EngineContext {
  bundle: ContentBundle;
  nodes: ReadonlyMap<string, GraphNode>;
  edges: ReadonlyMap<string, GraphEdge>;
  paths: ReadonlyMap<string, FlowPath>;
  evidence: ReadonlyMap<string, Evidence>;
  lessons: ReadonlyMap<string, Lesson>;
  outgoing: ReadonlyMap<string, readonly GraphEdge[]>;
  incoming: ReadonlyMap<string, readonly GraphEdge[]>;
  children: ReadonlyMap<string, readonly GraphNode[]>;
}

export function createContext(bundle: ContentBundle): EngineContext {
  const byId = <T extends { id: string }>(items: readonly T[]) => new Map(items.map((i) => [i.id, i]));
  const group = <T>(items: readonly T[], key: (t: T) => string | null) => {
    const m = new Map<string, T[]>();
    for (const item of items) {
      const k = key(item);
      if (k === null) continue;
      const list = m.get(k);
      if (list) list.push(item);
      else m.set(k, [item]);
    }
    return m;
  };
  return {
    bundle,
    nodes: byId(bundle.graph.nodes),
    edges: byId(bundle.graph.edges),
    paths: byId(bundle.graph.paths),
    evidence: byId(bundle.evidence),
    lessons: byId(bundle.lessons),
    outgoing: group(bundle.graph.edges, (e) => e.source_id),
    incoming: group(bundle.graph.edges, (e) => e.target_id),
    children: group(bundle.graph.nodes, (n) => n.parent_id),
  };
}
