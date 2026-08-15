/**
 * form — live lead-capture form: a Marketo Forms2 embed (fields rendered by
 * Marketo) followed by a ChiliPiper router handoff on success. Also owns the
 * shared "Schedule a call" modal (openScheduleModal/bindScheduleLinks) and the
 * ChiliPiper-only demo booking (bookDemo).
 *
 * Per-page config rows (author): formId, chiliPiperRouter, downloadUrl,
 * successUrl, header, subheader, disclaimer. Site-wide values (munchkin,
 * chilipiper subdomain, script URLs) come from /site-config.json via
 * getSiteConfig() — never authored per page, never hardcoded.
 *
 * CSS: blocks/form/form.css
 */
import { loadScript } from '../../scripts/aem.js';
// Vendored via git subtree at plugins/martech (see its README), not an
// installed npm package, so this necessarily crosses a package.json boundary.
// eslint-disable-next-line import/no-relative-packages
import { sendEvent } from '../../plugins/martech/src/index.js';
import { OF1_SIGNAL } from '../../scripts/of1-rtcdp-signal.js';

const CONFIG_KEYS = [
  'formId',
  'chiliPiperRouter',
  'downloadUrl',
  'successUrl',
  'header',
  'subheader',
  'disclaimer',
];

const CHILIPIPER_SRC_DEFAULT = '//js.chilipiper.com/marketing.js';
const SCHEDULE_FRAGMENT = '/fragments/schedule-call';

// getSiteConfig lives in scripts.js; import it dynamically so this block (which
// scripts.js's graph pulls in for the schedule modal) doesn't form a static cycle.
async function siteConfig() {
  // eslint-disable-next-line import/no-cycle
  const { getSiteConfig } = await import('../../scripts/scripts.js');
  return getSiteConfig();
}

export function parseFormConfig(block) {
  const found = {};
  [...block.querySelectorAll(':scope > div')].forEach((row) => {
    const [keyCell, valueCell] = row.children;
    const key = keyCell?.textContent.trim();
    if (key && CONFIG_KEYS.includes(key)) {
      // disclaimer keeps inline markup (e.g. the Privacy Statement link); others are plain text
      if (!valueCell) found[key] = undefined;
      else found[key] = key === 'disclaimer' ? valueCell.innerHTML.trim() : valueCell.textContent.trim();
    }
  });
  return {
    formId: found.formId,
    chiliPiperRouter: found.chiliPiperRouter,
    downloadUrl: found.downloadUrl,
    successUrl: found.successUrl,
    header: found.header,
    subheader: found.subheader,
    disclaimer: found.disclaimer,
  };
}

// Basic shape check — enough to gate the identity send without over-validating
// (demo lead form; not an auth boundary).
export function isValidBusinessEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// Maps lead fields → an identity sendEvent XDM. Email goes in identityMap as
// 'ambiguous' (unverified). Pure — no DOM/network.
export function buildIdentityXdm(fields) {
  return {
    eventType: 'web.formFilledOut',
    identityMap: {
      Email: [{ id: fields.email, primary: true, authenticatedState: 'ambiguous' }],
    },
    [OF1_SIGNAL.prefix]: {
      [OF1_SIGNAL.object]: { lead: { ...fields }, capturedAt: new Date().toISOString() },
    },
  };
}

// Provider-aware submit tracking. `window.utag` only ever exists when scripts/scripts.js chose
// the Tealium provider (the default) AND that instance is enabled — i.e. the hostname resolves
// to a utag environment (see plugins/tealium-martech/src/index.js `resolveEnvironment`). The
// Adobe path below only runs when the opt-in `?martech=adobe` override is used, unchanged.
export function trackFormSubmit(fields) {
  if (window.utag?.link) {
    // Consent-gate, like the loader's whenConsentResolved: a link fired while getConsentState()===0
    // enqueues and can re-trigger the ies-erp processQueue<->setPreferencesValues recursion. A
    // one-shot check is enough at submit time — on prod consent is long resolved; on a stuck-at-0
    // host it drops rather than loops.
    if (window.utag.gdpr?.getConsentState?.() === 0) return;
    window.utag.link({
      tealium_event: 'form_submit',
      ...fields,
      ivid: window.utag_data?.ivid,
    });
    return;
  }
  sendEvent({ xdm: buildIdentityXdm(fields) }).catch(() => {});
}

// Marketo field names → the lower-cased lead shape trackFormSubmit expects, so
// the same analytics events fire on a live submit as on the former mock.
function marketoValuesToLead(vals = {}) {
  return {
    email: vals.Email || '',
    firstName: vals.FirstName || '',
    lastName: vals.LastName || '',
    businessName: vals.Company || '',
    phone: vals.Phone || '',
  };
}

async function chiliPiperHandoff(cfg, router, form) {
  const subdomain = cfg['chilipiper.subdomain'];
  if (!router || !subdomain) return false;
  await loadScript(cfg['chilipiper.src'] || CHILIPIPER_SRC_DEFAULT);
  window.ChiliPiper?.submit(subdomain, router, { map: true, lead: form.getValues() });
  return true;
}

async function embedMarketoForm(formEl, cfg, config) {
  const munchkin = cfg['marketo.munchkin'];
  if (!munchkin) return;
  const host = `//${munchkin.toLowerCase()}.mktoweb.com`;
  const forms2Src = cfg['marketo.forms2Src'] || `${host}/js/forms2/js/forms2.min.js`;
  await loadScript(forms2Src);
  window.MktoForms2.loadForm(host, munchkin, config.formId, (form) => {
    // Place the disclaimer between the fields and Marketo's submit button
    // (matches erp.intuit.com), preserving its Privacy Statement link.
    const btnRow = formEl.querySelector('.mktoButtonRow');
    if (config.disclaimer && btnRow) {
      const el = document.createElement('div');
      el.className = 'form-disclaimer';
      el.innerHTML = config.disclaimer;
      btnRow.parentNode.insertBefore(el, btnRow);
    }
    form.onSuccess((vals) => {
      try { trackFormSubmit(marketoValuesToLead(vals)); } catch (e) { /* non-fatal */ }
      chiliPiperHandoff(cfg, config.chiliPiperRouter, form);
      if (config.downloadUrl) window.open(config.downloadUrl, '_blank', 'noopener');
      else if (config.successUrl && !config.chiliPiperRouter) {
        window.location.href = config.successUrl;
      }
      // Suppress Marketo's default redirect — ChiliPiper / download / successUrl takes over.
      return false;
    });
  });
}

export default async function decorate(block) {
  const config = parseFormConfig(block);
  if (!config.formId) {
    block.replaceChildren();
    return;
  }
  if (config.downloadUrl) block.classList.add('download');

  const children = [];
  if (config.header) {
    const el = document.createElement('h3');
    el.className = 'form-header';
    el.textContent = config.header;
    children.push(el);
  }
  if (config.subheader) {
    const el = document.createElement('p');
    el.className = 'form-subheader';
    el.textContent = config.subheader;
    children.push(el);
  }
  const form = document.createElement('form');
  form.id = `mktoForm_${config.formId}`;
  children.push(form);
  block.replaceChildren(...children);

  const cfg = await siteConfig();
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      observer.disconnect();
      embedMarketoForm(form, cfg, config);
    }
  });
  observer.observe(block);
}

// Shared "Schedule a call" modal — hosts the schedule-call fragment (which
// authors its own form block) in the reusable modal block.
export async function openScheduleModal() {
  // eslint-disable-next-line import/no-cycle
  const { openModal } = await import('../modal/modal.js');
  return openModal(SCHEDULE_FRAGMENT);
}

// Any anchor whose href ends with #schedule opens the modal instead of
// navigating — covers both `#schedule` and stray absolute URLs ending in it.
export function bindScheduleLinks(container) {
  container.querySelectorAll('a[href$="#schedule"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openScheduleModal();
    });
  });
}

// Book-a-demo: ChiliPiper scheduler directly (no Marketo form). Router is the
// only per-page value; subdomain/script come from /site-config.json.
export async function bookDemo(router) {
  const cfg = await siteConfig();
  const subdomain = cfg['chilipiper.subdomain'];
  if (!router || !subdomain) return;
  await loadScript(cfg['chilipiper.src'] || CHILIPIPER_SRC_DEFAULT);
  window.ChiliPiper?.scheduling(subdomain, router, { title: document.title });
}
