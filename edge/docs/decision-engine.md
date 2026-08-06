# Decision Engine — personalization flow (`PZN_SOURCE=de`)

How the edge worker personalizes a page's slots from Intuit's **Decision Engine
"Batch" endpoint**, enriched by a **ZoomInfo/3P** visitor-context lookup. This is
"use case 2" from the Aug 5 Intuit session; "use case 1" (experimentation / A-B)
is the separate IXP flow — see [ixp-integration.md](ixp-integration.md).

Like the other sources, the Decision Engine resolver produces the worker's
existing `PznEntry` shape, so the offer-fetch + DOM-inject path is unchanged. The
only new capability is **multiple entries per request** — one per personalized
slot — applied in a loop in [`src/index.js`](../src/index.js).

Selected by `PZN_SOURCE=de`, or per-request with `?pzn=de`.

## Flow (de mode)

Per request, in [`src/de/resolve.js`](../src/de/resolve.js) → `resolveDeEntries`:

1. **Route lookup** — [`resolveDeRoute(path)`](../src/de/routes.js). Not enrolled
   → `[]` → passthrough. The table holds the site knowledge the API lacks: which
   slots a page has, and the `{ placement, experience }` each maps to.
2. **Read the ivid** — the `ivid` cookie, overridable by `?ivid=` for demo/QA.
   Absent → `[]` → passthrough.
3. **ZoomInfo/3P** — [`fetchVisitorContext`](../src/de/zoominfo.js) reads
   `ZOOMINFO_URL` and pulls the primary `industry` from the
   `marketingProfile.zoominfo.attributes[]` list. Failure → no industry (the
   batch falls back to its default variant).
4. **Build attributes** — `ivid`, `locale`, `deviceType`, geo (from
   [`visitor.js`](../src/visitor.js)), and `industry` — mirrors the spec's
   `attributes` object.
5. **Batch call** — [`fetchBatch`](../src/de/batch-client.js) builds the faithful
   request (`batchItems` + `attributes`) and reads the decision.
6. **Map each slot** — a placement with `status: 200` and a
   `copyData.contentId` becomes a block-replace `PznEntry` at the slot; `status:
   204` (no recommendation) leaves the slot as authored.

Every failure degrades to a passthrough — personalization never breaks the page.
The worker still does **no decisioning**; the Decision Engine decides, this only
renders it.

## Mapping: batch response → PznEntry

| batch response entry                                  | `PznEntry`                                                              |
|-------------------------------------------------------|-------------------------------------------------------------------------|
| `status: 200` + `data.recommendations[0].copyData.contentId` | `{ location: slot, fragment: contentId, action: "replace", fidelity: "block" }` |
| `status: 204` (fallback) / missing contentId          | *skipped* → slot left as authored                                       |

`contentId` is the content reference. In the real service it is an opaque CMS id;
in this **mock it is an EDS fragment path** (Amol: "basically a path to content —
fragments in EDS"), so the existing `.plain.html` offer-fetch renders it
end-to-end. A real integration would add a `contentId → fragment` lookup here.

## Mocks — static JSON on the EDS origin (synthetic)

The ZoomInfo and Batch services are mocked as static JSON files committed in the
content repo and served from `main--intuit-erp--aemsites.aem.live`. **All values
are synthetic** (no customer data); the field shapes match the shared PDF.

- `pzn/zoominfo/context.json` — visitor context; `zi_c_industry_primary: "Hospitality"`.
- `pzn/de/batch-hospitality.json` — industry variant: both slots personalized (200).
- `pzn/de/batch-default.json` — fallback variant: slot-1 (200), slot-2 (204).

The batch client selects the variant by industry:
`DECISION_ENGINE_BATCH_URL/batch-<industry-slug>.json`, falling back to
`batch-default.json`. Swap both URLs for the real services later — nothing else
in the worker changes.

## Configuration

Added to [`wrangler.jsonc`](../wrangler.jsonc) `vars`:

- `ZOOMINFO_URL` — visitor-context endpoint (mock JSON on the origin).
- `DECISION_ENGINE_BATCH_URL` — base dir the batch client reads
  `batch-<industry>.json` from.

## Enrolling a page

Add a row to [`DE_ROUTES`](../src/de/routes.js):

```js
'/your/path': {
  slots: [
    { location: 'slot-1', placement: 'CGTTCOMMContentTTLCTY255044', experience: 'ttcom' },
    { location: 'slot-2', placement: 'CGTTCOMMContentTTLCTY255044Modal', experience: 'ttcom' },
  ],
},
```

The page must author each slot as a block whose name yields the slot class — a
block "Slot 1" renders as `<div class="slot-1">` (EDS `toClassName`).

## Demo

```bash
npm run dev   # http://127.0.0.1:8787
# industry visitor → both slots personalized (from batch-hospitality.json)
curl -s 'http://127.0.0.1:8787/drafts/pzn/treatment?pzn=de&ivid=4da9a4fd-a731-46e5-8a55-24485bfec474'
# no ivid → baseline passthrough
curl -s 'http://127.0.0.1:8787/drafts/pzn/treatment?pzn=de'
```

> The demo pages/fragments (`/drafts/pzn/treatment`, `/fragments/pzn/*`) and the
> static mock JSON must be reachable at the aem.live origin as `.plain.html` /
> static files. Confirm whether each is authored as EDS content (preview/publish)
> or a code-repo static file (like the existing `/pzn/map.json`); this affects
> *where* the asset is authored, not the worker.

## Tests

[`test/de-resolve.spec.js`](../test/de-resolve.spec.js): route lookup,
`buildBatchRequest`, ZoomInfo industry parse, `resolveDeEntries`
(200→entry, 204→skip, default-variant fallback, no-ivid/unenrolled passthrough),
and end-to-end through the worker in de mode (both slots filled, 204 slot left
untouched, cookie ivid, no-ivid passthrough).
