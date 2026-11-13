/**
 * Speech to text through Meta's Model API (Muse Voice Transcribe), with the same key as the
 * tutor's Meta provider. Read from Meta's docs on Nov 12, 2026
 * (https://dev.meta.ai/docs/speech-to-text): the endpoint takes a mono 16-bit PCM WAV at 16 or
 * 24 kHz, which is exactly what the app records.
 */
export const TRANSCRIBE_URL = 'https://api.meta.ai/v1/asr/transcribe';
export const TRANSCRIBE_MODEL = 'muse-voice-transcribe-1.0';
export const TRANSCRIBE_TIMEOUT_MS = 8_000;

export type TranscribeResult = { ok: true; text: string } | { ok: false; reason: 'timeout' | 'network' | 'http_error' | 'bad_output'; status?: number };

export async function callTranscribe(args: { apiKey: string; wav: Uint8Array<ArrayBuffer>; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<TranscribeResult> {
  const doFetch = args.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS);
  const form = new FormData();
  // One question, ended by the app: no server-side end-of-speech detection, no speakers.
  form.append('request', new Blob([JSON.stringify({ model: TRANSCRIBE_MODEL, audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' })], { type: 'application/json' }));
  form.append('audio', new Blob([args.wav], { type: 'audio/wav' }), 'question.wav');
  try {
    const res = await doFetch(TRANSCRIBE_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${args.apiKey}`, accept: 'application/json' },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: 'http_error', status: res.status };
    const data = (await res.json().catch(() => null)) as { transcript?: unknown } | null;
    if (typeof data?.transcript !== 'string') return { ok: false, reason: 'bad_output' };
    return { ok: true, text: data.transcript.trim() };
  } catch (err) {
    return { ok: false, reason: (err as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}
