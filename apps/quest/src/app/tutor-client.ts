import type { ConversationTurn, TutorPlan, TutorTrigger, TutorTurnRequest, ViewContext } from '@explode/contracts';
import { TutorTurnResponse } from '@explode/contracts';
import { commandScopeOf, currentStep, scriptedTutorTurn, validateTutorPlan } from '@explode/lesson-engine';
import type { Store } from './store.ts';

export interface TutorAnswer {
  plan: TutorPlan;
  source: 'live' | 'scripted';
  /** The model a live answer came from, as the proxy reported it; null when scripted. */
  model: string | null;
  note: string | null;
}

/** A question in the learner's own words, with what they can see and the conversation so far. */
export interface Question {
  text: string;
  view: ViewContext;
  history: ConversationTurn[];
}

const TIMEOUT_MS = 6000;
/** A question in the learner's own words may take the proxy two model calls (one retry). */
const QUESTION_TIMEOUT_MS = 10_000;
const TRANSCRIBE_TIMEOUT_MS = 9000;

/**
 * Optional live tutor (ADR-0011). The scripted tutor is the default and the fallback:
 * no URL, offline, timeout, HTTP error, or an invalid plan → scripted answer.
 */
export class TutorClient {
  constructor(private readonly url: string | null) {}

  get liveConfigured(): boolean {
    return !!this.url;
  }

  /** Turn one recorded question into text through the proxy. Null when it could not be done. */
  async transcribe(wav: Blob): Promise<string | null> {
    if (!this.url || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TRANSCRIBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.url.replace(/\/$/, '')}/v1/tutor/transcribe`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav, signal: ctrl.signal });
      if (!res.ok) return null;
      const text = ((await res.json()) as { text?: unknown } | null)?.text;
      return typeof text === 'string' ? text.trim().slice(0, 300) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async ask(store: Store, trigger: TutorTrigger, liveAllowed: boolean, question?: Question): Promise<TutorAnswer> {
    const scripted = (note: string | null): TutorAnswer => ({
      plan: scriptedTutorTurn(store.ctx, store.state, { trigger, selected_id: store.state.selected_id }),
      source: 'scripted',
      model: null,
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
      ...(question ? { free_text: question.text.slice(0, 300), view: question.view, history: question.history } : {}),
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), question ? QUESTION_TIMEOUT_MS : TIMEOUT_MS);
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
      const v = validateTutorPlan(store.ctx, parsed.data.plan, commandScopeOf(req));
      if (!v.ok) return scripted('Live AI answer failed validation; showing the offline guide.');
      const live = parsed.data.source === 'live';
      return { plan: v.plan, source: parsed.data.source, model: live ? (parsed.data.model ?? null) : null, note: null };
    } catch {
      return scripted('Live AI unavailable. The guided lesson still works.');
    } finally {
      clearTimeout(timer);
    }
  }
}
