# OF1 Signal Lands on the AEP Profile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Reshape the emitted `of1Signal` to flat profile-friendly fields and add a matching event field group to the AEP schema (under the real tenant prefix) so OF1 interest/intent persists on the visitor's profile event timeline (dropped today).

**Architecture:** EDS `buildOf1SignalXdm` (pure) emits a flattened `of1Signal` object. The AEP "Experience Event Schema" gets a field group defining that object under the org's real tenant prefix; the emit prefix is set to match. Nothing reads `of1Signal` back (write-only; separate from audiences + OF1 personalize paths), so the reshape is low-risk.

**Tech Stack:** EDS (vanilla ES modules, repo-root Vitest already on this branch); AEP console (schema field group — manual, console access required).

## Global Constraints

- **Work in the worktree:** `aem-intuit-erp/.claude/worktrees/cc-agent`, currently detached at `origin/feat/of1-rtcdp-signals` (where `scripts/of1-rtcdp-signal.js` lives — NOT on main). Create a working branch there: `git checkout -b feat/of1-signal-flatten` before Task 1.
- **HARD ORDERING:** the emitted object path must byte-match the schema field group path or ingestion drops it. Sequence: (Task 2) AEP field group establishes the **real tenant prefix** → report it → (Task 3) set `OF1_SIGNAL.prefix` to match. Task 3's prefix value is a placeholder until Task 2 reports it.
- **Flat shape (exact):**
  ```
  <prefix>.of1Signal = {
    topInterests: string[],   // interests[].topic, capped
    topIntent:    string,     // intentProfile.topIntent or ""
    pagesViewed:  string[],   // pageVisits[].path
    capturedAt:   string      // ISO
  }
  ```
  NOTE: **no `journeyStage`** — the OF1 `IntentProfile` type has only `{ intents, topIntent, topScore, updatedAt }`; there is no journeyStage field to emit. Do not invent it.
- Pure + fail-open: absent/partial payload → empty arrays / "". `buildOf1SignalXdm` must not throw.
- Do NOT touch: the audiences path (`readAlloySegmentIds` / `destinations[].segments`), the OF1 personalize channel (`requestOf1Profile` / `OF1_PERSONALIZE`), `sendOf1Signal`, or the form `lead` event. Only `buildOf1SignalXdm` + its test change.
- MAX_INTERESTS = 5, MAX_PAGES = 10 (caps to keep the event lean).

## Verified inputs (2026-07-31)
- Current emit (nested): `of1Signal = { interests:[{topic,score,source}], intent:{intents,topIntent,topScore,updatedAt}|null, pagesViewed:[{path,title,dwellTimeMs}], capturedAt }` under prefix `_intuit` (placeholder, dropped at ingestion).
- OF1 payload types: `InterestSignal { topic, score, source }`; `IntentProfile { intents, topIntent, topScore, updatedAt }`; pageVisits have `{ path, title, dwellTimeMs }`.
- Schema "Experience Event Schema" is Profile-ON with identityMap; has no tenant-prefixed field group yet.

---

### Task 1: Flatten `buildOf1SignalXdm` (pure, prefix still placeholder)

**Files:**
- Modify: `scripts/of1-rtcdp-signal.js` (`buildOf1SignalXdm` + `OF1_SIGNAL` caps)
- Test: `test/of1-rtcdp-signal.test.js` (update the `buildOf1SignalXdm` cases)

**Interfaces:**
- Consumes: OF1 payload (`interests`, `intentProfile`, `pageVisits`).
- Produces: `buildOf1SignalXdm(payload, page)` emitting the flat 4-field object under `OF1_SIGNAL.prefix`.

- [ ] **Step 1: Create the working branch (in the worktree)**

```bash
cd aem-intuit-erp/.claude/worktrees/cc-agent
git checkout -b feat/of1-signal-flatten
```

- [ ] **Step 2: Write the failing test**

Replace the existing `buildOf1SignalXdm` describe block in `test/of1-rtcdp-signal.test.js` with:

```js
describe('buildOf1SignalXdm (flat)', () => {
  const page = { url: 'https://x.aem.page/migration/', name: 'Migration' };
  const P = () => ({ prefix: OF1_SIGNAL.prefix, object: OF1_SIGNAL.object });

  it('flattens interests→topInterests, intent→topIntent, pages→pagesViewed', () => {
    const xdm = buildOf1SignalXdm({
      interests: [{ topic: 'QuickBooks Migration', score: 90, source: 'x' }, { topic: 'AI Finance Agents', score: 80, source: 'y' }],
      intentProfile: { intents: [], topIntent: 'purchase', topScore: 100, updatedAt: 1 },
      pageVisits: [{ path: '/migration/', title: 'M', dwellTimeMs: 10 }, { path: '/ai-agents/', title: 'A', dwellTimeMs: 5 }],
    }, page);
    const o = xdm[P().prefix][P().object];
    expect(o.topInterests).toEqual(['QuickBooks Migration', 'AI Finance Agents']);
    expect(o.topIntent).toBe('purchase');
    expect(o.pagesViewed).toEqual(['/migration/', '/ai-agents/']);
    expect(typeof o.capturedAt).toBe('string');
    expect(xdm.eventType).toBe('web.webpagedetails.pageViews');
  });

  it('caps interests at 5 and pages at 10', () => {
    const interests = Array.from({ length: 8 }, (_, i) => ({ topic: `t${i}`, score: 1, source: '' }));
    const pageVisits = Array.from({ length: 14 }, (_, i) => ({ path: `/p${i}`, title: '', dwellTimeMs: 1 }));
    const o = buildOf1SignalXdm({ interests, intentProfile: null, pageVisits }, page)[P().prefix][P().object];
    expect(o.topInterests).toHaveLength(5);
    expect(o.pagesViewed).toHaveLength(10);
  });

  it('empty/partial payload → empty arrays and empty topIntent', () => {
    const o = buildOf1SignalXdm({}, page)[P().prefix][P().object];
    expect(o.topInterests).toEqual([]);
    expect(o.topIntent).toBe('');
    expect(o.pagesViewed).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/of1-rtcdp-signal.test.js`
Expected: FAIL — current output has `interests`/`intent`/nested shapes, not `topInterests`/`topIntent`.

- [ ] **Step 4: Implement the flat shape**

In `scripts/of1-rtcdp-signal.js`, add caps to the const and reshape the builder. Replace the `OF1_SIGNAL` const line and the `buildOf1SignalXdm` body:

```js
export const OF1_SIGNAL = { prefix: '_intuit', object: 'of1Signal' };
const MAX_INTERESTS = 5;
const MAX_PAGES = 10;

// Maps an OF1 profile payload + page info into a FLAT, profile-friendly XDM
// sendEvent payload. Flattened (topInterests/topIntent/pagesViewed) so it
// models cleanly as an AEP event field group and is easy to segment on. Pure.
export function buildOf1SignalXdm(payload, page) {
  const p = payload || {};
  const interests = Array.isArray(p.interests) ? p.interests : [];
  const pages = Array.isArray(p.pageVisits) ? p.pageVisits : [];
  return {
    eventType: 'web.webpagedetails.pageViews',
    web: { webPageDetails: { URL: page.url, name: page.name } },
    [OF1_SIGNAL.prefix]: {
      [OF1_SIGNAL.object]: {
        topInterests: interests.map((i) => i.topic).filter(Boolean).slice(0, MAX_INTERESTS),
        topIntent: p.intentProfile?.topIntent || '',
        pagesViewed: pages.map((v) => v.path).filter(Boolean).slice(0, MAX_PAGES),
        capturedAt: new Date().toISOString(),
      },
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/of1-rtcdp-signal.test.js`
Expected: PASS (3 buildOf1SignalXdm cases + the untouched handshake/send/readAlloySegmentIds cases).

- [ ] **Step 6: Full suite (no regressions elsewhere)**

Run: `npm test` (repo root)
Expected: PASS — only `buildOf1SignalXdm` behavior changed; segments/handshake/send tests unaffected.

- [ ] **Step 7: Commit**

```bash
git add scripts/of1-rtcdp-signal.js test/of1-rtcdp-signal.test.js
git commit -m "feat(of1): flatten of1Signal payload for on-profile ingestion"
```

---

### Task 2: AEP schema field group (console — manual, establishes the prefix)

**Files:** none (AEP console).

> **Note:** Requires AEP console access in sandbox `developersandbox1`. This task ESTABLISHES the real tenant prefix that Task 3 must match. Cannot be done in code.

- [ ] **Step 1: Add the field group**

In AEP → Schemas → **Experience Event Schema** → **Add field group** (or create a new one, e.g. "OF1 Signal"). Define an object field `of1Signal` (at the schema root / tenant namespace) with:
- `topInterests` — array of string
- `topIntent` — string
- `pagesViewed` — array of string
- `capturedAt` — string (or date-time)

Save. Confirm the schema remains **Profile-enabled**.

- [ ] **Step 2: Record the real tenant prefix**

In the schema editor, expand the `of1Signal` object — it sits under a tenant prefix like `_sapphiredemo1` (NOT `_intuit`). **Write this prefix down** — it's the input to Task 3.

- [ ] **Step 3: Confirm the dataset picks up the schema**

The event dataset (`6a6a8eab41eabeaa764ab7c9`) uses this schema; the new field group is available automatically. No dataset change needed (already Profile-enabled).

---

### Task 3: Set the emit prefix to match the schema

**Files:**
- Modify: `scripts/of1-rtcdp-signal.js` (`OF1_SIGNAL.prefix`)

**Interfaces:**
- Consumes: the real tenant prefix from Task 2.
- Produces: the emitted `of1Signal` object under the schema-matching prefix.

> **Note:** BLOCKED until Task 2 reports the prefix. This is a one-line change.

- [ ] **Step 1: Set the prefix**

In `scripts/of1-rtcdp-signal.js`, change:

```js
export const OF1_SIGNAL = { prefix: '_intuit', object: 'of1Signal' };
```
to (using the ACTUAL prefix from Task 2, e.g. `_sapphiredemo1`):

```js
export const OF1_SIGNAL = { prefix: '<REAL_PREFIX_FROM_TASK_2>', object: 'of1Signal' };
```

- [ ] **Step 2: Update the test's prefix expectation if hardcoded**

The tests reference `OF1_SIGNAL.prefix` dynamically (via `P()`), so they still pass. Run:
`npx vitest run test/of1-rtcdp-signal.test.js` → PASS. If any test hardcodes `_intuit`, update it.

- [ ] **Step 3: Commit**

```bash
git add scripts/of1-rtcdp-signal.js
git commit -m "feat(of1): emit of1Signal under real AEP tenant prefix <prefix>"
```

---

### Task 4: Live verification (browser + AEP)

**Files:** none.

> **Note:** Needs the branch deployed to the preview host + AEP console. Cannot be headless.

- [ ] **Step 1** Deploy/preview the `feat/of1-signal-flatten` branch (or push it so the `feat-…` preview updates).
- [ ] **Step 2** Browse the site (construction/migration pages) with the extension on + an Assurance session.
- [ ] **Step 3** In Assurance, open the `pageViews` event → confirm the `of1Signal` object appears under the **real prefix** with `topInterests`/`topIntent`/`pagesViewed` (i.e. NOT dropped, correct prefix).
- [ ] **Step 4** In AEP → Profiles → search the profile (by ECID/email) → confirm the OF1 signal appears on the event timeline. (Or Datasets → Preview / Query Service on the event dataset.) Allow 1-2 min for streaming ingestion.
- [ ] **Step 5** Fail-open check: a page with no OF1 profile → event still sends with empty arrays, nothing breaks.

---

## Self-Review

**Spec coverage:** flat shape (Task 1) ✓; event field group under real prefix (Task 2) ✓; prefix match (Task 3) ✓; on-profile verification (Task 4) ✓; audiences/personalize paths untouched (constraint) ✓; fail-open + caps (Task 1 tests) ✓.

**Placeholder scan:** Task 3's `<REAL_PREFIX_FROM_TASK_2>` is an intentional, flagged dependency (not a lazy TODO) — it's blocked on the console step by design. All code steps otherwise complete.

**Type consistency:** `buildOf1SignalXdm(payload, page)`, `OF1_SIGNAL {prefix,object}`, flat fields `topInterests/topIntent/pagesViewed/capturedAt` used identically across Tasks 1/3 and tests. No `journeyStage` (absent from IntentProfile) — corrected from the design draft.

**Scope check:** one function + its test in code, one AEP field group, one prefix swap, one live verify. Nothing else in any repo depends on the old shape.
