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
  // Globs under `root` to index. Default: every .ts file under src. Tests and .d.ts files are skipped.
  include?: string[];
  /** TypeScript `paths`, relative to `root`, so imports between packages of a monorepo resolve. */
  tsPaths?: Record<string, string[]>;
  /** A pinned git commit of `root`'s origin. Default: the content hash of the tree. */
  gitRevision?: string;
  /**
   * Resolve imports the way a bundler does: no file extension needed, `./x.js` finds `x.ts`, and a
   * directory finds its index. Most repositories are written this way. Default: Node's own rules.
   */
  bundlerResolution?: boolean;
  /** Also parse JavaScript files matched by `include`. Default: TypeScript only. */
  allowJs?: boolean;
  /**
   * For a repository nobody prepared: build ids from a lowercased path and name with any other
   * character replaced, so they always fit the id contract, and leave out a declaration whose id
   * would be too long or would repeat. Evidence still cites the real path. Default: off, ids use
   * the path as written.
   */
  normalizeIds?: boolean;
}

/** Structural facts about a declaration, for ranking and roles. Never evidence. */
export interface DeclFact {
  exported: boolean;
  lines: number;
  /** A class that declares an `update` method. */
  has_update: boolean;
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
  facts: Record<string, DeclFact>;
}

type Decl = FunctionDeclaration | MethodDeclaration | ClassDeclaration;

const SKIPPED_FILE = /\.d\.ts$|\.(test|spec)\.ts$|(^|\/)(__tests__|__mocks__|test|tests)\//;
const MAX_ID = 200;
const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
/** Importance a function gains from its connections (calls, handlers, routes), at most. */
const CONNECTED_BOOST = 0.2;
/** Connections at which that boost is full. */
const CONNECTED_SATURATION = 6;

/**
 * Index a small TypeScript repository into a SystemGraph.
 * Conservative: an edge exists only when ts-morph resolves the callee to a declaration we indexed.
 */
export function indexRepository(opts: IndexOptions): IndexResult {
  const maxLines = opts.excerptLines ?? 12;
  const revision = opts.gitRevision ?? hashTree(opts.root);
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: opts.bundlerResolution ? ts.ModuleKind.ESNext : ts.ModuleKind.NodeNext,
      moduleResolution: opts.bundlerResolution ? ts.ModuleResolutionKind.Bundler : ts.ModuleResolutionKind.NodeNext,
      allowImportingTsExtensions: true,
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      types: ['node'],
      ...(opts.allowJs ? { allowJs: true } : {}),
      ...(opts.tsPaths ? { baseUrl: opts.root, paths: opts.tsPaths } : {}),
    },
  });
  for (const glob of opts.include ?? ['src/**/*.ts']) project.addSourceFilesAtPaths(join(opts.root, glob));
  const files = project
    .getSourceFiles()
    .map((sf) => ({ sf, rel: rel(opts.root, sf) }))
    .filter(({ rel: file }) => !SKIPPED_FILE.test(file))
    .sort((a, b) => (a.rel < b.rel ? -1 : 1));
  /** The form of a path or a name used inside ids. */
  const idPart = (s: string) => (opts.normalizeIds ? s.toLowerCase().replace(/[^a-z0-9._/@-]/g, '-') : s);
  const idName = (s: string) => (opts.normalizeIds ? s.toLowerCase().replace(/[^a-z0-9._-]/g, '-') : s.toLowerCase());

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const evidence = new Map<string, Evidence>();
  const declToId = new Map<Node, string>();
  const declRanges: DeclRange[] = [];
  const facts: Record<string, DeclFact> = {};
  const lineCache = new Map<string, string[]>();

  const lines = (file: string) => {
    let l = lineCache.get(file);
    if (!l) {
      l = readFileSync(join(opts.root, file), 'utf8').split('\n');
      lineCache.set(file, l);
    }
    return l;
  };

  const sourceEvidence = (longId: string, file: string, startLine: number, endLine: number, title: string, summary: string) => {
    // Ids are capped at 200 characters; a call between two deeply nested declarations can exceed that.
    const id = longId.length <= MAX_ID ? longId : `ev:src:long:${sha256(longId).slice(0, 24)}`;
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
    const clusterId = `cluster:${idPart(dir)}`;
    if (!nodes.has(clusterId)) {
      addNode({ id: clusterId, kind: 'cluster', label: posix.basename(dir), parent_id: null, truth_status: 'static_verified', evidence_ids: [] });
    }
    const modId = `mod:${idPart(file)}`;
    if (opts.normalizeIds && (modId.length > MAX_ID - 8 || nodes.has(modId))) continue;
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
  const registerDecl = (decl: Decl, id: string, kind: NodeKind, label: string, parent: string, file: string): boolean => {
    if (opts.normalizeIds && (id.length > MAX_ID - 8 || nodes.has(id))) return false;
    const start = decl.getStartLineNumber();
    const end = decl.getEndLineNumber();
    const evId = sourceEvidence(`ev:src:${id}`, file, start, end, `Source: ${file}:${start}-${end}`, `Declaration of ${label}.`);
    addNode({ id, kind, label, summary: docSummary(decl), parent_id: parent, truth_status: 'static_verified', evidence_ids: [evId] });
    declToId.set(decl, id);
    facts[id] = {
      exported: Node.isMethodDeclaration(decl) ? false : decl.isExported(),
      lines: end - start + 1,
      has_update: Node.isClassDeclaration(decl) && decl.getMethods().some((m) => m.getName() === 'update'),
    };
    declRanges.push({ node_id: id, kind: kind === 'class' ? 'class' : 'function', name: decl.getName() ?? '', file, start: decl.getStart(), end: decl.getEnd() });
    return true;
  };
  for (const { sf, rel: file } of files) {
    const idFile = idPart(file);
    const modId = `mod:${idFile}`;
    if (!nodes.has(modId)) continue;
    for (const fn of sf.getFunctions()) {
      const name = fn.getName();
      if (!name) continue;
      registerDecl(fn, `fn:${idFile}#${idName(name)}`, 'function', name, modId, file);
    }
    for (const cls of sf.getClasses()) {
      const name = cls.getName();
      if (!name) continue;
      const classId = `class:${idFile}#${idName(name)}`;
      if (!registerDecl(cls, classId, 'class', name, modId, file)) continue;
      for (const m of cls.getMethods()) {
        registerDecl(m, `fn:${idFile}#${idName(name)}.${idName(m.getName())}`, 'function', `${name}.${m.getName()}`, classId, file);
      }
    }
  }

  const addEdge = (relation: Relation, source: string, target: string, file: string, at: Node, flows: GraphEdge['flows'], label?: string, evidenceId?: string) => {
    if (source === target) return null;
    const longId = `edge:${relation}:${source}->${target}`;
    const id = longId.length <= MAX_ID ? longId : `edge:${relation}:long:${sha256(longId).slice(0, 24)}`;
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
      const targetId = `mod:${idPart(rel(opts.root, target))}`;
      if (nodes.has(targetId) && nodes.has(`mod:${idPart(file)}`)) addEdge('imports', `mod:${idPart(file)}`, targetId, file, imp, []);
    }
  }

  // 4. Call / construct edges, and the router adapter.
  for (const { sf, rel: file } of files) {
    for (const expr of sf.getDescendants()) {
      if (Node.isCallExpression(expr)) {
        const owner = ownerOf(expr, declToId) ?? `mod:${idPart(file)}`;
        if (!nodes.has(owner)) continue;
        const target = resolveCallee(expr, declToId);
        if (target) addEdge('calls', owner, target, file, expr, ['request']);
        maybeRoute(expr, owner, file);
      } else if (Node.isNewExpression(expr)) {
        const owner = ownerOf(expr, declToId) ?? `mod:${idPart(file)}`;
        if (!nodes.has(owner)) continue;
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

  // 6. Importance (docs/EXPLORE_PLAN.md W11): a presentation ranking from structure, never from
  // truth status. Kind baseline, +0.35 on a named path, and up to +0.2 for a function by how many
  // calls, handlers and routes it takes part in (imports are not counted), saturating at six.
  const onPath = new Set(paths.flatMap((p) => p.node_ids));
  const base: Record<NodeKind, number> = { system: 1, cluster: 0.9, route: 0.6, module: 0.5, class: 0.45, function: 0.3, test: 0.2, assembly: 0.9, component: 0.6 };
  const links = new Map<string, number>();
  for (const e of edges.values()) {
    if (e.relation === 'imports') continue;
    links.set(e.source_id, (links.get(e.source_id) ?? 0) + 1);
    links.set(e.target_id, (links.get(e.target_id) ?? 0) + 1);
  }
  for (const n of nodes.values()) {
    const connected = n.kind === 'function' ? CONNECTED_BOOST * Math.min(1, (links.get(n.id) ?? 0) / CONNECTED_SATURATION) : 0;
    n.importance = Math.round(Math.min(1, base[n.kind] + (onPath.has(n.id) ? 0.35 : 0) + connected) * 1000) / 1000;
  }

  const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const graph: SystemGraph = {
    schema_version: '1.0',
    system_id: opts.systemId,
    system_kind: 'software',
    display_name: opts.displayName,
    revision: { kind: opts.gitRevision ? 'git' : 'content_hash', value: revision },
    nodes: [...nodes.values()].sort(byId),
    edges: [...edges.values()].sort(byId),
    paths,
  };
  return { graph, evidence: [...evidence.values()].sort(byId), declRanges: declRanges.sort((a, b) => (a.node_id < b.node_id ? -1 : 1)), revision, facts };
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

/** The declaration's own doc comment: the nearest one, never a file's license header. */
function docSummary(decl: Decl): string {
  const docs = decl.getJsDocs();
  const doc = docs[docs.length - 1]?.getDescription().trim() ?? '';
  return /^copyright\b/i.test(doc) ? '' : doc.replace(/\s+/g, ' ');
}

function moduleSummary(sf: SourceFile): string {
  const decls = [...sf.getFunctions(), ...sf.getClasses()].filter((d) => d.isExported());
  const first = decls.map((d) => docSummary(d)).find(Boolean);
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

