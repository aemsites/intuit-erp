# IXP integration — edge worker consumer

How the edge worker resolves personalization from Intuit's **IXP Assignment API**
instead of the `map.json` sheet. Both sources produce the same internal
`PznEntry`, so the offer-fetch + DOM-inject path is identical; only *how the entry
is resolved* differs. The source is chosen by the `PZN_SOURCE` var:

- `PZN_SOURCE=map` (default) — [`src/pzn.js`](../src/pzn.js) reads `map.json`.
- `PZN_SOURCE=ixp` — [`src/ixp/`](../src/ixp) calls the IXP Assignment API over HTTP.
- `PZN_SOURCE=mock` — [`src/ixp/mock-source.js`](../src/ixp/mock-source.js) resolves
  the IXP mock **in-process** (no key, no network hop, no second Worker). This is
  the "no key required" demo path — see [Demo without a key](#demo-without-a-key-pznmock).

A `?pzn=map|ixp|mock` query param overrides the configured default **per request**,
so one deployment can demo every flow on the same URL without a redeploy. The
default stays `map`, so nothing changes for normal traffic.

The mock in [docs/ixp-mock.md](ixp-mock.md) stands in for the real service until a
key is available.

## Flow (ixp mode)

Per request, in [`src/index.js`](../src/index.js) → [`resolveIxpEntry`](../src/ixp/resolve.js):

1. **Route lookup** — [`resolveRoute(path)`](../src/ixp/routes.js). Not enrolled →
   `null` → passthrough (no IXP call). This table holds the site knowledge the
   API response lacks: which experiment a page is in, and which slot a block
   treatment targets.
2. **Read the ivid** — the `ivid` cookie, overridable by a `?ivid=` query param
   for demo/QA. Absent → `null` → passthrough.
3. **Call IXP** — [`fetchAssignment`](../src/ixp/client.js) with the route's
   `experimentId`/`label`. Transport/parse failure → `null` → passthrough.
4. **Map an assignment → `PznEntry`** — [`assignmentToPznEntry`](../src/ixp/resolve.js).
   The first assignment that maps to an actual change wins (a label route can
   resolve several experiments; one slot shows one treatment).

Every failure mode degrades to an untouched passthrough — personalization never
breaks the page.

## Mapping: assignment → PznEntry

| IXP assignment                                | `PznEntry`                                                    |
|-----------------------------------------------|---------------------------------------------------------------|
| `control: true`, empty, or unhandled type     | `null` → **passthrough** (baseline)                           |
| `REDIRECT` + `payload.variationUrl`           | `{ fidelity: "page", action: "replace", fragment: variationUrl }` → whole-`<main>` swap |
| `REPLACE_WEB_CONTENT` + `assetLocation`       | `{ fidelity: route.fidelity, action: "replace", location: route.location, fragment: assetLocation }` → block/section replace |

`MAB_REDIRECT` / `MAB_WEB_CONTENT` are treated like their non-MAB counterparts.
The `fragment` (a variation path or content ref) is fetched as `.plain.html` by
the unchanged [`resolveOfferMarkup`](../src/pzn.js).

## Run the IXP HTTP demo

One worker serves everything. `IXP_ASSIGNMENT_URL` defaults to the worker's own
`/us/v2/assignment` route (the in-worker mock), so the `ixp` HTTP flow calls back
into the same process with no key and no second service:

```bash
npm run dev            # http://127.0.0.1:8787 (also serves /us/v2/assignment)
```

Force the IXP flow per request with `?pzn=ixp`, and hit an enrolled path **with an
ivid** (any non-sentinel value buckets in):

```bash
curl -s 'http://127.0.0.1:8787/drafts/suresh/pzn?pzn=ixp&ivid=demo-visitor-2' | grep -i offer
```

`/drafts/suresh/pzn` is routed to experiment `39002` (a `REPLACE_WEB_CONTENT`
block treatment at `slot-1`), whose `assetLocation` points at the same authored
fragment the `map.json` demo uses — so switching to IXP reproduces the same visible
result. `39002` is split 50/50 (`treatmentSplit: 50` in the fixtures), so the arm
is chosen by a stable hash of the ivid: some visitors see the offer, others get the
baseline, and a given ivid always lands the same way. Try a few `?ivid=` values to
see both arms; omit `?ivid=` (and send no cookie) to see the non-destructive
passthrough.

The same override works against a deployed worker — no `--var` needed:

```bash
curl -s 'https://<deployed-worker>/drafts/suresh/pzn?pzn=ixp&ivid=demo-visitor-2' | grep -i offer
```

## Demo without a key (`?pzn=mock`)

The `ixp` source needs a real key + a reachable host. To demo the full IXP flow
(server-side A/B, per-visitor arms) **with no key and no second service**, use the
`mock` source: [`resolveMockEntry`](../src/ixp/mock-source.js) calls the IXP mock's
`handleAssignment` **in-process**, reusing the exact routing + mapping the real
`ixp` path uses. It works on a single deployed URL — nothing to wire, nothing to
reach over the network.

```bash
# treatment arm (e.g. demo-visitor-2) -> the offer is injected
curl -s 'https://<deployed-worker>/drafts/suresh/pzn?pzn=mock&ivid=demo-visitor-2' | grep -i offer
# control arm (e.g. demo-visitor-1) -> baseline; the arm is stable per ivid
curl -s 'https://<deployed-worker>/drafts/suresh/pzn?pzn=mock&ivid=demo-visitor-1' | grep -i offer
```

Demo knobs on the URL (all optional; the mock fabricates the rest):

- `?ivid=` — the visitor id; selects the A/B arm (stable per ivid).
- `?experimentId=` — override which experiment the mock resolves: `39001` (a
  page-level redirect), `39002` (the block A/B, the route default), `39003`
  (control). `?label=` does the same by label regex.

These params are consumed by the worker and stripped before the origin subrequest.

## Configuration

Added to [`wrangler.jsonc`](../wrangler.jsonc) `vars`:

- `PZN_SOURCE` — `map` (default), `ixp`, or `mock`. Overridable per request with
  `?pzn=map|ixp|mock` (demo / QA); the param is consumed by the worker and stripped
  before the origin subrequest.
- `IXP_ASSIGNMENT_URL` — the assignment endpoint. Defaults to the local mock;
  point at `experimentation[-preview].us.api.intuit.com` for the real service.
- `IXP_API_KEY` — the `intuit_apikey=` value. The committed default matches the
  mock's dev key (not a real secret). For the real host, set it as a Wrangler
  **secret** rather than a committed var:

  ```bash
  wrangler secret put IXP_API_KEY
  ```

## Enrolling a page

Add a row to [`IXP_ROUTES`](../src/ixp/routes.js):

```ts
"/your/path": { experimentId: 40010, location: "slot-1", fidelity: "block" },
// or match several experiments by label:
"/other/path": { label: "ERP-HERO-", location: "slot-2", fidelity: "section" },
```

`location`/`fidelity` are used for block/section treatments; page-level
(`REDIRECT`) treatments ignore them and replace the whole `<main>`.
