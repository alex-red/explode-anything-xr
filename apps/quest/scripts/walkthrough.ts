/**
 * Emulator walkthrough (docs/FINAL_PLAN.md B1).
 *
 * Drives the real app in the IWER desktop emulator through both lessons with emulated rays,
 * first with controllers and then with hands, then does a two-hand pull. Every step is derived
 * from the lesson definitions in the content bundles and checked against the `[explode]` events
 * the app logs. Fails on a missing or unexpected event, or on any console error or warning.
 *
 *   node apps/quest/scripts/walkthrough.ts            needs the dev server already running
 *   node apps/quest/scripts/walkthrough.ts --start    starts it headless, and stops it afterwards
 *   --mode controller|hand|both                       default: both
 *
 * It proves the logic and the input path in the emulator. It says nothing about frame rate,
 * readability or real hand tracking.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const APP = resolve(import.meta.dirname, '..');
const CLI = resolve(APP, '../../node_modules/.bin/iwsdk');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Vec = [number, number, number];
interface Targets {
  step: string;
  buttons: Record<string, Vec>;
  nodes: Record<string, Vec>;
  plugs: Record<string, Vec>;
}
interface LogEntry {
  timestamp: number;
  level: string;
  message: string;
  kind?: string;
}
interface Bundle {
  graph: { system_id: string; system_kind: string; edges: Array<{ id: string; target_id: string }> };
  lessons: Array<{ id: string; break_edge_id: string; repair_candidates: string[]; steps: Array<{ kind: string; expect: { type: string } }> }>;
}
type Mode = 'controller' | 'hand';

class Failure extends Error {}
const fail = (message: string): never => {
  throw new Failure(message);
};

// ---------------------------------------------------------------- CLI plumbing

async function cli<T = unknown>(domain: string, action: string, input?: object, timeoutMs = 60_000): Promise<T> {
  const args = [domain, action, ...(input ? ['--input-json', JSON.stringify(input)] : [])];
  let stdout: string;
  try {
    ({ stdout } = await run(CLI, args, { cwd: APP, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }));
  } catch (err) {
    // The CLI prints its JSON envelope on stderr when a command fails.
    const e = err as { stdout?: string; stderr?: string };
    stdout = e.stdout?.trim() || e.stderr?.trim() || '';
    if (!stdout.startsWith('{')) throw err;
  }
  const parsed = JSON.parse(stdout) as { ok: boolean; data?: { result?: T } & Record<string, unknown>; error?: { code: string; message: string } };
  if (!parsed.ok) return fail(`iwsdk ${domain} ${action} failed: ${parsed.error?.code} ${parsed.error?.message?.slice(0, 300)}`);
  return (parsed.data?.result ?? parsed.data) as T;
}

const key = (k: string) => cli('browser', 'interact', { steps: [{ action: 'press', key: k }] });

let seenUntil = 0;
/** Console entries newer than the last call, oldest first. */
async function newLogs(): Promise<LogEntry[]> {
  const all = await cli<LogEntry[]>('browser', 'logs', { count: 200 });
  const fresh = all.filter((e) => e.kind !== 'navigation' && e.timestamp > seenUntil);
  for (const e of all) if (e.timestamp > seenUntil) seenUntil = e.timestamp;
  return fresh;
}

/** Accepted engine events since the last call, as `{ event, step }`. */
async function newEvents(): Promise<Array<{ type: string; raw: string; index: number; status: string; system: string }>> {
  const out = [];
  for (const e of await newLogs()) {
    const m = /^\[explode\] (.*) → (.*)$/s.exec(e.message);
    if (!m) continue;
    const parts = m[2]!.split(':');
    const type = m[1] === 'replay' ? 'replay' : (JSON.parse(m[1]!) as { type: string }).type;
    out.push({ type, raw: m[1]!, status: parts.at(-1)!, index: Number(parts.at(-2)), system: m[2]! });
  }
  return out;
}

async function targets(): Promise<Targets> {
  await key('p');
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(150);
    const all = await cli<LogEntry[]>('browser', 'logs', { count: 200 });
    const hit = all.filter((e) => e.message.startsWith('[explode:targets] ')).at(-1);
    if (hit && hit.timestamp > targetsSeen) {
      targetsSeen = hit.timestamp;
      return JSON.parse(hit.message.slice('[explode:targets] '.length)) as Targets;
    }
  }
  return fail('the app did not report target positions (is the P key reaching the page?)');
}
let targetsSeen = 0;

// ---------------------------------------------------------------- input

const device = (mode: Mode, side: 'left' | 'right') => `${mode}-${side}`;

/** Aim the nearer hand's ray at a world position and pinch/trigger once. */
async function press(mode: Mode, pos: Vec | undefined, what: string): Promise<void> {
  if (!pos) return fail(`no position reported for ${what}; it is not visible or does not exist`);
  const dev = device(mode, pos[0] < 0 ? 'left' : 'right');
  await cli('xr', 'look-at', { device: dev, target: { x: pos[0], y: pos[1], z: pos[2] } });
  await sleep(300);
  await cli('xr', 'select', { device: dev, duration: 0.25 });
  await sleep(500);
}

/** Pinch with both hands, move them to ±halfSpan on x, release. */
async function twoHandPull(mode: Mode, halfSpan: number): Promise<void> {
  const [l, r] = [device(mode, 'left'), device(mode, 'right')];
  await Promise.all([cli('xr', 'set-select-value', { device: l, value: 1 }), cli('xr', 'set-select-value', { device: r, value: 1 })]);
  await sleep(400);
  await cli('xr', 'set-transform', { device: l, position: { x: -halfSpan, y: 1.5, z: -0.4 } });
  await cli('xr', 'set-transform', { device: r, position: { x: halfSpan, y: 1.5, z: -0.4 } });
  await sleep(500);
  await cli('xr', 'set-select-value', { device: l, value: 0 });
  await cli('xr', 'set-select-value', { device: r, value: 0 });
  await sleep(600);
}

// ---------------------------------------------------------------- the walkthrough

const BUTTON_FOR: Record<string, string> = { next: 'next', explode_at_least: 'explode', collapse_below: 'explode', trace: 'trace', open_evidence: 'evidence' };
const EVENT_FOR: Record<string, string> = { next: 'next', explode_at_least: 'set_explode', collapse_below: 'set_explode', trace: 'trace', open_evidence: 'open_evidence', unplug: 'unplug', predict: 'predict', repair: 'plug' };

function loadBundle(name: string): Bundle {
  return JSON.parse(readFileSync(join(APP, 'src/content', `${name}.bundle.json`), 'utf8')) as Bundle;
}

let pressed = 0;

async function runLesson(mode: Mode, bundle: Bundle): Promise<void> {
  const lesson = bundle.lessons[0] ?? fail(`${bundle.graph.system_id} has no lesson`);
  const breakTarget = bundle.graph.edges.find((e) => e.id === lesson.break_edge_id)?.target_id ?? fail('break edge not in graph');
  const wrongSocket = lesson.repair_candidates.find((c) => c !== breakTarget);
  const say = (i: number, text: string) => console.log(`  [${mode}] ${bundle.graph.system_kind} step ${i + 1}/${lesson.steps.length} ${lesson.steps[i]!.kind}: ${text}`);

  /** Do one press and return the accepted events, failing unless one of them is `type`. */
  const act = async (i: number, pos: Vec | undefined, what: string, type: string) => {
    await press(mode, pos, what);
    pressed++;
    const events = await newEvents();
    const hit = events.filter((e) => e.type === type).at(-1);
    if (!hit) return fail(`step ${i + 1} (${lesson.steps[i]!.kind}): pressed ${what} and expected a "${type}" event, got [${events.map((e) => e.type).join(', ') || 'nothing'}]`);
    return hit;
  };

  let i = 0;
  while (i < lesson.steps.length) {
    const expect = lesson.steps[i]!.expect.type;
    if (expect === 'explode_at_least' || expect === 'collapse_below') await sleep(300);
    const t = await targets();
    let after;
    if (expect in BUTTON_FOR) {
      const id = BUTTON_FOR[expect]!;
      after = await act(i, t.buttons[id], `the ${id} button`, EVENT_FOR[expect]!);
      if (expect === 'explode_at_least' || expect === 'collapse_below') await sleep(1400); // let the layout settle
    } else if (expect === 'unplug') {
      after = await act(i, t.plugs[lesson.break_edge_id], 'the plug', 'unplug');
    } else if (expect === 'predict') {
      after = await act(i, t.nodes[breakTarget], `part ${breakTarget}`, 'predict');
    } else if (expect === 'repair') {
      if (wrongSocket) {
        const wrong = await act(i, t.nodes[wrongSocket], `the wrong socket ${wrongSocket}`, 'plug');
        if (wrong.index !== i) fail(`a wrong socket advanced the lesson to step ${wrong.index + 1}`);
        say(i, 'wrong socket rejected');
      }
      after = await act(i, t.nodes[breakTarget], `the right socket ${breakTarget}`, 'plug');
    } else {
      return fail(`the walkthrough does not know how to satisfy "${expect}"`);
    }
    const last = i === lesson.steps.length - 1;
    const advanced = last ? after.status === 'complete' : after.index > i;
    if (!advanced) fail(`step ${i + 1} (${lesson.steps[i]!.kind}) did not advance: the app reports ${after.system}`);
    say(i, 'ok');
    i = last ? lesson.steps.length : after.index;
  }
}

async function runMode(mode: Mode, mechanical: Bundle, software: Bundle): Promise<void> {
  console.log(`\n${mode} mode`);
  await cli('xr', 'set-input-mode', { mode });
  await key('0'); // forget progress, back to the tutorial
  await sleep(800);
  await newEvents();

  await runLesson(mode, mechanical);
  // The tutorial hands over to the software system through the same Next button.
  const t = await targets();
  await press(mode, t.buttons.next, 'the continue button');
  const handover = await newEvents();
  if (!handover.some((e) => e.system.startsWith(software.graph.system_id))) fail('Continue did not switch to the software system');
  await sleep(600);
  await runLesson(mode, software);

  // Two-hand pull: together collapses, apart explodes, and neither hand selects anything.
  await twoHandPull(mode, 0.08);
  const together = await newEvents();
  await twoHandPull(mode, 0.25);
  const apart = await newEvents();
  const factor = (events: typeof together) => events.filter((e) => e.type === 'set_explode').map((e) => (JSON.parse(e.raw) as { factor: number }).factor).at(-1);
  if (factor(together) !== 0) fail(`pulling the hands together should collapse (factor 0), got ${factor(together)}`);
  if (factor(apart) !== 1) fail(`pulling the hands apart should explode (factor 1), got ${factor(apart)}`);
  const stray = [...together, ...apart].filter((e) => e.type !== 'set_explode');
  if (stray.length) fail(`the two-hand pull also triggered: ${stray.map((e) => e.type).join(', ')}`);
  console.log(`  [${mode}] two-hand pull: collapse and explode ok, nothing else triggered`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const start = args.includes('--start');
  const modeArg = args[args.indexOf('--mode') + 1];
  const modes: Mode[] = args.includes('--mode') && (modeArg === 'controller' || modeArg === 'hand') ? [modeArg] : ['controller', 'hand'];
  const mechanical = loadBundle('drivetrain');
  const software = loadBundle('repo-demo');

  let started = false;
  const browserReady = () => cli<{ state?: { browserCommandReady?: boolean } }>('dev', 'status', undefined, 20_000).then((r) => r.state?.browserCommandReady === true, () => false);
  if (!(await browserReady())) {
    if (!start) fail('the dev server is not running. Start it (bun run dev in apps/quest), or pass --start to let this script start it headless.');
    console.log('starting the dev server (headless)…');
    await run(CLI, ['dev', 'up', '--headless', '--timeout', '45000'], { cwd: APP, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    started = true;
  }

  const t0 = Date.now();
  try {
    // The managed browser connects a few seconds after the server is up.
    for (let waited = 0; !(await browserReady()); waited += 1000) {
      if (waited > 60_000) fail('the managed browser never became ready');
      await sleep(1000);
    }
    await cli('browser', 'reload', {});
    await sleep(2500);
    await key('d'); // debug readout on: the app now logs accepted events
    await cli('xr', 'enter', {});
    await sleep(2000);
    const status = await cli<{ sessionActive: boolean; sessionMode?: string }>('xr', 'status');
    if (!status.sessionActive) fail('the emulated session did not start');
    console.log(`session started: ${status.sessionMode}`);
    await newLogs();
    const runStartedAt = seenUntil; // the log buffer outlives reloads; only this run's entries count

    for (const mode of modes) await runMode(mode, mechanical, software);

    const problems = (await cli<LogEntry[]>('browser', 'logs', { count: 200, level: 'warn' })).concat(await cli<LogEntry[]>('browser', 'logs', { count: 200, level: 'error' }));
    const real = problems.filter((e) => (e.level === 'warn' || e.level === 'error') && e.timestamp > runStartedAt);
    if (real.length) fail(`${real.length} console warning(s) or error(s), first: ${real[0]!.message.slice(0, 300)}`);

    console.log(`\nPASS: ${modes.join(' + ')}; ${pressed} ray presses; no console warnings or errors; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    console.log('Emulator only: this does not measure frame rate, readability or real hand tracking.');
  } finally {
    // KEEP_XR=1 leaves the session open after a failure, so the scene can be inspected as it was.
    if (!process.env.KEEP_XR) await cli('xr', 'exit', {}).catch(() => undefined);
    if (started) await run(CLI, ['dev', 'down'], { cwd: APP, timeout: 60_000 }).catch(() => undefined);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Failure ? `\nFAIL: ${err.message}` : err);
  process.exit(1);
});
