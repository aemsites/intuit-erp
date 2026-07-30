# Intuit OF1 + AJO/RTCDP Demo — Readiness & Gap Analysis (per Act)

**Date:** 2026-07-30
**Purpose:** For each of Cedric's 5 acts, state concretely (a) what can be built/demoed
**today** with the info in hand, and (b) what is **missing** and who owns it. Grounded in
verified facts, not the aspirational script.

---

## What we actually have today (the inputs)

**AEP credentials (public, client-safe):**
- `AEP_DATASTREAM_ID = a114467b-290b-4429-9d7e-56bc5b5786fa`
- `AEP_ORG_ID = 87020D54659BEED90A495E68@AdobeOrg`

**Probe results** (anonymous `interact` calls to `edge.adobedc.net`, 2026-07-30):
- ✅ Transport valid (HTTP 200); **identity service live** — real ECID minted per event.
- ✅ **Personalization edges provisioned** — response advertises `Target` + `AAM` hints.
- ❌ **Nothing activated** — `activation:pull` empty for `__view__` and every named scope
  tried. No audiences/activities returning decisions.
- ❓ **Unverified:** whether the AEP **Profile service** is enabled on this datastream,
  whether **AJO B2B (account/buying-group modeling)** is licensed/configured, the XDM
  **tenant prefix + schema field groups**, identity **namespaces**, and any CRM/MAP sync.

**Code state:**
- OF1 core (anonymous intent personalization, generate/personalize) — built & deployed
  (worker `of1-gen-web-service`, tenant `main--intuit-erp--aemsites`).
- Strategy-driven generation (edit strategy doc → page forks) — built & deployed.
- Acquisition context (GCLID/UTM → hero hint) — built in worker + `signals.json` presets.
- Firmographics mock (`/api/firmographics`, email-domain → preset) — built & deployed.
- On-page Alloy — **enabled** on `origin/aep-martech-integration` (initMartech only; no
  sendEvent, no audience resolution, form non-submitting).
- Act 2 signal/stitch plumbing — **designed, not built** (branch `feat/of1-rtcdp-signals`).

**The recurring split:** OF1 (page personalization, signals, mock forks) is **our code**.
Everything that happens *inside the platform* — profile merge, B2B account resolution,
audiences, journeys, CRM sync — is **Adobe-side configuration** in a sandbox that today
has identity + personalization edges live but **no activities/audiences/journeys built**.

---

## Act 1 — "The 2.5-Second Fork" (personalization / industry editions)

**Doable now: ~ALL of it. No AEP dependency.**
- Anonymous construction-intent → OF1 forks hero + CTA to Construction edition (built).
- Strategy-file edit → preview/publish → instant re-fork (strategy-driven generation, built).
- Governance close: OF1 selects among pre-approved site content (built; verifiable on live site).

**Missing:** nothing structural. Only: rehearse on the live tenant host and confirm the
construction content/case-studies exist and are published. **Lowest-risk act; effectively ready.**

---

## Act 2 — "One Visitor, Not Three Records" (audience identification)

**Doable now:**
- Consent grant + send OF1 anonymous signals to RTCDP via Alloy `sendEvent` → **real ECID**
  (probe-confirmed). Visible in Adobe Assurance.
- Form-fill fires an identity event (business email) → **ECID→email stitch** (real; Alloy
  does this). The "merge into one profile" moment, provable in Assurance.
- Next-page existing-QBO-vs-new **fork driven by the firmographics mock** (real-shaped).
- (Design: `feat/of1-rtcdp-signals` spec `2026-07-30-act2-...`. Not yet implemented — standing by.)

**Missing (Adobe/Cedric owns):**
- Confirm **Profile service enabled** on the datastream (else the event lands in a dataset,
  no live profile to click into in the RTCDP UI).
- **XDM tenant prefix + schema field group** for the `of1Signal` object so signals persist
  on-profile (Edge accepts the object regardless, but won't store it without the schema).
- A **real decision scope + audience** to make the fork a genuine RTCDP decision (currently mock).
- Identity namespace for the email/account (default `Email` namespace assumed).

**Demo honesty:** signal + stitch are real (Assurance proof); the fork is simulated until
a scope is activated.

---

## Act 3 — "The Buying Group" (ABM account resolution) — MOST config-heavy

**Doable now (code): almost nothing unique.**
- Send per-contact events with a shared **company-domain / B2B account identity** in the
  `identityMap` (same plumbing as Act 2 + one identifier). This is the only codeable piece.
- Read a journey-stage decision and fork the page on it — **but the decision doesn't exist yet.**

**Missing (Adobe/Cedric owns — this is the entire signature moment):**
- **AJO B2B licensed & configured** in the sandbox (account model / buying-group matching).
  **Unconfirmed it's even available** — probe only proved identity + Target/AAM edges.
- Buying-group resolution: 3 profiles → 1 account record (native AJO B2B feature; no code).
- **Role modeling** (influencer / evaluator / decision-maker) on the account.
- An **AJO B2B journey** with defined stages.
- A **decision scope** that returns the account's journey stage for the website fork.
- Prior-session email-click-thru identity token to stitch a returning browser to a profile.

**Verdict:** the core of Act 3 is **not buildable today** — it lives inside AJO B2B, which is
unactivated (and possibly unlicensed) in this sandbox. Highest dependency risk of the five.

---

## Act 4 — "Ad Click to Account Journey" (speed + audience + attribution)

**Doable now:**
- GCLID + UTM in → OF1 matches hero/headline to the ad (acquisition-context, **built**;
  `signals.json` already has a gclid preset).
- Send the GCLID/UTM session data to RTCDP as XDM (extends Act 2's `sendEvent` with campaign
  fields) → lands as real attribution data with an ECID.

**Missing (Adobe/Cedric owns):**
- Profile eligibility for an **AJO acquisition journey** (journey must exist — config).
- **CRM/MAP sync** showing the lead with full journey (ad → variant → form → enrollment).
  Requires a CRM/MAP connected to AEP + destination config — **entirely Adobe/IT side; no
  code from us, and unconfirmed it exists.**
- Standard vs custom XDM for campaign/attribution fields (schema dependency, same as Act 2).

**Verdict:** the OF1 hero-match half is ready; the RTCDP-attribution send is buildable with
Act 2's plumbing; the journey-enrollment + CRM-sync payoff is Adobe/IT config we can't prove.

---

## Act 5 — "Coworker Catches It" (signal-to-action) — labeled early/design-partner

**Doable now:**
- Narrate the flow; the strategy-file refresh beat is real (reuses Act 1 strategy-driven
  generation). Signal detection can be simulated/narrated.

**Missing (mostly not code we own / out of scope):**
- The "coworker agent" that detects a bounce signal and proposes actions — **orchestration
  layer, not built**; treat as narrated per the script's own maturity label.
- Spin up an **AJO nurture track** (config), open a **Workfront ticket** (integration).
- Tie-back to the same account thread depends on Act 3 being real.

**Verdict:** demo as narrated/vision. Only the strategy-refresh sub-beat is real today.

---

## Consolidated "ask Cedric / Adobe" list (unblocks Acts 2–4)

1. Is the **Profile service** enabled on datastream `a114467b-…`?
2. Is **AJO B2B** (account & buying-group modeling) licensed and configured in this sandbox?
   (Gates all of Act 3.)
3. XDM **tenant prefix** + **schema field group(s)** for OF1 signal + campaign/attribution objects.
4. Identity **namespaces**: person (Email?) and B2B **account** (domain? account id?).
5. **Decision scope name(s)** + bound activities for: Act 2 QBO-vs-new fork; Act 3 journey-stage
   messaging.
6. **Audience** definitions (existing-QBO customer, new-to-franchise, construction-intent segment).
7. **AJO journeys** defined (Act 3 buying-group journey; Act 4 acquisition journey).
8. **CRM/MAP** connected to AEP + destination (Act 4 sync claim).

Once 1–8 (or the subset for a given act) are provided, our side is: enable Alloy (done),
implement config-driven `sendEvent` + `getPersonalizationForView` swaps, and replace the
mock forks with real decisions. Everything else is Adobe-side.
