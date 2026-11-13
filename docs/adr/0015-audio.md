# ADR-0015: Audio and speech — Web Audio, pre-rendered narration, captions always

**Status:** Accepted, 2026-10-23

## Context

`speechSynthesis` and `SpeechRecognition` are reportedly missing in Quest Browser ([forum](https://communityforums.atmeta.com/discussions/dev-quest/speechrecognition-in-webxr/1168273)), so this is REPORTED and needs verifying with a spike on Oct 26.

## Decision

- Web Audio for SFX.
- Narration is pre-rendered at build time (P1), keyed by `LessonStep.narration_id`.
- Captions are always on.
- The live tutor is caption-only.
- Voice input is P2 (record audio, transcribe through the proxy).

## Consequences

No microphone permission in P0, and no speech dependency on the network.

## Revisit trigger

The Oct 26 spike shows the Web Speech API works.

## Note, 2026-11-11

The sound set is now one synthesized design (`apps/quest/src/app/audio.ts`): each sound plays at the part it belongs to through an HRTF panner, with the listener following the head, through a master gain and compressor. Every lesson beat has one, including the failure cascading part by part and the room dimming. A "Sound: on/quiet/off" button is remembered. Ambient sounds never start audio before a user gesture. Every sound is still redundant with something visible.

## Note, 2026-11-12: voice questions

Decided by the owner on Nov 12: the app now asks for the microphone, reversing "no microphone permission" above. Only for the assistant, only with a live tutor configured, and never required.

- **In:** the assistant's icon records one question (16 kHz mono WAV, at most 10 s, ended by silence: `voice.ts`, `voice-activity.ts`) and posts it to the proxy's `/v1/tutor/transcribe`, which calls Meta's Model API (`muse-voice-transcribe-1.0`, the same `META_API_KEY` as the tutor's Meta provider). The text then goes through the ordinary `free_text` turn ([ADR-0011](0011-tutor.md)). What was heard is shown under the caption.
- **Out:** captions as before. The answer is also spoken through `speechSynthesis` where the browser has it; no server speech.
- **Permission:** the landing page offers to grant the microphone before the session starts.
- **Limits:** 12 s of audio per request, the per-IP rate limit, and a daily cap in seconds (`DAILY_AUDIO_SECONDS_CAP`, default 3600). Without `META_API_KEY`, or with the kill switch on, the endpoint answers 503 and the app says voice needs a connection.

Checked on Nov 12 from the local proxy: a 2.5 s synthesized clip came back transcribed in 2.5 s (with one word misheard), and a typed-equivalent question returned a live plan with two commands in 2.1 s. One of two live turns was rejected for citing an evidence id that does not exist, and fell back. Unverified: a human voice, a real room, and the microphone path in any browser. Whether Quest Browser grants the microphone, in or out of an immersive session, and whether it speaks, is unknown without a headset.
