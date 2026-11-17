/** Shared moves for the takes: press a toolbar button, a part, a plug or a picker row by id, and wait on the app's events. */
export function moves(a) {
  const { targets, press, sleep, frame, until } = a;
  const at = async (pick, what) => {
    const t = await targets();
    const p = pick(t);
    if (!p) throw new Error(`no target for ${what} (step ${t.step})`);
    return p;
  };
  const btn = async (id, wait = 900, opts) => { await press(await at((t) => t.buttons[id], id), opts); await sleep(wait); };
  const node = async (id, wait = 800, opts) => { await press(await at((t) => t.nodes[id], id), opts); await sleep(wait); };
  const plug = async (id, wait = 900, opts) => { await press(await at((t) => t.plugs[id], id), opts); await sleep(wait); };
  const row = async (match, wait = 900) => {
    const p = await at((t) => Object.entries(t.picker ?? {}).find(([id]) => match.test(id))?.[1], `picker row ${match}`);
    await press(p);
    await sleep(wait);
  };
  const ask = async (wait = 0) => { await press(await at((t) => t.ask, 'ask')); await sleep(wait); };
  const eventCount = () => frame.evaluate(() => window.__capture.events.length);
  /** Waits for an event logged after `from` whose text matches `re`. */
  const waitEvent = async (re, from, timeoutMs = 25_000) => {
    const t0 = Date.now();
    for (;;) {
      const texts = await frame.evaluate((n) => window.__capture.events.slice(n).map((e) => e.text), from);
      const hit = texts.find((x) => re.test(x));
      if (hit) return hit;
      if (Date.now() - t0 > timeoutMs) throw new Error(`no event ${re} within ${timeoutMs} ms`);
      await sleep(200);
    }
  };
  const stepIs = (re, what, ms) => until((t) => re.test(t.step), what, ms);
  return { btn, node, plug, row, ask, eventCount, waitEvent, stepIs };
}
