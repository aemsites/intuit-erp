# Martech

This site reproduces the production `erp.intuit.com` martech stack: a single **Tealium iQ** tag
manager (account `intuit`, profile `ies-erp`) that injects every downstream vendor at runtime,
gated by **OneTrust** consent (US opt-out model). Client loader:
[`plugins/tealium-martech/src/index.js`](plugins/tealium-martech/src/index.js).

Two things you'll want:

1. [The `?martech` runtime flag](#the-martech-runtime-flag) — switch what loads, per environment.
2. [Martech parity validation](#martech-parity-validation) — verify the rebuild fires the same
   martech as prod, page-for-page.

---

## The `?martech` runtime flag

What loads is decided by **two independent things**: the **host** (which Tealium *environment* to
use, if any) and the optional **`?martech=` query param** (which *provider / source*).

### Host → Tealium environment

`resolveEnvironment()` maps the hostname to a Tealium env. **Only the real prod host can ever be
`prod`** — there is no query-string or config override that escalates a non-prod host to `prod`.

| Host | Tealium env | Notes |
| --- | --- | --- |
| `erp.intuit.com` | **`prod`** | the live customer site |
| `stage.erp.intuit.com` | `dev` | Intuit staging (an `intuit.com` origin — consent CDN reachable) |
| `<branch>--intuit-erp--aemsites.aem.page` | `dev` | AEM preview |
| `<branch>--intuit-erp--aemsites.aem.live` | `dev` | AEM published |
| `localhost` / `127.0.0.1` | `dev` | local `aem up` |
| anything else (e.g. `*.preview.da.live`) | **inert** | martech fully disabled |

### `?martech=` → provider / source

| `?martech=` | What loads |
| --- | --- |
| *(absent)* or `cdn` | **Default.** Tealium `utag.js` + tags from `tags.tiqcdn.com`; OneTrust consent from Intuit's privacy CDN. |
| `local` | Tealium `utag.js` + the OneTrust consent stack from **local copies** in `/scripts/martech/` (see caveat below). |
| `off` | **Nothing** — no Tealium, no Adobe, fully inert. Use to isolate a page from all martech. |
| `adobe` | Legacy Adobe / `aem-martech` (Alloy) path — opt-in, currently dormant. |

The env (host) and the provider (`?martech`) are orthogonal: e.g. `localhost` is always the `dev`
env, but `?martech=local` vs the default only changes **where** utag.js and the consent stack are
fetched from.

### Consent-CDN caveat (why `?martech=local` exists)

OneTrust's consent CDN (`privacy-cdn*.a.intuit.com`) only serves **`*.intuit.com` origins**:

- On **`erp.intuit.com`** and **`stage.erp.intuit.com`** the default (CDN) consent stack works.
- On **aem.page / aem.live / localhost** (non-`intuit.com` origins) the consent CDN is
  CloudFront-blocked, so the default consent stack can't settle. Use **`?martech=local`** (local
  consent copies) or **`?martech=off`**.

> **`?martech=local` needs the vendor files.** The local copies live in `/scripts/martech/`
> (`utag.js`, `otSDKStub.js`, `cookies-consent-wrapper.min.js`, `gdprUtilBundle.js`, `stable/…`).
> They **mirror Intuit's CDN, are refreshed manually, and are git-ignored (not committed)**. So
> `?martech=local` works in a local checkout that has them, but **404s on the deployed
> aem.page/aem.live previews** (which serve committed code only). On a preview, either use
> `?martech=off`, or run an authenticated `aem up` locally (see below) where the default CDN path
> works.

### What loads where — quick matrix

| Where | Default (no param) | `?martech=local` | `?martech=off` |
| --- | --- | --- | --- |
| `erp.intuit.com` | Tealium **prod** + OneTrust (CDN) ✅ | — | inert |
| `stage.erp.intuit.com` | Tealium **dev** + OneTrust (CDN) ✅ | Tealium dev + local consent | inert |
| aem.page / aem.live preview | Tealium **dev** from CDN; consent CDN blocked → utag self-resolves (US opt-out) | ❌ 404 (vendor files not committed) | inert |
| `localhost` (`aem up`) | Tealium **dev** from CDN; consent CDN blocked | Tealium dev + **local** copies ✅ | inert |

When the consent CDN can't settle (non-`intuit.com` origin), utag resolves consent itself for the
US opt-out posture, so tags still fire.

---

## Martech parity validation

[`scripts/diff/martech-diff.mjs`](scripts/diff/martech-diff.mjs) checks that the rebuilt EDS site
fires the **same martech as live `erp.intuit.com`, page-for-page** — a golden-master diff. It's a
sibling of `content-diff` / `visual-diff` and reuses the same hardened live capture
(`scripts/diff/live-session.mjs`, which clears Akamai/Cloudflare bot-management so prod is never
silently measured as an "Access Denied" page).

### What it compares

Exact URLs can't match across environments (env path `…/ies-erp/prod/…` vs `…/dev/…`, per-load
visitor/trace IDs, cache-busters), so each page is reduced to three **environment-independent** sets
and diffed against a committed **prod golden**:

- **vendors** — which martech vendors fired a network call (GA4, Google Ads, Meta, LinkedIn,
  Marketo, Demandbase, Segment, o11y, …).
- **Tealium tag-uids** — which `utag.N.js` tag templates loaded (profile-assigned; identical across
  prod/dev publishes).
- **UDO keys** — the field *names* on the runtime `utag.data` layer (names only — values
  legitimately differ per page/visit).

### Setup

```bash
npm install                     # pulls playwright (a devDependency)
npx playwright install chromium # one-time browser download
```

Network access to `erp.intuit.com` (public) is required for the baseline.

### Running it

The tricky part is capturing **our build's** side: the rebuilt homepage on a preview is
access-gated. The clean answer is that the auth lives in **`aem up`** (server-side proxy), so if you
run the harness against an **authenticated local `aem up`** it stays cookie-free:

```bash
# Diff your local build against the committed prod golden (authenticated `aem up` on :3000):
node scripts/diff/martech-diff.mjs --env local --local-base http://localhost:3000 \
  --baseline scripts/diff/fixtures/martech-homepage.golden.json

# (Re)capture the prod golden — do this deliberately when prod's stack changes:
node scripts/diff/martech-diff.mjs --env prod \
  --refresh scripts/diff/fixtures/martech-homepage.golden.json
```

Other options:

| Flag | Purpose |
| --- | --- |
| `--env prod,stage,preview,local` | capture a subset of the env ladder (stage is VPN-gated; unreachable envs are SKIPPED, never failed) |
| `--ours-path /drafts/home` | point the our-build capture at a specific path (e.g. a disk-served draft that fires martech, no auth) |
| `--preview-base <url>` / `--local-base <url>` | override an env's base URL (e.g. your `aem up` port) |
| `--cookie 'name=value'` | pass an auth cookie if you must capture a gated preview directly (repeatable) |
| `--headed` | stealth real Chrome — escalate if prod bot-challenges the headless capture |
| `--settle <ms>` | capture window (default 9000 — spans the EDS delayed phase) |
| `--samples <n>` | capture each env `n` times and **union** the sets into the golden — recovers sampled/nondeterministic martech (FullStory, Akamai mPulse, DSP cookie-syncs). Prints a per-vendor hit frequency so you see what was flaky. Default 1. |
| `--json out.json` | also write the raw capture + diff |
| `--assert` | gate mode — exit 1 on any per-page `mustFire`/`mustNotFire` violation (see [Allowlist assertions](#allowlist-assertions)) |

### Reading the output

Each env is captured **best-effort**; an env we can't reach (stage off-VPN, gated preview, server
down) is **SKIPPED with a reason** — never mistaken for parity.

```
baseline golden(...)  25 vendors · 14 tag-uids · 47 udo-keys
          unclassified 3rd-party (add a vendor pattern or confirm noise): www.google.com
local     GAP
  missing vendors [page-authored on prod → LOOK INTO]: [trustarc]
  missing vendors [Tealium-injected → dev-profile diff, ok gap]: [demandbase, google-ads, segment, …]
  missing vendors [Akamai/CDN edge-injected → ok gap]: [mpulse]
  missing [downstream DSP cookie-sync — nondeterministic, informational]: [casale-index, …]
```

Because the whole stack is one Tealium tag manager, **most gaps are just Tealium _profile_
differences, not rebuild gaps.** Each missing vendor is auto-classified by *how prod loads it*:

| Class | Meaning | Action |
| --- | --- | --- |
| **page-authored → LOOK INTO** | prod loads it from the page itself (e.g. a TrustArc footer seal) | 🔴 real gap — decide if the rebuild needs it |
| **Tealium-injected → ok gap** | a Tealium tag the dev/e2e profile excludes | ✅ ok — fires once the prod profile is used |
| **Akamai / CDN edge-injected → ok gap** | injected by the edge (e.g. Akamai mPulse) | ✅ ok — appears behind Akamai |
| **downstream DSP cookie-sync** | fires nondeterministically downstream of the ad tags | ✅ informational — not a real gap |

The **unclassified 3rd-party** line lists any host not yet recognized by a vendor pattern — add a
pattern (see below) or confirm it's noise, so nothing is ever silently dropped.

### Allowlist assertions

`--assert` turns the report into a **gate**: each page in `PAGES` may declare vendors that
**must fire** (`mustFire`) or **must not fire** (`mustNotFire`) on the our-build envs, and any
violation exits **1**. Without `--assert` the run stays report-only (exit 0), so existing usage is
unchanged. Use it to lock in behavior that would otherwise regress silently — in particular, that a
vendor riding the Tealium profile fan-out still fires **where prod scopes it, and nowhere else**.

**Why this exists — Qualtrics (#148, #620).** The "Feedback" tab on `/blog/*` is Qualtrics Site
Intercept, and it is **not** page code: it is `ies-erp` Tealium **tag #35** (`utag.35.js`), scoped by
the tag's own load rule `cond[2] = /^\/blog\//` and gated on the analytics consent category
(`tcat:1`). The rebuild loads the real profile, so it already fires — no `scripts/delayed.js` loader
needed. A manual loader (proposed in #620) would **double-load** it on `/blog/*`, **over-fire** it
site-wide (it has no path gate), and **bypass** the consent category. These assertions encode the
correct contract so either regression — losing it, or re-broadening it — fails loudly.

| Page | `ours` path | assertion |
| --- | --- | --- |
| `blog-feedback` | `/blog/parity-probe` | `mustFire: ['qualtrics']` |
| `non-blog-scope` | `/parity-probe` | `mustNotFire: ['qualtrics']` |

The migrated `/blog` content is auth-gated, so `ours` points at committed drafts fixtures
(`drafts/blog/parity-probe.html`, `drafts/parity-probe.html`) served at **real** paths. Tag #35 keys
off `location.pathname`, so a synthetic `/blog/*` path triggers it exactly like real content. Serve
the fixtures at root with `--html-mount /`:

```bash
npx @adobe/aem-cli up --no-open --html-folder drafts --html-mount / --port 3001 &
node scripts/diff/martech-diff.mjs --env local --page blog-feedback,non-blog-scope \
  --local-base http://localhost:3001 --settle 15000 --assert
# → ASSERT ok  local: fires [qualtrics]   ·   ASSERT ok  local: absent [qualtrics]   (exit 0)
```

Run this **manually or on a schedule, not as a blocking CI gate.** It drives a browser, needs network
to `tags.tiqcdn.com`, fires a **real Qualtrics impression** each run (the dev profile points at the
production zone), and it guards an *external* dependency (the Tealium profile), so it can legitimately
go red for reasons outside any given PR.

### Updating / extending

- **Add a reference page:** add `{ name, prod, ours }` to `PAGES` in the script, then `--refresh` a
  golden for it (tags are page-specific via Tealium load rules, so capture a golden **per page**).
- **Add a vendor:** add a `[name, /regex/]` entry to `VENDORS`. If it is *not* a normal Tealium tag,
  also give it a `LOAD_CLASS` (`edge` / `authored` / `dsp-sync` / `infra`).
- **The golden** (`scripts/diff/fixtures/martech-homepage.golden.json`) is normalized — vendor
  names, tag numbers, and UDO key *names* only (no IDs or values) — so it is safe to commit.

### Known limitations

- **Report-only by default** (exit 0). `--assert` enables per-page must-fire/must-not-fire vendor
  allowlists (see [Allowlist assertions](#allowlist-assertions)); must-have UDO keys and per-vendor
  param comparison are still TODO.
- Some vendors fire **nondeterministically** — FullStory and Akamai mPulse are **sampled** (only a
  subset of visits records; note `fs_is_sampled` in the UDO), and the DSP cookie-syncs fire a
  different subset each load — so a single golden capture under-measures prod. Use **`--samples <n>`**
  to capture N times and union the stable set into the golden (each capture is a fresh context =
  fresh visitor = independent sampling roll); the summary reports the per-vendor hit frequency
  (e.g. `fullstory 3/8`) so the recovered set is explicit. The DSP syncs are additionally
  class-separated so they never gate parity.
- Tags are **page-specific** (load rules) — the homepage fires 14 tags, other page types fire
  others. Capture a golden per reference page.
