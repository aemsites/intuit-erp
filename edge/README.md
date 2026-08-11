# intuit-edge

Personalization edge worker — a Cloudflare Worker that sits in front of an
[aem.live](https://www.aem.live/) (Edge Delivery Services) site, acts as a full
production CDN proxy, and can rewrite the HTML **server-side, at the edge**,
before it reaches the browser.

Proof-of-concept for the Intuit demo: personalization resolved by Intuit's real
services can rewrite an EDS page on the way out, not just client-side.

Site behind the proxy: `main--intuit-erp--aemsites.aem.live`.

Vanilla JavaScript, no build step. A single deployable worker (`intuit-edge`).

## Flow

On each request the worker:

1. Applies the standard **aem.live proxy contract** (port redirect, RUM guard,
   query-param sanitization, CDN headers, response cleanup) — mirrors
   [`adobe/aem-cloudflare-prod-worker`](https://github.com/adobe/aem-cloudflare-prod-worker).
2. Fetches the origin (aem.live) page **and** resolves the personalization
   entry(ies) for the path **in parallel**.
3. For a `.json` request the origin **404s**, falls back to a JSON source: the
   da-sc structured-content worker for paths under a `STRUCTURED_CONTENT_PATHS`
   prefix (e.g. `/events/`), otherwise the mhast html-to-json worker
   (`mhast-html-to-json.adobeaem.workers.dev/aemsites/intuit-erp`).
4. **No entry** → returns the origin response **untouched** (byte-identical
   passthrough).
5. **Entry** → fetches the referenced **offer fragment**, injects it into the DOM,
   and merges the fragment's **cache keys** into the response so CDN invalidation
   of the fragment invalidates the page too.

A second, independent transform runs alongside fragment injection: **template
fill**. Pages authored with literal ALL-CAPS placeholder tokens (`TITLE`, `BODY`,
…) and a sibling data sheet get those tokens filled from the sheet, enriched with
per-visitor signals (geo/lang/greeting).

The worker does **no decisioning**. Intuit's services decide which offer applies
to a path; the worker only renders what the entry resolves.

## Personalization sources

The entry comes from one of two interchangeable resolvers, chosen by `PZN_SOURCE`
(or a `?pzn=de|ixp` per-request override, so one deployment can show either flow
on the same URL):

- **`de`** (default) — Intuit's **Decision Engine "Batch"** flow: a batch decision
  per visitor that personalizes **each slot** on the page (yields one entry per
  slot). See [docs/decision-engine.md](docs/decision-engine.md).
- **`ixp`** — Intuit's **IXP Assignment API** over HTTP (`IXP_ASSIGNMENT_URL`), for
  whole-page / block A-B experiments keyed off the visitor's `ivid` cookie. See
  [docs/ixp-integration.md](docs/ixp-integration.md).

Both resolve the same internal entry(ies), so the render path is identical.
Worker-internal params (`pzn`, `ivid`, `experimentId`, `label`, `locale`) are read
from the request and then stripped before the origin subrequest. `?locale=` forces
the DE locale (the batch response is keyed by locale) — handy when the browser's
`Accept-Language` (e.g. `en-GB`) has no configured offer; `?locale=en-US` shows it.

> **Status.** The Decision Engine batch endpoint is live and works with a key.
> Intuit's IXP endpoint currently returns **403** (key access not yet granted), so
> the `ixp` flow is wired against the real host but can only be exercised
> end-to-end against the assignment mock in `test/mocks/` (driven by the test
> suite) until that clears.

## The entry

There is no authored map/sheet — each resolver *derives* one or more entries.
Every entry has these fields:

| field      | meaning                                              | example                      |
|------------|------------------------------------------------------|------------------------------|
| `path`     | page path the offer applies to                       | `/drafts/pzn/treatment`      |
| `fragment` | offer fragment reference (`.plain.html` is appended) | `/fragments/pzn/automation`  |
| `location` | **slot id** to target in the page                    | `slot-1`                     |
| `action`   | `replace` \| `above` \| `below`                      | `replace`                    |
| `fidelity` | `block` \| `section` \| `page`                       | `block`                      |

## Action × fidelity

`fidelity` picks the **target element**; `action` picks the **operation** on it.

- **fidelity `block`** → target = the slot's block `<div>`. Offer injected as
  blocks (the fragment's outer section `<div>` is unwrapped).
- **fidelity `section`** → target = the top-level `<div>` section (direct child of
  `<main>`) that encloses the slot. Offer injected as a whole section.
- **fidelity `page`** → target = the inner content of `<main>` (ignores the slot).

- **action `replace`** → replace the target.
- **action `above`** → insert the offer before the target.
- **action `below`** → insert the offer after the target.

## How slots are marked

The origin EDS markup is **undecorated**: sections are bare `<div>` children of
`<main>`, blocks are `<div class="blockname">`. The worker matches `location`
against a block/section that has **any** of: a `class` token equal to the slot id
(`<div class="slot-1">`), `id="slot-1"`, or `data-slot="slot-1"`.

The simplest way for an author to mark a slot in EDS is to add the slot id as a
**class on an existing block** — append it to the block's title, e.g.
`Hero (slot-1)` renders as `<div class="hero slot-1">`. For a **section-level**
slot, add the slot id as a **Style** in the section's metadata, which renders as
a class on the section `<div>`. Either way no new block or content is needed —
you are just tagging what is already there.

## Offers / fragments

Offer content lives under `/fragments/pzn/` and **is** the offer — authored EDS
fragments, fetched as `.plain.html`. When a fragment is injected, its cache-tag
headers (`surrogate-key`, `edge-cache-tag`, `cache-tag`, `x-cache-tag`) are merged
into the composed response.

**JSON2HTML seam:** if Intuit later sends offers as JSON, render them into
fragment markup with [json2html](https://www.aem.live/developer/json2html) at the
marked seam in [`src/pzn.js`](src/pzn.js) (`resolveOfferMarkup`).

## Configuration

Set in [`wrangler.jsonc`](wrangler.jsonc) `vars` (config only — **no secrets**):

- `ORIGIN_BASE_URL` — aem.live origin the worker proxies pages from.
- `PZN_SOURCE` — `de` (default) or `ixp`. Overridable per request with `?pzn=`.
- `DECISION_ENGINE_BATCH_URL` — Intuit Decision Engine "Batch" endpoint (used when
  `PZN_SOURCE=de`).
- `IXP_ASSIGNMENT_URL` — Intuit IXP Assignment API host (used when
  `PZN_SOURCE=ixp`).
- `PUSH_INVALIDATION` — set to `disabled` to skip the `x-push-invalidation` origin
  header and force `no-store` (no edge caching we cannot purge). Defaults to
  enabled.
- `STRUCTURED_CONTENT_PATHS` — path prefixes whose `.json` (when the origin 404s)
  is served from the da-sc structured-content source instead of mhast. An array
  (`["/events/"]`), a JSON string, or a comma-separated string; empty ⇒ everything
  uses mhast.

### Secrets

The API keys are **Wrangler secrets** — stored server-side in Cloudflare and
attached to the `intuit-edge` worker. They are set **out of band, not by the
deploy**: never in `wrangler.jsonc`, the repo, or the pipeline, and they
**persist across deploys**. You set each one **once** (and again only to rotate).

| secret                  | used when          | without it                                                     |
|-------------------------|--------------------|----------------------------------------------------------------|
| `PZN_API_KEY`           | `PZN_SOURCE=de`    | batch client returns `null` → page passes through un-personalized |
| `IXP_API_KEY`           | `PZN_SOURCE=ixp`   | assignment request is unauthenticated → no assignment          |
| `ORIGIN_AUTHENTICATION` | origin has [site auth](https://www.aem.live/docs/authentication-setup-site) enabled | every origin subrequest (page, offer fragment, template sheet) is unauthenticated → the origin returns 401 and the worker serves the error / passes through un-personalized |

> 🔒 **`ORIGIN_AUTHENTICATION` is the aem.live site token.** When the origin site
> has authentication enabled, the worker must send it as `authorization: token
> <token>` on **every** subrequest it makes back to the origin — the proxied page
> ([`src/index.js`](src/index.js)), personalization offer fragments
> ([`src/pzn.js`](src/pzn.js)), and template data sheets
> ([`src/template.js`](src/template.js)). Set it once and every origin call is
> authenticated. (The `.json`-fallback helper workers — mhast / da-sc — are
> separate origins and are not covered by this token.)

> ⚠️ **A missing key does not fail the deploy or throw at runtime.** The guard in
> [`src/de/batch-client.js`](src/de/batch-client.js) returns `null`, so the flow
> degrades to a byte-identical passthrough. A worker with no `PZN_API_KEY` deploys
> "green" but silently personalizes nothing — the most common cause of "the demo
> shows the plain page."

Set / rotate a secret (targets the deployed `intuit-edge` worker):

```bash
wrangler secret put PZN_API_KEY     # prompts for the value; paste the key
wrangler secret put IXP_API_KEY
wrangler secret list                # shows names only, never values
```

For **local** `wrangler dev`, remote secrets are not read — put keys in a
git-ignored `.dev.vars` file in `edge/`:

```
PZN_API_KEY=…
IXP_API_KEY=…
ORIGIN_AUTHENTICATION=hlx_…   # aem.live site token, if the origin has site auth on
```

> 🔐 The prod PZN key was circulated in a shared PDF / Slack — **rotate it** and
> set the secret to the new value rather than the leaked one.

### Client-facing API (`/api/*`)

`/api/de` (POST) and `/api/ixp` (GET) are the client-driven personalization /
experiment endpoints used by `scripts/pzn.js` and `scripts/exp.js`. They reuse the
Decision Engine / IXP clients, read the `ivid` (cookie or `?ivid=` override, never
minted), and return a normalized decision (`{ placement, action, fidelity,
fragment }` for DE; `{ action, fidelity, fragment }` or `{ control: true }` for
IXP). Guarded by an origin allowlist (`*.intuit.com`, `*.aem.live`, `*.aem.page` +
same-origin) and, when `EDGE_AUTH_SECRET` is set, an Akamai-injected `x-edge-auth`
header.

## Develop, lint & test

```bash
npm install
npm run lint      # eslint (airbnb-base)
npm test          # vitest: proxy + personalization + DE + IXP consumer + mock
npm run dev       # wrangler dev on http://127.0.0.1:8787
```

Demo the **Decision Engine** flow end-to-end (the default source). The enrolled
page `/drafts/pzn/treatment` and its published `slot-1` block are live, so the
per-visitor batch recommendation is injected into the slot. Needs `PZN_API_KEY`
(a remote secret when deployed, or `.dev.vars` locally); vary `ivid` per visitor —
which offer (if any) comes back is decided by the Decision Engine:

```bash
# fetch the personalized page for a visitor
curl -s 'http://127.0.0.1:8787/drafts/pzn/treatment?ivid=demo-visitor-2' -o treatment.html
# when an offer is injected, its fragment cache tag propagates onto the response
curl -sD - -o /dev/null 'http://127.0.0.1:8787/drafts/pzn/treatment?ivid=demo-visitor-2' | grep -i cache-tag
```

The **IXP** flow (`?pzn=ixp`, enrolled at `/drafts/pzn/experiment`, experiment
`15972`) is wired against the real host but blocked by the 403 above; until it
clears, exercise it via the consumer tests (`test/ixp-consumer.spec.js`) and the
assignment mock (`test/mocks/`), which the suite drives directly.

## Deploy

Two separate things — don't conflate them:

**Code + vars** deploy automatically. Pushes to `main` that touch `edge/**` run
[`.github/workflows/deploy-edge-worker.yaml`](../.github/workflows/deploy-edge-worker.yaml):
a `verify` job (lint + tests) then a `deploy` job (`wrangler deploy`, needs the
`CLOUDFLARE_API_TOKEN` repo secret). PRs run `verify` only — they **never** deploy.
Manual deploy:

```bash
npm run deploy    # wrangler deploy; needs `wrangler login` or CLOUDFLARE_API_TOKEN
```

`wrangler deploy` uploads the **code and the `vars`** from `wrangler.jsonc` — it
does **not** set secrets. The API keys must already exist on the worker (see
[Secrets](#secrets)); because they persist across deploys, that is a one-time
setup per key.

Not pointing a real domain at the worker yet, but the aem.live proxy contract is
in place so one can be added later. Before doing so, revisit `/drafts/` handling
(the prod `/drafts/` 404 block is intentionally omitted so the demo works) and the
audience-keyed HTML cache question below.

## Open question: caching (not implemented — decide before the demo)

Composed personalized HTML is only edge-cacheable if the cache key includes the
audience/offer dimension; otherwise one visitor's offer leaks to others. Cache-key
**propagation** (fragment tags → response) is implemented; caching the composed
HTML is **deliberately not**. The origin read, the pzn source calls (batch /
assignment are per-visitor), and the offer-fragment fetch all bypass the edge
cache (`no-store` / `cf.cacheTtl: 0`) so injected content and its cache tags stay
current.
