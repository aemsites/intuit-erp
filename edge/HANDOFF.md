# Handoff — intuit-edge

Server-side personalization edge worker + aem.live CDN proxy in front of
`main--intuit-erp--aemsites.aem.live`. Vanilla JS, single deployable worker.
Full details in [README.md](README.md). Deep-dives:
[docs/ixp-mock.md](docs/ixp-mock.md), [docs/ixp-integration.md](docs/ixp-integration.md).

## What it does

- **aem.live proxy** — port redirect, RUM/optel guard, query-param sanitization,
  `x-forwarded-host` / `x-byo-cdn-type` / `x-push-invalidation` headers,
  `cacheEverything`, and 301/304/`age`/`x-robots-tag` response cleanup. Mirrors
  `adobe/aem-cloudflare-prod-worker` so a real domain can be pointed at it later.
- **`.json` 404 fallback** — a `.json` path the origin 404s falls back to
  `mhast-html-to-json.adobeaem.workers.dev/aemsites/intuit-erp` (forwards
  `head`/`preview`/`compact`). No path exclusions.
- **Personalization** — resolves an entry from `map` / `ixp` / `mock`
  (`PZN_SOURCE`, or `?pzn=` per request), fetches the offer fragment, injects it,
  and merges the fragment's cache keys into the response.
- **In-worker IXP mock** — served at `/v2/assignment` (was a separate worker;
  now a route). `IXP_ASSIGNMENT_URL` self-calls it so `?pzn=ixp` works with no key.

## Verified

- `npm run lint` — clean (eslint airbnb-base).
- `npm test` — **56 pass** across 3 files (map flow, aem.live proxy behaviors,
  `.json`→mhast fallback, cache-key merge, full IXP mock contract + A/B split,
  assignment→entry mapping, `?pzn=` overrides, in-process mock source, and the
  consolidated `/v2/assignment` route).
- Local `wrangler dev` smoke test against the real origin: proxy passthrough, the
  `/us/v2/assignment` route, personalization (both arms), `.json`→mhast fallback,
  the fragment cache-tag propagated onto the page response, and the `?pzn=ixp`
  self-call — all working end-to-end.

## Run / test / deploy

```bash
npm install
npm run lint
npm test
npm run dev          # http://127.0.0.1:8787

# no-key demo (recommended): ?pzn=mock resolves the IXP mock in-process. 39002 is
# a 50/50 split — demo-visitor-2/-3 = treatment (offer), demo-visitor-1/-9 = control.
curl -s 'http://127.0.0.1:8787/drafts/suresh/pzn?pzn=mock&ivid=demo-visitor-2' | grep -c 'Automate the routine'  # -> 1
# ?pzn=ixp runs the same flow over HTTP against the in-worker /us/v2/assignment route.

# map mode (default source) swaps on /drafts/pzn, which has slot-1:
curl -s 'http://127.0.0.1:8787/drafts/pzn' | grep -c 'Automate the routine'  # -> 1

npm run deploy       # needs `wrangler login` or CLOUDFLARE_API_TOKEN
```

Pushes to `main` touching `edge/**` deploy via
[.github/workflows/deploy-edge-worker.yaml](../.github/workflows/deploy-edge-worker.yaml).

## Open items

1. **`CLOUDFLARE_API_TOKEN` repo secret** — required for the CI deploy job. Add it
   in GitHub repo settings.
2. **Real IXP key + host** — the mock uses `dev-ixp-key`. Get a real key, set
   `IXP_API_KEY` as a Wrangler secret, and point `IXP_ASSIGNMENT_URL` at
   `experimentation[-preview].us.api.intuit.com`. The real API also expects
   `application`/`businessUnit` — add them to the client params then.
3. **Map-mode coverage** — the live `/pzn/map.json` targets `/` and
   `/construction` (slot-1/slot-2) which are **not** authored with those slots, so
   those pass through; `/drafts/pzn` **does** have slot-1 and swaps. To demo map
   mode on more pages, author the slot blocks there or point `location` at an
   existing block.
4. **Before a real domain** — revisit the omitted `/drafts/` 404 block and the
   audience-keyed HTML cache question (README "Open question: caching").

## Extension seams

- **Real pzn service:** replace `fetchMap` in [src/pzn.js](src/pzn.js).
- **Real IXP host:** swap `IXP_ASSIGNMENT_URL` + `IXP_API_KEY`.
- **JSON offers → json2html:** the marked seam in `resolveOfferMarkup`
  ([src/pzn.js](src/pzn.js)).
