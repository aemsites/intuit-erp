/**
 * Shared ChiliPiper opener. Loads ChiliPiper's marketing.js once and either opens the
 * scheduler (openChiliPiper) or submits a mapped lead (submitChiliPiper) for a given
 * router. Subdomain + script URL come from /site-config.json — never hardcoded per page.
 *
 * Used by the form block (bookDemo + post-Marketo handoff) and by personalization widgets
 * that open ChiliPiper on a trigger click, so it lives in scripts/ (not a block) to avoid a
 * block-depends-on-block edge.
 */
import { loadScript } from './aem.js';

const CHILIPIPER_SRC_DEFAULT = '//js.chilipiper.com/marketing.js';

// getSiteConfig lives in scripts.js; import it dynamically so this module (pulled into
// scripts.js's graph via the form block) doesn't form a static cycle.
async function chilipiperConfig() {
  // eslint-disable-next-line import/no-cycle
  const { getSiteConfig } = await import('./scripts.js');
  return getSiteConfig();
}

async function ensureChiliPiper(cfg) {
  await loadScript(cfg['chilipiper.src'] || CHILIPIPER_SRC_DEFAULT);
  return window.ChiliPiper;
}

// A per-lead correlation id ChiliPiper/CRM can join on. Published on window for
// downstream trackers (mirrors the OICMS snippet's window.chilipiperLeadXrefId).
export function leadXrefId() {
  const id = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `xref-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  window.chilipiperLeadXrefId = id;
  return id;
}

// Opens the ChiliPiper scheduler for `router` (no Marketo form). Sets a fresh
// lead_xref_id on window for the page's trackers. Returns false when misconfigured.
export async function openChiliPiper(router, { title = document.title } = {}) {
  const cfg = await chilipiperConfig();
  const subdomain = cfg['chilipiper.subdomain'];
  if (!router || !subdomain) return false;
  const cp = await ensureChiliPiper(cfg);
  if (!cp?.scheduling) return false;
  leadXrefId();
  cp.scheduling(subdomain, router, { title });
  return true;
}

// Post-Marketo handoff: submit a lead to `router` (map:true prefills from the mapped form).
export async function submitChiliPiper(router, lead) {
  const cfg = await chilipiperConfig();
  const subdomain = cfg['chilipiper.subdomain'];
  if (!router || !subdomain) return false;
  const cp = await ensureChiliPiper(cfg);
  if (!cp?.submit) return false;
  cp.submit(subdomain, router, { map: true, lead });
  return true;
}
