# intuit-edge

Personalization edge worker — a Cloudflare Worker that sits in front of an
[aem.live](https://www.aem.live/) (Edge Delivery Services) site, acts as a full
production CDN proxy, and can rewrite the HTML **server-side, at the edge**,
before it reaches the browser.

Proof-of-concept for the Intuit demo: personalization resolved by an external
service can rewrite an EDS page on the way out, not just client-side.

Site behind the proxy: `main--intuit-erp--aemsites.aem.live`.

Vanilla JavaScript, no build step. A single deployable worker.

## Flow

On each request the worker:

1. Serves the in-worker **IXP Assignment mock** at `/v2/assignment` (so the `ixp`
   HTTP flow can call it without a second worker — see below).
2. Applies the standard **aem.live proxy contract** (port redirect, RUM guard,
   query-param sanitization, CDN headers, response cleanup) — mirrors
   [`adobe/aem-cloudflare-prod-worker`](https://github.com/adobe/aem-cloudflare-prod-worker).
3. Fetches the origin (aem.live) response for the requested path.
4. Resolves the personalization **entry** for that path (see sources below).
5. For a `.json` request the origin **404s**, falls back to a JSON source: the
   da-sc structured-content worker for paths under a `STRUCTURED_CONTENT_PATHS`
   prefix (e.g. `/events/`), otherwise the mhast html-to-json worker
   (`mhast-html-to-json.adobeaem.workers.dev/aemsites/intuit-erp`).
6. **No entry** → returns the origin response **untouched** (byte-identical
   passthrough).
7. **Entry** → fetches the referenced **offer fragment**, injects it into the DOM,
   and merges the fragment's **cache keys** into the response so CDN invalidation
   of the fragment invalidates the page too.

The worker does **no decisioning**. Intuit's service (and RTCDP) decide which
offer applies to a path; the worker only renders what the entry resolves.

## Personalization sources

The entry comes from one of four interchangeable resolvers, chosen by
`PZN_SOURCE` (or a `?pzn=map|ixp|mock|de` per-request override, so one deployment
can show every flow on the same URL):

- **`map`** (default) — the `map.json` sheet (`PZN_MAP_URL`), a mock that proxies
  Intuit's real pzn service.
- **`ixp`** — Intuit's **IXP Assignment API** over HTTP (`IXP_ASSIGNMENT_URL`).
  By default this points at **this worker's own** `/us/v2/assignment` route (the
  in-worker mock), so the HTTP flow is exercised end-to-end with no key. Swap the
  URL + key for the real host when available.
- **`mock`** — the IXP mock resolved **in-process** (no network hop, no key). The
  "no key required" demo path.
- **`de`** — Intuit's **Decision Engine "Batch"** flow: a ZoomInfo/3P context
  lookup (`ZOOMINFO_URL`) then a batch decision (`DECISION_ENGINE_BATCH_URL`) that
  personalizes **each slot** on the page (yields one entry per slot). See
  [docs/decision-engine.md](docs/decision-engine.md).

All of them resolve the same internal entry(ies), so the render path is identical.
Worker-internal params (`pzn`, `ivid`, `experimentId`, `label`) are read from the
request and then stripped before the origin subrequest.

## The map

`GET /pzn/map.json` returns an EDS-style sheet. Each row:

| field      | meaning                                              | example                      |
|------------|------------------------------------------------------|------------------------------|
| `path`     | page path the offer applies to                       | `/` or `/construction`       |
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

The simplest way for an author to create a slot in EDS is to add a **block named
after the slot** (e.g. a block "Slot 1" → renders as `<div class="slot-1">`).
Matching is generic, so you can also point `location` at an **existing** block
(e.g. `hero`) for an instant demo with no authoring.

## Offers / fragments

Offer content lives under `/fragments/pzn/` and **is** the offer — authored EDS
fragments, fetched as `.plain.html`. When a fragment is injected, its cache-tag
headers (`surrogate-key`, `edge-cache-tag`, `cache-tag`, `x-cache-tag`) are merged
into the composed response.

**JSON2HTML seam:** if Intuit later sends offers as JSON, render them into
fragment markup with [json2html](https://www.aem.live/developer/json2html) at the
marked seam in [`src/pzn.js`](src/pzn.js) (`resolveOfferMarkup`).

## Configuration

Set in [`wrangler.jsonc`](wrangler.jsonc) `vars` (all swappable, no real secrets):

- `ORIGIN_BASE_URL` — aem.live origin the worker proxies pages from.
- `PZN_MAP_URL` — the personalization map. Point at the real pzn service later.
- `PZN_SOURCE` — `map` (default), `ixp`, or `mock`. Overridable per request with
  `?pzn=`.
- `IXP_ASSIGNMENT_URL` / `IXP_API_KEY` — the IXP endpoint + key (used when
  `PZN_SOURCE=ixp`). Defaults to this worker's own `/us/v2/assignment` route.
- `MOCK_API_KEY`, `EDGE_SVC_APP_NAME`, `BU_NAME`, `COUNTRY_CODE` — config for the
  in-worker IXP mock served at `/v2/assignment`.
- `PUSH_INVALIDATION` — set to `disabled` to skip the `x-push-invalidation` origin
  header. Defaults to enabled.
- `STRUCTURED_CONTENT_PATHS` — path prefixes whose `.json` (when the origin 404s)
  is served from the da-sc structured-content source instead of mhast. An array
  (`["/events/"]`), a JSON string, or a comma-separated string; empty ⇒ everything
  uses mhast.
- `ORIGIN_AUTHENTICATION` — optional; when set, sent as `authorization: token …`
  to the origin. Keep it as a Wrangler **secret**, not in `vars`.

### IXP Assignment API (mock + integration)

A faithful mock of Intuit's IXP Assignment API and the worker-side consumer live
alongside this worker:

- [docs/ixp-mock.md](docs/ixp-mock.md) — the mock (contract, fixtures, the
  `/v2/assignment` route).
- [docs/ixp-integration.md](docs/ixp-integration.md) — the `PZN_SOURCE=ixp`
  consumer flow and the assignment→entry mapping.

## Develop, lint & test

```bash
npm install
npm run lint      # eslint (airbnb-base)
npm test          # vitest: proxy + personalization + IXP mock + consumer
npm run dev       # wrangler dev on http://127.0.0.1:8787
```

Local demo, no key required (recommended) — `?pzn=mock` resolves the IXP mock
in-process; `39002` is a 50/50 split, so vary the ivid to see both arms. The
`/drafts/suresh/pzn` demo page and its `/fragments/pzn/automation` offer are live,
so the swap renders end-to-end. `demo-visitor-2`/`-3` land in the treatment arm,
`demo-visitor-1`/`-9` in control:

```bash
# treatment arm → offer injected (marker present)
curl -s 'http://127.0.0.1:8787/drafts/suresh/pzn?pzn=mock&ivid=demo-visitor-2' | grep -c 'Automate the routine'   # -> 1
# control arm → untouched passthrough
curl -s 'http://127.0.0.1:8787/drafts/suresh/pzn?pzn=mock&ivid=demo-visitor-1' | grep -c 'Automate the routine'   # -> 0
# fragment cache tag propagated onto the page response
curl -sD - -o /dev/null 'http://127.0.0.1:8787/drafts/suresh/pzn?pzn=mock&ivid=demo-visitor-2' | grep -i cache-tag
```

`?experimentId=` picks the scenario: `39001` page-redirect, `39002` block A/B,
`39003` control. `?pzn=ixp` exercises the same flow over HTTP against the
in-worker `/us/v2/assignment` route.

## Deploy

Pushes to `main` that touch `edge/**` deploy automatically via
[`.github/workflows/deploy-edge-worker.yaml`](../.github/workflows/deploy-edge-worker.yaml)
(requires a `CLOUDFLARE_API_TOKEN` repo secret). Manual deploy:

```bash
npm run deploy    # needs `wrangler login` or CLOUDFLARE_API_TOKEN
```

Not pointing a real domain at the worker yet, but the aem.live proxy contract is
in place so one can be added later. Before doing so, revisit `/drafts/` handling
(the prod `/drafts/` 404 block is intentionally omitted so the demo works) and the
audience-keyed HTML cache question below.

## Open question: caching (not implemented — decide before the demo)

Composed personalized HTML is only edge-cacheable if the cache key includes the
audience/offer dimension; otherwise one visitor's offer leaks to others. Cache-key
**propagation** (fragment tags → response) is implemented; caching the composed
HTML is **deliberately not**. The map fetch, the IXP client (assignments are
per-visitor), and the offer-fragment fetch all use `cf.cacheTtl: 0` (always fresh)
so injected content and its cache tags are current.
