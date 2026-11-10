import type { Evidence, FlowPath, GraphEdge, GraphNode, NodeKind, Relation, SystemGraph } from '@explode/contracts';
import { join, posix } from 'node:path';
import { readFileSync } from 'node:fs';
import { Node, Project, ts } from 'ts-morph';
import type { CallExpression, ClassDeclaration, FunctionDeclaration, MethodDeclaration, SourceFile } from 'ts-morph';
import { hashTree, sha256 } from './hash.ts';

export interface PathSpec {
  id: string;
  label: string;
  flow: FlowPath['flow'];
  node_ids: string[];
}

export interface IndexOptions {
  /** Repository root (contains src/). */
  root: string;
  systemId: string;
  displayName: string;
  /** Curated named paths. Every hop must be backed by a resolved edge or indexing fails. */
  paths?: PathSpec[];
  /** Max excerpt length in lines. */
  excerptLines?: number;
}

/** Character range of a function/method/class declaration, used to map V8 coverage to node ids. */
export interface DeclRange {
  node_id: string;
  kind: 'function' | 'class';
  /** Declared name (class name for classes; V8 names a class constructor after its class). */
  name: string;
  file: string;
  start: number;
  end: number;
}

export interface IndexResult {
  graph: SystemGraph;
  evidence: Evidence[];
  declRanges: DeclRange[];
  revision: string;
}

type Decl = FunctionDeclaration | MethodDeclaration | ClassDeclaration;

const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

/**
 * Index a small TypeScript repository into a SystemGraph.
 * Conservative: an edge exists only when ts-morph resolves the callee to a declaration we indexed.
 */
export function indexRepository(opts: IndexOptions): IndexResult {
  const maxLines = opts.excerptLines ?? 12;
  const revision = hashTree(opts.root);
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowImportingTsExtensions: true,
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      types: ['node'],
    },
  });
  project.addSourceFilesAtPaths(join(opts.root, 'src/**/*.ts'));
  const files = project
    .getSourceFiles()
    .map((sf) => ({ sf, rel: rel(opts.root, sf) }))
    .sort((a, b) => (a.rel < b.rel ? -1 : 1));

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const evidence = new Map<string, Evidence>();
  const declToId = new Map<Node, string>();
  const declRanges: DeclRange[] = [];
  const lineCache = new Map<string, string[]>();

  const lines = (file: string) => {
    let l = lineCache.get(file);
    if (!l) {
      l = readFileSync(join(opts.root, file), 'utf8').split('\n');
      lineCache.set(file, l);
    }
    return l;
  };

  const sourceEvidence = (id: string, file: string, startLine: number, endLine: number, title: string, summary: string) => {
    if (evidence.has(id)) return id;
    const end = Math.min(endLine, startLine + maxLines - 1);
    const excerpt = lines(file).slice(startLine - 1, end).join('\n');
    evidence.set(id, {
      id,
      kind: 'source_range',
      truth_status: 'static_verified',
      title: truncate(title, 120),
      summary: truncate(summary, 400),
      source: { path: file, start_line: startLine, end_line: end, revision, excerpt, excerpt_sha256: sha256(excerpt) },
    });
    return id;
  };

  const addNode = (n: Omit<GraphNode, 'summary' | 'importance'> & { summary?: string }) => {
    nodes.set(n.id, { importance: 0, ...n, summary: truncate(n.summary ?? '', 300), label: truncate(n.label, 60) });
  };

  // 1. Clusters (directories) and modules (files).
  for (const { sf, rel: file } of files) {
    const dir = posix.dirname(file);
    const clusterId = `cluster:${dir}`;
    if (!nodes.has(clusterId)) {
      addNode({ id: clusterId, kind: 'cluster', label: posix.basename(dir), parent_id: null, truth_status: 'static_verified', evidence_ids: [] });
    }
    const modId = `mod:${file}`;
    const evId = sourceEvidence(`ev:src:${modId}`, file, 1, lines(file).length, `Source: ${file}`, `Module ${file}.`);
    addNode({
      id: modId,
      kind: 'module',
      label: posix.basename(file),
      summary: moduleSummary(sf),
      parent_id: clusterId,
      truth_status: 'static_verified',
      evidence_ids: [evId],
    });
    const cluster = nodes.get(clusterId)!;
    if (cluster.evidence_ids.length < 3) cluster.evidence_ids.push(evId);
  }

  // 2. Declarations: functions, classes, methods.
  const registerDecl = (decl: Decl, id: string, kind: NodeKind, label: string, parent: string, file: string) => {
    const start = decl.getStartLineNumber();
    const end = decl.getEndLineNumber();
    const evId = sourceEvidence(`ev:src:${id}`, file, start, end, `Source: ${file}:${start}-${end}`, `Declaration of ${label}.`);
    addNode({ id, kind, label, summary: docSummary(decl), parent_id: parent, truth_status: 'static_verified', evidence_ids: [evId] });
    declToId.set(decl, id);
    declRanges.push({ node_id: id, kind: kind === 'class' ? 'class' : 'function', name: decl.getName() ?? '', file, start: decl.getStart(), end: decl.getEnd() });
  };
  for (const { sf, rel: file } of files) {
    const modId = `mod:${file}`;
    for (const fn of sf.getFunctions()) {
      const name = fn.getName();
      if (!name) continue;
      registerDecl(fn, `fn:${file}#${name.toLowerCase()}`, 'function', name, modId, file);
    }
    for (const cls of sf.getClasses()) {
      const name = cls.getName();
      if (!name) continue;
      const classId = `class:${file}#${name.toLowerCase()}`;
      registerDecl(cls, classId, 'class', name, modId, file);
      for (const m of cls.getMethods()) {
        registerDecl(m, `fn:${file}#${name.toLowerCase()}.${m.getName().toLowerCase()}`, 'function', `${name}.${m.getName()}`, classId, file);
      }
    }
  }

  const addEdge = (relation: Relation, source: string, target: string, file: string, at: Node, flows: GraphEdge['flows'], label?: string, evidenceId?: string) => {
    if (source === target) return null;
    const id = `edge:${relation}:${source}->${target}`;
    if (edges.has(id)) return id;
    const start = at.getStartLineNumber();
    const evId =
      evidenceId ??
      sourceEvidence(`ev:src:${id}`, file, start, at.getEndLineNumber(), `${relationTitle(relation)}: ${file}:${start}`, `${nodes.get(source)?.label} ${relationVerb(relation)} ${nodes.get(target)?.label}.`);
    edges.set(id, {
      id,
      source_id: source,
      target_id: target,
      relation,
      flows,
      truth_status: 'static_verified',
      evidence_ids: [evId],
      is_mutable_in_sandbox: false,
      ...(label ? { label } : {}),
    });
    return id;
  };

  // 3. Import edges (value imports between indexed modules).
  for (const { sf, rel: file } of files) {
    for (const imp of sf.getImportDeclarations()) {
      if (imp.isTypeOnly()) continue;
      const target = imp.getModuleSpecifierSourceFile();
      if (!target) continue;
      const targetId = `mod:${rel(opts.root, target)}`;
      if (nodes.has(targetId)) addEdge('imports', `mod:${file}`, targetId, file, imp, []);
    }
  }

  // 4. Call / construct edges, and the router adapter.
  for (const { sf, rel: file } of files) {
    for (const expr of sf.getDescendants()) {
      if (Node.isCallExpression(expr)) {
        const owner = ownerOf(expr, declToId) ?? `mod:${file}`;
        const target = resolveCallee(expr, declToId);
        if (target) addEdge('calls', owner, target, file, expr, ['request']);
        maybeRoute(expr, owner, file);
      } else if (Node.isNewExpression(expr)) {
        const owner = ownerOf(expr, declToId) ?? `mod:${file}`;
        const target = resolveIdentifierLike(expr.getExpression(), declToId);
        if (target) addEdge('depends_on', owner, target, file, expr, [], 'constructs');
      }
    }
  }

  function maybeRoute(call: CallExpression, owner: string, file: string) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return;
    const method = callee.getName();
    if (!ROUTE_METHODS.has(method)) return;
    const resolved = resolveCallee(call, declToId);
    if (!resolved || !/#router\.[a-z]+$/.test(resolved)) return;
    const [pathArg, ...handlerArgs] = call.getArguments();
    if (!pathArg || !Node.isStringLiteral(pathArg)) return;
    const routePath = pathArg.getLiteralValue();
    const routeId = `route:${method}:${routePath.toLowerCase()}`;
    const start = call.getStartLineNumber();
    const evId = sourceEvidence(`ev:src:${routeId}`, file, start, call.getEndLineNumber(), `Route registration: ${file}:${start}`, `${method.toUpperCase()} ${routePath} is registered here with its handler chain, which runs in order.`);
    const handlers = handlerArgs.map((arg) => resolveHandlerArg(arg, declToId));
    const firstHandlerParent = handlers[handlers.length - 1] ? nodes.get(handlers[handlers.length - 1]!)?.parent_id : null;
    const clusterId = firstHandlerParent ? nodes.get(firstHandlerParent)?.parent_id ?? `cluster:${posix.dirname(file)}` : `cluster:${posix.dirname(file)}`;
    addNode({
      id: routeId,
      kind: 'route',
      label: `${method.toUpperCase()} ${routePath}`,
      summary: `HTTP route; runs ${handlers.length} handler${handlers.length === 1 ? '' : 's'} in order.`,
      parent_id: clusterId,
      truth_status: 'static_verified',
      evidence_ids: [evId],
    });
    addEdge('registers_route', owner, routeId, file, call, ['request'], 'registers', evId);
    let prev = routeId;
    handlers.forEach((h, i) => {
      if (!h) return; // unresolved handler: no edge (never invent one)
      addEdge('handles', prev, h, file, call, ['request'], i === 0 ? 'first handler' : 'next()', evId);
      prev = h;
    });
  }

  // 5. Named paths: every hop must be a resolved edge into that node from an earlier path node.
  const paths: FlowPath[] = (opts.paths ?? []).map((spec) => {
    const edgeIds: string[] = [];
    for (const id of spec.node_ids) if (!nodes.has(id)) throw new Error(`path ${spec.id}: unknown node ${id}`);
    for (let i = 1; i < spec.node_ids.length; i++) {
      const target = spec.node_ids[i]!;
      let found: GraphEdge | undefined;
      for (let j = i - 1; j >= 0 && !found; j--) {
        const source = spec.node_ids[j]!;
        found = [...edges.values()].find((e) => e.source_id === source && e.target_id === target && e.relation !== 'imports');
      }
      if (!found) throw new Error(`path ${spec.id}: no resolved edge into ${target} from an earlier node on the path`);
      edgeIds.push(found.id);
    }
    const evidenceIds = [...new Set(edgeIds.flatMap((id) => edges.get(id)!.evidence_ids))];
    return { id: spec.id, label: spec.label, flow: spec.flow, node_ids: [...spec.node_ids], edge_ids: edgeIds, truth_status: 'static_verified', evidence_ids: evidenceIds };
  });

  // 6. Importance: kind baseline, boosted on named paths.
  const onPath = new Set(paths.flatMap((p) => p.node_ids));
  const base: Record<NodeKind, number> = { system: 1, cluster: 0.9, route: 0.6, module: 0.5, class: 0.45, function: 0.3, test: 0.2, assembly: 0.9, component: 0.6 };
  for (const n of nodes.values()) n.importance = Math.min(1, base[n.kind] + (onPath.has(n.id) ? 0.35 : 0));

  const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const graph: SystemGraph = {
    schema_version: '1.0',
    system_id: opts.systemId,
    system_kind: 'software',
    display_name: opts.displayName,
    revision: { kind: 'content_hash', value: revision },
    nodes: [...nodes.values()].sort(byId),
    edges: [...edges.values()].sort(byId),
    paths,
  };
  return { graph, evidence: [...evidence.values()].sort(byId), declRanges: declRanges.sort((a, b) => (a.node_id < b.node_id ? -1 : 1)), revision };
}

function rel(root: string, sf: SourceFile): string {
  return posix.relative(root.split('\\').join('/'), sf.getFilePath());
}

function ownerOf(node: Node, declToId: Map<Node, string>): string | undefined {
  for (let cur = node.getParent(); cur; cur = cur.getParent()) {
    const id = declToId.get(cur);
    if (id) return id;
  }
  return undefined;
}

function resolveCallee(call: CallExpression, declToId: Map<Node, string>): string | undefined {
  const callee = call.getExpression();
  const nameNode = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
  return resolveIdentifierLike(nameNode, declToId);
}

function resolveHandlerArg(arg: Node, declToId: Map<Node, string>): string | undefined {
  // `parseJsonBody` (a handler) or `loginHandler(auth)` (a handler factory).
  if (Node.isCallExpression(arg)) return resolveCallee(arg, declToId);
  return resolveIdentifierLike(arg, declToId);
}

function resolveIdentifierLike(node: Node, declToId: Map<Node, string>): string | undefined {
  let symbol = node.getSymbol();
  if (!symbol) return undefined;
  if (symbol.isAlias()) symbol = symbol.getAliasedSymbol() ?? symbol;
  for (const decl of symbol.getDeclarations()) {
    const id = declToId.get(decl);
    if (id) return id;
  }
  return undefined;
}

function docSummary(decl: Decl): string {
  const doc = decl.getJsDocs()[0]?.getDescription().trim() ?? '';
  return doc.replace(/\s+/g, ' ');
}

function moduleSummary(sf: SourceFile): string {
  const decls = [...sf.getFunctions(), ...sf.getClasses()].filter((d) => d.isExported());
  const first = decls.map((d) => d.getJsDocs()[0]?.getDescription().trim()).find(Boolean);
  const names = decls.map((d) => d.getName()).filter(Boolean);
  if (names.length === 0) return 'Types and helpers.';
  return truncate(`Exports ${names.join(', ')}.${first ? ` ${first.replace(/\s+/g, ' ')}` : ''}`, 300);
}

function relationTitle(r: Relation): string {
  return r === 'imports' ? 'Import' : r === 'calls' ? 'Call site' : r === 'depends_on' ? 'Construction' : 'Registration';
}

function relationVerb(r: Relation): string {
  return r === 'imports' ? 'imports' : r === 'calls' ? 'calls' : r === 'depends_on' ? 'constructs' : 'hands off to';
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

