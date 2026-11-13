/**
 * The tutor proxy as a plain Node server (Node ≥ 24, no build step, no platform account):
 *
 *   node --env-file-if-exists=.env services/tutor-proxy/src/server.ts
 *
 * Settings and keys come from the environment (see env.ts). Limits are counted in memory, so
 * they hold for one process and reset when it restarts.
 */
import { createServer } from 'node:http';
import type { Env } from './env.ts';
import { handle } from './index.ts';

const port = Number(process.env.PORT) || 8787;
/** The app's dev server (apps/quest, port 8473); a deployment sets ALLOWED_ORIGINS itself. */
const DEV_ORIGINS = 'https://localhost:8473,http://localhost:8473,https://127.0.0.1:8473,http://127.0.0.1:8473';

const e = process.env;
const env: Env = {
  ANTHROPIC_API_KEY: e.ANTHROPIC_API_KEY,
  META_API_KEY: e.META_API_KEY,
  // With only a Meta key there is one provider that can answer, so use it.
  TUTOR_PROVIDER: e.TUTOR_PROVIDER ?? (e.META_API_KEY && !e.ANTHROPIC_API_KEY ? 'meta' : 'anthropic'),
  TUTOR_MODEL: e.TUTOR_MODEL,
  META_MODEL: e.META_MODEL,
  ALLOWED_ORIGINS: e.ALLOWED_ORIGINS ?? DEV_ORIGINS,
  DAILY_TOKEN_CAP: e.DAILY_TOKEN_CAP,
  DAILY_AUDIO_SECONDS_CAP: e.DAILY_AUDIO_SECONDS_CAP,
  KILL_SWITCH: e.KILL_SWITCH,
};
/** Behind a reverse proxy the caller's address is the first hop of x-forwarded-for; trust it only when told to. */
const trustProxy = e.TRUST_PROXY === '1';

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > 1_000_000) req.destroy(); // far above any body the handler accepts
    else chunks.push(chunk);
  });
  req.on('end', () => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const forwarded = trustProxy ? headers.get('x-forwarded-for')?.split(',')[0]?.trim() : undefined;
    // The handler rate-limits by this header; never let a caller choose it.
    headers.set('cf-connecting-ip', forwarded || req.socket.remoteAddress || 'unknown');
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
    handle(request, env)
      .then(async (out) => {
        res.writeHead(out.status, Object.fromEntries(out.headers));
        res.end(Buffer.from(await out.arrayBuffer()));
      })
      .catch(() => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"internal error"}');
      });
  });
});

server.listen(port, () => {
  const key = env.TUTOR_PROVIDER === 'meta' ? env.META_API_KEY : env.ANTHROPIC_API_KEY;
  console.log(`tutor proxy on http://localhost:${port}`);
  console.log(`  tutor: ${env.TUTOR_PROVIDER}${key ? '' : ' (no key: scripted answers only)'}`);
  console.log(`  voice: ${env.META_API_KEY ? 'on' : 'off (needs META_API_KEY)'}`);
  console.log(`  origins: ${env.ALLOWED_ORIGINS}`);
});
