# IXP Assignment API — mock

A faithful mock of Intuit's **IXP Assignment API** (`GET /us/v2/assignment`),
the service that returns server-side experiment assignments for the
AEM / GWP Orchestrator flow. It lets us build and test the edge worker against
the **real request/response shape without an API key** — real calls need a key
from the IXP team and fire assignment/exposure tracking (see the spec's
Constraints), neither of which we want in a POC.

It is served by the `intuit-edge` worker itself, at the `/v2/assignment` route
(`GET /us/v2/assignment`, or any region prefix). `IXP_ASSIGNMENT_URL` defaults to
this worker's own route so the `PZN_SOURCE=ixp` HTTP flow works with no key; swap
it for `experimentation[-preview].us.api.intuit.com` once a key is available —
nothing else in the worker changes.

- Contract + validation: [`src/mock/ixp-assignment.js`](../src/mock/ixp-assignment.js)
- Fixture catalog: [`src/mock/ixp-fixtures.js`](../src/mock/ixp-fixtures.js)
- Route: the `/v2/assignment` branch in [`src/index.js`](../src/index.js)
- Config: the `MOCK_API_KEY` / `EDGE_SVC_APP_NAME` / `BU_NAME` / `COUNTRY_CODE`
  vars in [`wrangler.jsonc`](../wrangler.jsonc)
- Tests: [`test/mock-ixp.spec.js`](../test/mock-ixp.spec.js)

## The contract

**Request**

```
GET /us/v2/assignment?ivid=<ivid>&experimentId=<id>&label=<regex>&application=<app>&businessUnit=<bu>&country=<cc>
Authorization: Intuit_APIKey intuit_apikey=<key>, intuit_apikey_version=1.0
```

| param          | required | meaning                                                           |
|----------------|----------|-------------------------------------------------------------------|
| `ivid`         | yes      | visitor id; drives bucketing                                      |
| `experimentId` | one of   | numeric id — exact lookup (0 or 1 match)                          |
| `label`        | one of   | **regex** matched against experiment labels (0..n matches)        |
| `application`  | no       | cache scope; defaults to `EDGE_SVC_APP_NAME`                      |
| `businessUnit` | no       | cache scope; defaults to `BU_NAME`                                |
| `country`      | no       | stamped onto returned assignments; defaults to `COUNTRY_CODE`     |

One of `experimentId` / `label` must be present. `label` is a regex, so a single
call can resolve **several** experiments at once.

**Response** (`200`)

```json
{
  "ivid": "d3878e74-ba78-4e1d-afea-3be26957721a",
  "transactionId": "<uuid, generated per request>",
  "assignments": [ { /* Assignment */ } ],
  "error": "…"
}
```

`assignments` is empty when nothing resolves (not bucketed, out of scope, no
match). `error` appears **only** on a graceful SDK error (still HTTP 200 — see
below). An `Assignment` carries the treatment; the fields the edge worker cares
about are `experimentType`, `payload`, `assetLocation`, and `control` (full field
list in [`ixp-assignment.js`](../src/mock/ixp-assignment.js)).

## Validation & error behavior

Reproduced from the spec — the guiding rule is **the API never throws an
unhandled 500**; anything the caller can recover from is a graceful 200.

| condition                                   | status | body                                            |
|---------------------------------------------|--------|-------------------------------------------------|
| missing / wrong API key                     | `500`  | `{ "error": "Invalid Key" }`                    |
| missing `ivid`                              | `400`  | `{ "error": "Missing required query param: ivid" }` |
| neither `experimentId` nor `label`          | `400`  | `{ "error": "Provide one of: experimentId, label" }` |
| non-numeric `experimentId`                  | `400`  | `{ "error": "experimentId must be numeric" }`   |
| caller app/BU outside cache scope           | `200`  | empty `assignments`                             |
| `ivid` not bucketed into anything           | `200`  | empty `assignments`                             |
| no experiment matches                       | `200`  | empty `assignments`                             |
| experiment is **not IVID-typed**            | `200`  | empty `assignments` + `error` (graceful)        |
| match(es) resolve                           | `200`  | populated `assignments`                         |

Cache-scope allow lists (out of scope ⇒ empty) come straight from the spec:
business units `CG, SBSEG, INTUIT, PCG`; applications `INTUITCOM, SBGM,
TurboTax_Community, QBDT_IPD, Tsheets, PCGM`.

## Fixture catalog

Each fixture is an experiment the mock "knows about". `15972` is reproduced
**verbatim** from the shared spec capture so responses can be diffed against the
PDF. The `39xxx` fixtures are added to exercise the four cases the edge worker
cares about explicitly.

| experimentId | label               | experimentType        | edge-worker meaning                     |
|--------------|---------------------|-----------------------|-----------------------------------------|
| `15972`      | `081008a2-…-4810`   | `REDIRECT` (control)  | verbatim spec sample; control ⇒ baseline|
| `39001`      | `ERP-HERO-REDIRECT` | `REDIRECT`            | page-level — `payload.variationUrl`     |
| `39002`      | `ERP-HERO-BLOCK`    | `REPLACE_WEB_CONTENT` | block-level — `assetLocation`; **split 50/50** |
| `39003`      | `ERP-HERO-CONTROL`  | `DEFAULT` (control)   | control arm ⇒ passthrough (baseline)    |
| `39004`      | `ERP-BADTYPE`       | `DEFAULT`             | not IVID-typed ⇒ graceful error, empty  |

The three `ERP-HERO-*` fixtures share a prefix, so `?label=ERP-HERO-` resolves
all three in one call — demonstrating the regex/multi-match behavior.

Sentinel ivids of only `1`s and dashes (e.g. `11111-1111-…`) model a user
bucketed into nothing ⇒ empty assignments.

### A/B arm split (`treatmentSplit`)

A fixture may set `treatmentSplit` (a percentage) to model a real A/B experiment.
`39002` uses `treatmentSplit: 50`: for each bucketed visitor the ivid is hashed to
a stable `0–99` bucket (FNV-1a, [`bucketPercent`](../src/mock/ixp-fixtures.js)), and
buckets `< 50` get the treatment arm while the rest get the control arm
(`control: true` ⇒ the worker shows the baseline). The assignment is **stable per
visitor** — the same ivid always lands the same arm — so a demo shows some visitors
the offer and others the baseline off a single URL. Fixtures without a
`treatmentSplit` always hand out their defined arm.

## IXP → edge-worker mapping (design)

This is why these fixtures exist: the IXP assignment shape maps 1:1 onto the
actions the edge worker already performs (see the main [README](../README.md)).

| assignment                                    | edge-worker action                              |
|-----------------------------------------------|-------------------------------------------------|
| `control: true` **or** empty `assignments`    | **passthrough** — return origin untouched       |
| `REDIRECT` + `payload.variationUrl`           | **whole-page replace** — render the variation path |
| `REPLACE_WEB_CONTENT` + `assetLocation`       | **block/section replace** — fetch + inject content |

So the eventual consumer maps an `Assignment` to the same internal shape the
`map.json` flow already produces, and the rest of the render path is unchanged.

## Run it

```bash
npm run dev            # wrangler dev on http://127.0.0.1:8787 (serves /v2/assignment)
npm test               # vitest: full contract coverage (test/mock-ixp.spec.js)
npm run deploy         # needs Cloudflare auth
```

Example calls (default dev key is `dev-ixp-key`):

```bash
# single experiment by id
curl -s 'http://127.0.0.1:8787/us/v2/assignment?ivid=d3878e74-ba78-4e1d-afea-3be26957721a&experimentId=15972' \
  -H 'Authorization: Intuit_APIKey intuit_apikey=dev-ixp-key, intuit_apikey_version=1.0'

# regex label → three assignments
curl -s 'http://127.0.0.1:8787/us/v2/assignment?ivid=d3878e74-ba78-4e1d-afea-3be26957721a&label=ERP-HERO-' \
  -H 'Authorization: Intuit_APIKey intuit_apikey=dev-ixp-key, intuit_apikey_version=1.0'

# missing key → 500 Invalid Key
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:8787/us/v2/assignment?ivid=x&experimentId=15972'
```

## Configuration

Set in [`wrangler.jsonc`](../wrangler.jsonc) `vars` (no secrets):

- `MOCK_API_KEY` — expected `intuit_apikey=` value (dev default `dev-ixp-key`).
- `EDGE_SVC_APP_NAME` / `BU_NAME` / `COUNTRY_CODE` — defaults applied when the
  query omits `application` / `businessUnit` / `country`. The defaults sit inside
  the spec's cache-scope allow lists.

## Consumer wiring (built)

The edge worker can now resolve personalization from this API instead of
`map.json`, selected by the `PZN_SOURCE` var. See
[docs/ixp-integration.md](ixp-integration.md) for how the pieces fit:

- [`src/ixp/client.js`](../src/ixp/client.js) — `fetchAssignment` client.
- [`src/ixp/resolve.js`](../src/ixp/resolve.js) — `assignmentToPznEntry` (the
  mapping table above) + `resolveIxpEntry`.
- [`src/ixp/routes.js`](../src/ixp/routes.js) — path → (`experimentId`/`label`,
  slot) routing table.
- [`src/index.js`](../src/index.js) — picks the resolver by `PZN_SOURCE`; the
  `map.json` flow is unchanged and remains the default.
