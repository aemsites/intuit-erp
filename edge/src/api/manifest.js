/**
 * GET /api/pzn-manifest.json — client-driven Decision Engine personalization,
 * expressed as an aem-experimentation **Audience Manifest**.
 *
 * The aem-experimentation plugin fetches this path (via the page's `Audience
 * Manifest` metadata) and applies each row: for the resolved `remote` audience it
 * swaps the row's `selector` with the fragment at `url`. The decision is Intuit's
 * — the worker attaches the secret key, reads the visitor `ivid` from the cookie,
 * runs the Decision Engine "Batch" flow for the page's slots (reusing the same
 * resolvers as the SSR flow), and emits one row per personalized slot.
 *
 * The page path comes from the `Referer` (the plugin fetches `url.pathname` only,
 * dropping any query string), with a `?path=` override for QA. Never edge-cached
 * (`no-store`) — the decision is per-visitor. Empty `data` (no ivid / page not
 * enrolled / DE failure) leaves the page exactly as authored.
 */

import { fetchBatch } from '../de/batch-client.js';
import { mockBatch, SEGMENTS, offerForSegment } from '../de/mock.js';
import { buildAttributes, entryForSlot, slotEntryToPznEntry } from '../de/resolve.js';
import { resolveDeClientRoute } from '../de/routes.js';
import { readIvid } from '../ivid.js';
import { json, refererUrl } from './http.js';

const NO_STORE = { 'cache-control': 'no-store' };
const emptyManifest = () => json({ data: [] }, { headers: NO_STORE });

export async function handleManifest(request, env) {
  const url = new URL(request.url);
  const ref = refererUrl(request);
  // The plugin fetches the manifest path with no query (it uses `url.pathname`),
  // so the page comes from the Referer; `?path=` is a QA/testing override.
  const page = url.searchParams.get('path') || ref?.pathname || '/';

  const route = resolveDeClientRoute(page);
  if (!route) return emptyManifest();

  // Preview round-trip: when the AEM Sidekick panel forces a known segment, the
  // page URL carries `?audience=<segment>`. The plugin strips the manifest query,
  // so read it from the Referer — and return THAT segment's offer, enumerated as
  // that audience, so the forced variant renders instead of the per-visitor
  // decision. (`?audience=` on the manifest request itself is honored too, for QA.)
  const forced = url.searchParams.get('audience') || ref?.searchParams.get('audience');
  if (forced && SEGMENTS.includes(forced)) {
    const data = route.slots.map((slot) => ({
      page,
      audience: forced,
      selector: `.${slot.location}`,
      url: `/${offerForSegment(forced)}`,
    }));
    return json({ data }, { headers: NO_STORE });
  }

  const ivid = readIvid(request);
  if (!ivid) return emptyManifest();

  const attributes = buildAttributes(request, ivid, page);
  const response = env.DE_MOCK === 'enabled'
    ? mockBatch({ slots: route.slots, attributes })
    : await fetchBatch(env, { slots: route.slots, attributes });
  if (!response) return emptyManifest();

  const data = [];
  for (const slot of route.slots) {
    const entry = slotEntryToPznEntry(entryForSlot(response, slot), slot, page);
    if (entry) {
      // DE returns `copyData.pznblock` (e.g. `fragments/pzn/slot1-hospitality`);
      // the plugin resolves the manifest `url` against the origin, so make it a
      // root-relative path.
      const fragmentUrl = entry.fragment.startsWith('/') ? entry.fragment : `/${entry.fragment}`;
      data.push({
        page,
        audience: 'remote',
        selector: `.${entry.location}`,
        url: fragmentUrl,
      });
    }
  }
  return json({ data }, { headers: NO_STORE });
}
