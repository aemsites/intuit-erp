# intuit-edge

A thin Cloudflare Worker exposing two client-facing endpoints — `POST /api/pzn`
and `GET /api/ixp` — that proxy Intuit's **Decision Engine** (personalization) and
**IXP Assignment** (experimentation) services. Vanilla JavaScript, no build step,
a single deployable worker (`intuit-edge`).

## Architecture

Akamai is the CDN in front of the [aem.live](https://www.aem.live/) site
(`main--intuit-erp--aemsites.aem.live`) and serves **all page and fragment traffic
directly**. It routes only the `/api/*` paths to this worker.

All personalization / experimentation **decisioning happens in the browser** — see
the site's [`scripts/pzn.js`](../scripts/pzn.js) and [`scripts/exp.js`](../scripts/exp.js).
This worker does **no decisioning** and does **not** proxy or transform page HTML.
It is a thin, authenticated proxy: it takes the client's request, attaches the
secret API key, calls Intuit's backend, and returns a normalized decision. Every
failure mode degrades to "no personalization" so the client shows the baseline.

```
browser (scripts/pzn.js, scripts/exp.js)
   │  POST /api/pzn           GET /api/ixp
   ▼
Akamai ──/api/*──▶ intuit-edge worker ──▶ Decision Engine / IXP Assignment API
   │
   └── everything else ─────▶ aem.live (pages, fragments)
```

## Endpoints

### `POST /api/pzn` — Decision Engine batch personalization

Batch-personalizes a page's slots. The client collects each `pzn-<placement>`
slot on the page and sends the placements; the worker attaches the key, derives
the shared visitor attributes, calls the Batch endpoint, and returns one decision
per **personalized** slot (unpersonalized slots are omitted).

Request body:

```json
{ "slots": [{ "placement": "sbsegqbm…", "experience": "marketing" }], "path": "/optional/page/path" }
```

Response — one entry per personalized slot (empty array on no slots / no ivid /
failure):

```json
[{ "placement": "sbsegqbm…", "action": "replace", "fidelity": "block", "fragment": "fragments/pzn/slot1" }]
```

### `GET /api/ixp` — IXP experiment assignment

Resolves a whole-page or block experiment. The client supplies the experiment
identity from page metadata; the worker attaches the key, calls the IXP Assignment
API, and returns the first assignment that maps to a change.

Query params: `experimentId` **or** `label` (required), plus optional `fidelity`
(default `page`), `path`, `application`, `businessUnit`, `country`.

Response — a decision, or the control (baseline) arm:

```json
{ "action": "replace", "fidelity": "page", "fragment": "/variation/path" }
{ "control": true }
```

### `ivid`

Both endpoints read the visitor id from the `ivid` cookie, overridable by an
`?ivid=` query param for demo/QA. The worker never mints an ivid; when it is
absent there is nothing to personalize (empty / control response).

## Request guard

Every `/api/*` request passes through [`src/api/guard.js`](src/api/guard.js):

1. **Origin allowlist** — same-origin, `*.intuit.com`, `*.aem.live`, `*.aem.page`,
   or a missing `Origin` header (same-origin / non-browser) pass. A present but
   disallowed origin gets `403`. Credentialed CORS headers are emitted for allowed
   cross-origin requests. (An `Origin`/`Referer` check is spoofable by a
   non-browser caller — the real boundary is the shared secret below.)
2. **Shared secret** — when `EDGE_AUTH_SECRET` is set, requests must carry a
   matching `x-edge-auth` header (injected by Akamai on the `/api/*` route).
   Unset ⇒ the check is skipped, so it activates with no code change.

## Source layout

```
src/
  index.js            entry: routes /api/* to the router; everything else 404s
  api/
    router.js         guard → CORS preflight → dispatch → CORS merge
    pzn.js            POST /api/pzn handler
    ixp.js            GET  /api/ixp handler
    guard.js          origin allowlist + EDGE_AUTH_SECRET gate + CORS
    http.js           json() + refererPath() helpers
  ivid.js             reads the ivid (cookie / ?ivid= override)
  visitor.js          per-visitor signals derived at the edge (geo, lang, device)
  pzn/
    batch-client.js   Decision Engine "Batch" HTTP client (Intuit_APIKey auth)
    resolve.js        attributes builder + batch-response → decision mapping
  ixp/
    client.js         IXP Assignment API HTTP client (Intuit_APIKey auth)
    resolve.js        assignment → decision mapping
```

## Configuration

Set in [`wrangler.jsonc`](wrangler.jsonc) `vars` (config only — **no secrets**):

- `PERSONALIZATION_BATCH_URL` — Intuit Personalization "Batch" endpoint (`/api/pzn`).
- `IXP_ASSIGNMENT_URL` — Intuit IXP Assignment API host (`/api/ixp`).

### Secrets

API keys are **Wrangler secrets** — stored server-side in Cloudflare, attached to
the `intuit-edge` worker, set **out of band** (never in `wrangler.jsonc`, the repo,
or the pipeline) and persisted across deploys. Set each **once** (again only to
rotate).

| secret            | used by    | without it                                                        |
|-------------------|------------|-------------------------------------------------------------------|
| `PZN_API_KEY`     | `/api/pzn`  | batch client returns `null` → empty decision array (no personalization) |
| `IXP_API_KEY`     | `/api/ixp` | assignment request is unauthenticated → control (baseline)        |
| `EDGE_AUTH_SECRET`| the guard  | the `x-edge-auth` shared-secret check is **skipped** (allowlist only) |

> ⚠️ A missing key does not fail the deploy or throw at runtime — the flow degrades
> to "no personalization". A worker with no `PZN_API_KEY` deploys "green" but
> personalizes nothing.

```bash
wrangler secret put PZN_API_KEY     # prompts for the value; paste the key
wrangler secret put IXP_API_KEY
wrangler secret put EDGE_AUTH_SECRET # optional; enables the shared-secret gate
wrangler secret list                # names only, never values
```

For **local** `wrangler dev`, remote secrets are not read — put keys in a
git-ignored `.dev.vars` file in `edge/`:

```
PZN_API_KEY=…
IXP_API_KEY=…
# EDGE_AUTH_SECRET=…   # optional; set to exercise the shared-secret gate locally
```

## Develop, lint & test

```bash
npm install
npm run lint      # eslint (airbnb-base)
npm test          # vitest (guard, router, /api/pzn, /api/ixp, mapping helpers, ivid)
npm run dev       # wrangler dev on http://127.0.0.1:8787
```

Exercise the endpoints locally (needs the keys in `.dev.vars`):

```bash
# personalization decision for a slot
curl -s 'http://127.0.0.1:8787/api/pzn?ivid=demo-visitor-2' \
  -H 'content-type: application/json' \
  -d '{"slots":[{"placement":"SBSEGQBMContentAemPznIxpTest"}],"path":"/drafts/pzn/treatment"}'

# experiment assignment
curl -s 'http://127.0.0.1:8787/api/ixp?experimentId=385944&ivid=demo-visitor-2'
```

## Deploy

**Code + vars** deploy automatically. Pushes to `main` that touch `edge/**` run
[`.github/workflows/deploy-edge-worker.yaml`](../.github/workflows/deploy-edge-worker.yaml):
a `verify` job (lint + tests) then a `deploy` job (`wrangler deploy`, needs the
`CLOUDFLARE_API_TOKEN` repo secret). PRs run `verify` only — they **never** deploy.

```bash
npm run deploy    # wrangler deploy; needs `wrangler login` or CLOUDFLARE_API_TOKEN
```

`wrangler deploy` uploads the **code and the `vars`** from `wrangler.jsonc` — it
does **not** set secrets. The API keys must already exist on the worker (see
[Secrets](#secrets)); because they persist across deploys, that is a one-time
setup per key.
