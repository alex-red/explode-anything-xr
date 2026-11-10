# EXPLODE — Submission Checklist

**Deadline:** Wed Nov 18, 2026, 12:00 PM PST (1:00 PM MST) · **Target submit:** evening of Tue Nov 17 · **Sources:** [REVIEW.md sources](REVIEW.md#sources)

---

> Updated 2026-11-09 for link-based submission ([ADR-0002](adr/0002-distribution.md), [FINAL_PLAN.md](FINAL_PLAN.md)).

## A. Eligibility and admin

- [ ] Meta VR Start membership confirmed (required to enter) — VERIFIED [Meta post](https://developers.meta.com/blog/meta-connect-2026-vr-start-developer-competition/)
- [ ] Entrant eligibility; submitting representative is a Start member
- [ ] Division **New** (conceived and built on/after Sep 24, 2026; no prior codebase) — **VERIFY** exact wording on Devpost
- [ ] Track **Productivity**
- [ ] Rules, FAQ and judging read *by hand* (automated fetch returned 403) — **VERIFY**:
  - [x] WebXR entries accepted: the rules say an IWSDK project is submitted as a hosted link (read Nov 9)
  - [ ] Whether a public code repository is required
  - [ ] Judging devices (Quest 3 / 3S?)
  - [ ] Criteria and weights
  - [ ] Video length rule
  - [ ] Team rules
- [ ] Meta developer org created (needed only to turn on developer mode for `adb` and `chrome://inspect`)
- [ ] Privacy note live on the same host if the live tutor ships (it sends graph ids and recent lesson events to the proxy; no personal data)

## B. Hosting and the first screen

- [ ] Cloudflare Pages projects exist: `explode-dev` and `explode` (production)
- [ ] The dev URL opens in Quest Browser over HTTPS and enters passthrough AR with one press
- [ ] Landing page reads well in the Quest Browser window: what it is, the Enter button, "seated, hands only", the three disclosures
- [ ] A browser without mixed-reality support gets a clear message, not a dead button
- [ ] Permissions minimal: no microphone, no camera access beyond passthrough
- [ ] `?debug` is not in the submitted link

## C. Build freeze

- [ ] Release candidate built from a tagged commit with a clean working tree
- [ ] `npm run release:manifest` run on that build; `release/manifest.json` committed
- [ ] Deployed to production **once**; `npm run release:verify <production url>` prints `ok`
- [ ] Cold open of the production URL in a fresh Quest Browser profile passes the device checklist
- [ ] If the live tutor ships: proxy `ALLOWED_ORIGINS` is the production origin, the daily cap is set, `KILL_SWITCH` is documented
- [ ] No deploys to production after this point. `release:verify` again before submitting, then weekly until winners are announced

## D. Devpost entry

- [ ] Title and tagline (within the form's character limits)
- [ ] Description: inspiration, how it works, technical implementation, novelty, **known limitations**, future work, target launch date
- [ ] Discloses: "`auth-service` is a sample service written for this demo"; "drivetrain is a simplified teaching model"; "Observed = recorded at build time"
- [ ] Track and division selected
- [ ] The production URL
- [ ] Public YouTube/Vimeo video, under 3 min, captions, genuine footage ([VIDEO_STORYBOARD.md](VIDEO_STORYBOARD.md))
- [ ] 3–5 genuine screenshots (no concept art)
- [ ] Third-party licenses and attributions reviewed ([DATA_PROVENANCE.md](DATA_PROVENANCE.md))

## E. Final verification (Nov 17 evening → Nov 18 morning)

- [ ] Devpost shows submitted
- [ ] Every link opens logged-out: video, production URL
- [ ] `npm run release:verify <production url>` prints `ok`
- [ ] Production URL opened once more on the headset
- [ ] Touch nothing after submitting
