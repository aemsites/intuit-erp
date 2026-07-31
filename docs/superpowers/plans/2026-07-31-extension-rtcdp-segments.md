# Extension RTCDP Segments (via page Alloy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The EDS page captures the RTCDP/AJO segment IDs its own Alloy call already fetched and posts them to the OF1 extension; the extension maps IDs→names via the tenant `audiences.json`, merges them onto the behavior profile, and the existing pipeline surfaces them in the Insights side-panel and the `/api/personalize` body.

**Architecture:** Page-owns-the-Alloy-call (no extension→Adobe call, no identity/cookie handling). EDS `sendOf1Signal` returns its Alloy result; `scripts.js` extracts `destinations[].segments[].id` and `window.postMessage`s them. The extension content script forwards to the service worker, which fetches `audiences.json`, maps IDs→names, and merges onto `profile.entryContext.audiences` (a standalone path, independent of firmographics).

**Tech Stack:** EDS (vanilla ES modules, repo-root Vitest already present on this branch). Extension (TypeScript, Vitest + jsdom, `npm test` = `vitest run`; existing tests under `tests/`).

## Global Constraints

- **Two repos, two branches:**
  - EDS `aem-intuit-erp`: branch `feat/of1-rtcdp-signals` (has Act 2 + audiences.json + repo-root Vitest).
  - Extension `of1-preview-extension`: NEW branch `feat/rtcdp-segments` off `main` (main already has the firmographics/audiences code + full Vitest under `tests/`).
- Fail-open everywhere: no segments → page posts nothing; `audiences.json` fetch failure → keep existing audiences, skip; unknown IDs dropped; malformed profile → treated as empty. Never break the page or side panel.
- **Merge, not overwrite:** resolved segment names are merged (deduped) with any existing `entryContext.audiences`.
- **Separate from firmographics:** audiences resolve even when no firmographics resolve — a standalone handler, not inside `resolveAndStoreFirmographics`.
- postMessage type: `OF1_AUDIENCE_SEGMENTS`, payload `{ type, domain, ids }`. Content→worker message type: `RESOLVE_AUDIENCE_SEGMENTS`, `{ type, domain, ids }`.
- Segment read path (verified live): `result.destinations[].segments[].id`.
- audiences.json fetch: `https://${tid}.aem.page/of1/config/audiences.json` via `getTenantIdForDomain(domain)` + AbortController timeout (mirror `fetchSignal`, `SIGNAL_FETCH_TIMEOUT_MS = 4000`).
- No `of1-gen-web` worker change (mapping + flows already deployed).
- Content-script window listeners MUST guard `event.source === window` (matches existing `injector.ts` handshake).

---

### Task 1: EDS — capture Alloy result + read segment IDs

**Files:**
- Modify: `scripts/of1-rtcdp-signal.js` (return the sendEvent result; add `readAlloySegmentIds`)
- Test: `test/of1-audiences.test.js`

**Interfaces:**
- Consumes: the martech `sendEvent` result shape (`{ destinations: [{ segments: [{ id }] }] }`).
- Produces:
  - `readAlloySegmentIds(sendEventResult) => string[]` — deduped `destinations[].segments[].id`, `[]` on absent/invalid.
  - `sendOf1Signal(...)` returns `{ sent: boolean, result: object|null }` (was `boolean`).

- [ ] **Step 1: Write the failing test**

Create `test/of1-audiences.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { readAlloySegmentIds } from '../scripts/of1-rtcdp-signal.js';

describe('readAlloySegmentIds', () => {
  it('extracts deduped segment ids from destinations', () => {
    const result = {
      destinations: [
        { alias: 'aem', segments: [{ id: 'a', namespace: 'ups' }, { id: 'b', namespace: 'ups' }] },
      ],
    };
    expect(readAlloySegmentIds(result)).toEqual(['a', 'b']);
  });

  it('dedupes ids across destinations', () => {
    const result = {
      destinations: [{ segments: [{ id: 'a' }] }, { segments: [{ id: 'a' }, { id: 'c' }] }],
    };
    expect(readAlloySegmentIds(result)).toEqual(['a', 'c']);
  });

  it('returns [] for missing/empty/invalid input', () => {
    expect(readAlloySegmentIds(undefined)).toEqual([]);
    expect(readAlloySegmentIds({})).toEqual([]);
    expect(readAlloySegmentIds({ destinations: [] })).toEqual([]);
    expect(readAlloySegmentIds({ destinations: [{}] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/of1-audiences.test.js`
Expected: FAIL — `readAlloySegmentIds` not exported.

- [ ] **Step 3: Implement in `scripts/of1-rtcdp-signal.js`**

Add the pure extractor (near the other exports):

```js
// Extracts RTCDP/AJO segment IDs from the on-page Alloy sendEvent result.
// The Edge returns segment membership under result.destinations[].segments[].id
// (verified live: the alias:"aem" edge-lookup destination). Deduped; [] on any
// absent/invalid shape (fail-open — the page must never break if AEP is off).
export function readAlloySegmentIds(sendEventResult) {
  const destinations = sendEventResult?.destinations;
  if (!Array.isArray(destinations)) return [];
  const ids = [];
  for (const d of destinations) {
    const segments = Array.isArray(d?.segments) ? d.segments : [];
    for (const s of segments) {
      if (s?.id && !ids.includes(s.id)) ids.push(s.id);
    }
  }
  return ids;
}
```

Change `sendOf1Signal` to capture and return the result (it currently returns a boolean and discards the `sendEvent` return). Locate:

```js
    await sendEvent({ xdm });
    return true;
```

Replace with:

```js
    const result = await sendEvent({ xdm });
    return { sent: true, result: result || null };
```

And update the fail-open returns in `sendOf1Signal`: the early `if (!payload) return false;` becomes `return { sent: false, result: null };`, and the `catch { return false; }` becomes `catch { return { sent: false, result: null }; }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/of1-audiences.test.js`
Expected: PASS (3 cases).

- [ ] **Step 5: Check callers of sendOf1Signal**

Run: `grep -rn "sendOf1Signal" scripts/ test/`
`scripts.js` calls `sendOf1Signal({ sendEvent }).catch(() => {})` (fire-and-forget) — the return-shape change is backward compatible there (the resolved value was already ignored). Confirm no code destructures the old boolean return. If any does, update it. (Task 2 will consume the new `{ result }`.)

- [ ] **Step 6: Commit**

```bash
git add scripts/of1-rtcdp-signal.js test/of1-audiences.test.js
git commit -m "feat(of1): capture Alloy result + readAlloySegmentIds extractor"
```

---

### Task 2: EDS — post segment IDs to the extension

**Files:**
- Modify: `scripts/scripts.js` (`loadLazy` — post segments after sendOf1Signal)

**Interfaces:**
- Consumes: `readAlloySegmentIds` + the `{ result }` from `sendOf1Signal` (Task 1).
- Produces: a `window.postMessage({ type: 'OF1_AUDIENCE_SEGMENTS', domain, ids }, '*')` when segments are present.

- [ ] **Step 1: Add the import**

In `scripts/scripts.js`, the existing import is `import { sendOf1Signal } from './of1-rtcdp-signal.js';`. Extend it:

```js
import { sendOf1Signal, readAlloySegmentIds } from './of1-rtcdp-signal.js';
```

- [ ] **Step 2: Post segments after the signal resolves**

In `loadLazy`, the current line is:

```js
    sendOf1Signal({ sendEvent }).catch(() => {});
```

Replace with:

```js
    // Capture the segments the page's Alloy already resolved and hand them to
    // the OF1 extension (page owns the Alloy call; the extension maps + displays).
    sendOf1Signal({ sendEvent }).then((r) => {
      const ids = readAlloySegmentIds(r && r.result);
      if (ids.length) {
        window.postMessage({ type: 'OF1_AUDIENCE_SEGMENTS', domain: window.location.hostname, ids }, '*');
      }
    }).catch(() => {});
```

- [ ] **Step 3: Lint**

Run: `npx eslint scripts/scripts.js`
Expected: no new errors.
Note: the postMessage wiring is verified live in the browser (Task 6), not unit-tested here (matches how Act 2's DOM/Alloy wiring was handled).

- [ ] **Step 4: Commit**

```bash
git add scripts/scripts.js
git commit -m "feat(of1): post Alloy segment ids to the extension"
```

---

### Task 3: Extension — mapSegmentIds pure helper

> **Repo:** `of1-preview-extension`, branch `feat/rtcdp-segments` (create off `main`).

**Files:**
- Create: `src/shared/segment-map.ts`
- Test: `tests/shared/segment-map.test.ts`

**Interfaces:**
- Produces: `mapSegmentIds(ids: string[], audiencesMap: Record<string, { name?: string }>) => string[]` — resolves IDs→names, drops unknown/nameless, dedupes, `[]` on invalid input.

- [ ] **Step 1: Create the branch**

```bash
cd of1-preview-extension && git checkout -b feat/rtcdp-segments main
```

- [ ] **Step 2: Write the failing test**

Create `tests/shared/segment-map.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapSegmentIds } from "../../src/shared/segment-map";

const MAP = {
  "234df199": { name: "Buying Group Member Role is Influencer" },
  "9e7083eb": { name: "Buying Group Member Role is Decision Maker" },
  noname: {},
};

describe("mapSegmentIds", () => {
  it("maps known ids to names", () => {
    expect(mapSegmentIds(["234df199", "9e7083eb"], MAP)).toEqual([
      "Buying Group Member Role is Influencer",
      "Buying Group Member Role is Decision Maker",
    ]);
  });
  it("drops unknown and nameless ids", () => {
    expect(mapSegmentIds(["234df199", "unknown", "noname"], MAP)).toEqual([
      "Buying Group Member Role is Influencer",
    ]);
  });
  it("dedupes repeated ids", () => {
    expect(mapSegmentIds(["234df199", "234df199"], MAP)).toEqual([
      "Buying Group Member Role is Influencer",
    ]);
  });
  it("returns [] for empty/invalid", () => {
    expect(mapSegmentIds([], MAP)).toEqual([]);
    expect(mapSegmentIds(undefined as any, MAP)).toEqual([]);
    expect(mapSegmentIds(["234df199"], null as any)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/shared/segment-map.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `src/shared/segment-map.ts`:

```ts
// Maps RTCDP/AJO segment IDs to human-readable audience names via the tenant's
// audiences.json map. Unknown or nameless IDs are dropped so only curated names
// reach the UI + the personalize request. Pure — no I/O.
export function mapSegmentIds(
  ids: string[],
  audiencesMap: Record<string, { name?: string }>,
): string[] {
  if (!Array.isArray(ids) || !audiencesMap || typeof audiencesMap !== "object") return [];
  const names: string[] = [];
  for (const id of ids) {
    const name = audiencesMap[id]?.name;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/shared/segment-map.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 6: Commit**

```bash
git add src/shared/segment-map.ts tests/shared/segment-map.test.ts
git commit -m "feat(ext): mapSegmentIds segment id->name helper"
```

---

### Task 4: Extension — resolve + store audience segments (service worker)

> **Repo:** `of1-preview-extension`, branch `feat/rtcdp-segments`.

**Files:**
- Modify: `src/background/service-worker.ts`
- Test: `tests/background/service-worker.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `mapSegmentIds` (Task 3); existing `getTenantIdForDomain`, `getBehaviorProfile`, `saveBehaviorProfile`, `createEmptyProfile`.
- Produces: `RESOLVE_AUDIENCE_SEGMENTS` message handler → `resolveAndStoreAudienceSegments(domain, ids)`: fetch `audiences.json`, map, MERGE onto `profile.entryContext.audiences` (deduped), save, `DATA_UPDATED`. Independent of firmographics.

- [ ] **Step 1: Write the failing test**

Add to `tests/background/service-worker.test.ts` (follow the file's existing mock setup for `chrome.storage`/`fetch`; mirror the pattern of the existing `RESOLVE_FIRMOGRAPHICS` test):

```ts
describe("RESOLVE_AUDIENCE_SEGMENTS", () => {
  it("maps ids via audiences.json and merges names onto entryContext.audiences", async () => {
    // audiences.json fetch returns the ID->name map
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ "234df199": { name: "Buying Group Member Role is Influencer" } }),
    }) as any;
    // seed a profile with an existing (firmographic) audience to prove MERGE
    await seedProfile("example.com", { entryContext: { source: "direct", label: "Direct", capturedAt: 1, audiences: ["Existing Mock Audience"] } });

    const res = await sendMessage({ type: "RESOLVE_AUDIENCE_SEGMENTS", domain: "example.com", ids: ["234df199", "unknown"] });
    expect(res.ok).toBe(true);

    const profile = await getStoredProfile("example.com");
    expect(profile.entryContext.audiences).toEqual(
      expect.arrayContaining(["Existing Mock Audience", "Buying Group Member Role is Influencer"]),
    );
    expect(profile.entryContext.audiences).not.toContain("unknown");
  });

  it("is fail-open: audiences.json fetch failure leaves existing audiences intact", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
    await seedProfile("ex2.com", { entryContext: { source: "direct", label: "Direct", capturedAt: 1, audiences: ["Keep Me"] } });
    const res = await sendMessage({ type: "RESOLVE_AUDIENCE_SEGMENTS", domain: "ex2.com", ids: ["234df199"] });
    expect(res.ok).toBe(true);
    const profile = await getStoredProfile("ex2.com");
    expect(profile.entryContext.audiences).toEqual(["Keep Me"]);
  });
});
```

> Adapt `seedProfile`/`getStoredProfile`/`sendMessage` to the helpers the existing test file uses (it already exercises `RESOLVE_FIRMOGRAPHICS` and `GET_PROFILE` — reuse those seams; do not invent new globals). If the file lacks a reusable helper, use the same inline `chrome.storage.local` mock the existing tests use.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/background/service-worker.test.ts`
Expected: FAIL — `RESOLVE_AUDIENCE_SEGMENTS` unknown message type / handler missing.

- [ ] **Step 3: Implement the fetch + handler**

In `src/background/service-worker.ts`, add the import:

```ts
import { mapSegmentIds } from "../shared/segment-map";
```

Add a fetcher mirroring `fetchSignal` (uses `getTenantIdForDomain` + AbortController):

```ts
// Fetches the tenant's audiences.json (segment ID -> { name }) map. Returns {}
// on any failure so callers fail-open. Cached briefly to avoid refetch per page.
const audiencesMapCache = new Map<string, Record<string, { name?: string }>>();
async function fetchAudiencesMap(domain: string): Promise<Record<string, { name?: string }>> {
  const tid = await getTenantIdForDomain(domain);
  if (audiencesMapCache.has(tid)) return audiencesMapCache.get(tid)!;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SIGNAL_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://${tid}.aem.page/of1/config/audiences.json`, { signal: controller.signal });
    if (!res.ok) return {};
    const map = await res.json();
    const safe = map && typeof map === "object" ? map : {};
    audiencesMapCache.set(tid, safe);
    return safe;
  } catch {
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
}
```

Add the resolve+store function (standalone, NOT inside firmographics):

```ts
// Resolves RTCDP/AJO segment IDs (posted by the page from its own Alloy call)
// to names via audiences.json, and MERGES them onto entryContext.audiences.
// Independent of firmographics: a visitor can have segments with no company.
async function resolveAndStoreAudienceSegments(domain: string, ids: string[]): Promise<void> {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const map = await fetchAudiencesMap(domain);
  const names = mapSegmentIds(ids, map);
  if (names.length === 0) return;

  let profile = await getBehaviorProfile(domain);
  if (!profile) profile = createEmptyProfile(domain);
  const base = profile.entryContext || { source: "direct", label: "Direct", capturedAt: Date.now() };
  const existing = Array.isArray(base.audiences) ? base.audiences : [];
  const merged = [...existing];
  for (const n of names) if (!merged.includes(n)) merged.push(n);
  profile.entryContext = { ...base, audiences: merged };
  await saveBehaviorProfile(profile);
  chrome.runtime.sendMessage({ type: "DATA_UPDATED", domain }).catch(() => {});
}
```

Add the message handler and register it in `MESSAGE_HANDLERS`:

```ts
async function handleResolveAudienceSegments(msg: any): Promise<any> {
  if (!msg.domain) return { ok: false };
  await resolveAndStoreAudienceSegments(msg.domain, msg.ids || []);
  return { ok: true };
}
```

In the `MESSAGE_HANDLERS` object, add:

```ts
  RESOLVE_AUDIENCE_SEGMENTS: handleResolveAudienceSegments,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/background/service-worker.test.ts`
Expected: PASS (the 2 new cases + existing suite green).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test`
Expected: PASS (whole extension suite).
Run: `npx tsc --noEmit` (if the repo uses it — check package.json scripts; run the repo's typecheck/lint script if present)
Expected: no new type errors.

- [ ] **Step 6: Commit**

```bash
git add src/background/service-worker.ts tests/background/service-worker.test.ts
git commit -m "feat(ext): resolve + store RTCDP audience segments (merge, fail-open)"
```

---

### Task 5: Extension — content script receives + forwards segments

> **Repo:** `of1-preview-extension`, branch `feat/rtcdp-segments`.

**Files:**
- Modify: `src/content/injector.ts`
- Test: `tests/content/injector.test.ts` (add a case)

**Interfaces:**
- Consumes: the `OF1_AUDIENCE_SEGMENTS` window message from the page (Task 2).
- Produces: forwards `chrome.runtime.sendMessage({ type: 'RESOLVE_AUDIENCE_SEGMENTS', domain, ids })`.

- [ ] **Step 1: Write the failing test**

Add to `tests/content/injector.test.ts` (mirror the existing window-message test pattern in that file; mock `chrome.runtime.sendMessage`):

```ts
it("forwards OF1_AUDIENCE_SEGMENTS to the service worker", async () => {
  const sendMessage = vi.fn().mockResolvedValue({ ok: true });
  (globalThis as any).chrome = { ...(globalThis as any).chrome, runtime: { ...(globalThis as any).chrome?.runtime, sendMessage } };

  window.postMessage({ type: "OF1_AUDIENCE_SEGMENTS", domain: "example.com", ids: ["234df199"] }, "*");
  await new Promise((r) => setTimeout(r, 0)); // let the message loop run

  expect(sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "RESOLVE_AUDIENCE_SEGMENTS", domain: "example.com", ids: ["234df199"] }),
  );
});
```

> If the existing injector tests import the module differently (e.g. a `setup` that registers listeners on import), follow that same setup so the new listener is registered. Adapt the chrome mock to the file's existing pattern rather than inventing one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/content/injector.test.ts`
Expected: FAIL — no forwarder yet.

- [ ] **Step 3: Implement the listener**

In `src/content/injector.ts`, add a window message listener (alongside the existing `OF1_REQUEST_PROFILE` one), guarding `event.source === window`:

```ts
window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.type !== "OF1_AUDIENCE_SEGMENTS") return;
  const { domain, ids } = event.data;
  if (!domain || !Array.isArray(ids) || ids.length === 0) return;
  chrome.runtime.sendMessage({ type: "RESOLVE_AUDIENCE_SEGMENTS", domain, ids }).catch(() => {});
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/content/injector.test.ts`
Expected: PASS (new case + existing green).

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS (whole suite).

- [ ] **Step 6: Commit**

```bash
git add src/content/injector.ts tests/content/injector.test.ts
git commit -m "feat(ext): content script forwards OF1_AUDIENCE_SEGMENTS to worker"
```

---

### Task 6: Live end-to-end verification (browser)

**Files:** none (verification only).

> **Note:** Requires the EDS branch deployed to preview, the extension branch built + loaded, and a session whose profile resolves segments (Quentin's session already resolves to Influencer). Cannot be verified headlessly. Also requires `audiences.json` published in DA.live so the extension's fetch returns it (Task 5 of the prior plan — operator step).

- [ ] **Step 1: Build + load the extension**

Build the extension branch (`npm run build` or the repo's build script) and load the unpacked build in Chrome. Ensure the OF1 extension is enabled.

- [ ] **Step 2: Confirm audiences.json is served**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://feat-of1-rtcdp-signals--intuit-erp--aemsites.aem.page/of1/config/audiences.json`
Expected: `200` (publish it in DA.live first if 404).

- [ ] **Step 3: Browse + observe the Insights panel**

On the deployed EDS branch (normal window, extension on), browse a few pages so the profile resolves segments. Open the extension side panel → Insights. Confirm the audiences show the mapped name(s) (e.g. "Buying Group Member Role is Influencer").

- [ ] **Step 4: Confirm it reaches personalize**

Trigger an OF1 personalize (the extension's personalize flow) and confirm the `/api/personalize` request body's `audiences` includes the mapped segment name. Confirm OF1's output reflects the audience.

- [ ] **Step 5: Fail-open check**

On a page/tenant with no `audiences.json` (or no segments), confirm the panel and generation behave exactly as before — no errors.

---

## Self-Review

**Spec coverage:**
- Page captures Alloy result + reads segment IDs → Task 1. ✓
- Page posts IDs to the extension → Task 2. ✓
- Extension maps IDs→names (fetch audiences.json) → Tasks 3 (pure) + 4 (fetch/handler). ✓
- Separate-from-firmographics resolve path, merge onto audiences → Task 4. ✓
- Content script receives + forwards → Task 5. ✓
- Existing Insights display + personalize body consume audiences → verified in Task 6 (no new code needed). ✓
- Fail-open everywhere → Tasks 1/2/4/5 guards + tests. ✓

**Placeholder scan:** No TBD/TODO in code steps; all code shown. Test-helper adaptation notes in Tasks 4/5 point at concrete existing patterns (RESOLVE_FIRMOGRAPHICS test, injector window-message test) rather than leaving them blank — an intentional "match the existing harness" instruction, not a placeholder.

**Type consistency:** `readAlloySegmentIds(result)`, `sendOf1Signal → {sent,result}`, `mapSegmentIds(ids, map)`, `resolveAndStoreAudienceSegments(domain, ids)`, message types `OF1_AUDIENCE_SEGMENTS` / `RESOLVE_AUDIENCE_SEGMENTS`, and `entryContext.audiences: string[]` are used identically across tasks and match the existing codebase types.

**Scope check:** One feature across two repos; each task ends with an independently testable deliverable (Tasks 1,3,4,5 unit-tested; 2 lint+browser; 6 live). No worker change. Dynamic AEP-API name lookup and any extension→Adobe call are explicitly out of scope (spec non-goals).
