import type { ContentBundle, Evidence, Lesson } from '@explode/contracts';
import type { IndexResult, PathSpec } from '@explode/indexer';
import { indexRepository, sha256 } from '@explode/indexer';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { BundleDraft } from './bundle.ts';
import { finalizeBundle } from './bundle.ts';
import { layoutSoftware } from './layout.ts';
import type { PartGraph, Selection } from './relevance.ts';
import { Curation, buildDigest, curationProblems, partGraph, partShortName, selectRelevant } from './relevance.ts';

/**
 * Any public repository, drawn the way the Immersive Web SDK is (ADR-0025, ADR-0026): indexed
 * from source, folded to its most relevant parts, under parent nodes a model chose.
 *
 * Unlike `sdk.ts`, nothing here is prepared by hand. The source is whatever was unpacked into
 * `root`; the traced call chain is derived from the call graph; package names of a monorepo are
 * read from its `package.json` files.
 *
 * Truth contract (ADR-0007): the repository's code is never installed or run, so nothing is
 * `observed` and no connection can be unplugged. Parts, connections and the traced chain are
 * `static_verified` and cite the lines they came from. The groups are a model's and are `inferred`.
 */

/** Where the source came from. Every field is as the host reported it; none is chosen by a model. */
export interface RepoSource {
  /** `owner/name`, as written on the host. */
  full_name: string;
  /** The page a person would open, e.g. https://github.com/owner/name. */
  url: string;
  /** The full commit id the source was read at. */
  commit: string;
  /** The licence as the host reports it; null when it reports none. */
  license: { spdx: string; name: string } | null;
}

/** Fewer parts than this and there is nothing to explode. */
export const MIN_PARTS = 8;
/** A curation needs four groups, and a group needs a file of its own. */
export const MIN_FILES = 4;
export const ANY_BUDGET = { budget: 46, perGroupMin: 3, perGroupMax: 8, maxEdges: 64 } as const;
/** Parts on the traced chain, at most. */
const MAX_CHAIN = 6;
/** Callees tried from each part while looking for the longest chain. */
const CHAIN_BRANCH = 4;

const SOURCE_GLOBS = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];
const JS_GLOBS = ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'];

/** The system id of a repository at a commit: lowercase and inside the id contract. */
export function repoSystemId(source: RepoSource): string {
  const name = source.full_name.toLowerCase().replace(/[^a-z0-9._/-]/g, '-');
  return `system:gh/${name}@${source.commit.slice(0, 12)}`.slice(0, 200);
}

/** JSON as config files write it: comments and trailing commas allowed. Null when it is not that. */
function parseLooseJson(text: string): unknown {
  const bare = text.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, str: string | undefined) => str ?? '').replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(bare);
  } catch {
    return null;
  }
}

const CONFIG_FILES = ['tsconfig.json', 'tsconfig.base.json', 'jsconfig.json'];

/**
 * How imports that are not relative paths resolve inside the repository, so a call across
 * packages or through an alias still finds its declaration:
 *
 * - package names of a monorepo: `@scope/pkg` resolves to that package's `index` file under `src`
 *   (or beside its manifest);
 * - `compilerOptions.paths` of the `tsconfig.json` or `jsconfig.json` files, relative to their
 *   own `baseUrl` (`extends` is not followed).
 *
 * A name that maps to nothing in the repository is left out, and its imports then draw no
 * connection. When two places define the same name, the first in path order is kept.
 */
export function workspacePaths(root: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const aliases = (dir: string) => {
    for (const file of CONFIG_FILES) {
      const at = join(root, dir, file);
      if (!existsSync(at)) continue;
      const options = (parseLooseJson(readFileSync(at, 'utf8')) as { compilerOptions?: { baseUrl?: unknown; paths?: unknown } } | null)?.compilerOptions;
      if (!options?.paths || typeof options.paths !== 'object') continue;
      const base = posix.join(dir, typeof options.baseUrl === 'string' ? options.baseUrl : '.');
      for (const [key, targets] of Object.entries(options.paths as Record<string, unknown>)) {
        if (key in out || !Array.isArray(targets)) continue;
        const mapped = targets.filter((t): t is string => typeof t === 'string').map((t) => posix.normalize(posix.join(base, t)));
        // Stay inside the repository.
        if (mapped.length && mapped.every((t) => !t.startsWith('..') && !t.startsWith('/'))) out[key] = mapped;
      }
    }
  };
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    aliases(dir);
    const manifest = join(root, dir, 'package.json');
    if (dir !== '' && existsSync(manifest)) {
      try {
        const name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name;
        if (typeof name === 'string' && /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) {
          for (const base of ['src', '']) {
            const index = ['index.ts', 'index.tsx', 'index.mts', 'index.js', 'index.mjs'].map((f) => posix.join(dir, base, f)).find((f) => existsSync(join(root, f)));
            if (!index) continue;
            out[name] = [index];
            out[`${name}/*`] = [posix.join(dir, base, '*')];
            break;
          }
        }
      } catch {
        // Not JSON: this directory names no package.
      }
    }
    let entries: string[];
    try {
      entries = readdirSync(join(root, dir)).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const child = dir === '' ? entry : posix.join(dir, entry);
      if (statSync(join(root, child)).isDirectory()) walk(child, depth + 1);
    }
  };
  walk('', 0);
  return out;
}

export interface RepoIndex {
  index: IndexResult;
  pg: PartGraph;
  digest: { text: string; dirs: string[]; part_ids: string[]; sha256: string };
  counts: { files: number; declarations: number; parts: number; connections: number };
}

/** Index everything unpacked under `root`. Slow for a large repository: run it off the main thread. */
export function indexAnyRepo(root: string, source: RepoSource): RepoIndex {
  const tsPaths = workspacePaths(root);
  const index = indexRepository({
    root,
    systemId: repoSystemId(source),
    displayName: displayName(source),
    include: [...SOURCE_GLOBS, ...JS_GLOBS],
    allowJs: true,
    bundlerResolution: true,
    constFunctions: true,
    normalizeIds: true,
    gitRevision: source.commit,
    ...(Object.keys(tsPaths).length ? { tsPaths } : {}),
  });
  const pg = partGraph(index);
  const digest = buildDigest(pg);
  return {
    index,
    pg,
    digest: { ...digest, sha256: sha256(digest.text) },
    counts: {
      files: index.graph.nodes.filter((n) => n.kind === 'module').length,
      declarations: index.graph.nodes.filter((n) => n.kind === 'class' || n.kind === 'function').length,
      parts: pg.parts.size,
      connections: pg.links.length,
    },
  };
}

/** Why this index cannot be exploded, in words for the learner; null when it can. */
export function tooSmall(repo: RepoIndex): string | null {
  if (repo.counts.files < MIN_FILES || repo.counts.parts < MIN_PARTS) {
    return `Only ${repo.counts.parts} classes and functions in ${repo.counts.files} files could be read from it, which is too few to explode.`;
  }
  return null;
}

function displayName(source: RepoSource): string {
  const name = source.full_name.split('/').pop() ?? source.full_name;
  const full = `${name} (${source.full_name})`;
  return full.length <= 80 ? full : source.full_name.slice(0, 80);
}

/** The group a part falls in: the longest member path that holds its file. Mirrors `selectRelevant`. */
function groupedParts(curation: Curation, pg: PartGraph): Set<string> {
  const inPrefix = (file: string, member: string) => {
    const m = member.replace(/\/+$/, '');
    return file === m || file.startsWith(`${m}/`);
  };
  const out = new Set<string>();
  for (const p of pg.parts.values()) if (curation.groups.some((g) => g.members.some((m) => inPrefix(p.file, m)))) out.add(p.id);
  return out;
}

/**
 * Make a model's curation safe to select from: drop what it singled out that sits in no group or
 * shares a short name with something kept earlier. Nothing is added and no text is changed.
 */
export function usableCuration(curation: Curation, pg: PartGraph): Curation {
  const grouped = groupedParts(curation, pg);
  const taken = new Set<string>();
  const keep = (id: string) => {
    const part = pg.parts.get(id);
    if (!part || !grouped.has(id)) return false;
    const name = partShortName(part.label);
    if (name === '' || taken.has(name)) return false;
    taken.add(name);
    return true;
  };
  const kept = new Set<string>();
  const entry_points = curation.entry_points.filter((id) => !kept.has(id) && keep(id) && kept.add(id));
  const spotlight = curation.spotlight.filter((s) => kept.has(s.id) || (keep(s.id) && kept.add(s.id)));
  return { ...curation, entry_points, spotlight };
}

/**
 * One real chain of calls to trace, derived from the call graph: the longest chain (up to six
 * parts) that starts at one of the curation's entry points, or failing that at the strongest part
 * that calls anything. Every hop is an indexed call or construction between two parts; the chain
 * only chooses which of them to show. Null when nothing calls anything.
 */
export function deriveChain(curation: Curation, pg: PartGraph): PathSpec | null {
  const grouped = groupedParts(curation, pg);
  const fixed = new Set([...curation.entry_points, ...curation.spotlight.map((s) => s.id)]);
  const fixedNames = new Set([...fixed].map((id) => partShortName(pg.parts.get(id)?.label ?? '')));
  const usable = (id: string) => {
    if (!grouped.has(id)) return false;
    if (fixed.has(id)) return true;
    const name = partShortName(pg.parts.get(id)!.label);
    return name !== '' && !fixedNames.has(name);
  };
  const callees = new Map<string, string[]>();
  for (const l of pg.links) {
    if (!usable(l.source) || !usable(l.target)) continue;
    const list = callees.get(l.source) ?? [];
    list.push(l.target);
    callees.set(l.source, list);
  }
  const score = (id: string) => pg.parts.get(id)!.score;
  for (const list of callees.values()) list.sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1));

  let best: string[] = [];
  let bestScore = -1;
  const names = new Set<string>();
  const walk = (chain: string[], total: number) => {
    if (chain.length > best.length || (chain.length === best.length && total > bestScore)) {
      best = [...chain];
      bestScore = total;
    }
    if (chain.length >= MAX_CHAIN) return;
    let tried = 0;
    for (const next of callees.get(chain[chain.length - 1]!) ?? []) {
      const name = partShortName(pg.parts.get(next)!.label);
      if (chain.includes(next) || names.has(name)) continue;
      if (tried++ >= CHAIN_BRANCH) break;
      names.add(name);
      chain.push(next);
      walk(chain, total + score(next));
      chain.pop();
      names.delete(name);
    }
  };
  const starts = [...curation.entry_points.filter(usable), ...[...callees.keys()].sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1)).slice(0, 8)];
  for (const start of starts) {
    names.clear();
    names.add(partShortName(pg.parts.get(start)!.label));
    walk([start], score(start));
    // An entry point with a real chain behind it wins over a longer chain from anywhere else.
    if (best.length >= 3 && curation.entry_points.includes(best[0]!)) break;
  }
  if (best.length < 2) return null;
  const from = pg.parts.get(best[0]!)!.label;
  return { id: 'path:calls', label: `the calls from ${from}`.slice(0, 60), flow: 'control', node_ids: best };
}

export interface RepoBuildResult {
  bundle: ContentBundle;
  stats: Selection['stats'];
}

/**
 * Check a model's answer against the index and, when it fits, build the bundle. The answer is the
 * model's JSON as text, exactly as returned. Problems are returned to be sent back to the model;
 * nothing is repaired here.
 */
export function buildFromCuration(
  repo: RepoIndex,
  source: RepoSource,
  answer: string,
  producedBy: { provider: string; model: string; created_at: string },
): { ok: true; result: RepoBuildResult } | { ok: false; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(answer);
  } catch (err) {
    return { ok: false, problems: [`not JSON: ${(err as Error).message}`] };
  }
  const parsed = Curation.safeParse({
    schema_version: '1',
    source: { repository: source.url, commit: source.commit },
    produced_by: { ...producedBy, digest_sha256: repo.digest.sha256 },
    ...(raw as object),
  });
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const problems = curationProblems(parsed.data, repo.pg);
  if (problems.length) return { ok: false, problems };

  const curation = usableCuration(parsed.data, repo.pg);
  const chain = deriveChain(curation, repo.pg);
  let selection: Selection;
  try {
    selection = selectRelevant(repo.index, curation, {
      ...ANY_BUDGET,
      paths: chain ? [chain] : [],
      systemId: repoSystemId(source),
      displayName: displayName(source),
      skipDuplicateNames: true,
    });
  } catch (err) {
    // A group whose every part clashes with a stronger one, for instance.
    return { ok: false, problems: [(err as Error).message] };
  }
  const license: Evidence = {
    id: 'ev:license:source',
    kind: 'asset_license',
    // The host's own reading of the repository, not something this build checked.
    truth_status: 'inferred',
    title: `Source: ${source.full_name}`.slice(0, 120),
    summary: `Every excerpt in this system is quoted from ${source.full_name} at commit ${source.commit.slice(0, 12)}, fetched from GitHub when this was built. Licence as GitHub reports it: ${source.license ? source.license.name : 'none detected'}. Not affiliated with or endorsed by its authors.`.slice(0, 400),
    license: {
      name: source.license?.name ?? 'No licence detected',
      ...(source.license ? { spdx: source.license.spdx } : {}),
      url: source.url,
      attribution: `The authors of ${source.full_name}`,
    },
  };
  const draft: BundleDraft = {
    graph: selection.graph,
    evidence: [...selection.evidence, license].sort((a, b) => (a.id < b.id ? -1 : 1)),
    layout: layoutSoftware(
      selection.graph,
      curation.groups.map((g) => `concept:${g.id}`),
    ),
    lessons: [tourLesson(selection, curation, source)],
    assets: null,
  };
  return { ok: true, result: { bundle: finalizeBundle(draft), stats: selection.stats } };
}

/** The same tour the SDK gets (`sdk.ts`), with every figure counted from this index. */
function tourLesson(selection: Selection, curation: Curation, source: RepoSource): Lesson {
  const { graph, stats } = selection;
  const path = graph.paths[0];
  const model = curation.produced_by.model;
  const steps: Lesson['steps'] = [
    {
      id: 'step:tour-intro',
      kind: 'intro',
      caption: `This is ${source.full_name}, read from GitHub at commit ${source.commit.slice(0, 7)}. Its source was indexed just now: ${stats.indexed.files} files, ${stats.indexed.declarations} declarations. None of it was run.`,
      expect: { type: 'next' },
      on_enter: [],
    },
    {
      id: 'step:tour-explode',
      kind: 'explode',
      caption: `Nobody can read ${stats.indexed.declarations} parts at once. Press Explode to see the ${stats.shown.parts} that the call graph ranks highest, in ${stats.shown.groups} groups.`,
      hint: 'Press Explode. You can also pinch with both hands and pull them apart.',
      expect: { type: 'explode_at_least', factor: 0.8 },
      on_enter: [],
    },
    {
      id: 'step:tour-groups',
      kind: 'explain',
      caption: `The ${stats.shown.groups} glowing groups were chosen by an AI model (${model}) from a digest of the index, so each is marked a hypothesis. The parts inside were ranked from the call graph and come straight from the source.`,
      expect: { type: 'next' },
      on_enter: [{ type: 'highlight', target_ids: graph.nodes.filter((n) => n.role === 'concept').map((n) => n.id) }],
    },
  ];
  if (path) {
    steps.push({
      id: 'step:tour-trace',
      kind: 'trace',
      caption: `Follow one real chain of calls. Press Trace ${path.label}.`,
      hint: 'The Trace button is in the panel next to you.',
      expect: { type: 'trace', path_id: path.id },
      on_enter: [{ type: 'clear_highlight' }, { type: 'focus', target_id: path.node_ids[0]! }],
    });
  }
  steps.push(
    {
      id: 'step:tour-evidence',
      kind: 'explain',
      caption: path
        ? `Each of the ${path.node_ids.length} steps is a call found in the source. Select one and open its evidence to see the lines.`
        : 'Every part comes from the source. Select one and open its evidence to see the lines.',
      hint: 'Select any part, then press Evidence.',
      expect: { type: 'open_evidence' },
      on_enter: path ? [] : [{ type: 'clear_highlight' }],
    },
    {
      id: 'step:tour-reflect',
      kind: 'reflect',
      caption: `That is ${stats.shown.parts} of ${stats.indexed.parts} classes and functions. Nothing here was run, so nothing is marked observed, and no connection can be unplugged. Explore freely.`,
      expect: { type: 'next' },
      on_enter: path ? [{ type: 'animate_flow', path_id: path.id }] : [],
    },
  );
  // A long repository name must not push a caption past what the contract (and the panel) holds.
  for (const step of steps) if (step.caption.length > 280) step.caption = `${step.caption.slice(0, 279)}…`;
  return {
    // One id per repository at a commit, so finishing one tour does not mark another as done.
    id: `lesson:tour:${graph.system_id.slice('system:'.length)}`.slice(0, 200),
    system_id: graph.system_id,
    title: `Explode ${source.full_name}`.slice(0, 80),
    objectives: ['See a codebase through its most relevant parts.', 'Tell what an AI chose from what the source proves.'],
    repair_candidates: [],
    steps,
  };
}
