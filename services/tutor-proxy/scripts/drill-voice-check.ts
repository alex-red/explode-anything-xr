/**
 * How often the live tutor does what the demo video says it does (docs/DEMO_PLAN.md A2).
 *
 * Sends the two spoken lines of the video's drill take to the real handler, with the state and the
 * view the app would send at those two steps of the incident drill, and counts how often the plan
 * does what the narration claims:
 *
 *   "Why did that fail?"      at drill-observe: lights the parts that stopped, and opens the recorded run
 *   "Plug it back in for me"  at drill-repair:  a plug command into the right socket
 *
 *   node --env-file=.env services/tutor-proxy/scripts/drill-voice-check.ts [runs, default 10] [the second line, as heard]
 *
 * Calls Meta's Model API with META_API_KEY, two to four calls per run. Run only when asked.
 * The text sent is the typed equivalent of the speech: transcription is not part of this check.
 */
import type { EngineEvent, TutorTurnRequest, ViewContext } from '@explode/contracts';
import { TutorTurnResponse } from '@explode/contracts';
import { createContext, initialState, reduce, visibleAtDetail } from '@explode/lesson-engine';
import repoDemo from '../../../apps/quest/src/content/repo-demo.bundle.json' with { type: 'json' };
import { createRegistry } from '../src/bundles.ts';
import type { Env } from '../src/env.ts';
import { createHandler } from '../src/handler.ts';

if (!process.env.META_API_KEY) {
  console.error('META_API_KEY is not set (run with node --env-file=.env)');
  process.exit(2);
}
const RUNS = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 10;
const ORIGIN = 'https://localhost:8473';
const env: Env = { TUTOR_PROVIDER: 'meta', META_API_KEY: process.env.META_API_KEY, META_MODEL: process.env.META_MODEL, ALLOWED_ORIGINS: ORIGIN, RATE_LIMIT_MAX: '100000', DAILY_TOKEN_CAP: '5000000' };
const logs: string[] = [];
const registry = createRegistry([repoDemo]);
const handle = createHandler({ registry, log: (m) => logs.push(m) });

const entry = registry.get(repoDemo.graph.system_id)!;
const ctx = entry.ctx;
const drill = ctx.lessons.get('lesson:repo-incident')!;
const breakEdge = ctx.edges.get(drill.break_edge_id!)!;
const runEvidence = 'ev:run:mut:drop-body-parser';

/** The learner's events from the start of the drill to the step named, as the app would log them. */
function eventsTo(stepId: string): EngineEvent[] {
  const events: EngineEvent[] = [{ type: 'next' }, { type: 'set_explode', factor: 1 }];
  let state = initialState(ctx, drill.id);
  for (const e of events) state = reduce(ctx, state, e);
  // drill-find: point at the first part that never gets the request (the cut edge's target).
  events.push({ type: 'predict', target_id: breakEdge.target_id });
  if (stepId === 'step:drill-repair') events.push({ type: 'next' });
  return events;
}

/** The buttons the app lists for the assistant, with the drill's state (app.ts buttons()). */
function buttons(stepId: string): ViewContext['buttons'] {
  const atRepair = stepId === 'step:drill-repair';
  const on = (id: string, label: string, enabled = true) => ({ id, label, enabled });
  return [
    on('next', 'Next ▸', !atRepair),
    on('explode', 'Collapse'),
    on('trace', 'Trace Login request'),
    on('detail', 'Detail: more'),
    on('evidence', 'Evidence'),
    on('explain', 'Explain this', false),
    on('depends', 'What depends?', false),
    on('why', 'Why it failed'),
    on('hint', 'Hint'),
    on('undo', 'Undo'),
    on('reset', 'Reset'),
    on('recenter', 'Recenter'),
    on('guide', 'Gestures'),
    on('sound', 'Sound: on'),
    on('layout', 'Layout: wide'),
    on('backdrop', 'View: passthrough'),
    on('switch', '◂ Headset'),
    on('more', 'More: Drivetrain'),
    on('projects', 'Projects ▾'),
    on('live', 'Live AI: on'),
  ];
}

function request(stepId: string, text: string): TutorTurnRequest {
  const events = eventsTo(stepId);
  let state = initialState(ctx, drill.id);
  for (const e of events) state = reduce(ctx, state, e);
  if (state.lesson?.step_index !== drill.steps.findIndex((s) => s.id === stepId)) throw new Error(`the replay did not reach ${stepId}: at step ${state.lesson?.step_index}`);
  const view: ViewContext = {
    explode_factor: state.explode_factor,
    detail: 'supporting',
    in_session: true,
    active_path_id: state.active_path_id,
    evidence_open_id: state.evidence_open_id,
    highlighted_ids: state.highlighted_ids.slice(0, 12),
    visible_node_ids: [...visibleAtDetail(ctx, state, 'supporting', true)].slice(0, 40),
    awaiting_prediction: false,
    buttons: buttons(stepId),
    can_propose: true,
    systems: [
      { id: 'system:mr-headset', name: 'Mixed-reality headset (teaching model)', current: false },
      { id: 'system:auth-service', name: 'auth-service (sample TypeScript service)', current: true },
      { id: 'system:iwsdk', name: 'Immersive Web SDK (meta/immersive-web-sdk)', current: false },
    ],
  };
  return {
    system_id: ctx.bundle.graph.system_id,
    revision: ctx.bundle.graph.revision.value,
    trigger: 'free_text',
    selected_id: state.selected_id,
    lesson_id: drill.id,
    step_id: stepId,
    broken_edge_ids: state.broken_edge_ids.slice(0, 10),
    recent_events: events.slice(-10),
    free_text: text,
    view,
    history: [],
  };
}

async function ask(req: TutorTurnRequest) {
  const t0 = performance.now();
  const res = await handle(new Request('https://proxy.local/v1/tutor/turn', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(req) }), env);
  const ms = Math.round(performance.now() - t0);
  const parsed = TutorTurnResponse.safeParse(await res.json());
  return { ms, status: res.status, fallback: res.headers.get('x-tutor-fallback'), r: parsed.success ? parsed.data : null };
}

const whyReq = request('step:drill-observe', 'Why did that fail?');
const PLUG_TEXT = process.argv[3] ?? 'Plug it back in for me';
const plugReq = request('step:drill-repair', PLUG_TEXT);
let replay = initialState(ctx, drill.id);
for (const e of eventsTo('step:drill-observe')) replay = reduce(ctx, replay, e);
const affected = new Set(replay.consequences[0]?.affected_ids ?? []);
const firstAffected = replay.consequences[0]?.first_affected_id ?? null;
// A path that runs through the parts that stopped lights them too.
const onPath = new Set(ctx.bundle.graph.paths.filter((p) => p.node_ids.some((id) => affected.has(id))).map((p) => p.id));

const tally = { why: { live: 0, lights: 0, opens: 0, both: 0, ms: [] as number[] }, plug: { live: 0, plugs: 0, ms: [] as number[] } };
for (let i = 1; i <= RUNS; i++) {
  const w = await ask(whyReq);
  const plan = w.r?.plan;
  const lit = (plan?.actions ?? []).some((a) => (a.type === 'highlight' && a.target_ids.some((id) => affected.has(id) || id === firstAffected)) || (a.type === 'highlight_path' && onPath.has(a.path_id)));
  const opened = (plan?.actions ?? []).some((a) => a.type === 'show_evidence' && a.evidence_id === runEvidence) || (plan?.commands ?? []).some((c) => c.type === 'open_evidence' && c.evidence_id === runEvidence);
  if (w.r?.source === 'live') tally.why.live++;
  if (lit) tally.why.lights++;
  if (opened) tally.why.opens++;
  if (lit && opened) tally.why.both++;
  tally.why.ms.push(w.ms);
  console.log(`why  ${i}: ${w.ms} ms ${w.r?.source ?? `HTTP ${w.status}`}${w.fallback ? ` (fallback: ${w.fallback})` : ''} lights=${lit} opens-run=${opened} · "${plan?.say.slice(0, 110) ?? ''}"`);
  if (plan && !(lit && opened)) console.log(`         actions ${JSON.stringify(plan.actions)} commands ${JSON.stringify(plan.commands ?? [])}`);

  const p = await ask(plugReq);
  const pplan = p.r?.plan;
  const plugged = (pplan?.commands ?? []).some((c) => c.type === 'plug' && c.edge_id === breakEdge.id && c.target_id === breakEdge.target_id);
  if (p.r?.source === 'live') tally.plug.live++;
  if (plugged) tally.plug.plugs++;
  tally.plug.ms.push(p.ms);
  console.log(`plug ${i}: ${p.ms} ms ${p.r?.source ?? `HTTP ${p.status}`}${p.fallback ? ` (fallback: ${p.fallback})` : ''} plugs-right=${plugged} · "${pplan?.say.slice(0, 110) ?? ''}"`);
  if (pplan && !plugged) console.log(`         commands ${JSON.stringify(pplan.commands ?? [])}`);
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
console.log(`\n"Why did that fail?": live ${tally.why.live}/${RUNS}, lit the stopped parts or their path ${tally.why.lights}/${RUNS}, opened the recorded run ${tally.why.opens}/${RUNS}, both ${tally.why.both}/${RUNS}; median ${median(tally.why.ms)} ms, slowest ${Math.max(...tally.why.ms)} ms`);
console.log(`"${PLUG_TEXT}": live ${tally.plug.live}/${RUNS}, right plug ${tally.plug.plugs}/${RUNS}; median ${median(tally.plug.ms)} ms, slowest ${Math.max(...tally.plug.ms)} ms`);
for (const m of logs) console.log(`log: ${m}`);
