/**
 * Latency spike for Meta's Model API (docs/EXPLORE_PLAN.md W12, step M4).
 *
 *   node --env-file=.env services/tutor-proxy/scripts/meta-spike.ts [model ...]
 *
 * Ten real turns per model against the real repo-demo bundle, through the same prompt, graph
 * context, turn text and `callMeta` the Worker uses, then `validateTutorPlan` as the Worker does.
 * The upstream timeout is raised to 30 s so slow answers are measured rather than cut off.
 * Gate: p95 under 4 s and at least 9 of 10 valid plans. Prints no key.
 */
import type { TutorTurnRequest } from '@explode/contracts';
import { validateTutorPlan } from '@explode/lesson-engine';
import repoDemo from '../../../apps/quest/src/content/repo-demo.bundle.json' with { type: 'json' };
import { createRegistry } from '../src/bundles.ts';
import { buildGraphContext, buildTurnText, SYSTEM_PROMPT } from '../src/context.ts';
import { callMeta } from '../src/meta.ts';

const apiKey = process.env.META_API_KEY;
if (!apiKey) {
  console.error('META_API_KEY is not set (run with node --env-file=.env)');
  process.exit(2);
}
const models = process.argv.slice(2).length ? process.argv.slice(2) : ['muse-ember-1.0', 'muse-spark-1.3'];

const entry = createRegistry([repoDemo]).get('system:auth-service');
if (!entry) throw new Error('repo-demo bundle missing');
const { bundle, ctx } = entry;
const graphContext = buildGraphContext(bundle);
const login = bundle.lessons.find((l) => l.id === 'lesson:repo-login')!;
const drill = bundle.lessons.find((l) => l.id === 'lesson:repo-incident')!;

const base = (over: Partial<TutorTurnRequest>): TutorTurnRequest => ({
  system_id: bundle.graph.system_id,
  revision: bundle.graph.revision.value,
  trigger: 'explain_selection',
  selected_id: null,
  lesson_id: login.id,
  step_id: null,
  broken_edge_ids: [],
  recent_events: [],
  ...over,
});

const TURNS: TutorTurnRequest[] = [
  base({ selected_id: 'route:post:/login', step_id: 'step:repo-intro' }),
  base({ selected_id: 'fn:src/auth/service.ts#authservice.login', step_id: 'step:repo-trace' }),
  base({ trigger: 'what_depends', selected_id: 'fn:src/sessions/store.ts#sessionstore.create', step_id: 'step:repo-evidence' }),
  base({ trigger: 'hint', step_id: 'step:repo-predict' }),
  base({ trigger: 'why_failed', step_id: 'step:repo-observe', broken_edge_ids: [login.break_edge_id] }),
  base({ trigger: 'hint', step_id: 'step:repo-repair', broken_edge_ids: [login.break_edge_id] }),
  base({ trigger: 'free_text', free_text: 'Why does login need a session at all?', selected_id: 'fn:src/sessions/store.ts#sessionstore.create', step_id: 'step:repo-reflect' }),
  base({ lesson_id: drill.id, trigger: 'hint', step_id: 'step:drill-find', broken_edge_ids: [drill.break_edge_id] }),
  base({ lesson_id: drill.id, trigger: 'why_failed', step_id: 'step:drill-observe', broken_edge_ids: [drill.break_edge_id] }),
  base({ lesson_id: null, trigger: 'explain_selection', selected_id: 'fn:src/auth/password.ts#verifypassword' }),
];

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

for (const model of models) {
  console.log(`\n${model}`);
  const times: number[] = [];
  let valid = 0;
  for (const [i, req] of TURNS.entries()) {
    const t0 = performance.now();
    const res = await callMeta({ apiKey, model, systemPrompt: SYSTEM_PROMPT, graphContext, turnText: buildTurnText(ctx, req), timeoutMs: 30_000 });
    const ms = Math.round(performance.now() - t0);
    times.push(ms);
    let note: string;
    if (!res.ok) note = `FAIL ${res.reason}${res.status ? ` ${res.status}` : ''}`;
    else {
      const v = validateTutorPlan(ctx, res.plan);
      if (v.ok) {
        valid++;
        note = `valid (${res.model}, ${res.usage.input_tokens}+${res.usage.output_tokens} tok) "${v.plan.say.slice(0, 70)}"`;
      } else note = `INVALID ${v.errors.slice(0, 2).join('; ')}`;
    }
    console.log(`  ${String(i + 1).padStart(2)} ${req.trigger.padEnd(17)} ${String(ms).padStart(6)} ms  ${note}`);
  }
  const p50 = pct(times, 50);
  const p95 = pct(times, 95);
  const under5 = times.filter((t) => t < 5000).length;
  const pass = p95 < 4000 && valid >= 9;
  console.log(`  p50 ${p50} ms · p95 ${p95} ms · valid ${valid}/${TURNS.length} · under the proxy's 5 s timeout ${under5}/${TURNS.length} → ${pass ? 'PASS' : 'FAIL'}`);
}
