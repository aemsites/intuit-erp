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

// Opens the ChiliPiper scheduler for `router` (no Marketo form). Returns false when misconfigured.
export async function openChiliPiper(router, { title = document.title } = {}) {
  const cfg = await chilipiperConfig();
  const subdomain = cfg['chilipiper.subdomain'];
  if (!router || !subdomain) return false;
  const cp = await ensureChiliPiper(cfg);
  if (!cp?.scheduling) return false;
  cp.scheduling(subdomain, router, { title });
  return true;
}

// A fresh lead-correlation id (SFDC `Lead_XRef_ID__c`). Minted once per form submission and fed
// to three sinks so the lead → booking chain joins up: the Marketo hidden field, the ECS lead
// track (below), and the ChiliPiper `event` (submitChiliPiper).
export function mintLeadXref() {
  return window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `xref-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

// Fires the ECS lead track that the `ies-erp` Tealium container turns into IES_lead (and, after
// ChiliPiper's iframe posts `booking-confirmed`, IES_booking — the container owns that listener).
// No-ops off-intuit, where the Intuit edge doesn't inject `window.intuit.tracking.ecs`. The
// container gates on object+action, a non-empty lead_xref_id, and this exact product family.
export function trackLeadCreated({ leadXrefId, formId } = {}) {
  const wa = window.intuit?.tracking?.ecs?.webAnalytics;
  if (typeof wa?.track !== 'function') return false;
  wa.track({
    object: 'lead',
    action: 'create_submitted',
    lead_xref_id: leadXrefId,
    product_family_of_interest: 'Intuit Enterprise Suite',
    form_id: formId,
  });
  return true;
}

// Post-Marketo handoff: submit the lead to `router`, handing ChiliPiper the same xref that went to
// the Marketo hidden field + lead track so the booking correlates. Matches erp.intuit.com's call —
// `map:false` (lead passed explicitly, not auto-mapped), `disableRelation`, and the xref event.
export async function submitChiliPiper(router, lead, xref = mintLeadXref()) {
  const cfg = await chilipiperConfig();
  const subdomain = cfg['chilipiper.subdomain'];
  if (!router || !subdomain) return false;
  const cp = await ensureChiliPiper(cfg);
  if (!cp?.submit) return false;
  cp.submit(subdomain, router, {
    map: false,
    lead,
    disableRelation: true,
    event: { Lead_XRef_ID__c: xref },
  });
  return true;
}
