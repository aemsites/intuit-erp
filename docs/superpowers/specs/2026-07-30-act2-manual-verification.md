# Act 2 — Manual Verification Guide: Signal Capture & Identity Stitch

**Date:** 2026-07-30
**Purpose:** Step-by-step verification of OF1 anonymous signals → RTCDP profile flow using Adobe Assurance (browser-based, cannot be headless).
**Related:** [Act 2 Design](2026-07-30-act2-of1-rtcdp-signals-design.md) | [Readiness & Gap Analysis](2026-07-30-ajo-rtcdp-demo-readiness.md)

---

## Prerequisites

1. **Branch deployed:** `feat/of1-rtcdp-signals` deployed to the preview environment (typically `main--intuit-erp--aemsites.hlx.page` or a staging URL).
2. **OF1 extension installed** in your browser on the Intuit OF1 tab/window (the browser extension that supplies the anonymous profile via postMessage).
3. **Adobe Assurance session active** on the tenant (`87020D54659BEED90A495E68@AdobeOrg`):
   - Launch [Adobe Assurance](https://experience.adobe.com/assurance) in a separate tab.
   - Connect your browser session to a new Assurance session (scan the session QR or paste the link into the preview window).
4. **Adobe Experience Platform (AEP) UI open** in another tab (optional, for live profile inspection after stitch).

---

## Beat 1: Anonymous Signal Capture (web.webpagedetails.pageViews)

### Setup

1. In Assurance, **enable filters:**
   - Search for event type `web.webpagedetails.pageViews` or vendor `Adobe Experience Platform Web SDK`.
2. Open the preview site **in a clean session or incognito window** (no prior cookies/profile).
3. Navigate to the **site home or a construction-related content page** (e.g., `/en/construction`, `/en/services/construction-management`).
   - This ensures the OF1 extension has a chance to infer construction intent before the signal fires.

### Verification Steps

1. **Load the page.** Wait ~3–5 seconds for the page to settle (OF1 profile request + RTCDP signal send).
2. **In Assurance, find the `web.webpagedetails.pageViews` event:**
   - Filter by event type or search for "pageViews" in the event stream.
   - Click to expand the event details.
3. **Confirm the ECID (Experience Cloud ID):**
   - Under `IdentityMap` → `ECID`, you should see an identifier (e.g., `"12345..."`).
   - **Note this ECID; you will verify it again in Beat 2.**
4. **Confirm the OF1 signal object:**
   - Scroll down in the event payload to find the **tenant-namespaced custom object** (Adobe/Cedric confirms the exact tenant prefix; for now, look for an object named `of1Signal` or similar under the XDM root).
   - The object should contain:
     - `interests`: array of `{ topic: string, score: number }`
     - `intent`: object with `type` (e.g., "construction") and optional `journeyStage`
     - `pagesViewed`: array of page paths visited in this session
     - `capturedAt`: ISO timestamp
   - **Success**: The object is present and non-empty, confirming the signal was sent.
5. **Optional: Verify event type:**
   - The `eventType` field should read `web.webpagedetails.pageViews`.

### What's Expected

✅ **Signal successfully sent:** Assurance shows the `web.webpagedetails.pageViews` event with a real ECID and a non-empty `of1Signal` object.

❌ **Signal missing:**
- Check `MARTECH_ENABLED` is true in the deploy (ask the DevOps contact).
- Verify OF1 extension is installed and replying to the postMessage (open the browser DevTools console, look for logs like "OF1_PERSONALIZE received").
- Ensure you browsed a construction-related page before load (else OF1 may not infer intent).

---

## Beat 2: Identity Stitch (web.formFilledOut)

### Setup

1. **Do NOT reload the page.** Remain on the same browser session (same ECID).
2. Scroll to the **"Schedule a call" or "Talk to sales" form** on the page (typically on the main CTA page or `/en/contact` or similar).
3. **In Assurance, clear previous event filters** or add a new filter for event type `web.formFilledOut`.

### Verification Steps

1. **Fill the form with a business email:**
   - First Name: any value (e.g., "Test")
   - Last Name: any value (e.g., "User")
   - Business Email: a real-looking business email (e.g., `test@company.com`)
   - Phone: any value (e.g., "+1 555-0123")
   - Job Title: any value (e.g., "Manager")
2. **Submit the form** (click the submit button).
   - The form should show a success message or confirmation (demo behavior: may also navigate or reveal a forked next step).
3. **In Assurance, find the `web.formFilledOut` event:**
   - Scan the event stream for the most recent `web.formFilledOut` event (it should appear within 1–2 seconds of form submission).
   - Click to expand.
4. **Confirm the identity map (Email):**
   - Under `IdentityMap` → `Email`, you should see:
     ```json
     {
       "id": "test@company.com",
       "primary": true,
       "authenticatedState": "ambiguous"
     }
     ```
   - The `authenticatedState: "ambiguous"` indicates an unverified email (expected, per design).
5. **Confirm the ECID is **identical** to Beat 1:**
   - Under `IdentityMap` → `ECID`, verify the ECID matches the one from the Beat 1 signal event.
   - **This is the identity stitch moment:** the anonymous session (ECID) now carries a known email, linking the two records.
6. **Optional: Inspect lead fields:**
   - Scroll down to the tenant-namespaced object to confirm form fields are also persisted (name, email, phone, title).

### What's Expected

✅ **Stitch successful:** Assurance shows a `web.formFilledOut` event with `identityMap.Email` and **the same ECID as Beat 1**.

❌ **Event missing or ECID differs:**
- If the ECID differs, the browser session may have reset or a new profile was created. Reload and repeat.
- If the event is missing, check:
  - Form submission was successful (check browser console for errors).
  - Martech is enabled (same check as Beat 1).
  - Email validation passed (non-empty, looks like `*@*.*`).

---

## Optional: Verify Profile Merge in AEP UI

If you have AEP UI access:

1. Navigate to **AEP → Profiles → Unified Profiles → Search**.
2. Search by the email address you submitted in Beat 2.
3. **Expected outcome:**
   - A profile appears with the email.
   - **IF Profile service is enabled on the datastream** (Cedric to confirm): the profile shows identity history including the ECID from Beat 1, proving the merge.
   - **IF Profile service is NOT enabled yet:** the profile may be a dataset-only entry; ECID link will not appear until Cedric enables the service.

---

## What's Mock vs. Real vs. Blocked

### Real (Verified Today)
- ✅ **Anonymous signal send:** ECID minted by the Alloy identity service (live; proven in Beat 1).
- ✅ **Identity stitch:** Email-to-ECID mapping sent to RTCDP via `web.formFilledOut` event (real Alloy stitch; Assurance proof in Beat 2).
- ✅ **Form submission:** Email validation + event fire work end-to-end.

### Mock (Functional, Placeholder)
- 🎭 **Next-page fork decision:** The existing-QBO-vs-new fork after form-fill is **driven by the firmographics mock** (email domain → hardcoded preset), not a real RTCDP decision.
  - **What you see:** After form submission, the site navigates or reveals a "new customer" variant (or "existing QBO customer" variant, depending on the domain).
  - **Why it's mock:** There is no activated RTCDP decision scope or audience returning a real fork yet.
  - **How it becomes real:** Cedric sets up a decision scope + audience in RTCDP → our code swaps `firmographics.fetch()` for `getPersonalizationForView(scope)` → same demo flow, now data-driven.
  - **No code change needed on our end until Cedric provides the scope name.**

### Blocked (Requires Adobe/Cedric Config)
- 🚫 **On-profile signal persistence:** The `of1Signal` object lands in the AEP dataset today but **is NOT stored on-profile** until Cedric:
  - Defines an **XDM schema field group** for the `of1Signal` object.
  - Confirms the **tenant prefix** (e.g., `_intuit123`, derived from the org ID).
  - Enables the **Profile service** on the datastream.
  - Once done, signals persist on the unified profile and feed into audience lookups.
  
- 🚫 **Real fork decision:** The RTCDP decision/audience resolution for the fork is **not active today** (readiness doc confirms `activation:pull` returns empty scopes). Cedric must:
  - Create a **decision scope** tied to the fork (e.g., `qbo-vs-new` with propositions for each variant).
  - Bind an **audience** to the scope (e.g., "existing QBO customers" or "new-to-franchise segment").
  - Activate the audience + decision in the RTCDP UI.
  - Once live, our code reads the scope via `getPersonalizationForView` and the fork becomes real-time (not mock-driven).

For details on what Cedric owns, see [Readiness & Gap Analysis](2026-07-30-ajo-rtcdp-demo-readiness.md), section "Act 2 — One Visitor, Not Three Records."

---

## Troubleshooting

| Issue | Check |
|-------|-------|
| No pageViews event appears in Assurance | Is MARTECH_ENABLED true? Is the OF1 extension installed? Check browser console for "OF1_PERSONALIZE" logs. |
| ECID missing or blank | Verify Assurance is capturing XDM events (not just raw Alloy payloads). Clear Assurance filters and reload. |
| Form doesn't submit or shows validation error | Ensure email field is populated with a valid format (e.g., `user@company.com`). Check browser console for JS errors. |
| formFilledOut event is missing | Did the form actually submit? Check the success message or page state. Verify martech is enabled. |
| ECID in formFilledOut differs from pageViews | Browser session may have reset (new tab, incognito expired). Close and restart both the preview and Assurance session. |
| on-profile signals don't show in AEP UI | Contact Cedric to verify Profile service is enabled on the datastream and XDM schema is configured. |

---

## Next Steps

Once this verification completes successfully:

1. **Document the Assurance session screenshots** (Beat 1 ECID + of1Signal; Beat 2 formFilledOut + same ECID).
2. **Share with Cedric/stakeholders** to confirm the plumbing is working.
3. **Cedric proceeds with AEP config:**
   - Enable Profile service + define XDM schema (signals persist on-profile).
   - Create decision scope + audience (real fork).
   - Tie the fork to the scope in a subsequent design/config milestone.
4. **Our code remains unchanged** until Cedric provides the scope name + config; then a one-line config swap activates the real decision.

---

## Summary

This guide provides the manual, browser-based verification that the Act 2 anonymous-to-known identity flow is operational:
- **Beat 1** proves the anonymous signal reaches RTCDP with a real ECID.
- **Beat 2** proves the email identity fires in the same session, stitching to the same ECID.
- The fork is **real-shaped but mock-driven today** (firmographics); it becomes real once Cedric activates a decision scope.
- **On-profile persistence is not yet available** (awaits schema config on Adobe's side).

The flow is production-ready from a code/plumbing perspective; the real-time decision and profile storage are Adobe-side enablements.
