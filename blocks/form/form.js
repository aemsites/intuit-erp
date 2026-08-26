/**
 * form — live lead-capture form: a Marketo Forms2 embed (fields rendered by
 * Marketo) followed by a ChiliPiper router handoff on success. Also owns the
 * shared "Schedule a call" modal (openScheduleModal/bindScheduleLinks) and the
 * ChiliPiper-only demo booking (bookDemo).
 *
 * Per-page config rows (author): formId, chiliPiperRouter, downloadUrl,
 * successUrl, header, subheader, disclaimer, recaptcha (per-form v3 opt-in),
 * buttonLabel (overrides Marketo's own hardcoded submit button text).
 * Site-wide values (munchkin, chilipiper subdomain, script URLs, reCAPTCHA
 * site key/verify endpoint) come from /site-config.json via getSiteConfig() —
 * never authored per page, never hardcoded.
 *
 * Marketo instance: production by default. A page opts into a non-prod instance
 * with `marketo: dev` | `marketo: e2e` metadata (no hostname logic), which selects
 * the Munchkin from site-config (marketo.munchkin.dev/.e2e). The Forms2 script URL
 * is generated from the selected Munchkin. `formId` is authored to match whichever
 * instance the page targets (Marketo form ids differ per instance).
 *
 * CSS: blocks/form/form.css
 */
import { loadScript, getMetadata } from '../../scripts/aem.js';
// Vendored via git subtree at plugins/martech (see its README), not an
// installed npm package, so this necessarily crosses a package.json boundary.
// eslint-disable-next-line import/no-relative-packages
import { sendEvent } from '../../plugins/martech/src/index.js';

// Tenant-namespaced XDM location for lead-identity events. Object name `of1Signal` must
// byte-match the AEP "Experience Event Schema" field group path (AEP console config) or
// ingestion silently drops it. Independent of the (removed) OF1 generative-page feature,
// which used to write interest/intent data to this same object.
export const LEAD_XDM_TARGET = { prefix: '_sapphiredemo1', object: 'of1Signal' };

const CONFIG_KEYS = [
  'formId',
  'chiliPiperRouter',
  'downloadUrl',
  'successUrl',
  'header',
  'subheader',
  'disclaimer',
  'recaptcha',
  'buttonLabel',
];

const CHILIPIPER_SRC_DEFAULT = '//js.chilipiper.com/marketing.js';
const SCHEDULE_FRAGMENT_DEFAULT = '/fragments/schedule-call-vertical';

// A page can point the nav "Schedule a call" modal at a different fragment via
// `schedule-fragment` metadata — same override convention as blog-template.js's
// right-rail fragment (bare name resolves under /fragments/, absolute path used as-is).
function scheduleFragmentPath() {
  const value = getMetadata('schedule-fragment') || SCHEDULE_FRAGMENT_DEFAULT;
  return value.startsWith('/') ? value : `/fragments/${value}`;
}

// Marketo instance selection, keyed by the `marketo` page metadata. Prod unless the
// page opts in; hostname is deliberately not consulted.
const MARKETO_MUNCHKIN_KEYS = {
  dev: 'marketo.munchkin.dev',
  e2e: 'marketo.munchkin.e2e',
  prod: 'marketo.munchkin',
};

function marketoEnv() {
  const m = getMetadata('marketo').trim().toLowerCase();
  return m === 'dev' || m === 'e2e' ? m : 'prod';
}

// reCAPTCHA v3 (invisible). erp.intuit.com's own siteverify proxy scores the
// token; enable per form block via the `recaptcha` config row. Runs only on an
// *.intuit.com origin (the endpoint's CORS allowlist) — see setupRecaptcha.
const RECAPTCHA_API_SRC = 'https://www.google.com/recaptcha/api.js';
const RECAPTCHA_DEFAULT_THRESHOLD = 0.3;
const RECAPTCHA_MAX_ATTEMPTS = 3;
const RECAPTCHA_RETRY_MS = 2000;

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
    recaptcha: found.recaptcha === 'true',
    buttonLabel: found.buttonLabel,
  };
}

// Maps lead fields → an identity sendEvent XDM. Email goes in identityMap as
// 'ambiguous' (unverified). Pure — no DOM/network.
export function buildIdentityXdm(fields) {
  return {
    eventType: 'web.formFilledOut',
    identityMap: {
      Email: [{ id: fields.email, primary: true, authenticatedState: 'ambiguous' }],
    },
    [LEAD_XDM_TARGET.prefix]: {
      [LEAD_XDM_TARGET.object]: { lead: { ...fields }, capturedAt: new Date().toISOString() },
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

// reCAPTCHA v3, mirroring erp.intuit.com: on form load fetch a score token and
// verify it via Intuit's siteverify proxy, then gate the Marketo submit on the
// result (Marketo's own captcha is off; the token is never a form field). The
// verify endpoint's CORS allowlist is *.intuit.com, so this is a no-op that
// never blocks a submit anywhere else. Config: per-form `recaptcha` opt-in plus
// site-wide recaptcha.siteKey/verifyUrl/apiKey/scoreThreshold from /site-config.json.
async function setupRecaptcha(cfg, config, form) {
  const siteKey = cfg['recaptcha.siteKey'];
  const verifyUrl = cfg['recaptcha.verifyUrl'];
  const apiKey = cfg['recaptcha.apiKey'];
  if (!config.recaptcha || cfg['recaptcha.enabled'] === false || !siteKey || !verifyUrl || !apiKey) {
    return;
  }
  // Number.isFinite (not `|| default`) so an explicit threshold of "0" is honored.
  const parsed = parseFloat(cfg['recaptcha.scoreThreshold']);
  const threshold = Number.isFinite(parsed) ? parsed : RECAPTCHA_DEFAULT_THRESHOLD;

  // Distinguish "endpoint says bot" (low/invalid score → block) from "endpoint
  // unreachable" (network/CORS → allow, so an outage never drops real leads).
  const verify = async (token) => {
    try {
      const res = await fetch(verifyUrl, {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `response=${encodeURIComponent(token)}`,
      });
      const data = await res.json();
      if (data.success === true) return data.score === undefined || data.score >= threshold;
      return false; // expired/invalid/low-score token — refresh and retry
    } catch (e) {
      return true;
    }
  };

  let verified = false;
  form.onValidate(() => form.submittable(verified));

  await loadScript(`${RECAPTCHA_API_SRC}?render=${siteKey}`);
  let attempts = 0;
  const run = () => window.grecaptcha?.ready(() => {
    window.grecaptcha.execute(siteKey, { action: '' })
      .then(async (token) => {
        verified = await verify(token);
        attempts += 1;
        if (!verified && attempts < RECAPTCHA_MAX_ATTEMPTS) setTimeout(run, RECAPTCHA_RETRY_MS);
      })
      .catch(() => { verified = true; }); // grecaptcha unavailable — don't block leads
  });
  run();
}

function disclaimerBelowFields(formEl) {
  const buttonRow = formEl.querySelector('.mktoButtonRow');
  if (!buttonRow) return false;
  const fieldRows = [...formEl.querySelectorAll('.mktoFormRow')]
    .filter((row) => row.querySelector('input:not([type="hidden"]), select, textarea'));
  if (!fieldRows.length) return false;
  const lastFieldTop = Math.max(...fieldRows.map((row) => row.getBoundingClientRect().top));
  return buttonRow.getBoundingClientRect().top - lastFieldTop > 20;
}

async function embedMarketoForm(formEl, cfg, config, env) {
  // Munchkin for the active instance, falling back to the base (prod) key. The
  // Forms2 script URL is generated from it — one host per Marketo instance.
  const munchkin = cfg[MARKETO_MUNCHKIN_KEYS[env]] || cfg['marketo.munchkin'];
  if (!munchkin) return;
  const host = `//${munchkin.toLowerCase()}.mktoweb.com`;
  const forms2Src = `${host}/js/forms2/js/forms2.min.js`;
  await loadScript(forms2Src);
  window.MktoForms2.loadForm(host, munchkin, config.formId, (form) => {
    if (config.disclaimer) {
      const el = document.createElement('div');
      el.className = 'form-disclaimer';
      el.innerHTML = config.disclaimer;
      const buttonRow = formEl.querySelector('.mktoButtonRow');
      // `disclaimer-below` variant forces the disclaimer under the submit button
      const below = formEl.closest('.form')?.classList.contains('disclaimer-below');
      if (buttonRow && below) {
        buttonRow.after(el);
      } else if (buttonRow && disclaimerBelowFields(formEl)) {
        formEl.insertBefore(el, buttonRow);
      } else {
        formEl.parentNode.insertBefore(el, formEl);
      }
    }
    // Marketo forms ship with their own hardcoded button text (e.g. "Watch Now"
    // on a form template built for webinars); override it per-page when the
    // form is reused in a context that needs different copy.
    if (config.buttonLabel) {
      const button = formEl.querySelector('.mktoButton');
      if (button) button.textContent = config.buttonLabel;
    }
    setupRecaptcha(cfg, config, form);
    // A ChiliPiper handoff only actually fires when both router (authored) and
    // subdomain (site-config) are present; decide synchronously so onSuccess can
    // fall back to Marketo's own thank-you if ChiliPiper is misconfigured.
    const canHandoff = !!(config.chiliPiperRouter && cfg['chilipiper.subdomain']);
    form.onSuccess((vals) => {
      try { trackFormSubmit(marketoValuesToLead(vals)); } catch (e) { /* non-fatal */ }
      if (canHandoff) chiliPiperHandoff(cfg, config.chiliPiperRouter, form);
      if (config.downloadUrl) window.open(config.downloadUrl, '_blank', 'noopener');
      else if (config.successUrl && !canHandoff) window.location.href = config.successUrl;
      // Suppress Marketo's default redirect only when we provide our own feedback
      // (ChiliPiper / download / successUrl). Otherwise let Marketo show its
      // thank-you so a misconfigured handoff never leaves the visitor with nothing.
      const handled = canHandoff || !!config.downloadUrl || !!config.successUrl;
      return !handled;
    });
  });
}

export default async function decorate(block) {
  // blocks/modal/modal.js clones + force-redecorates cached fragments, so this can run
  // twice; the 2nd pass sees the <form> shell from the 1st, not the original config rows.
  const stashedConfig = block.dataset.formConfig;
  let config;
  try {
    config = stashedConfig ? JSON.parse(stashedConfig) : parseFormConfig(block);
  } catch (e) {
    config = parseFormConfig(block); // corrupt stash — fall back rather than throw
  }
  if (!config.formId) {
    block.replaceChildren();
    return;
  }
  if (!stashedConfig) block.dataset.formConfig = JSON.stringify(config);
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
  const env = marketoEnv();
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      observer.disconnect();
      embedMarketoForm(form, cfg, config, env);
    }
  });
  observer.observe(block);
}

// Shared "Schedule a call" modal — hosts the schedule-call fragment (which
// authors its own form block) in the reusable modal block.
export async function openScheduleModal() {
  // eslint-disable-next-line import/no-cycle
  const { openModal } = await import('../modal/modal.js');
  return openModal(scheduleFragmentPath());
}

// Any anchor whose href ends with #schedule opens the modal instead of
// navigating — covers both `#schedule` and stray absolute URLs ending in it.
// Called from multiple content-injection points (initial page load, fragments,
// modals), so it's idempotent: a `data-schedule-bound` flag skips anchors that
// already have the listener rather than double-binding them.
export function bindScheduleLinks(container) {
  container.querySelectorAll('a[href$="#schedule"]:not([data-schedule-bound])').forEach((a) => {
    a.dataset.scheduleBound = 'true';
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
