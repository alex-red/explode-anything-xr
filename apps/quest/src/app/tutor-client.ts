import type { TutorPlan, TutorTrigger, TutorTurnRequest } from '@explode/contracts';
import { TutorTurnResponse } from '@explode/contracts';
import { currentStep, scriptedTutorTurn, validateTutorPlan } from '@explode/lesson-engine';
import type { Store } from './store.ts';

export interface TutorAnswer {
  plan: TutorPlan;
  source: 'live' | 'scripted';
  note: string | null;
}

const TIMEOUT_MS = 6000;

/**
 * Optional live tutor (ADR-0011). The scripted tutor is the default and the fallback:
 * no URL, offline, timeout, HTTP error, or an invalid plan → scripted answer.
 */
export class TutorClient {
  constructor(private readonly url: string | null) {}

  get liveConfigured(): boolean {
    return !!this.url;
  }

  async ask(store: Store, trigger: TutorTrigger, liveAllowed: boolean): Promise<TutorAnswer> {
    const scripted = (note: string | null): TutorAnswer => ({
      plan: scriptedTutorTurn(store.ctx, store.state, { trigger, selected_id: store.state.selected_id }),
      source: 'scripted',
      note,
    });
    if (!this.url || !liveAllowed) return scripted(null);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return scripted('Live AI unavailable. The guided lesson still works.');

    const s = store.state;
    const step = currentStep(store.ctx, s);
    const req: TutorTurnRequest = {
      system_id: s.system_id,
      revision: s.revision,
      trigger,
      selected_id: s.selected_id,
      lesson_id: s.lesson?.lesson_id ?? null,
      step_id: step?.id ?? null,
      broken_edge_ids: s.broken_edge_ids.slice(0, 10),
      recent_events: store.log.slice(-10),
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${this.url.replace(/\/$/, '')}/v1/tutor/turn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });
      if (!res.ok) return scripted('Live AI unavailable. The guided lesson still works.');
      const parsed = TutorTurnResponse.safeParse(await res.json());
      if (!parsed.success) return scripted('Live AI returned an invalid answer; showing the offline guide.');
      // Never trust the server's validation alone: the client is what executes actions.
      const v = validateTutorPlan(store.ctx, parsed.data.plan);
      if (!v.ok) return scripted('Live AI answer failed validation; showing the offline guide.');
      return { plan: v.plan, source: parsed.data.source, note: null };
    } catch {
      return scripted('Live AI unavailable. The guided lesson still works.');
    } finally {
      clearTimeout(timer);
    }
  }
}
