/**
 * Local end-to-end check of the Worker's request handler on Meta's Model API, with no server and
 * no deploy (docs/EXPLORE_PLAN.md W12). Builds the handler exactly as `src/index.ts` does, sends it
 * the requests the app sends (origin, body shape, bundle revision), and checks the health route and
 * that live turns come back as validated `live` plans that name their model.
 *
 *   node --env-file=.env services/tutor-proxy/scripts/meta-local-check.ts
 */
import { TutorTurnResponse } from '@explode/contracts';
import drivetrain from '../../../apps/quest/src/content/drivetrain.bundle.json' with { type: 'json' };
import repoDemo from '../../../apps/quest/src/content/repo-demo.bundle.json' with { type: 'json' };
import { createRegistry } from '../src/bundles.ts';
import type { Env } from '../src/env.ts';
import { createHandler } from '../src/handler.ts';

if (!process.env.META_API_KEY) {
  console.error('META_API_KEY is not set (run with node --env-file=.env)');
  process.exit(2);
}
const ORIGIN = 'https://localhost:8473';
const env = {
  TUTOR_PROVIDER: 'meta',
  META_MODEL: 'muse-ember-1.0',
  META_API_KEY: process.env.META_API_KEY,
  ALLOWED_ORIGINS: ORIGIN,
  DAILY_TOKEN_CAP: '2000000',
  KILL_SWITCH: '0',
} as Env;
const fallbacks: string[] = [];
const handle = createHandler({ registry: createRegistry([repoDemo, drivetrain]), log: (m) => fallbacks.push(m) });

let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

const health = await handle(new Request('https://proxy.local/v1/health', { headers: { origin: ORIGIN } }), env);
const h = (await health.json()) as Record<string, unknown>;
check(health.status === 200 && h.provider === 'meta' && h.model === 'muse-ember-1.0' && !JSON.stringify(h).includes('LLM_'), `health ${JSON.stringify(h)}`);

const login = repoDemo.lessons.find((l) => l.id === 'lesson:repo-login')!;
const turns = [
  { trigger: 'explain_selection', selected_id: 'fn:src/auth/service.ts#authservice.login', step_id: 'step:repo-trace', broken_edge_ids: [] },
  { trigger: 'why_failed', selected_id: null, step_id: 'step:repo-observe', broken_edge_ids: [login.break_edge_id] },
  { trigger: 'free_text', free_text: 'What would break if verifyPassword always returned true?', selected_id: 'fn:src/auth/password.ts#verifypassword', step_id: 'step:repo-reflect', broken_edge_ids: [] },
];
for (const t of turns) {
  const body = { system_id: repoDemo.graph.system_id, revision: repoDemo.graph.revision.value, lesson_id: login.id, recent_events: [], ...t };
  const t0 = performance.now();
  const res = await handle(
    new Request('https://proxy.local/v1/tutor/turn', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    env,
  );
  const ms = Math.round(performance.now() - t0);
  const parsed = TutorTurnResponse.safeParse(await res.json());
  const r = parsed.success ? parsed.data : null;
  const fallback = res.headers.get('x-tutor-fallback');
  check(
    res.status === 200 && res.headers.get('access-control-allow-origin') === ORIGIN && r?.source === 'live' && r.model === 'muse-ember-1.0',
    `${t.trigger} ${ms} ms → ${r?.source ?? 'unparsed'}${r?.model ? ` · ${r.model}` : ''}${fallback ? ` (fallback: ${fallback})` : ''} "${r?.plan.say.slice(0, 80) ?? ''}"`,
  );
}

const denied = await handle(new Request('https://proxy.local/v1/health', { headers: { origin: 'https://evil.example' } }), env);
check(denied.status === 403, 'another origin is refused');

for (const m of fallbacks) console.log(`  log: ${m}`);
console.log(failed ? `FAIL: ${failed} check(s)` : 'PASS: the Worker handler serves live Meta plans locally');
process.exit(failed ? 1 : 0);
