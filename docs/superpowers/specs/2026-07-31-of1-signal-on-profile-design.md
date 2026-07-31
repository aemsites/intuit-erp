# OF1 Signal Lands on the AEP Profile — Design

**Date:** 2026-07-31
**Repos:** `aem-intuit-erp` (EDS page emit — reshape `buildOf1SignalXdm`), AEP console (schema field group — done by whoever has console access)
**Status:** Approved, not yet implemented
**Context:** Demo beat "OF1's signal lands in AEP." Today the OF1 signal reaches the Edge but is **dropped at ingestion** (no matching schema field). This makes it persist on the profile's event timeline.

## Goal

Reshape the emitted `of1Signal` object to flat, profile-friendly fields and add a matching
**event field group** to "Experience Event Schema" (under the org's real tenant prefix) so the
OF1 interest/intent signal ingests and appears on the visitor's AEP profile event timeline —
demonstrable in the Profiles UI / dataset preview.

## Verified state (2026-07-31)

- Sandbox `developersandbox1`; datastream `a114467b`; schema **"Experience Event Schema"** has
  **Profile ON** + `identityMap` (so ECID→email stitch already persists).
- Schema has **no tenant-prefixed field group** → the emitted `_intuit.of1Signal` object is
  accepted by the Edge but **dropped at ingestion**.
- The EDS page-emit code (`scripts/of1-rtcdp-signal.js`, `buildOf1SignalXdm`) lives on the
  **unmerged EDS branch `feat/of1-rtcdp-signals` (PR #2)** — not on main. Work happens there.
- Nothing reads `of1Signal` back: it's write-only, separate from the audiences path
  (`destinations[].segments`) and from OF1's personalize channel (`OF1_REQUEST_PROFILE`
  postMessage). So reshaping it is low-risk — touches only `buildOf1SignalXdm` + its unit test.

## Decisions (locked with user)

- **Flatten the payload** to profile-friendly fields (easy to model + segment):
  ```
  <prefix>.of1Signal = {
    topInterests: string[],   // e.g. ["QuickBooks & Legacy ERP Migration", "AI Finance Agents"]
    topIntent: string,        // e.g. "purchase"
    journeyStage: string,     // e.g. "consideration" (or "" if none)
    pagesViewed: string[],    // e.g. ["/migration/", "/ai-agents/", "/"]
    capturedAt: string        // ISO
  }
  ```
  (Down from the current nested `interests[{topic,score,source}]`, `intent{intents[],...}`,
  `pagesViewed[{path,title,dwellTimeMs}]`.)
- **Event data, not a profile-record attribute.** The signal rides the existing
  `web.webpagedetails.pageViews` event; with Profile ON + identity it shows on the profile's
  event history. No profile-class field group / record-write path needed.

## Hard dependency (the ordering that prevents silent drops)

The emitted object path MUST byte-match the schema field group path, or ingestion drops it again.

1. **AEP (console):** create/add a field group to "Experience Event Schema" defining the
   `of1Signal` object (5 flat fields above). Adding it establishes the **real tenant prefix**
   (e.g. `_sapphiredemo1`), NOT the `_intuit` placeholder.
2. **Report the prefix** back to the code side.
3. **EDS (code):** set `OF1_SIGNAL.prefix` to that real prefix AND reshape `buildOf1SignalXdm`
   to emit the 5 flat fields. Deploy the branch.
4. **Verify** on-profile (below).

Steps 1↔3 cannot be finalized independently — the prefix from (1) drives (3).

## Components

### AEP schema field group (console)
- Field group on "Experience Event Schema" (Experience Event class), object `of1Signal` with:
  `topInterests` (string array), `topIntent` (string), `journeyStage` (string),
  `pagesViewed` (string array), `capturedAt` (string / date-time).
- Save; confirm the schema stays Profile-enabled. Note the tenant prefix shown on the object.

### EDS `buildOf1SignalXdm` (code, `scripts/of1-rtcdp-signal.js`, branch `feat/of1-rtcdp-signals`)
- Change `OF1_SIGNAL.prefix` from `_intuit` → the real prefix.
- Reshape the object build:
  - `topInterests` = `payload.interests?.map(i => i.topic).slice(0, N)` (drop scores/sources).
  - `topIntent` = `payload.intentProfile?.topIntent || ""`.
  - `journeyStage` = derive from `payload.intentProfile` (topIntent's journeyStage) or `""`.
  - `pagesViewed` = `payload.pageVisits?.map(v => v.path)`.
  - `capturedAt` = ISO.
- Keep it pure + fail-open (empty arrays / "" when absent). Update the unit test to the new shape.

## Non-goals / unchanged
- Audiences path (`destinations[].segments` → extension) — untouched.
- OF1 personalize channel (`OF1_REQUEST_PROFILE` postMessage → `/api/personalize`) — untouched;
  OF1 still gets full interest/intent detail there, independent of this flattened signal.
- The `lead` object on the form `formFilledOut` event — out of scope here (separate event/shape).
- No profile-record attribute; no new audience.

## Testing
- Unit (EDS Vitest): `buildOf1SignalXdm` emits the 5 flat fields under the configured prefix;
  empty/partial payload → empty arrays / "". 
- Live (browser + AEP): browse → Assurance shows the pageview event carrying the flat `of1Signal`
  under the real prefix (not dropped) → after ~1-2 min, open the profile (by ECID/email) in the
  Profiles UI → the OF1 interests appear on the event timeline (or via Datasets → Preview / Query
  Service on the event dataset).

## Demo flow (once live)
Apply George (or browse) → form-fill to attach identity → in AEP Profiles, open the profile →
show OF1's construction/migration interest landed on the timeline. "OF1's anonymous signal is
now real, queryable data on the unified profile."
