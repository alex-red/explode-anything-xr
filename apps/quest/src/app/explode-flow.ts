import type { ContentBundle, ExplodeJob, ExplodeProposal, ExplodeRequest, ExplodeStage } from '@explode/contracts';
import { ExplodeError, type ExplodeApi } from './explode-client.ts';

/**
 * Explode Anything, the learner's side of it (ADR-0026): ask, read the proposal, then Build or
 * Cancel. This holds where that conversation has got to and nothing else; the card draws it and
 * the app opens what comes out.
 *
 * Nothing is built unless `build()` is called, and only the learner's Build button (or their own
 * words to the assistant, through that same button) calls it.
 */
export type FlowView =
  | { phase: 'idle' }
  | { phase: 'researching'; query: string; stage: ExplodeStage | null }
  | { phase: 'proposed'; proposal: ExplodeProposal }
  | { phase: 'building'; title: string; stage: ExplodeStage | null; seconds: number }
  | { phase: 'receiving'; title: string }
  /** It ended without a system: refused, failed, or unreachable. `message` says why. */
  | { phase: 'stopped'; heading: string; message: string };

/** What a proposal is about, in a few words: the repository's name, or the subject's. */
export function nameOf(proposal: ExplodeProposal): string {
  return proposal.kind === 'repository' ? proposal.repository.full_name : proposal.subject.name;
}

/** Seconds between questions to the server while it works. */
const POLL_SECONDS = 0.7;

export class ExplodeFlow {
  view: FlowView = { phase: 'idle' };
  private jobId: string | null = null;
  /** Bumped whenever the flow starts over, so a late answer to an old question is dropped. */
  private run = 0;
  private waiting = false;
  private sincePoll = 0;

  constructor(
    private readonly api: ExplodeApi,
    private readonly onBuilt: (bundle: ContentBundle) => void,
    private readonly onChange: () => void,
  ) {}

  get busy(): boolean {
    return this.view.phase !== 'idle';
  }

  private set(view: FlowView): void {
    this.view = view;
    this.onChange();
  }

  private stop(heading: string, err: unknown): void {
    this.jobId = null;
    this.set({ phase: 'stopped', heading, message: err instanceof ExplodeError ? err.message : 'Something went wrong on this side. Nothing was built.' });
  }

  /** Look something up and bring back a proposal. Builds nothing. */
  propose(request: ExplodeRequest): void {
    if (this.busy) return;
    const run = ++this.run;
    this.jobId = null;
    this.set({ phase: 'researching', query: request.query, stage: null });
    this.api.propose(request).then(
      (job) => {
        if (run !== this.run) return void this.api.cancel(job.id);
        this.jobId = job.id;
        this.apply(job);
      },
      (err: unknown) => run === this.run && this.stop('COULD NOT LOOK IT UP', err),
    );
  }

  /** The learner said yes to the proposal on the card. */
  build(): void {
    if (this.view.phase !== 'proposed' || !this.jobId) return;
    const run = this.run;
    const title = nameOf(this.view.proposal);
    this.set({ phase: 'building', title, stage: null, seconds: 0 });
    this.api.confirm(this.jobId).then(
      (job) => run === this.run && this.apply(job),
      (err: unknown) => run === this.run && this.stop('NOT BUILT', err),
    );
  }

  /** The learner said no, stopped a build, or closed the card. Leaves nothing behind. */
  cancel(): void {
    if (!this.busy) return;
    const id = this.jobId;
    this.run++;
    this.jobId = null;
    this.waiting = false;
    if (id && this.view.phase !== 'stopped') void this.api.cancel(id);
    this.set({ phase: 'idle' });
  }

  /** Once a frame: ask the server how it is getting on, one question at a time. */
  tick(dt: number): void {
    const phase = this.view.phase;
    if ((phase !== 'researching' && phase !== 'building') || !this.jobId || this.waiting) return;
    this.sincePoll += dt;
    if (this.sincePoll < POLL_SECONDS) return;
    this.sincePoll = 0;
    this.waiting = true;
    const run = this.run;
    this.api
      .job(this.jobId)
      .then(
        (job) => run === this.run && this.apply(job),
        (err: unknown) => run === this.run && this.stop(phase === 'building' ? 'LOST TOUCH WITH THE BUILD' : 'COULD NOT LOOK IT UP', err),
      )
      .finally(() => {
        if (run === this.run) this.waiting = false;
      });
  }

  private apply(job: ExplodeJob): void {
    const title = job.proposal ? nameOf(job.proposal) : this.view.phase === 'building' ? this.view.title : '';
    switch (job.status) {
      case 'researching':
        if (this.view.phase === 'researching' && this.view.stage !== (job.stage?.id ?? null)) this.set({ ...this.view, stage: job.stage?.id ?? null });
        return;
      case 'proposed':
        if (job.proposal && this.view.phase === 'researching') this.set({ phase: 'proposed', proposal: job.proposal });
        return;
      case 'building':
        return this.set({ phase: 'building', title, stage: job.stage?.id ?? null, seconds: job.build_seconds ?? 0 });
      case 'refused':
        this.jobId = null;
        return this.set({ phase: 'stopped', heading: 'CANNOT BUILD THAT', message: job.refusal ?? 'The server gave no reason.' });
      case 'failed':
        this.jobId = null;
        return this.set({ phase: 'stopped', heading: 'NOT BUILT', message: job.error ?? 'The server gave no reason.' });
      case 'cancelled':
        this.jobId = null;
        return this.set({ phase: 'idle' });
      case 'done': {
        const run = this.run;
        const id = job.id;
        this.jobId = null;
        this.set({ phase: 'receiving', title });
        this.api.bundle(id).then(
          (bundle) => {
            if (run !== this.run) return;
            this.set({ phase: 'idle' });
            this.onBuilt(bundle);
          },
          (err: unknown) => run === this.run && this.stop('BUILT, BUT NOT OPENED', err),
        );
      }
    }
  }
}
