import type { Evidence, RunRecord } from '@explode/contracts';
import { canonicalJson } from '@explode/contracts';
import type { DeclRange } from '@explode/indexer';
import { sha256 } from '@explode/indexer';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TEST_ARGS = ['--test', '--test-concurrency=1', '--test-reporter=tap', 'test/*.test.ts'];
export const TEST_COMMAND = `node ${TEST_ARGS.join(' ')}`;

export interface MutationSpec {
  id: string;
  edge_id: string;
  file: string;
  find: string;
  replace: string;
  description: string;
}

export interface RecordedEvidence {
  baseline: Extract<Evidence, { kind: 'test_run' }>;
  mutations: Extract<Evidence, { kind: 'mutation_run' }>[];
}

interface RunCache {
  runs: Record<string, { inputs_sha256: string; record: RunRecord }>;
}

/**
 * Build-time evidence (ADR-0007): run the fixture's tests once with V8 coverage (node-level
 * `observed`), then once per declarative mutation (edge-level failure evidence).
 * Runs are always re-executed; a cached record (and its original timestamp) is kept only when
 * the inputs and the normalized result are identical, so bundles stay byte-stable.
 */
export function recordEvidence(opts: {
  fixtureDir: string;
  workRoot: string;
  mutations: MutationSpec[];
  declRanges: DeclRange[];
  revision: string;
  cachePath: string;
}): RecordedEvidence {
  rmSync(opts.workRoot, { recursive: true, force: true });
  mkdirSync(opts.workRoot, { recursive: true });
  const cache: RunCache = existsSync(opts.cachePath) ? JSON.parse(readFileSync(opts.cachePath, 'utf8')) : { runs: {} };
  const nextCache: RunCache = { runs: {} };

  const keep = (key: string, inputs: string, fresh: RunRecord): RunRecord => {
    const prev = cache.runs[key];
    const same =
      prev &&
      prev.inputs_sha256 === inputs &&
      prev.record.output_sha256 === fresh.output_sha256 &&
      prev.record.exit_code === fresh.exit_code &&
      prev.record.passed === fresh.passed &&
      prev.record.failed === fresh.failed;
    const record = same ? prev.record : fresh;
    nextCache.runs[key] = { inputs_sha256: inputs, record };
    return record;
  };

  // Baseline with coverage.
  const baseDir = join(opts.workRoot, 'baseline');
  cpSync(opts.fixtureDir, baseDir, { recursive: true });
  const coverageDir = join(opts.workRoot, 'coverage-baseline');
  const base = runTests(baseDir, coverageDir);
  if (base.exit_code !== 0 || base.failed > 0) {
    throw new Error(`fixture tests must pass before recording evidence:\n${base.output_excerpt}`);
  }
  const baseRecord = keep('baseline', sha256(`${opts.revision}\0${TEST_COMMAND}`), base);
  const executed = executedNodes(baseDir, coverageDir, opts.declRanges);

  const baseline: RecordedEvidence['baseline'] = {
    id: 'ev:run:baseline',
    kind: 'test_run',
    truth_status: 'observed',
    title: 'Recorded test run (build time)',
    summary: `All ${baseRecord.passed} tests passed when this content was built. ${executed.length} indexed functions ran during the run (V8 coverage).`,
    run: baseRecord,
    executed_node_ids: executed,
  };

  const mutations = opts.mutations.map((m): RecordedEvidence['mutations'][number] => {
    const dir = join(opts.workRoot, m.id.replace(/[^a-z0-9-]/g, '_'));
    cpSync(opts.fixtureDir, dir, { recursive: true });
    const target = join(dir, m.file);
    const src = readFileSync(target, 'utf8');
    const occurrences = src.split(m.find).length - 1;
    if (occurrences !== 1) throw new Error(`mutation ${m.id}: expected exactly one match in ${m.file}, found ${occurrences}`);
    writeFileSync(target, src.replace(m.find, m.replace));
    const fresh = runTests(dir);
    if (fresh.exit_code === 0 || fresh.failed === 0) throw new Error(`mutation ${m.id} did not make any test fail`);
    const record = keep(m.id, sha256(`${opts.revision}\0${TEST_COMMAND}\0${canonicalJson(m)}`), fresh);
    return {
      id: `ev:run:${m.id}`,
      kind: 'mutation_run',
      truth_status: 'observed',
      title: `Recorded mutation run: ${record.failed} of ${record.passed + record.failed} tests failed`,
      summary: `${m.description} Recorded at build time in an isolated copy; the real source is unchanged.`,
      run: record,
      mutation: {
        id: m.id,
        edge_id: m.edge_id,
        description: m.description,
        file: m.file,
        diff: `--- a/${m.file}\n+++ b/${m.file}\n${prefix(m.find, '-')}\n${prefix(m.replace, '+')}`,
      },
    };
  });

  writeFileSync(opts.cachePath, `${JSON.stringify(sortRuns(nextCache), null, 2)}\n`);
  return { baseline, mutations };
}

function runTests(cwd: string, coverageDir?: string): RunRecord {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_DISABLE_COLORS: '1', FORCE_COLOR: '0' };
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  if (coverageDir) env.NODE_V8_COVERAGE = coverageDir;
  else delete env.NODE_V8_COVERAGE;
  const res = spawnSync(process.execPath, TEST_ARGS, { cwd, env, encoding: 'utf8', timeout: 60_000 });
  const raw = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const normalized = normalizeOutput(raw, cwd);
  const num = (label: string) => Number(new RegExp(`^# ${label} (\\d+)$`, 'm').exec(normalized)?.[1] ?? 0);
  const passed = num('pass');
  const failed = num('fail');
  const failing = failingTests(normalized);
  return {
    command: TEST_COMMAND,
    node_version: process.version,
    recorded_at: new Date().toISOString(),
    exit_code: res.status ?? 1,
    passed,
    failed,
    failing_tests: failing.map((f) => f.name),
    output_excerpt: excerpt(passed, failed, failing),
    output_sha256: sha256(normalized),
  };
}

/** Strip timings and machine-specific paths so equal runs hash equally. */
export function normalizeOutput(raw: string, cwd: string): string {
  return raw
    .split(cwd)
    .join('<fixture>')
    .split('\n')
    .filter((l) => !/duration_ms/.test(l))
    .join('\n');
}

function failingTests(tap: string): { name: string; error: string }[] {
  const out: { name: string; error: string }[] = [];
  const lines = tap.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^not ok \d+ - (.+)$/.exec(lines[i]!);
    if (!m) continue;
    let error = '';
    for (let j = i + 1; j < lines.length && !/^(ok|not ok) \d+/.test(lines[j]!); j++) {
      const e = /^ {2}error: (.*)$/.exec(lines[j]!);
      if (!e) continue;
      error = e[1]!.startsWith('|') ? (lines[j + 1] ?? '').trim() : e[1]!.replace(/^'|'$/g, '');
      break;
    }
    out.push({ name: m[1]!, error });
  }
  return out;
}

function excerpt(passed: number, failed: number, failing: { name: string; error: string }[]): string {
  const head = `tests ${passed + failed} · pass ${passed} · fail ${failed}`;
  const body = failing.map((f) => `✗ ${f.name}${f.error ? `\n  ${f.error}` : ''}`).join('\n');
  const text = body ? `${head}\n${body}` : head;
  return text.length > 1500 ? `${text.slice(0, 1499)}…` : text;
}

interface V8Coverage {
  result: { url: string; functions: { functionName: string; ranges: { startOffset: number; endOffset: number; count: number }[] }[] }[];
}

/** Map executed V8 function ranges to indexed declarations (type stripping preserves offsets). */
export function executedNodes(fixtureCopy: string, coverageDir: string, declRanges: DeclRange[]): string[] {
  const prefix = `${pathToFileURL(join(fixtureCopy, '/')).href}`;
  const executed: { file: string; name: string; start: number; end: number }[] = [];
  for (const name of readdirSync(coverageDir).sort()) {
    if (!name.endsWith('.json')) continue;
    const cov = JSON.parse(readFileSync(join(coverageDir, name), 'utf8')) as V8Coverage;
    for (const script of cov.result) {
      if (!script.url.startsWith(`${prefix}src/`)) continue;
      const file = script.url.slice(prefix.length);
      for (const fn of script.functions) {
        const r = fn.ranges[0];
        if (r && r.count > 0) executed.push({ file, name: fn.functionName, start: r.startOffset, end: r.endOffset });
      }
    }
  }
  const ids = new Set<string>();
  for (const d of declRanges) {
    const hit =
      d.kind === 'class'
        ? // A class counts as executed when its constructor or field initializers ran.
          executed.some((x) => x.file === d.file && x.start >= d.start && x.end <= d.end && (x.name === d.name || x.name === '<instance_members_initializer>'))
        : executed.some((x) => x.file === d.file && Math.abs(x.end - d.end) <= 1 && x.start >= d.start && x.start - d.start <= 30);
    if (hit) ids.add(d.node_id);
  }
  return [...ids].sort();
}

function prefix(text: string, mark: string): string {
  return text
    .split('\n')
    .map((l) => `${mark}${l}`)
    .join('\n');
}

function sortRuns(c: RunCache): RunCache {
  return { runs: Object.fromEntries(Object.entries(c.runs).sort(([a], [b]) => (a < b ? -1 : 1))) };
}
