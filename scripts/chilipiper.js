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

// Post-Marketo handoff: submit the lead to `router`, handing ChiliPiper the same xref that went to
// the Marketo hidden field + lead track so the booking correlates. Matches erp.intuit.com's call —
// `map:false` (lead passed explicitly, not auto-mapped), `disableRelation`, and the xref event.
export async function submitChiliPiper(router, lead) {
  const leadObj = {
    Lead_XRef_ID__c: lead.Lead_XRef_ID__c,
    FirstName: lead.FirstName || '',
    LastName: lead.LastName || '',
    Email: lead.Email || '',
    Phone: lead.Phone || '',
    Country: lead.Country || '',
    Number_of_Employees__c: lead.NumberOfEmployees || '',
    Language: lead.Language__c || ''
  };
  const cfg = await chilipiperConfig();
  const subdomain = cfg['chilipiper.subdomain'];
  if (!router || !subdomain) return false;
  const cp = await ensureChiliPiper(cfg);
  if (!cp?.submit) return false;
  cp.submit(subdomain, router, {
    map: false,
    leadObj,
    disableRelation: true,
    event: { Lead_XRef_ID__c: lead.Lead_XRef_ID__c },
  });
  return true;
}

