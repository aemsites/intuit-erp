# Extension Resolves & Displays RTCDP Segments (via the page's Alloy) — Design

**Date:** 2026-07-31
**Repos:** `aem-intuit-erp` (EDS page: capture + post segments), `of1-preview-extension` (receive, map, store, display)
**Status:** Approved, not yet implemented
**Context:** Act 3 payoff surface (buying-group role) + real Act 2 audience input for the Intuit OF1 + AJO/RTCDP demo. Follows the "OF1's LLM decides" architecture — no on-page content fork.

## Concept

The page already fetches the visitor's RTCDP/AJO segment membership from Adobe as part of
its own Alloy `sendEvent` (verified live: `result.destinations[].segments[].id`). The page
posts those segment **IDs** to the extension; the extension maps IDs → human names via the
tenant's `audiences.json`, stores them on the behavior profile, and the **existing** pipeline
surfaces them in the Insights side-panel card AND the `/api/personalize` request body. The
extension never calls Adobe — it reads what the page already got, which sidesteps all
identity/ECID-cookie/CORS complexity.

## Verified facts (live, 2026-07-31)

- On the page, `window.alloy('sendEvent', …)` returns `result.destinations[]`; the entry with
  `alias: 'aem'` carries `segments[]{ id, namespace: 'ups' }`. Quentin's session resolved to
  Influencer (`234df199…`) + IT Security (`2e65818b…`).
- EDS `sendOf1Signal` (Act 2) currently `await sendEvent({xdm})` but **discards the result** —
  the segments are fetched but thrown away. This is the small capture gap to close.
- Extension already: has a page↔extension `window.postMessage` channel in `injector.ts`
  (the `OF1_REQUEST_PROFILE`/`OF1_PERSONALIZE` handshake); stores `profile.entryContext.audiences`;
  renders it in the Insights card; and includes it in the `/api/personalize` body. So a resolved
  `audiences` string[] flows to UI + personalize automatically.
- `audiences.json` (ID→{name} map) authored at EDS `of1/config/audiences.json` (committed 909bfa1).

## Decisions (locked with user)

- **Page → extension bridge:** the EDS page reads its Alloy segment IDs and `window.postMessage`s
  them; the extension content script receives + forwards to the service worker.
- **Mapping owner:** the **extension** fetches `https://{tenant}.aem.page/of1/config/audiences.json`
  and maps IDs → names (for both the UI display and the personalize names).
- **Separate resolve path:** a standalone audiences path, NOT coupled to firmographics — segments
  resolve even when no company firmographics resolve.
- **Trigger:** on page access, after the page's Alloy has run (so the IDs exist to post).
- **UI:** reuse the existing `entryContext.audiences` Insights display (no new section).
- **Merge, not overwrite:** resolved segment names are MERGED (deduped) with any existing
  firmographic/mock audiences on `entryContext.audiences`, so both coexist.
- **No worker change:** the worker-side `audienceIds`→name mapping (already built + deployed) stays
  as the `/api/generate` path + fallback; personalize already accepts `audiences` names.

## Data flow

```
EDS page (scripts.js): Alloy sendEvent → result.destinations[].segments[].id
  → readAlloySegmentIds(result) → window.postMessage({ type: 'OF1_AUDIENCE_SEGMENTS', domain, ids })
Extension content script (injector.ts): window 'message' OF1_AUDIENCE_SEGMENTS
  → chrome.runtime.sendMessage({ type: 'RESOLVE_AUDIENCE_SEGMENTS', domain, ids })
Extension service worker: resolveAndStoreAudienceSegments(domain, ids)
  → fetch {tenant}/of1/config/audiences.json → mapSegmentIds(ids, map) (drop unknowns, dedupe)
  → merge onto profile.entryContext.audiences (deduped) → save → chrome.runtime.sendMessage DATA_UPDATED
  → Insights card renders audiences (already wired) + /api/personalize body includes them (already wired)
```

## Components

### EDS repo (`aem-intuit-erp`) — 2 changes
1. **Capture the Alloy result.** `scripts/of1-rtcdp-signal.js` `sendOf1Signal` currently returns
   `boolean` and discards the `sendEvent` result. Change it to return `{ sent, result }` (or expose
   the result) so the caller can read segments. Keep fail-open.
2. **Read + post segment IDs.** Add pure `readAlloySegmentIds(result) => string[]`
   (`destinations[].segments[].id`, deduped, `[]` on any absent/invalid shape). In `scripts.js`
   `loadLazy`, after `sendOf1Signal`, if segment IDs are present,
   `window.postMessage({ type: 'OF1_AUDIENCE_SEGMENTS', domain, ids }, '*')`. Fail-open (no ids → no post).

### Extension repo (`of1-preview-extension`) — 3 changes
3. **Content script** (`src/content/injector.ts`): add a `window` `message` listener for
   `OF1_AUDIENCE_SEGMENTS` (guard `event.source === window`), forward as
   `chrome.runtime.sendMessage({ type: 'RESOLVE_AUDIENCE_SEGMENTS', domain, ids })`.
4. **Pure map helper** (`mapSegmentIds(ids, audiencesMap) => string[]`): resolve IDs→names via the
   fetched map, drop unknown/nameless, dedupe. Unit-tested.
5. **Service worker** (`src/background/service-worker.ts`): `RESOLVE_AUDIENCE_SEGMENTS` handler →
   `resolveAndStoreAudienceSegments(domain, ids)`: fetch the tenant's `audiences.json` (via
   `getTenantIdForDomain` for the host), `mapSegmentIds`, load the profile (or empty), MERGE the
   names onto `entryContext.audiences` (dedupe), save, `DATA_UPDATED`. Independent of firmographics.
   Cache the fetched map briefly to avoid refetching every page access.

### No worker (`of1-gen-web`) change
Worker mapping + both prompt flows already live (deployed 1999d163). Personalize consumes the
`audiences` names the extension already sends.

## Error handling
Fail-open throughout: page posts nothing if no segments; `audiences.json` fetch failure → keep any
existing audiences, skip; unknown IDs dropped; malformed profile → treated as empty. Never breaks
the page or the side panel.

## Testing
- EDS: `readAlloySegmentIds` unit test (known/dedupe/empty/invalid). postMessage wiring browser-verified.
- Extension: `mapSegmentIds` pure unit test (known/unknown/nameless/empty/dedupe);
  `resolveAndStoreAudienceSegments` with mocked fetch + chrome.storage (maps, merges, DATA_UPDATED).
- Live (browser): browse the branch with the extension → Insights card shows "Buying Group Member
  Role is Influencer" → `/api/personalize` body carries the name → OF1 reflects it. (Not headless.)

## Non-goals
- Extension does NOT call the AEP Edge itself (no identity/cookie handling — the page owns the Alloy call).
- No new AEP config (Ken owns segment activation).
- No on-page content fork (OF1 decides).
- No dynamic AEP Segmentation API name lookup (audiences.json is the source of names).
