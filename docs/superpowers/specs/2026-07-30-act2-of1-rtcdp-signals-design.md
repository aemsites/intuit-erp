# Act 2 — OF1 Anonymous Signals → RTCDP Profile at Form-Fill — Design

**Date:** 2026-07-30
**Repo:** `aem-intuit-erp` (EDS), branch `feat/of1-rtcdp-signals` off `origin/aep-martech-integration`
**Status:** Approved, not yet implemented
**Demo context:** Act 2 of Cedric's 5-act Intuit OF1 + AJO/RTCDP B2B script — "One Visitor, Not Three Records."

## Goal

Send OF1's anonymous interest/intent signals into Adobe Experience Platform (RTCDP) via
the on-page Web SDK (Alloy), then at "Talk to sales / Schedule a call" form-fill send a
known-identity (business email) event so the anonymous ECID stitches to a real profile —
the "anonymous interest merges into a new RTCDP profile" moment. The subsequent
existing-QBO-vs-new-to-franchise **fork is mock-driven** (reuses the firmographics mock)
until Adobe-side AJO/RTCDP activities are configured.

## Probe findings that shape this (2026-07-30)

Anonymous probes to `edge.adobedc.net/ee/v2/interact` with the real datastream + org:
- ✅ Transport 200; identity service live (real ECID minted); personalization edges
  provisioned (Target + AAM advertised).
- ❌ `activation:pull` empty for `__view__` and every candidate named scope → **no AJO/RTCDP
  activities activated yet**. Therefore the real fork decision is blocked on Adobe config;
  anonymous `sendEvent` plumbing is safe to build now.

## What already exists (do not rebuild)

- `origin/aep-martech-integration` already flips `MARTECH_ENABLED` on with the real
  datastream + org id → `initMartech` runs, Alloy loads, `martechEager`/`martechLazy` fire.
- `plugins/martech/src/index.js` exports `sendEvent(payload)`, `updateUserConsent(consent)`,
  `getPersonalizationForView(viewName)`.
- OF1 exposes the anonymous profile on-page via a postMessage handshake (from
  `of1-client.js`): page posts `{type:'OF1_REQUEST_PROFILE', domain}`; the extension replies
  `{type:'OF1_PERSONALIZE', payload:{ interests, intentProfile, pageVisits, query }}`.
- Firmographics/audiences mock path (worker `/api/firmographics` + tenant
  `firmographics.json`, email-domain → preset) already built and deployed — reused for the fork.

## Decisions (locked with user)

- Branch: `feat/of1-rtcdp-signals` off `aep-martech-integration` (reviewable separately).
- Fork driver: **existing firmographics mock** (real-shaped, swappable later).
- Consent: **auto-grant** `updateUserConsent({ collect: true })` on load (demo posture,
  no banner). Required — martech inits `defaultConsent: 'pending'`, which otherwise
  queues/drops all `sendEvent` calls.
- XDM: **custom namespaced object** for OF1 signals (see Component 3 for the tenant-prefix
  caveat).

## Components & Data Flow

### 1. Consent grant (enabler — build + verify first)
Add `updateUserConsent({ collect: true })` early in `loadLazy` (`scripts/scripts.js`),
guarded by `MARTECH_ENABLED`. Fail-open (try/catch, non-fatal). Without this, every
`sendEvent` below silently no-ops.

### 2. `scripts/of1-rtcdp-signal.js` (new module)
Exports `sendOf1Signal(martech)` (martech fns injected for testability). On a page with OF1:
1. Request the anonymous profile using OF1's existing protocol: `postMessage(OF1_REQUEST_PROFILE)`,
   await `OF1_PERSONALIZE` with a short timeout (~2.5s). No new extension code.
2. Map `payload.{interests, intentProfile, pageVisits}` → XDM via a pure `buildOf1SignalXdm(payload)`.
3. `martech.sendEvent(xdm)`. Anonymous → ECID minted.
Fail-open: no extension reply / timeout / martech disabled → resolve without sending.
Wired into `loadLazy` after martech is ready, guarded by `MARTECH_ENABLED`.

### 3. XDM payload shape
- Base: `eventType: 'web.webpagedetails.pageViews'` + `web.webPageDetails` (URL, name).
- OF1 data under a **tenant-namespaced custom object**. NOTE: the real XDM tenant prefix is
  org-derived (e.g. `_intuit123`), NOT literally `_intuit`. The Edge will *accept* an
  unknown object, but it is only stored on-profile once Cedric adds a matching **schema field
  group** and confirms the prefix. Implementation reads the prefix + object name from a config
  constant (`OF1_SIGNAL_XDM` in `scripts/of1-rtcdp-signal.js`) so it is a one-line swap.
- Custom object carries: `interests` (topic+score[]), `intent` (type/journeyStage),
  `pagesViewed` (paths[]), `capturedAt`.

### 4. Form-fill identity event (`blocks/form/form.js`)
The block renders a non-submitting `<button type="button">` today. Add a submit handler:
- On click, read the 5 fields; validate business email (basic shape + non-empty required fields).
- Fire `sendEvent` with `identityMap: { Email: [{ id: <email>, primary: true,
  authenticatedState: 'ambiguous' }] }` plus lead fields under the same tenant-namespaced
  object. `ambiguous` (not `authenticated`) because the email is unverified — matches the
  block's own comment and avoids asserting a verified identity into the platform.
- On success, show the existing confirmation affordance and (demo) navigate/reveal the
  forked next step. Fail-open: invalid email → inline validation, no send; martech
  absent → still show confirmation (form must never appear broken on the live site).
- Keep the block's current CSP-safe structure (no inline handlers; handler attached in JS).

### 5. The fork (mock-driven, this milestone)
After form-fill, the existing-QBO-vs-new decision reuses the firmographics/audiences mock
(email domain → preset). No real AEP decision call. Structured so a future
`getPersonalizationForView(scope)` swap replaces the mock without touching the form/signal code.

## Handoff contract for Cedric (what makes the fork real)
A short companion doc (`docs/.../act2-aep-config-contract.md`) listing exactly what to
configure AEP-side: (a) decision scope name(s) for the fork; (b) the identity namespace the
B2B audiences key on (Email? a B2B account id? domain?); (c) proposition-scope → OF1-audience-id
mapping; (d) the XDM tenant prefix + schema field group for the `of1Signal` object so signals
persist on-profile. Our code reads these from config constants → drop-in swap.

## Error Handling
Fail-open at every seam: consent grant, extension handshake timeout, `MARTECH_ENABLED` false,
invalid email, `sendEvent` rejection. The live site behaves identically to today if any piece
is absent — nothing user-visible breaks.

## Testing
- Unit (Vitest, like existing EDS block tests): `buildOf1SignalXdm` mapping (interests/intent/
  pages → XDM object under the configured prefix); email validation; fail-open guards
  (null payload, timeout). `sendEvent` is injected/mocked — no network in tests.
- Manual (needs browser, your session): load a page → OF1 signal `sendEvent` visible in
  network / Adobe Assurance with an ECID; submit form → identity event fires, Email in
  identityMap, ECID stitch visible in Assurance.

## Non-Goals (YAGNI / blocked)
- Real audience resolution / real fork decision (Adobe config — Acts 3/4 territory).
- Extension-side `resolveRtcdpAudiences` edge call.
- Consent banner / production consent flow (demo auto-grants).
- Changing what OF1 itself sends to the worker (unchanged).
