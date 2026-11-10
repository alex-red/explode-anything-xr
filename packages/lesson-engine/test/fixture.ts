import type { ContentBundle, Evidence, GraphEdge, GraphNode } from '@explode/contracts';

const sha = 'a'.repeat(64);
const src = (id: string, path: string): Evidence => ({
  id,
  kind: 'source_range',
  truth_status: 'static_verified',
  title: path,
  summary: '',
  source: { path, start_line: 1, end_line: 3, revision: 'git:abc', excerpt: 'x', excerpt_sha256: sha },
});
const node = (id: string, label: string, parent: string | null = 'cluster:app'): GraphNode => ({
  id,
  kind: parent ? 'function' : 'cluster',
  label,
  summary: `${label} summary`,
  parent_id: parent,
  truth_status: 'static_verified',
  evidence_ids: [`ev:src:${id}`],
  importance: 0.5,
});
const edge = (a: string, b: string, mutable = false): GraphEdge => ({
  id: `edge:${a}->${b}`,
  source_id: a,
  target_id: b,
  relation: 'calls',
  flows: ['request'],
  truth_status: 'static_verified',
  evidence_ids: [`ev:src:${a}`],
  is_mutable_in_sandbox: mutable,
});

export function miniBundle(withMutation = true): ContentBundle {
  const nodes = [
    node('cluster:app', 'App', null),
    node('fn:router', 'Router'),
    node('fn:login', 'Login handler'),
    node('fn:auth', 'AuthService.login'),
    node('fn:verify', 'password.verify'),
    node('fn:session', 'SessionStore.create'),
  ];
  const edges = [
    edge('fn:router', 'fn:login'),
    edge('fn:login', 'fn:auth'),
    edge('fn:auth', 'fn:verify', true),
    edge('fn:verify', 'fn:session'),
  ];
  const evidence: Evidence[] = nodes.map((n) => src(`ev:src:${n.id}`, `src/${n.id}.ts`));
  if (withMutation) {
    evidence.push({
      id: 'ev:mut:verify',
      kind: 'mutation_run',
      truth_status: 'observed',
      title: 'Mutation: skip password.verify',
      summary: '',
      run: {
        command: 'node --test',
        node_version: 'v24',
        recorded_at: '2026-10-24T00:00:00Z',
        exit_code: 1,
        passed: 3,
        failed: 2,
        failing_tests: ['login succeeds'],
        output_excerpt: 'not ok',
        output_sha256: sha,
      },
      mutation: { id: 'mut:verify', edge_id: 'edge:fn:auth->fn:verify', description: 'stub', file: 'src/auth.ts', diff: '-a\n+b' },
    });
  }
  const placements = Object.fromEntries(
    nodes.map((n, i) => [n.id, { collapsed: [0, 0, 0] as [number, number, number], exploded: [i * 0.05, 0, 0] as [number, number, number], radius: 0.02 }]),
  );
  return {
    bundle_version: '1',
    graph: {
      schema_version: '1.0',
      system_id: 'sys:mini',
      system_kind: 'software',
      display_name: 'Mini',
      revision: { kind: 'git', value: 'abc' },
      nodes,
      edges,
      paths: [
        {
          id: 'path:login',
          label: 'Login',
          flow: 'request',
          node_ids: ['fn:router', 'fn:login', 'fn:auth', 'fn:verify', 'fn:session'],
          edge_ids: edges.map((e) => e.id),
          truth_status: 'static_verified',
          evidence_ids: ['ev:src:fn:router'],
        },
      ],
    },
    evidence,
    layout: { system_id: 'sys:mini', anchor_distance: 0.65, cone_deg: { horizontal: 60, vertical: 50 }, placements },
    lessons: [
      {
        id: 'lesson:mini',
        system_id: 'sys:mini',
        title: 'Mini',
        objectives: ['understand'],
        break_edge_id: 'edge:fn:auth->fn:verify',
        repair_candidates: ['fn:verify', 'fn:session', 'fn:router'],
        misconception_on_wrong_prediction: 'assumes-failure-is-local',
        steps: [
          { id: 'step:intro', kind: 'intro', caption: 'Hi', expect: { type: 'next' }, on_enter: [] },
          { id: 'step:explode', kind: 'explode', caption: 'Pull apart', expect: { type: 'explode_at_least', factor: 0.8 }, on_enter: [] },
          { id: 'step:trace', kind: 'trace', caption: 'Trace', expect: { type: 'trace', path_id: 'path:login' }, on_enter: [] },
          {
            id: 'step:predict',
            kind: 'predict',
            caption: 'Predict',
            expect: { type: 'predict' },
            on_enter: [{ type: 'ask_prediction', question: 'What stops?' }],
            feedback: { correct: 'Yes', incorrect: 'Not quite' },
          },
          { id: 'step:break', kind: 'break', caption: 'Unplug', expect: { type: 'unplug', edge_id: 'edge:fn:auth->fn:verify' }, on_enter: [] },
          { id: 'step:repair', kind: 'repair', caption: 'Repair', expect: { type: 'repair', edge_id: 'edge:fn:auth->fn:verify' }, on_enter: [] },
        ],
      },
    ],
    assets: null,
    content_hash: sha,
    generated_at: '2026-10-24T00:00:00Z',
    generator: 'test',
  };
}
