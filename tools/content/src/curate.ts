import { sha256 } from '@explode/indexer';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CURATION_SCHEMA, curationSystemPrompt } from './curation-prompt.ts';
import { IWSDK_DIR } from './paths.ts';
import { Curation, buildDigest, curationProblems, partGraph } from './relevance.ts';
import { indexSdk, sdkSource } from './sdk.ts';

/**
 * The curation step (docs/RELEVANCE_PLAN.md): a model reads a digest of the whole index and
 * chooses the parent nodes, the parts most worth showing, and where to start reading.
 *
 *   node --env-file=.env tools/content/src/curate.ts
 *
 * It runs only when someone runs it, never inside `content:generate`: the generator reads the
 * committed `content/iwsdk/curation.json`, so builds stay offline and repeatable. The answer is
 * checked against the index (every path and id must exist) and written exactly as returned, with
 * the provider's own model name. A wrong answer is retried with the problems, never patched by hand.
 *
 * What is sent: the digest of an open source repository (directory names, declaration names and
 * their doc comments). Nothing from this project and nothing personal.
 */

const URL = process.env.CURATE_URL ?? 'https://api.meta.ai/v1/chat/completions';
const MODEL = process.env.CURATE_MODEL ?? 'muse-spark-1.3';
const KEY = process.env.CURATE_API_KEY ?? process.env.META_API_KEY;
const TIMEOUT_MS = Number(process.env.CURATE_TIMEOUT_MS ?? 180_000);
const ATTEMPTS = 3;

const SYSTEM = curationSystemPrompt();
const SCHEMA = CURATION_SCHEMA;

interface Turn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function ask(messages: Turn[]): Promise<{ text: string; model: string; tokens: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages,
        response_format: { type: 'json_schema', json_schema: { name: 'curation', schema: SCHEMA, strict: true } },
        reasoning_effort: 'low',
        max_completion_tokens: 8192,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error(`no text in the answer (finish_reason ${data?.choices?.[0]?.finish_reason})`);
    return { text, model: String(data.model ?? MODEL), tokens: Number(data?.usage?.total_tokens ?? 0) };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  if (!KEY) throw new Error('set META_API_KEY (or CURATE_API_KEY) in the environment: node --env-file=.env tools/content/src/curate.ts');
  const source = sdkSource();
  const pg = partGraph(indexSdk());
  const digest = buildDigest(pg);
  const digestHash = sha256(digest.text);
  console.log(`digest: ${digest.dirs.length} directories, ${digest.part_ids.length} of ${pg.parts.size} parts, ${digest.text.length} characters, sha256 ${digestHash.slice(0, 12)}`);

  const messages: Turn[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Repository: ${source.name}\n\n${digest.text}` },
  ];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const started = Date.now();
    const answer = await ask(messages);
    console.log(`attempt ${attempt}: ${answer.model} answered in ${((Date.now() - started) / 1000).toFixed(1)} s, ${answer.tokens} tokens`);
    let problems: string[];
    let curation: Curation | null = null;
    try {
      const parsed = Curation.safeParse({
        schema_version: '1',
        source: { repository: source.repository, commit: source.commit },
        produced_by: { provider: new globalThis.URL(URL).host, model: answer.model, created_at: new Date().toISOString(), digest_sha256: digestHash },
        ...(JSON.parse(answer.text) as object),
      });
      if (parsed.success) {
        curation = parsed.data;
        problems = curationProblems(curation, pg);
      } else problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    } catch (err) {
      problems = [`not JSON: ${(err as Error).message}`];
    }
    if (curation && problems.length === 0) {
      const out = resolve(IWSDK_DIR, 'curation.json');
      writeFileSync(out, `${JSON.stringify(curation, null, 2)}\n`);
      console.log(`wrote ${out}: ${curation.groups.length} groups, ${curation.spotlight.length} spotlight parts, ${curation.entry_points.length} entry points`);
      for (const g of curation.groups) console.log(`  ${g.label}: ${g.members.join(', ')}`);
      return;
    }
    console.log(`attempt ${attempt} does not fit the index:\n- ${problems.join('\n- ')}`);
    messages.push({ role: 'assistant', content: answer.text });
    messages.push({ role: 'user', content: `That answer has these problems. Send the whole JSON again with them fixed, changing nothing else:\n- ${problems.join('\n- ')}` });
  }
  throw new Error(`no usable curation after ${ATTEMPTS} attempts; nothing was written`);
}

await main();
