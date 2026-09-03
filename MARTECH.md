# Martech

This is the entry point for the site's analytics stack. The site loads one Tealium iQ profile
(`intuit/ies-erp`); that profile injects ECS click/page-view tracking and downstream vendors such as
Google, Meta, LinkedIn, Marketo, Demandbase, Segment, and Qualtrics.

The two data contracts are documented separately:

- [`APPVARS.md`](APPVARS.md): page-view personalization and experiment data;
- [`CLICK-TRACKING.md`](CLICK-TRACKING.md): click-time DOM attributes and residue authoring.

## Load sequence

1. [`head.html`](head.html) creates `window.utag_data` and sets `utag_cfg_ovrd.noview=true`, which
   prevents Tealium from sending an automatic view before consent resolves.
2. During eager loading, [`scripts/scripts.js`](scripts/scripts.js) seeds `window.appVars`, installs
   the temporary ECS enrichment and interaction-scheduling shim, and creates `TealiumMartech`.
3. During lazy loading, the Tealium loader starts prod-only Intuit Observability RUM, loads the
   OneTrust stack, and waits up to three seconds for consent state. With a pre-existing decision it
   loads `utag.js` immediately. If consent is still unknown, lazy loading continues without Tealium;
   a one-shot `OneTrustGroupsUpdated` listener loads it after OneTrust publishes a decision.
   The loader then sends the single initial `utag.view` through the consent guard.
4. During delayed loading, the site sends a consent-gated `delayed_ready` event.

The loader is [`plugins/tealium-martech/src/index.js`](plugins/tealium-martech/src/index.js). Adobe
Web SDK code remains in the repository as commented, inactive integration code; it is not a runtime
provider and has no query-parameter switch.

## Environment and runtime switches

The hostname selects the Tealium environment. A query parameter cannot promote a non-Intuit host
to the production profile.

| Host | Tealium environment |
| --- | --- |
| `erp.intuit.com` | `prod` |
| `stage.erp.intuit.com` | `prod` |
| `*--intuit-erp--aemsites.aem.page` | `dev` |
| `*--intuit-erp--aemsites.aem.live` | `dev` |
| `localhost`, `127.0.0.1` | `dev` |
| any other host, including `*.preview.da.live` | disabled |

`?martech=` changes whether martech loads and, for local testing, where vendor files come from:

| Value | Behavior |
| --- | --- |
| absent, `cdn`, or any unrecognized value | Tealium and consent scripts load from their CDNs |
| `local` | Tealium and consent scripts load from `/scripts/martech/` |
| `off` | all martech and ECS enrichment are disabled |

The `local` vendor directory is workstation-only and not committed, so this mode works from a
checkout that has the mirrored files but not from a deployed AEM preview. Intuit's OneTrust CDN
accepts `*.intuit.com` origins; on localhost and AEM hosts it may be blocked. Use `local` for a
deterministic local consent stack or `off` when martech is irrelevant to the test.

## Consent ownership

The site loads Intuit's OneTrust stack before `utag.js`:

1. `otSDKStub.js` with Intuit domain script `74130b76-29e2-4d72-ab52-09f9ed5818fb`;
2. `cookies-consent-wrapper.min.js`;
3. `gdprUtilBundle.js`.

Consent responsibility is split deliberately:

| Owner | Responsibility |
| --- | --- |
| this repository | keep `utag.js` unloaded while OneTrust consent is unknown, then wait until Tealium reports a resolved consent state before calling `utag.view` or `utag.link` |
| `ies-erp` Tealium profile | map OneTrust categories and enforce Google Consent Mode v2 for downstream tags |

`whenConsentResolved()` is an anti-recursion guard. The profile can recurse between its consent
queue and preference handling if it receives a tracked call while consent state is `0`. The guard
runs calls after either a granted or declined decision and drops them if state never resolves. It
does not grant consent or map categories.

The loader treats a parseable `OptanonConsent` groups value as an existing decision. If it is still
absent after the bounded wait, `lazy()` returns so page loading is not held open. The listener
ignores OneTrust group events until that cookie becomes readable, removes itself before loading
`utag.js`, and shares one load promise so duplicate events cannot inject the profile twice.

The footer's `button.ot-sdk-show-settings` opens the OneTrust Preference Center after the SDK binds
it. That interaction can only be tested reliably on an `intuit.com` origin because the consent CDN
blocks other origins.

## Profile-owned integrations

Do not add page loaders for vendors already owned by `ies-erp`. Their Tealium load rules carry the
required path and consent scope. For example, the blog Feedback tab is Qualtrics tag 35, restricted
by the profile to `/blog/*`; loading it from page code would duplicate it and bypass that scope.

Intuit Observability RUM is the exception: it is page-authored rather than a Tealium tag. The loader
starts it only when the resolved Tealium environment is `prod`.

## Validation

Unit coverage for environment resolution, consent, and loader behavior is in
[`test/tealium-martech.test.js`](test/tealium-martech.test.js).

[`scripts/diff/martech-diff.mjs`](scripts/diff/martech-diff.mjs) compares normalized vendor names,
Tealium tag ids, and UDO key names with production. It classifies expected profile, edge, and
nondeterministic DSP differences instead of comparing unstable request URLs.

```bash
# Compare an authenticated local build with the committed production baseline
node scripts/diff/martech-diff.mjs --env local --local-base http://localhost:3000 \
  --baseline scripts/diff/fixtures/martech-homepage.golden.json

# Deliberately refresh the production baseline
node scripts/diff/martech-diff.mjs --env prod \
  --refresh scripts/diff/fixtures/martech-homepage.golden.json

# Check the Qualtrics blog/non-blog load rules
# Serve the committed drafts at / on port 3001
npx @adobe/aem-cli up --no-open --html-folder drafts --html-mount / --port 3001 &
node scripts/diff/martech-diff.mjs --env local \
  --page blog-feedback,non-blog-scope --local-base http://localhost:3001 \
  --settle 15000 --assert
```

Browser captures need Playwright and network access. Unreachable environments are reported as
skipped. `--assert` gates only explicit vendor allowlist rules; the general comparison is
report-only. Use multiple samples when validating sampled vendors such as FullStory or Akamai
mPulse.
