# Cedric — AEP Config Needed to Make Act 2 (and beyond) Real

**Date:** 2026-07-31
**From:** the OF1 client-side work (branch `feat/of1-rtcdp-signals`)
**Context:** Act 2 client plumbing is **built and verified live** in Assurance (org `sapphiredemo1`, datastream `a114467b...`). The transport, consent, ECID, and email→ECID **stitch all work today**. What remains is **Adobe-side config only** — nothing more on our (client) side until you provide the items below. This note gives you the exact IDs/paths we captured so you don't have to re-derive them.

---

## What already works (no action needed)

Verified end-to-end in Adobe Assurance on 2026-07-31:
- On-page Alloy sends OF1's anonymous signal: `web.webpagedetails.pageViews` carrying `_intuit.of1Signal` (interests, intent, pagesViewed) + a real **ECID** (`00393545737177858283143271135068800585`), consent `general=in`.
- Form-fill sends `web.formFilledOut` with `identityMap.Email` (`authenticatedState: ambiguous`) + the **same ECID** → the anonymous→known **identity stitch** is confirmed.

## What's captured from the live Edge response (for your reference)

- **Datastream:** `a114467b-290b-4429-9d7e-56bc5b5786fa` (config `...:prod`)
- **Sandbox it actually resolves to:** `developersandbox1` (`sandboxId 8532b98e-4bd9-4d4e-b2b9-8e4bd96d4eb3`) — NOT the `prod` shown in the UI URL. Please confirm this is the intended sandbox.
- **Schema currently on the event dataset:** `https://ns.adobe.com/sapphiredemo1/schemas/a1cb986dded9a71818926692865abb7bff35a73c71680409`
- **Event dataset:** `6a6a8eab41eabeaa764ab7c9` (flow `af01fe61-a2e4-4e0f-b878-58d99f899656`)
- **Profile datasets:** `[]` (empty) → **events are NOT landing on the unified profile yet.**
- **Edge segmentation:** enabled.
- **Existing edge-lookup destination** (`applicableDestinations`): alias **`aem`**, destinationId **`db536faa-4fd0-4b5c-b2d7-831b1228afd4`**, flowSpec `07a26f27-6ac3-4a5e-a150-b67ba2ebe490`, region VA7 — already wired with **2 segments**:
  - `2e65818b-a9c4-461a-90c4-1a778ae48902` (namespace `ups`)
  - `708bd5c6-773f-49ed-a450-383f0c157339` (namespace `ups`)
  - Our test visitor matched neither (`segmentsDiscovered: []`).

---

## The asks (ordered by leverage)

### 1. Persist the OF1 signal on-profile — unblocks audiences
Today the Edge **accepts** `_intuit.of1Signal` but drops it (not in the schema, and Profile service isn't enabled for it). To fix:
- Add an **XDM schema field group** covering the `of1Signal` object: `interests[]{topic, score, source}`, `intent{topIntent, topScore, intents[]}`, `pagesViewed[]{path, title, dwellTimeMs}`, `capturedAt`, and (from the form event) `lead{firstName,lastName,businessName,email,phone}`.
- **Confirm the real XDM tenant prefix.** We currently emit under `_intuit` as a placeholder — the real prefix is org-derived (e.g. `_sapphiredemo1`). Tell us the exact one and we change **one constant** (`OF1_SIGNAL.prefix` in `scripts/of1-rtcdp-signal.js`) — one-line swap, no other code change.
- Enable the **Profile service** on the datastream so events merge onto the profile keyed by ECID/Email.

### 2. Make the Act 2 fork real — QBO-customer vs new-to-franchise
The next-page fork (existing-QBO vs new-to-franchise) is currently **mock** (driven by email domain via our firmographics preset). To make it a real RTCDP decision:
- Tell us what the **2 existing segments** on the `aem` destination (`db536faa...`) actually represent. If one already maps to "existing QuickBooks customer" (or similar), we can consume it directly.
- Otherwise, define the **audience(s)** for the fork (e.g. "existing QBO customer", "new-to-franchise") and bind them to a **decision scope** we can request.
- Give us the **decision scope name(s)**. We then swap the mock lookup for `getPersonalizationForView(scope)` / read edge segment membership — same demo flow, now data-driven. No other client change.

### 3. Confirm identity namespaces
- Person identity: we use the standard **`Email`** namespace. Confirm that's correct for how the B2B audiences resolve.
- If Acts 3/4 (ABM / buying-group) need a **B2B account identity** (company domain or account id), tell us the namespace and we'll add it to the `identityMap`.

---

## What we do once you deliver each item

| You provide | We do (client) | Result |
|---|---|---|
| Tenant prefix + schema field group + Profile service on | Change `OF1_SIGNAL.prefix` constant | OF1 signals persist on the unified profile |
| Segment meaning / audience + decision scope name | Swap mock fork for `getPersonalizationForView(scope)` | Act 2 fork becomes a real RTCDP decision |
| B2B account namespace (for Act 3/4) | Add account id to `identityMap` | Buying-group / ABM resolution possible |

Everything else for Acts 3–4 (buying-group modeling, AJO journeys, CRM/MAP sync) is Adobe/AJO-B2B configuration on your side — see `2026-07-30-ajo-rtcdp-demo-readiness.md` for the full per-act breakdown.
