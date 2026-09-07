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

`?tealium-phase=delayed` is a page-owned diagnostic variant of steps 3–4. Observability and the
complete OneTrust stack remain in lazy, but `utag.js`, the initial view, and `delayed_ready` wait
until the EDS delayed phase. The absent/default value is `lazy`; unknown values preserve that
default. Consent is still required in either phase, and duplicate lifecycle/OneTrust events share
the same one-shot load promise.

The opt-in `?martech-phase-split=on` performance experiment changes only steps 3–4. The initial
view targets all tags that are active under the profile's existing load rules except Floodlight
(UID 9), Google Ads (UID 15), and Facebook (UID 21). At `delayed_ready`, a second targeted view
sends those three active tags. This cohort comes from the September 2026 mobile leave-one-out and
combined-exclusion benchmarks rather than template size alone. Without the parameter, the original
unfiltered initial view and delayed link remain unchanged.

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

`?martech-phase-split=on` can be combined with the values above. It is a lab switch for controlled
performance traces, not a replacement for publishing equivalent event-based rules in Tealium iQ.

`?tealium-phase=delayed` moves the whole Tealium profile, but not OneTrust or Observability RUM,
from lazy to delayed. It can be combined with `?martech-phase-split=on`; in that combination the
initial and delayed targeted views occur after the profile loads in delayed, so use it to measure
whole-profile timing rather than the benefit of spacing the two tag audiences apart.

`?onemind=delayed` keeps the page-authored 1Mind launcher off the lazy path until the shared EDS
delayed signal. `?onemind=off` prevents the launcher from loading for an attribution baseline.
Absent, `lazy`, and unknown values preserve the existing immediate widget behavior. This switch
does not disable or alter the site's personalization decision call; it only controls the selected
1Mind treatment's external launcher.

`?tealium-tags=` is a lab-only delivery allowlist for the site's initial and delayed lifecycle
calls. Values are comma-separated numeric tag UIDs; whitespace is trimmed,
duplicates are removed, and invalid values are ignored. The requested UIDs are intersected with the
tags that remain active after the profile's load rules and consent decision, preserving the
profile's tag order. This means the query parameter cannot force an inactive tag to run.

| Example | Behavior |
| --- | --- |
| parameter absent | preserves the existing initial, delayed, public view/link, and phase-split routing |
| `?tealium-tags=1,2,3,7` | only active profile tags with UIDs 1, 2, 3, or 7 receive the site's initial and delayed lifecycle calls |
| `?tealium-tags=7,%202,7,invalid` | equivalent to `?tealium-tags=7,2` |
| `?tealium-tags=` (or no valid UIDs) | sets Tealium's documented `noload` override before `utag.js`, halting initialization after Pre Loader and providing a core/pre-loader-only baseline |

The allowlist composes with `?martech-phase-split=on`: each phase receives only the active UIDs
that belong to both that phase and the allowlist. The switch does not disable the OneTrust/Tealium
core loaders or the separate Intuit Observability RUM integration. Public `trackView()` and
`trackEvent()` calls intentionally keep their normal un-targeted
`utag.view`/`utag.link` routing so Tealium can evaluate load rules against each event's data. The
page-side allowlist does not constrain those calls; the profile-native filter rule below does.

### Tag-template load limitation

A non-empty allowlist does **not** currently isolate tag-template download and initialization cost.
The checked-in Tealium runtime processes load rules during `PINIT`/`INIT` and loads every active
`utag.<uid>.js` template before the site's targeted initial view runs. `noview=true` suppresses the
automatic tracking call, not that initialization. Consequently, use non-empty allowlists to verify
delivery behavior, but do not interpret their Web Vitals differences as the cost of only the listed
tags.

Tealium's supported page-side `noload` setting is terminal: it halts all operations and has no
documented selective resume API. Clearing it and invoking internal `PINIT`, `LOAD`, or configuration
objects would couple this site to generated runtime internals and can bypass this profile's consent
integration. The site therefore uses `noload` only for the explicitly empty baseline.

For true per-tag performance isolation, update a lab version of the `ies-erp` profile so native load
rules exclude non-allowlisted tags before `INIT`. Declare `tealium-tags` as a Querystring data source
(available at runtime as `qp.tealium-tags`), then create one filter rule per tag UID with these two
**OR** conditions:

1. `tealium-tags` **is not defined**; or
2. `tealium-tags` matches the UID at a comma boundary, allowing whitespace and leading zeroes — for
   UID 23, use the regular expression `(?:^|,)\s*0*23\s*(?:,|$)`.

Assign that tag's filter rule alongside its existing load rule and select **Match All Rules**. An
absent parameter therefore preserves normal routing, a present empty/invalid parameter matches no
tag, and a non-empty parameter loads only the listed tags that also satisfy their original rule.
Keep consent enforcement in the profile's consent integration rather than duplicating it in these
diagnostic rules.

To build an "all tags except" lifecycle-delivery allowlist, first read the active UID inventory
after Tealium and consent have loaded. In the browser console, replace the sample omitted UIDs with
the two or three tags to exclude; the expression returns the allowlist value to paste into the URL:

```js
const omitted = new Set(['23', '27']);
window.utag.loader.cfgsort
  .filter((uid) => window.utag.loader.cfg[uid]?.load
    && window.utag.loader.cfg[uid]?.send
    && !omitted.has(uid))
  .join(',');
```

Use the returned value as `?tealium-tags=<uids>` (or
`?martech-phase-split=on&tealium-tags=<uids>`). Rebuild it for the page and consent state under
test because profile load rules can make the active inventory context-dependent.

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

### Consent performance evidence

Sampled experience-performance telemetry, and every view with `?perf=on`, records the OneTrust
stack, consent-settle, and total consent durations as `consentStackMs`, `consentSettleMs`, and
`consentTotalMs`. It also observes layout shifts without recent input and reports:

- `cls`: browser CLS using the standard one-second-gap/five-second session window;
- `onetrustDirectShift`: shift value for entries with a source inside OneTrust markup;
- `consentWindowShift`: shift value during consent loading plus a one-second render tail;
- `topLayoutShiftSource` and `topLayoutShiftSourceScore`: the highest associated shifted element.

Direct source attribution and consent-window correlation are deliberately separate: a banner can
move a page-owned node without OneTrust itself appearing as the browser's shift source. Element
labels contain only tag names and at most two sanitized CSS classes—never text, field values,
links, data attributes, or arbitrary element ids.

## Profile-owned integrations

Do not add page loaders for vendors already owned by `ies-erp`. Their Tealium load rules carry the
required path and consent scope. For example, the blog Feedback tab is Qualtrics tag 35, restricted
by the profile to `/blog/*`; loading it from page code would duplicate it and bypass that scope.

Intuit Observability RUM is the exception: it is page-authored rather than a Tealium tag. The loader
starts it only when the resolved Tealium environment is `prod`.

## Validation

Unit coverage for environment resolution, consent, and loader behavior is in
[`test/tealium-martech.test.js`](test/tealium-martech.test.js).

The supported browser checks are documented in
[`scripts/diff/README.md`](scripts/diff/README.md). With the local development server running:

```bash
npm run verify:martech
```

[`scripts/diff/martech-diff.mjs`](scripts/diff/martech-diff.mjs) compares normalized vendor names,
Tealium tag ids, and UDO key names with production. It classifies expected profile, edge, and
nondeterministic DSP differences instead of comparing unstable request URLs.

```bash
# Compare an authenticated local build with the committed production baseline
node scripts/diff/martech-diff.mjs --env local --local-base http://localhost:3000 \
  --baseline scripts/diff/fixtures/martech.golden.json

# Deliberately refresh the production baseline
node scripts/diff/martech-diff.mjs --env prod \
  --refresh scripts/diff/fixtures/martech.golden.json

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
