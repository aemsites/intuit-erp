/**
 * form — live lead-capture form: a Marketo Forms2 embed (fields rendered by
 * Marketo) followed by a ChiliPiper router handoff on success. Also owns the
 * ChiliPiper-only demo booking (bookDemo). The shared "Schedule a call" modal
 * lives in scripts/schedule-modal.js.
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
import { loadScript, getMetadata, decorateIcons } from '../../scripts/aem.js';
import { fetchPlaceholders } from '../../scripts/placeholders.js';
import { experienceLog } from '../../scripts/experience.js'

// Uncomment with the AEP/WebSDK integration in scripts/scripts.js.
// // Vendored via git subtree at plugins/martech (see its README), not an
// // installed npm package, so this necessarily crosses a package.json boundary.
// // eslint-disable-next-line import/no-relative-packages
// import { sendEvent } from '../../plugins/martech/src/index.js';

// Shared ChiliPiper opener (also used by personalization widgets).
import {
  openChiliPiper, submitChiliPiper,
} from '../../scripts/chilipiper.js';

import {
  createUUID,
  getCidValue,
  getTrackData,
  buildPageHierarchy,
  getPhCountryCodeForGeo,
  getCookieValue,
} from '../../scripts/utils.js';

// Uncomment with the AEP/WebSDK integration in scripts/scripts.js.
// // Tenant-namespaced XDM location for lead-identity events. Object name `of1Signal` must
// // byte-match the AEP "Experience Event Schema" field group path (AEP console config) or
// // ingestion silently drops it. Independent of the (removed) OF1 generative-page feature,
// // which used to write interest/intent data to this same object.
// export const LEAD_XDM_TARGET = { prefix: '<prefix>', object: 'of1Signal' };

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
  'enableMunchkinTag',
  'munchkinId',
  'leadSource',
  'productFamily',
  'primaryProduct',
  'leadTreatmentName',
  'leadLegacyCampaign',
  'leadCountry',
  'leadCountryCode',
  'leadLanguage',
];

const RICH_TEXT_KEYS = ['header', 'subheader', 'disclaimer'];

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

// reCAPTCHA v3 constants
const RECAPTCHA_API_SRC = 'https://www.google.com/recaptcha/api.js';
const RECAPTCHA_DEFAULT_THRESHOLD = 0.3;
const RECAPTCHA_MAX_ATTEMPTS = 3;
const RECAPTCHA_RETRY_MS = 2000;

// munchkin tag constants
const MUNCHKIN_API_SRC = '//munchkin.marketo.net/munchkin.js';

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
      if (!valueCell) found[key] = undefined;
      else if (RICH_TEXT_KEYS.includes(key)) found[key] = valueCell.innerHTML.trim();
      else found[key] = valueCell.textContent.trim();
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
    enableMunchkinTag: found.enableMunchkinTag === 'true',
    munchkinId: found.munchkinId,
    leadSource: found.leadSource,
    productFamily: found.productFamily,
    primaryProduct: found.primaryProduct,
    leadTreatmentName: found.leadTreatmentName,
    leadLegacyCampaign: found.leadLegacyCampaign,
    leadCountry: found.leadCountry,
    leadCountryCode: found.leadCountryCode,
    leadLanguage: found.leadLanguage,
  };
}

// Uncomment with the AEP/WebSDK integration in scripts/scripts.js.
// // Maps lead fields → an identity sendEvent XDM. Email goes in identityMap as
// // 'ambiguous' (unverified). Pure — no DOM/network.
// export function buildIdentityXdm(fields) {
//   return {
//     eventType: 'web.formFilledOut',
//     identityMap: {
//       Email: [{ id: fields.email, primary: true, authenticatedState: 'ambiguous' }],
//     },
//     [LEAD_XDM_TARGET.prefix]: {
//       [LEAD_XDM_TARGET.object]: { lead: { ...fields }, capturedAt: new Date().toISOString() },
//     },
//   };
// }

/**
 * Loads the Munchkin JavaScript library for Marketo and initializes it with a specified form ID
 * @param {String} environment - The unique identifier for the Marketo Munchkin id
 */
const loadMunchkinTag = (munchkinId) => {
  let didInit = false;
  const initMunchkin = () => {
    const munchkin = window.Munchkin;
    if (munchkin && !didInit) {
      didInit = true;
      munchkin.init(munchkinId);
    }
  };
  loadScript(MUNCHKIN_API_SRC).then(initMunchkin);
};

/**
 * Split full name into First and Last name
 * @returns first or last name {String}
 * @param fullName
 * @param fieldName
 */
const getFirstAndLastName = (fullName, fieldName) => {
  if (fullName) {
    const [firstName, ...rest] = fullName.trim().split(' ');
    const lastName = rest.join(' ');

    if (fieldName === 'first_name') return firstName;
    if (fieldName === 'last_name') return lastName || 'NotProvided';
  }
  return null;
};

/**
 * When the form uses a single Full_Name__c field, split it into Marketo
 * FirstName/LastName hidden fields before submit.
 * @param {Object} form Marketo form instance
 */
function syncFullNameHiddenFields(form) {
  const formValues = form.getValues();
  if (!formValues?.Full_Name__c) return;
  form.addHiddenFields({
    FirstName: getFirstAndLastName(formValues.Full_Name__c, 'first_name') || '',
    LastName: getFirstAndLastName(formValues.Full_Name__c, 'last_name') || '',
  });
}

/**
 * Build Trait data object
 * @returns trait object:{Object}
 * @param values
 */
export const getTraitData = (formVals) => {
  // get phone number country code
  const phCountryCode = formVals?.CountryCode && formVals?.Phone
    ? getPhCountryCodeForGeo(formVals.CountryCode)
    : '';

  return {
    first_name:
    formVals?.FirstName
      || getFirstAndLastName(formVals?.Full_Name__c, 'first_name') || '',
    last_name:
    formVals?.LastName
      || getFirstAndLastName(formVals?.Full_Name__c, 'last_name') || '',
    full_name: formVals?.Full_Name__c || '',
    email: formVals?.Email || '',
    lead_country: formVals?.CountryCode || '',
    phone: `${phCountryCode}${formVals?.Phone || ''}`,
    type: 'identity',
    ivid: getCookieValue('ivid'),
    ecid: getCookieValue('s_ecid'),
    uidp: getCookieValue('qbn.uidp'),
    _mkto_trk: getCookieValue('_mkto_trk'),
    cid: getCidValue(),
  };
};

/**
 * Build custom/campaign details object
 * @returns campaign details object:{Object}
 * @param values
 */
const getCustomProperties = (formVals, formId) => ({
  form_id: formId || formVals?.formid || '',
  product_family_of_interest: formVals?.Product_Family_of_Interest__c || '',
  product_of_interest: formVals?.Primary_Product_of_Interest__c || '',
  lead_source: formVals?.LeadSource || '',
  lead_treatment_name: formVals?.Legacy_Treatment_Name__c || '',
  lead_language: formVals?.Language__c || 'English',
  lead_xref_id: formVals?.Lead_XRef_ID__c || '',
  legacy_campaign_name: formVals?.Legacy_Campaign_Name__c || '',
  market: formVals?.CountryCode || '',
  productRegion: formVals?.CountryCode || '',
});

export function trackFormSubmit(formVals, formId) {
  const webAnalyticsObj = window.intuit?.tracking?.ecs?.webAnalytics;
  if (webAnalyticsObj) {
    const trackObj = getTrackData(formVals?.CountryCode || 'us');
    trackObj.custom_properties = getCustomProperties(formVals, formId);

    const { segment } = webAnalyticsObj;
    const initialConfig = segment?.initConfig;
    trackObj.page_name_parameter = buildPageHierarchy(initialConfig, trackObj);

    if (typeof webAnalyticsObj?.track === 'function') webAnalyticsObj.track(trackObj);
    if (typeof webAnalyticsObj?.identify === 'function') webAnalyticsObj.identify(getTraitData(formVals));
  }
}

// How long to wait for ChiliPiper's booking overlay to actually appear before
// giving up and leaving the hosting modal open.
const CHILIPIPER_OVERLAY_TIMEOUT_MS = 4000;

// ChiliPiper injects its calendar into its own body-level overlay. Resolve once
// that overlay exists, or to false if it never shows up within the timeout —
// bounded, and always tears down its observer/timer so nothing leaks.
function waitForChiliPiperOverlay(timeout = CHILIPIPER_OVERLAY_TIMEOUT_MS) {
  const present = () => document.querySelector('.chilipiper-popup-window iframe.chilipiper-frame');
  if (present()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer;
    const observer = new MutationObserver(() => {
      if (!present()) return;
      clearTimeout(timer);
      observer.disconnect();
      resolve(true);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timer = setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeout);
  });
}

// Confirmation copy shown in place of a submitted form. Authored centrally in
// the `placeholders` sheet as `form thank you heading` / `form thank you body`
// (camel-cased on read); these are the fallbacks for when the sheet has no row.
const THANK_YOU_HEADING_DEFAULT = 'Thank you';
const THANK_YOU_BODY_DEFAULT = 'An Intuit expert will be in touch with you shortly.';

// Replaces the submitted form with the confirmation. This also removes Marketo's
// submit button, which it relabels to "Please Wait" and only ever restores from
// its own thank-you/redirect — suppressed whenever the block supplies its own
// feedback, so the button would otherwise stay stuck on "Please Wait".
// Idempotent: guarded by a `data-thank-you-shown` flag.
function showThankYou(form, placeholders = {}) {
  const formEl = form.getFormElem?.()?.[0] || document.getElementById(`mktoForm_${form.getId?.()}`);
  if (!formEl || formEl.dataset.thankYouShown === 'true') return;

  // hide heading and disclaimers text
  if (formEl.previousElementSibling?.classList?.contains('form-disclaimer')) {
    formEl.previousElementSibling.classList.add('hide-element');
  }
  if (formEl.closest('.form-wrapper')?.previousElementSibling?.classList?.contains('default-content-wrapper')) {
    formEl.closest('.form-wrapper').previousElementSibling.classList.add('hide-element');
  }

  formEl.dataset.thankYouShown = 'true';
  const note = document.createElement('div');
  note.className = 'form-success';
  note.setAttribute('role', 'status');
  const check = document.createElement('span');
  check.className = 'icon icon-circle-check-fill-green form-success-check';
  const heading = document.createElement('p');
  heading.className = 'form-success-heading';
  heading.textContent = placeholders.formThankYouHeading || THANK_YOU_HEADING_DEFAULT;
  const body = document.createElement('p');
  body.textContent = placeholders.formThankYouBody || THANK_YOU_BODY_DEFAULT;
  note.append(check, heading, body);
  formEl.replaceWith(note);
  // The page-load icon pass has long finished by the time a form is submitted,
  // so resolve this icon's <img> explicitly.
  decorateIcons(note);
}

// Native <dialog> with showModal() sits in the top layer and covers ChiliPiper's
// body-level overlay until it is closed — capture it before the form node is replaced.
function getHostingDialog(form) {
  const formEl = form.getFormElem?.()?.[0];
  if (formEl?.isConnected) return formEl.closest('dialog');
  return document.querySelector('.modal dialog[open]');
}

// Post-Marketo handoff: submit the lead via the shared submitChiliPiper (prod-parity args +
// the Lead_XRef_ID__c event), then only dismiss the hosting schedule-call modal once ChiliPiper's
// own overlay has actually taken over. Returns false when the submit or the overlay never lands so
// the caller can show a fallback rather than leaving the visitor with nothing.
async function chiliPiperHandoff(router, form, hostingDialog) {
  const submitted = await submitChiliPiper(router, form.getValues());
  if (!submitted) return false;
  // submitChiliPiper is fire-and-forget, so close the dialog only once the overlay is really up —
  // closing unconditionally would leave a visitor with no calendar, no form and no error.
  const tookOver = await waitForChiliPiperOverlay();
  if (!tookOver || !hostingDialog || !getHostingDialog(form)) return false;
  const dialog = hostingDialog || getHostingDialog(form);
  if (dialog) {
    // Distinct from a user-initiated close: skip the focus restore so we don't
    // pull focus off ChiliPiper's overlay as it takes over (see modal.js).
    dialog.dataset.suppressFocusRestore = 'true';
    dialog.close();
  }
  return true;
}

// reCAPTCHA v3
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
  form.onValidate(() => {
    syncFullNameHiddenFields(form);
    form.submittable(verified);
  });

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

/**
 * This function takes an object of hidden fields and maps them to a new object
 * with specific keys. It filters out any fields that are `undefined` and ensures
 * the resulting record contains only string values.
 *
 * @param hiddenFields - An object containing the hidden fields to be mapped.
 * @returns A record of key-value pairs where the keys are the mapped field names
 * and the values are the corresponding non-undefined string values.
 */
export const getMappedHiddenFields = (configObj) => {
  const mappedFields = {
    LeadSource: configObj?.leadSource,
    Product_Family_of_Interest__c: configObj?.productFamily,
    Primary_Product_of_Interest__c: configObj?.primaryProduct,
    Legacy_Treatment_Name__c: configObj?.leadTreatmentName,
    Legacy_Campaign_Name__c: configObj?.leadLegacyCampaign,
    CountryCode: configObj?.leadCountryCode,
    Country: configObj?.leadCountry,
    Language__c: configObj?.leadLanguage,
  };

  return Object.fromEntries(
    Object.entries(mappedFields).filter(([, value]) => value !== undefined),
  );
};

async function embedMarketoForm(formEl, cfg, config, env) {
  // generate an load Forms2 script URL.
  const munchkin = config.munchkinId || cfg[MARKETO_MUNCHKIN_KEYS[env]] || cfg['marketo.munchkin'];
  if (!munchkin) return;
  const host = `//${munchkin.toLowerCase()}.mktoweb.com`;
  const forms2Src = `${host}/js/forms2/js/forms2.min.js`;

  const [placeholders] = await Promise.all([fetchPlaceholders(), loadScript(forms2Src)]);

  // load munchkin tag
  if (config.enableMunchkinTag && getCookieValue('ccpa') === '1|1') {
    loadMunchkinTag(munchkin);
  }

  window.MktoForms2.loadForm(host, munchkin, config.formId, (form) => {
    // Get random UUID
    const leadXref = (window.crypto?.randomUUID ? window.crypto.randomUUID() : createUUID());
    const ividVal = window?.utag_data?.ivid || getCookieValue('ivid') || ''

    // add hidden fields and populate values
    const hiddenFields = { Lead_XRef_ID__c: leadXref };
    hiddenFields.IVID__c = ividVal;
    hiddenFields.cID = getCidValue() || '';
    const customizedHiddenFields = getMappedHiddenFields(config);
    form.addHiddenFields?.({ ...hiddenFields, ...customizedHiddenFields });

    // append disclaimers
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

    // update the button label
    if (config.buttonLabel) {
      const button = formEl.querySelector('.mktoButton');
      if (button) button.textContent = config.buttonLabel;
    }

    // recaptcha
    if (config.recaptcha) {
      setupRecaptcha(cfg, config, form);
    } else {
      form.onValidate(() => {
        syncFullNameHiddenFields(form);
      });
    }

    // check for chilipiper config added
    const canHandoff = !!(config.chiliPiperRouter && cfg['chilipiper.subdomain']);

    form.onSuccess((vals) => {

      // invoking ECS tracking
      try {
        trackFormSubmit({ ...vals, Lead_XRef_ID__c: leadXref }, config.formId);
      } catch (e) { /* non-fatal */ }

      // ChiliPiper handoff: capture the hosting modal before any DOM swap, then
      // close it once ChiliPiper's overlay is up so it isn't trapped behind the
      // native <dialog> top layer. Thank-you is the fallback when handoff fails.
      if (canHandoff) {
        const hostingDialog = getHostingDialog(form);
        chiliPiperHandoff(config.chiliPiperRouter, form, hostingDialog).then((ok) => {
          if (!ok) showThankYou(form, placeholders);
        });
      }

      // handling other use case like download file or redirect to success URL
      if (config.downloadUrl) window.open(config.downloadUrl, '_blank', 'noopener');
      else if (config.successUrl && !canHandoff) window.location.href = config.successUrl;

      // Suppress Marketo's default redirect only when we provide our own feedback
      // (ChiliPiper / download / successUrl). Otherwise let Marketo show its
      // thank-you so a misconfigured handoff never leaves the visitor with nothing.
      const handled = canHandoff || !!config.downloadUrl || !!config.successUrl;
      return !handled;
    });

    // Handle for form submission fail
    form.onSubmit(() => {
      setTimeout(() => {
        const targetNode = document.querySelectorAll(
          `#mktoForm_${config.formId} .mktoButtonRow .mktoButtonWrap .mktoErrorMsg`
        )[0];
        if (targetNode) {
          experienceLog('error',
            `MARKETOFORM_ISSUE_WITH_FORM_SUBMISSION,formId:${config.formId},leadXRefID:${leadXref},ivid:${ividVal}`
          );
        }
      }, 500);
    });

  });
}

function setRichText(el, html) {
  el.innerHTML = html;
  const only = el.firstElementChild;
  if (el.childElementCount === 1 && only.tagName === 'P') only.replaceWith(...only.childNodes);
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
    setRichText(el, config.header);
    children.push(el);
  }
  if (config.subheader) {
    const el = document.createElement('p');
    el.className = 'form-subheader';
    setRichText(el, config.subheader);
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

// Book-a-demo: ChiliPiper scheduler directly (no Marketo form). Router is the
// only per-page value; subdomain/script come from /site-config.json.
export async function bookDemo(router) {
  await openChiliPiper(router);
}
