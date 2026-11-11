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
