/**
 * Records one emulator take for the demo video into video/takes/<take>/ (docs/VIDEO_PRODUCTION.md §4).
 *
 *   node scripts/capture/take.mjs <take> [beat …]     (from apps/quest; the dev server must be running
 *                                                     with --allow-browser-automation)
 *
 * Runs runner.mjs in the managed browser once to set up, once per beat (each a clip), once to
 * save the sound. Naming beats records only those, after a fresh setup.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const APP = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = resolve(APP, '../../node_modules/.bin/iwsdk');
const [name, ...only] = process.argv.slice(2);
if (!name) throw new Error('usage: take.mjs <take> [beat …]');
const take = (await import(`./takes/${name}.mjs`)).default;
const out = resolve(APP, '../../video/takes', name);
if (!only.length) rmSync(out, { recursive: true, force: true });
mkdirSync(join(APP, '.capture'), { recursive: true });

async function job(kind, extra = {}) {
  writeFileSync(join(APP, '.capture/job.json'), JSON.stringify({ kind, take: name, out, ...extra }));
  let stdout;
  try {
    ({ stdout } = await exec(CLI, ['browser', 'run', 'scripts/capture/runner.mjs', '--timeout', '110000'], { cwd: APP, maxBuffer: 16 * 1024 * 1024 }));
  } catch (err) {
    stdout = err.stdout || String(err);
  }
  let parsed;
  try {
    // A beat's own console lines come first; the CLI's result is the last JSON object.
    parsed = JSON.parse(stdout.slice(stdout.lastIndexOf('{\n  "ok"')));
  } catch {
    throw new Error(`${kind}: ${stdout.slice(-800)}`);
  }
  if (!parsed.ok) throw new Error(`${kind} ${extra.beat ?? ''}: ${parsed.error?.message?.slice(0, 800)}`);
  const result = parsed.data.result;
  console.log(`[${name}] ${kind}${extra.beat ? ' ' + extra.beat : ''}: ${JSON.stringify(result)}`);
  return result;
}

await job('setup');
const failures = [];
for (const [beat] of take.beats) {
  if (only.length && !only.includes(beat)) continue;
  const r = await job('beat', { beat });
  if (r.error) {
    failures.push(beat);
    console.log(r.error);
    break;
  }
}
await job('finish');
if (failures.length) process.exitCode = 1;
