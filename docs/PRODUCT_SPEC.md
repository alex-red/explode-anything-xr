# EXPLODE — Product Spec (v2)

**Supersedes:** handoff §0–3, §5, §7, §23 · **Updated:** 2026-10-24 · **Owner:** solo dev
**Entry:** Meta VR Start Developer Competition 2026 · **New** division · **Productivity** track · deadline **Wed Nov 18, 2026, 12:00 PM PST (1:00 PM MST)**

---

## 0. Status vocabulary

| Tag | Meaning |
|---|---|
| **MUST / P0** | Required for the submission |
| **SHOULD / P1** | Winning-quality execution; can be cut after an explicit review |
| **COULD / P2** | Stretch; only if every gate is green |
| **CUT** | Excluded to protect the deadline |
| **VERIFIED** | Confirmed against a linked source ([REVIEW.md sources](REVIEW.md#sources)) |
| **VERIFY** | Unconfirmed; there is an action to resolve it |

All quantitative targets are internal engineering targets unless they cite a rule.

## 1. Pitch

> **"Pick up a system. Pull it apart. Break one connection. Fix it yourself. Understand why."**

A compact object hovers over your real desk (passthrough MR). You pinch with both hands and pull, and it **explodes** into its meaningful parts. You trace how a login request flows through a real TypeScript service and see the source lines behind every connection. Then you unplug one dependency and watch what goes dark downstream. A **recorded test run** tells you whether that failure is proven or only a hypothesis. Finally, you plug it back in with your own hands.

A 90-second **EV-drivetrain tutorial** teaches the gestures first: the same verbs, explode → trace → unplug → replug, on a physical system you already intuit. It then collapses into a sphere that becomes the codebase.

**Success for Nov 18:** one interaction framework that makes two very different systems understandable through the same physical language, and stays truthful about what it knows.

## 2. The defining loop

**TRACE → BREAK → REPAIR → UNDERSTAND**

| Verb | What the learner does | What the system guarantees |
|---|---|---|
| Trace | Taps **Trace** or a path chip | Highlights only real (`static_verified`) or authored (`authored_model`) relations |
| Predict | Points at the part they think fails first | The engine scores it deterministically; the LLM never grades |
| Break | Unplugs one sandboxed connection | The real repo is never touched; the consequence is labeled `observed` only if a recorded mutation run matches the edge |
| Repair | Plugs it into one of 3 candidate sockets | Wrong sockets are rejected with a hint; the right one restores the flow |
| Understand | Reads the explanation and evidence | Every claim shows a truth badge and opens to the source or run record |

Experience pillars (kept from handoff §5, updated):

- **A. Make complexity tangible.** 6–10 top-level clusters, never a hairball.
- **B. Explanations act on the scene.**
- **C. Safe causal experiments.**
- **D. Learning that adapts.** Hints after mistakes, plus a misconception tag.
- **E. Comfortable, seated, passthrough-first** (see [INTERACTION_SPEC.md](INTERACTION_SPEC.md)).

## 3. Problem, users, and jobs

**Problem.** Docs, diagrams, code search and chat each show parts of a system but not how consequences propagate. Developers joining an unfamiliar repo struggle to build an accurate mental model of *what depends on what*.

**Hypothesis.** A seated, two-handed spatial environment can speed up building that model, *if* detail is controlled, evidence is explicit, and manipulation is meaningful. VR alone does not guarantee this; see [§8](#8-hypotheses-and-invalidation).

| User | Need |
|---|---|
| **Primary:** developer onboarding into an unfamiliar TypeScript service | "Show me the handful of modules that matter for login, and prove it." |
| **Secondary:** student or curious learner | "Show me how power reaches the wheels." |
| **Judge persona:** no context, 5–10 min, Quest 3/3S, hands only, possibly unreliable network | A payoff within 5 minutes, with zero setup |

**Jobs to be done:**

1. Show me only the parts that matter for my question.
2. Show me how information or power flows.
3. Let me test what happens if a dependency disappears.
4. Let me fix it myself.
5. Show me the evidence so I can trust it.

## 4. Prior art and differentiation

Do not claim "first ever". Adjacent work:

| Prior work | What exists | Our difference |
|---|---|---|
| [Teardown AI](https://devpost.com/software/teardown-ai) | Photo-to-exploded-object explanations | Hands-first causal manipulation; a grounded repo mode |
| [CuriosityXR](https://www.curiosityxr.com/vr-ai-tutor) | Quest AI tutor that disassembles 3D objects | The tutor acts on *relationships*, cites evidence, and never grades |
| [GitNexus](https://github.com/abhigyanpatwari/GitNexus) (canonical repo; license **VERIFY**) | Code knowledge graph and impact analysis | Spatial, embodied experiment workflow; not a dependency |
| [PartCrafter](https://github.com/wgsxm/PartCrafter), [SAM 3D Objects](https://github.com/facebookresearch/sam-3d-objects) | Image-to-3D parts | Reconstruct appearance, not hidden functional truth. Not used |

**Visible differentiators:**

1. One gesture grammar across domains.
2. Tutor answers become scene actions.
3. Truth badges on every claim.
4. The learner performs the repair.
5. Build-time *recorded* evidence instead of a claimed live sandbox.

## 5. Competition fit and award strategy

Facts **VERIFIED** from [Meta's competition post](https://developers.meta.com/blog/meta-connect-2026-vr-start-developer-competition/) and [UploadVR](https://www.uploadvr.com/meta-launches-1-million-competition-for-hands-first-apps-ahead-of-vr-glasses/):

- $1M across 20 prizes.
- Platforms: Quest, VR Glasses, or both.
- Must be "fully usable with hands, end-to-end".
- Seated, fast cold start, clean pause/resume, and something satisfying within ≤10 min.

Rules-page details (judging devices, criterion weights, whether a PWA entry is accepted) are **VERIFY**; see [REVIEW.md §6](REVIEW.md#6-still-needs-outside-verification).

A submission can win at most one prize.

| Award | Prize | Fit | What judges must see |
|---|---|---|---|
| Best New Productivity | $70k (runner-up $35k) | **Primary** | Understanding a real codebase faster through hands-first interaction |
| Best Agentic Interaction | $25k | Strong | A tutor that observes state, acts on the scene, and responds to learner actions, with no voice needed |
| Best First Five Minutes | $25k | Strong | Zero-config: explode in ≤60 s, full loop in ≤5 min |
| Boldest Original Concept | $25k | Possible | A "same physical language for car and code" reveal |
| Best Accessibility Forward | $25k | Stretch | One-handed path, reduced motion, captions always on |
| Best Reason to Come Back | $25k | Stretch | Saved completion plus a transfer challenge |
| Judge's Choice | $20k ×2 | Possible | Polish |
| Best Social & Multiplayer | $25k | No | — |

**Rule:** never trade stability, hand usability, performance or honesty for a speculative AI feature.

## 6. Scope

**P0 (MUST):**

- A hosted link that opens in Quest Browser ([ADR-0002](adr/0002-distribution.md)); one press to enter; immersive AR with passthrough; hands-only end to end; recenter; pause/resume.
- One indexed TypeScript repo (the sample `auth-service`, [ADR-0018](adr/0018-fixture-repo.md)): 6–10 clusters, an evidence panel, truth badges.
- Hero lesson: trace login → predict → break (2–3 recorded mutations) → observed failure → repair (3 sockets) → reflect.
- 90-second procedural EV-drivetrain tutorial on the same engine, skippable.
- Deterministic lesson engine and scripted tutor; no network needed once the page has loaded.
- Sustained 72 fps on Quest 3.
- Video, Devpost entry, frozen deploy.

**P1 (SHOULD):**

- Live context tutor through the proxy.
- Pre-rendered narration.
- A transfer challenge (second break).
- Backdrop toggle.
- Reduced motion, a one-handed path, text size.
- Saved completion.
- Offline relaunch ([ADR-0016](adr/0016-offline.md)).

**P2 (COULD):**

- Voice (recorded audio → proxy speech-to-text).
- VR Glasses gaze + pinch.
- Hand occlusion.
- Quad layers for code text.
- A third-party repo, or runtime import.

**CUT:**

- Photo input.
- FastAPI and any Python backend.
- A runtime test sandbox.
- RAG.
- GitNexus or Tree-sitter dependencies.
- A multi-call agent loop.
- Bloom and post-processing.
- Multiplayer.
- Pose-detection gestures and dwell.
- A numeric mastery model.
- Arbitrary photo-to-CAD reconstruction.
- Automatic PRs or repo mutation.

**Scope freeze:** **Tue Nov 10.** After that, nothing new unless it replaces a broken P0 piece.

## 7. Honesty rules

1. Every visible claim carries a truth status ([ARCHITECTURE.md §3](ARCHITECTURE.md#3-truth-contract)).
2. `observed` means *recorded at build time*. The UI never says "running now".
3. Edges are never `observed`. A break with no matching recorded mutation is styled as a **hypothesis**.
4. The drivetrain is labeled "simplified teaching model, not a real vehicle".
5. The hero repo is disclosed as "a sample service written for this demo" in both the UI and Devpost text.
6. The tutor cannot invent ids, cite missing evidence, or claim more than its evidence supports. Plans that do are rejected ([ADR-0011](adr/0011-tutor.md)).
7. Video and screenshots are genuine on-device footage. Any composited overlay is labeled.

## 8. Hypotheses and invalidation

| # | Hypothesis | Lean test |
|---|---|---|
| H1 | Trace/break/repair improves identifying an *indirect* dependency compared with reading docs | 2–3 causal questions before and after, in playtests #2 and #3 |
| H2 | First explode-and-repair is understandable without VR coaching | Cold-novice metrics ([QA_MATRIX.md §4](QA_MATRIX.md#4-playtest-protocol)) |
| H3 | Scene-acting tutor answers beat text-only answers | Compare chip answers with the scene actions off vs on (informal) |

**The concept is invalidated if:**

- users can't reliably select relationships in 3D;
- it is slower and less accurate than a 2D flowchart;
- tutor actions add nothing over labels;
- hand occlusion makes the experiment frustrating.

**Pivot:** a compact guided spatial lesson, not a universal platform. Anecdotal playtest results are never marketed as science.

## 9. Beyond the hackathon

Not part of the Nov 18 commitment:

- **A.** Bring-your-own TypeScript repo: build-time indexing, CI-recorded evidence.
- **B.** Live traces (OpenTelemetry) as a real `observed` source for edges.
- **C.** Verified CAD/BOM adapters for mechanical systems.
- **D.** Personalized curricula, formally evaluated against chat and 2D diagrams.
- **E.** Collaborative spatial reviews; a web viewer.

**Research question.** Does an AI that manipulates a *grounded spatial causal model* in response to misconceptions improve transfer, compared with AI chat or passive 3D? Planned design:

- Four conditions: docs + 2D graph; chat + 2D; spatial without a tutor; spatial with a constrained tutor.
- Pre/post and delayed transfer measures.
- Counterbalanced, with identical evidence across conditions.

This is a hypothesis, not a claim.
