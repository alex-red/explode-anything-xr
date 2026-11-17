/**
 * Records the demo video's emulator takes (docs/VIDEO_PRODUCTION.md §4). Runs inside the managed
 * browser through `iwsdk browser run`, one job at a time, started by take.mjs:
 *
 *   setup   load the app with ?capture, put the audio tap and the fake microphone in place,
 *           enter XR with hands, sit at the desk, and start recording the sound
 *   beat    record one beat of a take as a screencast while performing its actions
 *   finish  stop the sound and save it, with every event the app logged
 *
 * The managed browser gives a script at most 110 s, so a take is split into beats shorter than
 * that, each its own clip; the sound runs on in the page across them, on the same clock.
 *
 * Every action goes through the emulated head, hands and pinches a person would use, or a key the
 * app documents; nothing calls into the app. The head and hands move through the CLI's `xr`
 * commands (which work while a script runs); keys and the app's log go through this page.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs in the app's frame before any of its scripts. */
const TAP = `(() => {
  if (!location.search.includes('capture') || window.__capture) return;
  const tapCtx = new AudioContext({ sampleRate: 48000 });
  const mix = tapCtx.createMediaStreamDestination();
  const chunks = [];
  const events = [];
  let rec = null;
  let recStart = 0;
  const info = console.info.bind(console);
  console.info = (...a) => {
    const text = a.map(String).join(' ');
    if (text.startsWith('[explode] ') || text.startsWith('[capture]')) events.push({ t: (performance.timeOrigin + performance.now()) / 1000, text });
    return info(...a);
  };
  const tapped = new WeakSet();
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const out = connect.call(this, dest, ...rest);
    try {
      if (dest instanceof AudioDestinationNode && this.context !== tapCtx && !tapped.has(this)) {
        tapped.add(this);
        const ctx = this.context;
        if (!ctx.__capDest) {
          ctx.__capDest = ctx.createMediaStreamDestination();
          connect.call(tapCtx.createMediaStreamSource(ctx.__capDest.stream), mix);
        }
        connect.call(this, ctx.__capDest);
      }
    } catch (e) { console.warn('[capture] tap failed', String(e)); }
    return out;
  };
  window.__capture = {
    voices: [],
    events,
    async start() {
      await tapCtx.resume();
      rec = new MediaRecorder(mix.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.start(500);
      recStart = performance.timeOrigin + performance.now();
      return { start: recStart, state: tapCtx.state };
    },
    async stop() {
      await new Promise((r) => { rec.onstop = r; rec.stop(); });
      window.__capture.blob = new Blob(chunks, { type: 'audio/webm' });
      return { start: recStart, size: window.__capture.blob.size };
    },
    async piece(from, to) {
      const buf = new Uint8Array(await window.__capture.blob.slice(from, to).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    },
  };
  // The microphone: the app primes the permission with { audio: true } and listens with
  // constraints; each listen gets the next queued clip, which also plays into the recording.
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (!c || !c.audio) throw new DOMException('capture: audio only', 'NotAllowedError');
    const dest = tapCtx.createMediaStreamDestination();
    if (c.audio === true) return dest.stream;
    const b64 = window.__capture.voices.shift();
    if (b64) {
      await tapCtx.resume();
      const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const audio = await tapCtx.decodeAudioData(bytes.buffer);
      const src = tapCtx.createBufferSource();
      src.buffer = audio;
      connect.call(src, dest);
      connect.call(src, mix);
      src.start(tapCtx.currentTime + 0.5);
      console.info('[capture] voice clip ' + audio.duration.toFixed(2));
    } else console.info('[capture] microphone asked, no clip queued');
    return dest.stream;
  };
})();`;

/** Keeps the emulator's dev UI (Remote Control pill, toolbar, panels, gizmos) out of the picture. */
const HIDE_DEV_UI = `(() => {
  if (window.__hideDevUi) return;
  window.__hideDevUi = true;
  const hide = () => { for (const el of document.querySelectorAll('body > *')) if (el.shadowRoot) el.style.setProperty('display', 'none', 'important'); };
  hide();
  setInterval(hide, 250);
})();`;

// Seated in front of the 0.79 m table in the emulator's living room, eyes at 1.2 m, hands in front of the chest.
const HEAD = { x: -1.54, y: 1.2, z: 1.0 };
const HEAD_PITCH = -20;
const HANDS = { 'hand-left': { x: -1.72, y: 0.98, z: 0.72 }, 'hand-right': { x: -1.36, y: 0.98, z: 0.72 } };
const REST = { pitch: -10, yaw: 0, roll: 0 };

function orient(from, p) {
  const dx = p[0] - from.x, dy = p[1] - from.y, dz = p[2] - from.z;
  return { pitch: (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI, yaw: (Math.atan2(-dx, -dz) * 180) / Math.PI, roll: 0 };
}

/** The actions a take's beats use. */
function actions({ page, frame, workspaceRoot }) {
  const CLI = resolve(workspaceRoot, '../../node_modules/.bin/iwsdk');
  const lines = [];
  page.on('console', (m) => lines.push(m.text()));

  async function xr(action, input) {
    let stdout;
    try {
      ({ stdout } = await exec(CLI, ['xr', action, '--input-json', JSON.stringify(input)], { cwd: workspaceRoot, timeout: 30_000 }));
    } catch (err) {
      stdout = err.stdout?.trim() || '';
      if (!stdout.startsWith('{')) throw err;
    }
    const parsed = JSON.parse(stdout);
    if (!parsed.ok) throw new Error(`xr ${action}: ${parsed.error?.code} ${parsed.error?.message?.slice(0, 300)}`);
    return parsed.data?.result ?? parsed.data;
  }
  const key = (k) => frame.locator('body').press(k);
  async function targets() {
    lines.length = 0;
    await key('p');
    for (let i = 0; i < 40; i++) {
      await sleep(50);
      const hit = lines.findLast((l) => l.startsWith('[explode:targets] '));
      if (hit) return JSON.parse(hit.slice('[explode:targets] '.length));
    }
    throw new Error('no targets');
  }
  async function until(test, what, timeoutMs = 20_000) {
    const t0 = Date.now();
    for (;;) {
      const t = await targets();
      if (test(t)) return t;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what} (step ${t.step})`);
      await sleep(300);
    }
  }
  const sideOf = (p) => (p[0] < (HANDS['hand-left'].x + HANDS['hand-right'].x) / 2 ? 'hand-left' : 'hand-right');
  /** Points a hand at `p` over `dur` seconds (the nearer hand unless `hand` is given). */
  async function aim(p, { hand, dur = 0.6 } = {}) {
    if (!p) throw new Error('nothing to aim at');
    const device = hand ?? sideOf(p);
    await xr('animate-to', { device, orientation: orient(HANDS[device], p), duration: dur });
    await sleep(dur * 1000 + 100);
    return device;
  }
  /** Aim, hold a beat so the hover shows, pinch. */
  async function press(p, { hand, dur = 0.6, hold = 350, after = 700 } = {}) {
    const device = await aim(p, { hand, dur });
    await sleep(hold);
    await xr('select', { device, duration: 0.22 });
    await sleep(after);
    return device;
  }
  async function rest(hand, dur = 0.5) {
    await xr('animate-to', { device: hand, orientation: REST, duration: dur });
    await sleep(dur * 1000);
  }
  /** Turns the head toward `p` (or back to the seat's view). */
  async function look(p, dur = 0.8) {
    await xr('animate-to', { device: 'headset', orientation: p ? orient(HEAD, p) : { pitch: HEAD_PITCH, yaw: 0, roll: 0 }, duration: dur });
    await sleep(dur * 1000);
  }
  /**
   * The two-hand pull (ADR-0021): both hands pinch in front of the chest, rays pointing out to the
   * sides at nothing, move apart, and let go. Then they go back to rest.
   */
  async function pull({ from = 0.07, to = 0.19, dur = 1.0, y = 1.0, z = 0.7 } = {}) {
    const cx = (HANDS['hand-left'].x + HANDS['hand-right'].x) / 2;
    const side = { 'hand-left': -1, 'hand-right': 1 };
    for (const [device, s] of Object.entries(side)) await xr('animate-to', { device, position: { x: cx + s * from, y, z }, orientation: { pitch: 0, yaw: -s * 70, roll: 0 }, duration: 0.5 });
    await sleep(650);
    for (const device of Object.keys(side)) await xr('set-select-value', { device, value: 1 });
    await sleep(150);
    for (const [device, s] of Object.entries(side)) await xr('animate-to', { device, position: { x: cx + s * to, y, z }, orientation: { pitch: 0, yaw: -s * 70, roll: 0 }, duration: dur });
    await sleep(dur * 1000 + 150);
    for (const device of Object.keys(side)) await xr('set-select-value', { device, value: 0 });
    await sleep(300);
    for (const [device, position] of Object.entries(HANDS)) await xr('animate-to', { device, position, orientation: REST, duration: 0.6 });
    await sleep(700);
  }
  async function seat({ forget = false } = {}) {
    await xr('set-transform', { device: 'headset', position: HEAD, orientation: { pitch: HEAD_PITCH, yaw: 0, roll: 0 } });
    for (const [device, position] of Object.entries(HANDS)) await xr('set-transform', { device, position, orientation: REST });
    await sleep(400);
    if (forget) await key('0');
    await sleep(300);
    await key('c');
    await sleep(1500);
    const t = await targets();
    if (t.placedOn !== 'desk') throw new Error(`not on the desk: ${t.placedOn}`);
    return t;
  }
  return { xr, key, targets, until, aim, press, pull, rest, look, seat, sleep, page, frame, HANDS, HEAD };
}

export default async function run(ctx) {
  const { page, frame, cdp, workspaceRoot } = ctx;
  const job = JSON.parse(readFileSync(join(workspaceRoot, '.capture/job.json'), 'utf8'));
  const take = (await import(`${pathToFileURL(resolve(workspaceRoot, 'scripts/capture/takes', `${job.take}.mjs`)).href}?v=${Date.now()}`)).default;
  const a = actions(ctx);
  const out = job.out;
  mkdirSync(out, { recursive: true });

  if (job.kind === 'setup') {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addStyleTag({ content: 'iframe{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483646!important;border:0!important}' });
    await page.addInitScript(TAP);
    await frame.goto(`https://localhost:8473/${take.query ?? '?capture'}`, { waitUntil: 'load' });
    await sleep(3500);
    await frame.evaluate(HIDE_DEV_UI);
    await page.evaluate(HIDE_DEV_UI);
    const voices = (take.voices ?? []).map((p) => readFileSync(resolve(workspaceRoot, '../..', p)).toString('base64'));
    await frame.evaluate((v) => window.__capture.voices.push(...v), voices);
    if (take.before) await take.before(a);
    await a.xr('enter', {});
    await sleep(2500);
    await a.xr('set-input-mode', { mode: 'hand' });
    const t = await a.seat({ forget: !!take.forget });
    // A trusted key press gives the page the user activation its sound needs; the app binds no `q`.
    await a.key('q');
    const sound = await frame.evaluate(() => window.__capture.start());
    if (take.settle) await take.settle(a);
    return { step: t.step, sound };
  }

  if (job.kind === 'beat') {
    const fn = take.beats.find(([name]) => name === job.beat)?.[1];
    if (!fn) throw new Error(`no beat ${job.beat}`);
    const dir = join(out, job.beat);
    mkdirSync(join(dir, 'frames'), { recursive: true });
    const times = [];
    let n = 0;
    const onFrame = (f) => {
      writeFileSync(join(dir, 'frames', `${String(n++).padStart(6, '0')}.jpg`), Buffer.from(f.data, 'base64'));
      times.push(f.metadata.timestamp);
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    };
    cdp.on('Page.screencastFrame', onFrame);
    // The managed browser puts the window back to its own size after each script, so set 1920x1080
    // again before recording; the emulator then draws the 10:9 eye view centred (cropped out when encoding).
    await page.setViewportSize({ width: 1920, height: 1080 });
    await sleep(900);
    const view = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    const t0 = Date.now();
    let error = null;
    try {
      await fn(a);
    } catch (err) {
      error = String(err?.stack ?? err);
    }
    await sleep(200);
    await cdp.send('Page.stopScreencast');
    cdp.off?.('Page.screencastFrame', onFrame);
    writeFileSync(join(dir, 'frames.json'), JSON.stringify(times));
    writeFileSync(join(dir, 'view.json'), JSON.stringify(view));
    const t = await a.targets().catch(() => null);
    return { beat: job.beat, frames: times.length, seconds: (Date.now() - t0) / 1000, step: t?.step, error };
  }

  if (job.kind === 'finish') {
    const { start, size } = await frame.evaluate(() => window.__capture.stop());
    const parts = [];
    for (let at = 0; at < size; at += 4_000_000) parts.push(Buffer.from(await frame.evaluate(([f, t]) => window.__capture.piece(f, t), [at, Math.min(size, at + 4_000_000)]), 'base64'));
    writeFileSync(join(out, 'audio.webm'), Buffer.concat(parts));
    writeFileSync(join(out, 'audio.json'), JSON.stringify({ start: start / 1000 }));
    const events = await frame.evaluate(() => window.__capture.events);
    writeFileSync(join(out, 'events.json'), JSON.stringify(events, null, 1));
    return { audioBytes: size, events: events.length };
  }
  throw new Error(`unknown job ${job.kind}`);
}
