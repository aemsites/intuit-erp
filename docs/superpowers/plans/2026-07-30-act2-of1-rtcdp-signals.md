# Act 2 — OF1 → RTCDP Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send OF1's anonymous interest/intent signals into RTCDP via on-page Alloy, and stitch the anonymous ECID to a known identity at "Schedule a call" form-fill — the "one visitor, not three records" moment.

**Architecture:** A new pure module `scripts/of1-rtcdp-signal.js` maps the OF1 profile (fetched via the existing `OF1_REQUEST_PROFILE`/`OF1_PERSONALIZE` postMessage handshake) into an XDM event and sends it with the martech plugin's `sendEvent`. `scripts.js` grants consent on load and fires the signal in `loadLazy`. `blocks/form/form.js` gains a submit handler that fires an email-identity `sendEvent`. The next-page fork stays mock (firmographics). Pure logic (XDM mapping, email validation) is unit-tested with Vitest; thin DOM/Alloy wiring is verified manually in Adobe Assurance.

**Tech Stack:** AEM EDS (vanilla ES modules), `plugins/martech` (Adobe Web SDK / Alloy), Vitest + jsdom (new at repo root, mirroring `plugins/martech/vitest.config.js`).

## Global Constraints

- Branch: `feat/of1-rtcdp-signals`, off `origin/aep-martech-integration` (Alloy already enabled there: `MARTECH_ENABLED` is on with the real datastream/org).
- Fail-open everywhere: missing extension, handshake timeout, `MARTECH_ENABLED` false, invalid email, or `sendEvent` rejection must never break the page or the form. The live site behaves identically to today if any piece is absent.
- All new martech calls guarded by `MARTECH_ENABLED` (imported from `scripts.js` scope) — never call Alloy fns when it's off.
- Consent: `updateUserConsent({ collect: true })` (demo auto-grant). Required — martech inits `defaultConsent: 'pending'`, which otherwise drops all `sendEvent` calls.
- XDM tenant prefix is a **config constant** `OF1_SIGNAL` in `scripts/of1-rtcdp-signal.js` (`{ prefix: '_intuit', object: 'of1Signal' }`). The real prefix is org-derived and unknown today; the Edge accepts the object regardless, and it only persists on-profile once Cedric adds the schema field group. Do NOT hardcode the prefix in multiple places.
- Email identity uses `authenticatedState: 'ambiguous'` (email is unverified — matches the form block's own note; do NOT use `'authenticated'`).
- CSP: the form block must stay CSP-safe — no inline handlers; attach the submit handler in JS (the block already uses `<button type="button">`).
- OF1 postMessage protocol (existing, do not change): page posts `{ type: 'OF1_REQUEST_PROFILE', domain }`; extension replies `{ type: 'OF1_PERSONALIZE', payload: { interests, intentProfile, pageVisits, query } }`.
- `interests` items are `{ topic, score }`; `intentProfile` is `{ type, journeyStage }`-shaped or null; `pageVisits` is an array of path strings.

---

### Task 1: Repo-root Vitest setup

**Files:**
- Create: `vitest.config.js` (repo root)
- Modify: `package.json` (root) — add `test` script + `vitest` devDependency
- Create: `test/setup.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs Vitest over `test/**/*.test.js` in jsdom. Later tasks add test files there.

- [ ] **Step 1: Add Vitest config**

Create `vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js'],
    restoreMocks: true,
  },
});
```

- [ ] **Step 2: Add setup file**

Create `test/setup.js`:

```js
// Placeholder for global test setup (jsdom is configured via vitest.config.js).
// Kept so setupFiles has a stable target as suites grow.
```

- [ ] **Step 3: Wire the test script + devDependency**

In root `package.json`, replace the `test` script:

```json
    "test": "vitest run",
```

Add to `devDependencies` (create the block if absent), matching the plugin's pinned major:

```json
    "vitest": "^2.1.0",
    "jsdom": "^25.0.0",
```

- [ ] **Step 4: Install and verify the runner works (no tests yet)**

Run: `npm install`
Run: `npx vitest run`
Expected: exits 0 with "No test files found" (or equivalent) — the runner is wired, no suites yet.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.js test/setup.js package.json package-lock.json
git commit -m "test: add repo-root Vitest setup"
```

---

### Task 2: OF1 signal module — XDM mapping (pure core)

**Files:**
- Create: `scripts/of1-rtcdp-signal.js`
- Create: `test/of1-rtcdp-signal.test.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `OF1_SIGNAL = { prefix: '_intuit', object: 'of1Signal' }` (exported const).
  - `buildOf1SignalXdm(payload, opts) => object` — maps `{ interests, intentProfile, pageVisits }` + `{ url, name }` into an XDM `sendEvent` payload. Pure, no DOM/network.

- [ ] **Step 1: Write the failing test**

Create `test/of1-rtcdp-signal.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildOf1SignalXdm, OF1_SIGNAL } from '../scripts/of1-rtcdp-signal.js';

const page = { url: 'https://x.aem.page/construction', name: 'construction' };

describe('buildOf1SignalXdm', () => {
  it('maps interests, intent, and pages under the tenant-namespaced object', () => {
    const xdm = buildOf1SignalXdm({
      interests: [{ topic: 'job costing', score: 82 }, { topic: 'construction', score: 70 }],
      intentProfile: { type: 'research', journeyStage: 'consideration' },
      pageVisits: ['/construction', '/blog/construction-case-study'],
    }, page);

    expect(xdm.eventType).toBe('web.webpagedetails.pageViews');
    expect(xdm.web.webPageDetails.URL).toBe(page.url);
    expect(xdm.web.webPageDetails.name).toBe(page.name);

    const obj = xdm[OF1_SIGNAL.prefix][OF1_SIGNAL.object];
    expect(obj.interests).toEqual([
      { topic: 'job costing', score: 82 },
      { topic: 'construction', score: 70 },
    ]);
    expect(obj.intent).toEqual({ type: 'research', journeyStage: 'consideration' });
    expect(obj.pagesViewed).toEqual(['/construction', '/blog/construction-case-study']);
    expect(typeof obj.capturedAt).toBe('string');
  });

  it('tolerates an empty/partial profile without throwing', () => {
    const xdm = buildOf1SignalXdm({}, page);
    const obj = xdm[OF1_SIGNAL.prefix][OF1_SIGNAL.object];
    expect(obj.interests).toEqual([]);
    expect(obj.intent).toBeNull();
    expect(obj.pagesViewed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/of1-rtcdp-signal.test.js`
Expected: FAIL — cannot resolve `../scripts/of1-rtcdp-signal.js`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/of1-rtcdp-signal.js`:

```js
// Sends OF1's anonymous interest/intent signals into RTCDP via the on-page Web
// SDK (Alloy). Pure mapping (buildOf1SignalXdm) is unit-tested; the DOM/Alloy
// wiring (sendOf1Signal) is verified manually in Adobe Assurance. Fail-open:
// any missing piece resolves to a no-op so the page is never affected.

// Tenant-namespaced XDM location for the OF1 signal. The real prefix is
// org-derived and unknown today — the Edge accepts an unknown object, but it
// only persists on-profile once a matching schema field group exists AEP-side.
// Single source of truth so it is a one-line swap when Cedric confirms it.
export const OF1_SIGNAL = { prefix: '_intuit', object: 'of1Signal' };

// Maps an OF1 profile payload + page info into an XDM sendEvent payload. Pure.
export function buildOf1SignalXdm(payload, page) {
  const p = payload || {};
  return {
    eventType: 'web.webpagedetails.pageViews',
    web: { webPageDetails: { URL: page.url, name: page.name } },
    [OF1_SIGNAL.prefix]: {
      [OF1_SIGNAL.object]: {
        interests: Array.isArray(p.interests) ? p.interests : [],
        intent: p.intentProfile || null,
        pagesViewed: Array.isArray(p.pageVisits) ? p.pageVisits : [],
        capturedAt: new Date().toISOString(),
      },
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/of1-rtcdp-signal.test.js`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add scripts/of1-rtcdp-signal.js test/of1-rtcdp-signal.test.js
git commit -m "feat(rtcdp): OF1 signal XDM mapping"
```

---

### Task 3: OF1 signal module — profile handshake + send (wiring)

**Files:**
- Modify: `scripts/of1-rtcdp-signal.js`
- Modify: `test/of1-rtcdp-signal.test.js`

**Interfaces:**
- Consumes: `buildOf1SignalXdm` (Task 2); a `sendEvent`-shaped fn injected by the caller.
- Produces:
  - `requestOf1Profile(timeoutMs) => Promise<object|null>` — resolves the OF1 payload via the postMessage handshake, or null on timeout.
  - `sendOf1Signal({ sendEvent, timeoutMs }) => Promise<boolean>` — orchestrates request→map→send; returns true if an event was sent, false (no-op) otherwise. `sendEvent` injected for testability.

- [ ] **Step 1: Write the failing test**

Add to `test/of1-rtcdp-signal.test.js`:

```js
import { requestOf1Profile, sendOf1Signal, OF1_SIGNAL as SIG } from '../scripts/of1-rtcdp-signal.js';
import { vi } from 'vitest';

describe('requestOf1Profile', () => {
  it('resolves the payload when the extension replies', async () => {
    const promise = requestOf1Profile(1000);
    // simulate the extension responding to OF1_REQUEST_PROFILE
    window.postMessage({ type: 'OF1_PERSONALIZE', payload: { interests: [{ topic: 'x', score: 1 }] } }, '*');
    const payload = await promise;
    expect(payload.interests).toEqual([{ topic: 'x', score: 1 }]);
  });

  it('resolves null on timeout when no reply arrives', async () => {
    const payload = await requestOf1Profile(10);
    expect(payload).toBeNull();
  });
});

describe('sendOf1Signal', () => {
  it('sends a mapped event when a profile is available', async () => {
    const sendEvent = vi.fn().mockResolvedValue({});
    const promise = sendOf1Signal({ sendEvent, timeoutMs: 1000 });
    window.postMessage({ type: 'OF1_PERSONALIZE', payload: { interests: [{ topic: 'job costing', score: 9 }] } }, '*');
    const sent = await promise;
    expect(sent).toBe(true);
    expect(sendEvent).toHaveBeenCalledTimes(1);
    const arg = sendEvent.mock.calls[0][0];
    expect(arg.xdm[SIG.prefix][SIG.object].interests).toEqual([{ topic: 'job costing', score: 9 }]);
  });

  it('is a no-op (returns false) when no profile arrives', async () => {
    const sendEvent = vi.fn();
    const sent = await sendOf1Signal({ sendEvent, timeoutMs: 10 });
    expect(sent).toBe(false);
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('never throws if sendEvent rejects (fail-open)', async () => {
    const sendEvent = vi.fn().mockRejectedValue(new Error('edge down'));
    const promise = sendOf1Signal({ sendEvent, timeoutMs: 1000 });
    window.postMessage({ type: 'OF1_PERSONALIZE', payload: { interests: [] } }, '*');
    await expect(promise).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/of1-rtcdp-signal.test.js`
Expected: FAIL — `requestOf1Profile`/`sendOf1Signal` not exported.

- [ ] **Step 3: Extend the implementation**

Append to `scripts/of1-rtcdp-signal.js`:

```js
// Requests the OF1 anonymous profile via the existing postMessage handshake
// (the extension owns the response). Resolves null on timeout so callers no-op.
export function requestOf1Profile(timeoutMs = 2500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      resolve(val);
    };
    const onMessage = (event) => {
      if (event.data?.type === 'OF1_PERSONALIZE') finish(event.data.payload || {});
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'OF1_REQUEST_PROFILE', domain: window.location.hostname }, '*');
    setTimeout(() => finish(null), timeoutMs);
  });
}

// Orchestrates request → map → send. `sendEvent` is injected (the martech
// plugin's sendEvent in production). Returns true iff an event was sent.
// Fail-open: no profile, or a rejected send, resolves to false and never throws.
export async function sendOf1Signal({ sendEvent, timeoutMs = 2500 } = {}) {
  try {
    const payload = await requestOf1Profile(timeoutMs);
    if (!payload) return false;
    const xdm = buildOf1SignalXdm(payload, {
      url: window.location.href,
      name: document.title || window.location.pathname,
    });
    await sendEvent({ xdm });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/of1-rtcdp-signal.test.js`
Expected: PASS (all cases: mapping 2 + handshake 2 + send 3).

- [ ] **Step 5: Commit**

```bash
git add scripts/of1-rtcdp-signal.js test/of1-rtcdp-signal.test.js
git commit -m "feat(rtcdp): OF1 profile handshake + signal send"
```

---

### Task 4: Wire consent + signal send into scripts.js

**Files:**
- Modify: `scripts/scripts.js`

**Interfaces:**
- Consumes: `updateUserConsent` (martech), `sendEvent` (martech), `sendOf1Signal` (Task 3), `MARTECH_ENABLED` (existing module const).
- Produces: on every page load with martech enabled, consent is granted and the OF1 signal is sent (fail-open).

- [ ] **Step 1: Extend the martech import**

In `scripts/scripts.js`, the existing import is:

```js
import { initMartech, martechEager, martechLazy } from '../plugins/martech/src/index.js';
```

Replace with:

```js
import {
  initMartech, martechEager, martechLazy, updateUserConsent, sendEvent,
} from '../plugins/martech/src/index.js';
import { sendOf1Signal } from './of1-rtcdp-signal.js';
```

- [ ] **Step 2: Grant consent + send the signal in loadLazy**

In `loadLazy`, the existing martech line is:

```js
  if (MARTECH_ENABLED) { try { await martechLazy(); } catch (e) { /* non-fatal */ } }
```

Replace it with:

```js
  if (MARTECH_ENABLED) {
    try { await martechLazy(); } catch (e) { /* non-fatal */ }
    // Demo posture: auto-grant collection consent (martech inits consent
    // 'pending', which would otherwise drop sendEvent). Then push the OF1
    // anonymous signal to RTCDP. Both fail-open — never block the page.
    try { await updateUserConsent({ collect: true }); } catch (e) { /* non-fatal */ }
    sendOf1Signal({ sendEvent }).catch(() => {});
  }
```

- [ ] **Step 3: Verify the module still lints/loads (no unit test for wiring)**

Run: `npx eslint scripts/scripts.js`
Expected: no new errors (pre-existing repo lint state unchanged).
Note: this DOM/Alloy wiring is verified manually in Adobe Assurance (see plan's Manual Verification), not by a unit test — do not add a brittle jsdom test that mocks the whole module graph.

- [ ] **Step 4: Commit**

```bash
git add scripts/scripts.js
git commit -m "feat(rtcdp): grant consent and send OF1 signal on load"
```

---

### Task 5: Form-fill identity event + email validation

**Files:**
- Modify: `blocks/form/form.js`
- Create: `test/form-identity.test.js`

**Interfaces:**
- Consumes: `sendEvent` (martech), `OF1_SIGNAL` (Task 2).
- Produces:
  - `isValidBusinessEmail(value) => boolean` (exported from `blocks/form/form.js`) — basic non-empty + shape check.
  - `buildIdentityXdm(fields) => object` (exported) — maps lead fields → XDM with `identityMap.Email` (`authenticatedState: 'ambiguous'`) + lead fields under the tenant object. Pure.
  - On submit with a valid email, the block fires `sendEvent({ xdm })` (fail-open) and shows a confirmation.

- [ ] **Step 1: Write the failing test**

Create `test/form-identity.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { isValidBusinessEmail, buildIdentityXdm } from '../blocks/form/form.js';
import { OF1_SIGNAL } from '../scripts/of1-rtcdp-signal.js';

describe('isValidBusinessEmail', () => {
  it('accepts a normal business email', () => {
    expect(isValidBusinessEmail('controller@brightpathco.com')).toBe(true);
  });
  it('rejects empty / malformed', () => {
    expect(isValidBusinessEmail('')).toBe(false);
    expect(isValidBusinessEmail('not-an-email')).toBe(false);
    expect(isValidBusinessEmail('a@b')).toBe(false);
  });
});

describe('buildIdentityXdm', () => {
  it('puts the email in identityMap as ambiguous and carries lead fields', () => {
    const xdm = buildIdentityXdm({
      firstName: 'Dana', lastName: 'Cole', businessName: 'Bright Path',
      email: 'controller@brightpathco.com', phone: '555-1234',
    });
    const id = xdm.identityMap.Email[0];
    expect(id.id).toBe('controller@brightpathco.com');
    expect(id.primary).toBe(true);
    expect(id.authenticatedState).toBe('ambiguous');
    const lead = xdm[OF1_SIGNAL.prefix][OF1_SIGNAL.object].lead;
    expect(lead.businessName).toBe('Bright Path');
    expect(lead.email).toBe('controller@brightpathco.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/form-identity.test.js`
Expected: FAIL — `isValidBusinessEmail`/`buildIdentityXdm` not exported.

- [ ] **Step 3: Implement in `blocks/form/form.js`**

Add the exported pure helpers (top of file, after the `FIELDS` const) and the submit wiring. Replace the file body with:

```js
/**
 * form — "Let's connect" static lead form (accounting, compare, erp-solutions).
 * Heading / subtext / accountant link / consent are authored as default content
 * (a trailing default-content paragraph becomes the reCAPTCHA note). The block
 * renders the fixed 5-field form. CSP-safe: no inline handlers — the submit
 * handler is attached in JS. On submit with a valid business email it fires an
 * identity sendEvent (Act 2 RTCDP stitch), then shows a confirmation.
 *
 * Variants: (default) underline inputs (accounting) · .boxed labelled boxes
 * (compare) · .sky sky band + hidden labels (erp-solutions).
 * CSS: blocks/form/form.css
 */
import { sendEvent } from '../../plugins/martech/src/index.js';
import { OF1_SIGNAL } from '../../scripts/of1-rtcdp-signal.js';

const FIELDS = [
  ['First name*', 'text', 'firstName'],
  ['Last name*', 'text', 'lastName'],
  ['Business name*', 'text', 'businessName'],
  ['Business email*', 'email', 'email'],
  ['Business phone*', 'tel', 'phone'],
];

// Basic shape check — enough to gate the identity send without over-validating
// (demo lead form; not an auth boundary).
export function isValidBusinessEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// Maps lead fields → an identity sendEvent XDM. Email goes in identityMap as
// 'ambiguous' (unverified). Pure — no DOM/network.
export function buildIdentityXdm(fields) {
  return {
    eventType: 'web.formFilledOut',
    identityMap: {
      Email: [{ id: fields.email, primary: true, authenticatedState: 'ambiguous' }],
    },
    [OF1_SIGNAL.prefix]: {
      [OF1_SIGNAL.object]: { lead: { ...fields }, capturedAt: new Date().toISOString() },
    },
  };
}

export default function decorate(block) {
  const form = document.createElement('div');
  form.className = 'lead-fields';
  const inputs = {};
  FIELDS.forEach(([label, type, key]) => {
    const l = document.createElement('label');
    l.className = 'ff';
    l.innerHTML = `<span>${label}</span><input type="${type}" placeholder="${label}" aria-label="${label.replace('*', '')}">`;
    inputs[key] = l.querySelector('input');
    form.append(l);
  });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'form-submit';
  btn.textContent = 'Schedule a call';
  form.append(btn);

  const note = document.createElement('p');
  note.className = 'form-note';
  note.setAttribute('aria-live', 'polite');

  btn.addEventListener('click', () => {
    const fields = Object.fromEntries(
      Object.entries(inputs).map(([k, el]) => [k, el.value.trim()]),
    );
    if (!isValidBusinessEmail(fields.email)) {
      note.textContent = 'Please enter a valid business email.';
      return;
    }
    // Fire the identity event (fail-open — never block the confirmation).
    try { sendEvent(buildIdentityXdm(fields)).catch(() => {}); } catch (e) { /* non-fatal */ }
    note.textContent = 'Thanks — we’ll be in touch shortly.';
    btn.disabled = true;
  });

  block.replaceChildren(form, note);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/form-identity.test.js`
Expected: PASS (email 3 cases + xdm 1 case).

- [ ] **Step 5: Run the full suite + lint**

Run: `npm test`
Expected: PASS — all suites (of1-rtcdp-signal + form-identity).
Run: `npx eslint blocks/form/form.js scripts/of1-rtcdp-signal.js`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add blocks/form/form.js test/form-identity.test.js
git commit -m "feat(rtcdp): form-fill identity event + email validation"
```

---

### Task 6: Manual verification guide (doc)

**Files:**
- Create: `docs/superpowers/specs/2026-07-30-act2-manual-verification.md`

**Interfaces:** none (documentation only).

> **Note:** The send/stitch only prove out live in a browser with Adobe Assurance — they cannot be verified headlessly. This task produces the operator guide; running it needs the user's browser + a deploy.

- [ ] **Step 1: Write the verification guide**

Create `docs/superpowers/specs/2026-07-30-act2-manual-verification.md` containing:
- Prereqs: branch deployed to preview; OF1 extension installed; Adobe Assurance session open on the tenant.
- Beat 1 (signal): load a page after browsing construction content → in Assurance, find the `web.webpagedetails.pageViews` event, confirm it carries the `of1Signal` object (interests/pages) and an ECID was assigned.
- Beat 2 (stitch): on the OF1 CTA page, fill "Schedule a call" with a business email → confirm the `web.formFilledOut` event fires with `identityMap.Email` and the **same ECID** as Beat 1.
- What's mock: the next-page existing-QBO-vs-new fork is firmographics-driven, not an RTCDP decision.
- What's blocked: on-profile persistence + real fork need Cedric's schema field group + activated decision scope (cross-ref the readiness doc).

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-30-act2-manual-verification.md
git commit -m "docs: Act 2 manual verification guide"
```

---

## Self-Review

**Spec coverage:**
- Consent auto-grant → Task 4. ✓
- OF1 signal send (`sendEvent`, custom XDM object, config-driven prefix) → Tasks 2–4. ✓
- Profile handshake reuse (no extension change) → Task 3. ✓
- Form-fill identity event (email, `ambiguous`, CSP-safe) → Task 5. ✓
- Mock fork → unchanged existing firmographics path; explicitly out of scope here, documented in Task 6. ✓
- Fail-open everywhere → Tasks 3/4/5 guards + tests. ✓
- Handoff/manual verification → Task 6 + existing readiness doc. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; tests are concrete.

**Type consistency:** `OF1_SIGNAL` (const, `{prefix,object}`), `buildOf1SignalXdm(payload, page)`, `requestOf1Profile(timeoutMs)`, `sendOf1Signal({sendEvent,timeoutMs})`, `isValidBusinessEmail(value)`, `buildIdentityXdm(fields)` are used identically across tasks. `sendEvent` is injected in `sendOf1Signal` (testable) but imported directly in the form block (DOM-side, fail-open) — intentional and noted.

**Scope check:** Single feature (Act 2 client plumbing), one repo, ends with a working+testable deliverable. The real fork decision and on-profile persistence are explicitly deferred (Adobe config), not silently dropped.
