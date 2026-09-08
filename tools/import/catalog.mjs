/**
 * catalog.mjs — resolve source CTA promos and fixed shared content to the DA
 * `fragment` references that already exist in the repo.
 *
 * Ground truth: the migrated DA pages reference a *curated* set of media-promo
 * fragments (content/fragments/media-promo/<id>.html) rather than inlining the
 * source's media-text CTAs. Each promo fragment is a media-text block built from
 * one of the source CTA images, so the mapping is deterministic by image asset
 * basename (verified: cta-2-introducing-ies-image-us-en.jpg -> c21d6r8ia, etc.).
 * We never invent an id — an unmatched CTA falls back to an inline media-text
 * block in the caller.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { JSDOM } from 'jsdom';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MEDIA_PROMO_DIR = join(REPO_ROOT, 'content', 'fragments', 'media-promo');

/** Fully-qualified fragment host the DA pages use (verbatim). The active site is
 *  erp--intuit (the repo syncs there), and the corpus references fragments on its
 *  .aem.live host — not the stale intuit-erp--aemsites migration domain. */
export const FRAGMENT_BASE = 'https://main--erp--intuit.aem.live/fragments';

/** Trailing shared disclaimer every article carries. */
export const PRICING_DISCLAIMER = `${FRAGMENT_BASE}/pricing-disclaimer`;

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

let cache;

/**
 * Index the media-promo fragments once: asset-basename -> {id, heading}, plus a
 * normalized-heading -> id fallback.
 * @returns {{byAsset: Map<string,object>, byHeading: Map<string,string>, ids: Set<string>}}
 */
export function loadCatalog() {
  if (cache) return cache;
  const byAsset = new Map();
  const byHeading = new Map();
  const ids = new Set();
  let files = [];
  try {
    files = readdirSync(MEDIA_PROMO_DIR).filter((f) => f.endsWith('.html'));
  } catch {
    // no catalog available (e.g. content not pulled) — matcher returns null
    cache = { byAsset, byHeading, ids };
    return cache;
  }
  files.forEach((file) => {
    const id = file.replace(/\.html$/, '');
    ids.add(id);
    const doc = new JSDOM(readFileSync(join(MEDIA_PROMO_DIR, file), 'utf8')).window.document;
    const mt = doc.querySelector('.media-text');
    if (!mt) return;
    const img = mt.querySelector('img[src]');
    if (img) {
      const asset = basename(img.getAttribute('src').split('?')[0]);
      if (asset && !byAsset.has(asset)) byAsset.set(asset, { id, heading: '' });
    }
    // the real heading is the last non-empty h3 (the first h3 wraps the image)
    const heading = [...mt.querySelectorAll('h3')]
      .map((h) => h.textContent.trim())
      .filter(Boolean)
      .pop() || '';
    if (img && byAsset.has(basename(img.getAttribute('src').split('?')[0]))) {
      byAsset.get(basename(img.getAttribute('src').split('?')[0])).heading = heading;
    }
    if (heading) byHeading.set(norm(heading), id);
  });
  cache = { byAsset, byHeading, ids };
  return cache;
}

/**
 * Explicit source-image-basename -> fragment-id overrides, for CTAs the two
 * automatic strategies can't bridge: the media-promo fragment stores a
 * DA-optimized asset (so byAsset never sees the source basename) and the source
 * CTA's heading is a bold <p> rather than an <h3> (so byHeading has nothing to
 * key on). Verified by matching alt text + copy against the fragment.
 *   cta-2-introducing-ies-image-us-en.jpg -> c21d6r8ia
 *     ("Introducing Intuit Enterprise Suite" band; fragment img media_1833…avif)
 */
const CTA_ASSET_OVERRIDES = {
  'cta-2-introducing-ies-image-us-en.jpg': 'c21d6r8ia',
};

/**
 * Resolve a source CTA to a media-promo fragment id.
 * @param {{imageSrc?: string, heading?: string}} cta
 * @returns {{id: string, how: string} | null} match + how it matched, or null
 */
export function matchCta({ imageSrc, heading } = {}) {
  const { byAsset, byHeading, ids } = loadCatalog();
  if (imageSrc) {
    const asset = basename(imageSrc.split('?')[0]);
    const override = CTA_ASSET_OVERRIDES[asset];
    if (override && ids.has(override)) return { id: override, how: `override:${asset}` };
    if (byAsset.has(asset)) return { id: byAsset.get(asset).id, how: `asset:${asset}` };
  }
  if (heading) {
    const key = norm(heading);
    if (byHeading.has(key)) return { id: byHeading.get(key), how: 'heading' };
  }
  return null;
}

/** Fully-qualified URL for a media-promo fragment id. */
export const mediaPromoUrl = (id) => `${FRAGMENT_BASE}/media-promo/${id}`;
