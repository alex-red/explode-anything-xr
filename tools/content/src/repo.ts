import type { ContentBundle, Evidence, Lesson, SystemGraph } from '@explode/contracts';
import type { PathSpec } from '@explode/indexer';
import { indexRepository } from '@explode/indexer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BundleDraft } from './bundle.ts';
import { finalizeBundle } from './bundle.ts';
import type { MutationSpec, RecordedEvidence } from './evidence.ts';
import { recordEvidence } from './evidence.ts';
import { layoutSoftware } from './layout.ts';
import { REPO_DEMO_DIR, WORK_DIR } from './paths.ts';

export const REPO_SYSTEM_ID = 'system:auth-service';
export const LOGIN_PATH_ID = 'path:login-request';
export const MAIN_MUTATION_ID = 'mut:skip-session-create';
export const REPO_LESSON_ID = 'lesson:repo-login';
/** The incident drill (docs/WIN_PLAN.md W9) replays a different recorded mutation from the lesson's. */
export const DRILL_MUTATION_ID = 'mut:drop-body-parser';
export const DRILL_LESSON_ID = 'lesson:repo-incident';

/** Top-row clusters follow the login path left to right; supporting clusters below. */
const CLUSTER_ORDER = [
  'cluster:src/http',
  'cluster:src/routes',
  'cluster:src/auth',
  'cluster:src/sessions',
  'cluster:src/app',
  'cluster:src/users',
  'cluster:src/config',
  'cluster:src/audit',
];

export function buildRepoBundle(previous?: ContentBundle | null): ContentBundle {
  const fixtureDir = resolve(REPO_DEMO_DIR, 'fixture');
  const paths = JSON.parse(readFileSync(resolve(REPO_DEMO_DIR, 'paths.json'), 'utf8')) as PathSpec[];
  const mutations = JSON.parse(readFileSync(resolve(REPO_DEMO_DIR, 'mutations.json'), 'utf8')) as MutationSpec[];

  const indexed = indexRepository({
    root: fixtureDir,
    systemId: REPO_SYSTEM_ID,
    displayName: 'auth-service (sample TypeScript service)',
    paths,
  });
  const recorded = recordEvidence({
    fixtureDir,
    workRoot: resolve(WORK_DIR, 'repo-demo'),
    mutations,
    declRanges: indexed.declRanges,
    revision: indexed.revision,
    cachePath: resolve(REPO_DEMO_DIR, 'recorded-runs.json'),
  });

  const graph = applyRecordedEvidence(indexed.graph, recorded);
  const evidence: Evidence[] = [...indexed.evidence, recorded.baseline, ...recorded.mutations].sort((a, b) => (a.id < b.id ? -1 : 1));
  const draft: BundleDraft = {
    graph,
    evidence,
    layout: layoutSoftware(graph, CLUSTER_ORDER),
    lessons: [repoLesson(graph, recorded), drillLesson(graph, recorded)],
    assets: null,
  };
  return finalizeBundle(draft, previous);
}

/** Executed declarations become `observed`; mutated edges become sandbox-mutable (edges stay static). */
function applyRecordedEvidence(graph: SystemGraph, recorded: RecordedEvidence): SystemGraph {
  const executed = new Set(recorded.baseline.executed_node_ids);
  const mutable = new Set(recorded.mutations.map((m) => m.mutation.edge_id));
  for (const id of mutable) if (!graph.edges.some((e) => e.id === id)) throw new Error(`mutation targets unknown edge ${id}`);
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      executed.has(n.id) ? { ...n, truth_status: 'observed' as const, evidence_ids: [...n.evidence_ids, recorded.baseline.id] } : n,
    ),
    edges: graph.edges.map((e) => (mutable.has(e.id) ? { ...e, is_mutable_in_sandbox: true } : e)),
  };
}

function repoLesson(graph: SystemGraph, recorded: RecordedEvidence): Lesson {
  const main = recorded.mutations.find((m) => m.mutation.id === MAIN_MUTATION_ID);
  if (!main) throw new Error(`missing main mutation ${MAIN_MUTATION_ID}`);
  const edge = graph.edges.find((e) => e.id === main.mutation.edge_id)!;
  const label = (id: string) => graph.nodes.find((n) => n.id === id)!.label;
  const src = label(edge.source_id);
  const dst = label(edge.target_id);
  const total = main.run.passed + main.run.failed;
  const loginPath = graph.paths.find((p) => p.id === LOGIN_PATH_ID)!;
  const clusters = graph.nodes.filter((n) => n.kind === 'cluster').length;
  const wrongSockets = ['fn:src/sessions/store.ts#sessionstore.revoke', 'fn:src/auth/tokens.ts#signtoken'];
  for (const id of wrongSockets) if (!graph.nodes.some((n) => n.id === id)) throw new Error(`unknown socket ${id}`);

  return {
    id: REPO_LESSON_ID,
    system_id: graph.system_id,
    title: 'What happens when someone logs in?',
    objectives: [
      'Trace a login request through real source, step by step.',
      `Predict what fails when ${src} stops calling ${dst}, then check against a recorded test run.`,
      'Repair the connection and explain why the failure was not local.',
    ],
    break_edge_id: edge.id,
    repair_candidates: [wrongSockets[0]!, edge.target_id, wrongSockets[1]!],
    misconception_on_wrong_prediction: 'assumes-failure-is-local',
    steps: [
      {
        id: 'step:repo-intro',
        kind: 'intro',
        caption: 'This is auth-service, a small TypeScript service written as a sample for EXPLODE. Its graph was built from the actual source.',
        expect: { type: 'next' },
        on_enter: [],
      },
      {
        id: 'step:repo-explode',
        kind: 'explode',
        caption: `Press Explode to see its ${clusters} subsystems, or pull it apart with both hands.`,
        hint: 'Press Explode. You can also pinch with both hands and pull them apart.',
        expect: { type: 'explode_at_least', factor: 0.8 },
        on_enter: [],
      },
      {
        id: 'step:repo-trace',
        kind: 'trace',
        caption: 'What happens when someone logs in? Press Trace Login to follow the request.',
        hint: 'The Trace Login button is in the panel next to you.',
        expect: { type: 'trace', path_id: LOGIN_PATH_ID },
        on_enter: [{ type: 'focus', target_id: loginPath.node_ids[0]! }],
      },
      {
        id: 'step:repo-evidence',
        kind: 'explain',
        caption: `Each of the ${loginPath.node_ids.length} steps exists in the source. Select one and open its evidence to see the lines.`,
        hint: 'Select any glowing part, then press Evidence.',
        expect: { type: 'open_evidence' },
        on_enter: [],
      },
      {
        id: 'step:repo-predict',
        kind: 'predict',
        caption: `Suppose ${src} stopped calling ${dst}. Which step would fail first? Point at it.`,
        hint: 'Steps before the missing call still run. Look for the first step that would no longer be called.',
        expect: { type: 'predict' },
        on_enter: [
          { type: 'highlight', target_ids: [edge.source_id, edge.target_id] },
          { type: 'ask_prediction', question: `If ${src} stops calling ${dst}, which step fails first?` },
        ],
        feedback: {
          correct: `Right. ${dst} never runs, so no session is created and no token is signed.`,
          incorrect: `Not quite. Steps before the missing call still run. The failure starts at ${dst} and spreads to everything after it.`,
        },
      },
      {
        id: 'step:repo-break',
        kind: 'break',
        caption: `Now test it. Unplug the call from ${src} to ${dst}. The real repository is not changed.`,
        hint: 'Select the highlighted connection, then press Unplug.',
        expect: { type: 'unplug', edge_id: edge.id },
        on_enter: [{ type: 'focus', target_id: edge.source_id }],
      },
      {
        id: 'step:repo-observe',
        kind: 'observe',
        caption: `Observed: with this call removed, ${main.run.failed} of ${total} tests failed in a test run recorded when this content was built. Open the evidence to see which.`,
        expect: { type: 'next' },
        on_enter: [{ type: 'show_evidence', evidence_id: main.id }],
      },
      {
        id: 'step:repo-repair',
        kind: 'repair',
        caption: 'Reconnect the call. Three sockets are offered, and only one is right.',
        hint: `${src} needs to create the session before anything can be signed.`,
        expect: { type: 'repair', edge_id: edge.id },
        on_enter: [],
      },
      {
        id: 'step:repo-reflect',
        kind: 'reflect',
        caption: 'The failure was not local. One missing call stopped everything after it on the login path, and the tests caught it.',
        expect: { type: 'next' },
        on_enter: [{ type: 'animate_flow', path_id: LOGIN_PATH_ID }],
      },
    ],
  };
}

/**
 * An unguided incident drill: the system starts with a recorded mutation's connection cut. The
 * learner gets only the symptom (the recorded failing tests), finds the cut, names the first part
 * that never gets the request, and repairs it. Every figure comes from the recorded runs.
 */
function drillLesson(graph: SystemGraph, recorded: RecordedEvidence): Lesson {
  const drill = recorded.mutations.find((m) => m.mutation.id === DRILL_MUTATION_ID);
  if (!drill) throw new Error(`missing drill mutation ${DRILL_MUTATION_ID}`);
  const edge = graph.edges.find((e) => e.id === drill.mutation.edge_id)!;
  if (!edge.is_mutable_in_sandbox) throw new Error(`drill edge ${edge.id} is not sandbox-mutable`);
  const loginPath = graph.paths.find((p) => p.id === LOGIN_PATH_ID)!;
  if (!loginPath.edge_ids.includes(edge.id)) throw new Error(`drill edge ${edge.id} is not on ${LOGIN_PATH_ID}`);
  const label = (id: string) => graph.nodes.find((n) => n.id === id)!.label;
  const src = label(edge.source_id);
  const dst = label(edge.target_id);
  const total = drill.run.passed + drill.run.failed;
  const symptom = drill.run.failing_tests[0];
  if (!symptom) throw new Error(`drill mutation ${DRILL_MUTATION_ID} recorded no failing test`);
  // Wrong sockets: the two parts just after the right one on the login path.
  const at = loginPath.node_ids.indexOf(edge.target_id);
  const wrong = [loginPath.node_ids[at + 1], loginPath.node_ids[at + 2]].filter((id): id is string => !!id);
  if (wrong.length !== 2) throw new Error('drill needs two wrong sockets after its target on the login path');
  const baseline = recorded.baseline.run;

  return {
    id: DRILL_LESSON_ID,
    system_id: graph.system_id,
    title: 'Incident: logins are failing',
    objectives: ['Find a cut connection from its symptom alone.', 'Name what it stops, then repair it.'],
    break_edge_id: edge.id,
    starts_broken: true,
    repair_candidates: [wrong[0]!, edge.target_id, wrong[1]!],
    misconception_on_wrong_prediction: 'assumes-failure-is-local',
    steps: [
      {
        id: 'step:drill-intro',
        kind: 'intro',
        caption: `Incident: in a test run recorded when this content was built, ${drill.run.failed} of ${total} tests failed, including “${symptom}”. One connection in auth-service is cut. Find it.`,
        expect: { type: 'next' },
        on_enter: [],
      },
      {
        id: 'step:drill-explode',
        kind: 'explode',
        caption: 'Open it up: press Explode, or pull it apart with both hands.',
        hint: 'Press Explode. You can also pinch with both hands and pull them apart.',
        expect: { type: 'explode_at_least', factor: 0.8 },
        on_enter: [],
      },
      {
        id: 'step:drill-find',
        kind: 'predict',
        caption: 'Find the cut. Which part is the first that never gets the request? Point at it.',
        hint: 'A cut connection shows as a short coral stub, and its plug waits in the tray. Which side of it stops?',
        expect: { type: 'predict' },
        on_enter: [{ type: 'ask_prediction', question: 'Which part is the first to stop?' }],
        feedback: {
          correct: `Right. ${src} no longer hands the request on, so ${dst} and everything after it never run.`,
          incorrect: `Not quite. The cut is between ${src} and ${dst}: ${dst} is the first part that never gets the request.`,
        },
      },
      {
        id: 'step:drill-observe',
        kind: 'observe',
        caption: `Observed: with this connection cut, ${drill.run.failed} of ${total} tests failed in the recorded run. The evidence lists them.`,
        expect: { type: 'next' },
        on_enter: [{ type: 'show_evidence', evidence_id: drill.id }],
      },
      {
        id: 'step:drill-repair',
        kind: 'repair',
        caption: 'Plug the connection back into the right socket.',
        hint: `${src} hands the request to ${dst}.`,
        expect: { type: 'repair', edge_id: edge.id },
        on_enter: [],
      },
      {
        id: 'step:drill-reflect',
        kind: 'reflect',
        caption: `Resolved. You found the cut from its symptom, named what it stopped, and restored the flow. With nothing cut, all ${baseline.passed} of ${baseline.passed + baseline.failed} tests passed in the recorded baseline run.`,
        expect: { type: 'next' },
        on_enter: [{ type: 'animate_flow', path_id: LOGIN_PATH_ID }],
      },
    ],
  };
}

