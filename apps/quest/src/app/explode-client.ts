import { ContentBundle, ExplodeJob, checkBundleIntegrity, type ExplodeRequest } from '@explode/contracts';

/**
 * Explode Anything, app side (ADR-0026): the calls to the server that researches a request,
 * proposes a build and, once the learner has confirmed, builds it.
 *
 * Nothing the server sends is trusted on its word. A job is parsed against the contract, and a
 * bundle is parsed and put through the same integrity check as a shipped one before the app will
 * open it.
 */

/** Something went wrong that the learner can be told. */
export class ExplodeError extends Error {}

export interface ExplodeApi {
  /** True when the server says it can build right now. Never throws. */
  available(): Promise<boolean>;
  propose(request: ExplodeRequest): Promise<ExplodeJob>;
  job(id: string): Promise<ExplodeJob>;
  confirm(id: string): Promise<ExplodeJob>;
  cancel(id: string): Promise<void>;
  bundle(id: string): Promise<ContentBundle>;
}

const TIMEOUT_MS = 10_000;
const BUNDLE_TIMEOUT_MS = 30_000;

export class ExplodeClient implements ExplodeApi {
  private readonly base: string;

  constructor(
    url: string,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {
    this.base = url.replace(/\/$/, '');
  }

  async available(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.base}/v1/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      return res.ok && ((await res.json()) as { explode?: unknown } | null)?.explode === true;
    } catch {
      return false;
    }
  }

  private async call(method: string, path: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ExplodeError('The build server could not be reached.');
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // Not JSON: handled as a failed call below.
    }
    if (!res.ok) {
      const said = (data as { error?: unknown } | null)?.error;
      throw new ExplodeError(typeof said === 'string' ? `The build server said: ${said.slice(0, 160)}.` : `The build server answered ${res.status}.`);
    }
    return data;
  }

  private async jobFrom(data: unknown): Promise<ExplodeJob> {
    const parsed = ExplodeJob.safeParse((data as { job?: unknown } | null)?.job);
    if (!parsed.success) throw new ExplodeError('The build server sent something this app does not understand.');
    return parsed.data;
  }

  async propose(request: ExplodeRequest): Promise<ExplodeJob> {
    return this.jobFrom(await this.call('POST', '/v1/explode/propose', request));
  }

  async job(id: string): Promise<ExplodeJob> {
    return this.jobFrom(await this.call('GET', `/v1/explode/jobs/${encodeURIComponent(id)}`));
  }

  async confirm(id: string): Promise<ExplodeJob> {
    return this.jobFrom(await this.call('POST', `/v1/explode/jobs/${encodeURIComponent(id)}/confirm`));
  }

  async cancel(id: string): Promise<void> {
    await this.call('DELETE', `/v1/explode/jobs/${encodeURIComponent(id)}`).catch(() => undefined);
  }

  async bundle(id: string): Promise<ContentBundle> {
    return checkedBundle(await this.call('GET', `/v1/explode/jobs/${encodeURIComponent(id)}/bundle`, undefined, BUNDLE_TIMEOUT_MS));
  }
}

/**
 * A bundle from outside the build (the server, or this browser's storage), admitted only if it
 * fits the contract and keeps the truth contract. Anything else is refused whole.
 */
export function checkedBundle(raw: unknown): ContentBundle {
  const parsed = ContentBundle.safeParse(raw);
  if (!parsed.success) throw new ExplodeError('What was built does not fit this app, so it was not opened.');
  const problems = checkBundleIntegrity(parsed.data);
  if (problems.length) throw new ExplodeError('What was built did not pass its checks, so it was not opened.');
  // A system built on request is never a shipped one, and never carries a recorded run.
  const id = parsed.data.graph.system_id;
  if (!id.startsWith('system:gh/') && !id.startsWith('system:ai/')) throw new ExplodeError('What was built has a name this app does not accept.');
  // A subject drafted by a model is hypothesis through and through (ADR-0026); anything stronger is refused.
  if (id.startsWith('system:ai/')) {
    const g = parsed.data.graph;
    if ([...g.nodes, ...g.edges, ...g.paths].some((x) => x.truth_status !== 'inferred' || x.evidence_ids.length > 0)) {
      throw new ExplodeError('The draft claims more than a draft can, so it was not opened.');
    }
  }
  if (parsed.data.evidence.some((e) => e.truth_status === 'observed') || parsed.data.graph.nodes.some((n) => n.truth_status === 'observed')) {
    throw new ExplodeError('What was built claims a recorded run it cannot have, so it was not opened.');
  }
  return parsed.data;
}

/**
 * A GitHub address inside something the learner typed or said ("explode github.com/a/b please"),
 * or the text itself when it is nothing but `owner/name`. Null otherwise: a loose name is left to
 * the assistant, which may ask.
 */
export function repoQueryIn(text: string): string | null {
  const t = text.trim();
  const url = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+/i.exec(t);
  if (url) return url[0].replace(/[.,;:!?)]+$/, '');
  return /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(t) ? t : null;
}
