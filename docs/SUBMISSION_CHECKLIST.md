# EXPLODE — Submission Checklist

**Deadline:** Wed Nov 18, 2026, 12:00 PM PST (1:00 PM MST) · **Target submit:** evening of Tue Nov 17 · **Sources:** [REVIEW.md sources](REVIEW.md#sources)

---

## A. Eligibility and admin (by Oct 25)

- [ ] Meta VR Start membership confirmed (required to enter) — VERIFIED [Meta post](https://developers.meta.com/blog/meta-connect-2026-vr-start-developer-competition/)
- [ ] Entrant eligibility; submitting representative is a Start member
- [ ] Division **New** (conceived and built on/after Sep 24, 2026; no prior codebase) — **VERIFY** exact wording on Devpost
- [ ] Track **Productivity**
- [ ] Rules, FAQ and judging read *by hand* (automated fetch returned 403) — **VERIFY**:
  - [ ] PWA/web entries accepted, with a written answer saved
  - [ ] Judging devices (Quest 3 / 3S?)
  - [ ] Criteria and weights
  - [ ] Video length rule
  - [ ] Team rules
- [ ] Meta developer org and app created in the Developer Dashboard
- [ ] Developer Distribution Agreement accepted by the org admin
- [ ] Privacy policy URL live (a static page on the same host is fine)
- [ ] Data Use Checkup completed if the Dashboard requires it — **VERIFY**

## B. PWA packaging and distribution ([ADR-0002](adr/0002-distribution.md))

- [ ] Web app manifest: name, icons, `display`, `start_url` pointing at the **immutable versioned path**
- [ ] Service worker precaches every asset, including both bundles and audio (≤30 MB)
- [ ] Designed first-launch-offline screen
- [ ] Bubblewrap TWA built; **signing keystore backed up offline**, never committed (`*.keystore` is gitignored)
- [ ] `/.well-known/assetlinks.json` deployed *before* testing the APK
- [ ] Auto-enter immersive AR only inside the installed PWA
- [ ] Release channel named **Competition** exists (Dashboard docs list ALPHA/BETA/RC/STORE — **VERIFY**)
- [ ] APK uploaded to the Competition channel; invite link generated
- [ ] **A second Meta account installs from the invite and completes the lesson** (AT-01)
- [ ] Airplane-mode relaunch works (AT-02)
- [ ] Permissions minimal: no mic in P0, no unrelated devices

## C. Build freeze

- [ ] Release-candidate deploy at `/v/<semver>-<content_hash[0:8]>/`, never overwritten
- [ ] Final APK SHA-256 and bundle `content_hash` archived
- [ ] Hosting and tutor proxy kept up through ~Dec 11; daily hash check (AT-13)
- [ ] Proxy daily spend cap set; `KILL_SWITCH` documented
- [ ] No updates after the deadline until winners are announced

## D. Devpost entry

- [ ] Title and tagline (within the form's character limits)
- [ ] Description: inspiration, how it works, technical implementation, novelty, **known limitations**, future work, target launch date
- [ ] Discloses: "`auth-service` is a sample service written for this demo"; "drivetrain is a simplified teaching model"; "Observed = recorded at build time"
- [ ] Track and division selected
- [ ] Release-channel invite URL
- [ ] Public YouTube/Vimeo video, under 3 min, captions, genuine footage ([VIDEO_STORYBOARD.md](VIDEO_STORYBOARD.md))
- [ ] 3–5 genuine screenshots (no concept art)
- [ ] Third-party licenses and attributions reviewed ([DATA_PROVENANCE.md](DATA_PROVENANCE.md))

## E. Final verification (Nov 17 evening → Nov 18 morning)

- [ ] Devpost shows submitted
- [ ] Every link opens logged-out: video, invite, privacy policy
- [ ] Invite install re-tested on the second account
- [ ] Touch nothing after submitting
