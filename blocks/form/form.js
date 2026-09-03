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

// Uncomment with the AEP/WebSDK integration in scripts/scripts.js.
// // Vendored via git subtree at plugins/martech (see its README), not an
// // installed npm package, so this necessarily crosses a package.json boundary.
// // eslint-disable-next-line import/no-relative-packages
// import { sendEvent } from '../../plugins/martech/src/index.js';

// Shared ChiliPiper opener (also used by personalization widgets).
import {
  openChiliPiper, submitChiliPiper,
} from '../../scripts/chilipiper.js';

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
  'enableMunchkinTag'
];

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

/**
 * Creates unique uuid string
 */
const createUUID = () => {
  const lut = [];
  for (let i = 0; i < 256; i += 1) {
    lut[i] = (i < 16 ? '0' : '') + i.toString(16);
  }
  const d0 = (Math.random() * 0xffffffff) | 0;
  const d1 = (Math.random() * 0xffffffff) | 0;
  const d2 = (Math.random() * 0xffffffff) | 0;
  const d3 = (Math.random() * 0xffffffff) | 0;
  return `${
    lut[d0 & 0xff] +
    lut[(d0 >> 8) & 0xff] +
    lut[(d0 >> 16) & 0xff] +
    lut[(d0 >> 24) & 0xff]
  }-${lut[d1 & 0xff]}${lut[(d1 >> 8) & 0xff]}-${
    lut[((d1 >> 16) & 0x0f) | 0x40]
  }${lut[(d1 >> 24) & 0xff]}-${lut[(d2 & 0x3f) | 0x80]}${
    lut[(d2 >> 8) & 0xff]
  }-${lut[(d2 >> 16) & 0xff]}${lut[(d2 >> 24) & 0xff]}${lut[d3 & 0xff]}${
    lut[(d3 >> 8) & 0xff]
  }${lut[(d3 >> 16) & 0xff]}${lut[(d3 >> 24) & 0xff]}`;
};

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

  const scriptEl = document.createElement('script');
  scriptEl.type = 'text/javascript';
  scriptEl.src = '//munchkin.marketo.net/munchkin.js';
  scriptEl.onload = initMunchkin;
  document.head.appendChild(scriptEl);
};

/**
 * Get value of a query param from the current URL
 * @param {String} paramName name of the query param to retrieve
 * @returns {String} value of query param if found else null
 */
const getQueryParamValue = (paramName) => {
  const value = new URLSearchParams(window.location.search).get(paramName);
  return value === '' ? null : value;
};

/**
 * Get value of cookie found with accurate key
 * @param {String} cookieName key of the cookie to be retrieved
 * @returns {String} value of cookie if found else null
 */
const getCookieValue = (cookieName) => {
  if (!cookieName) {
    return null;
  }
  const regex = new RegExp(
    `(?:^|; )${cookieName.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1')}=([^;]*)`
  );
  const matches = regex.exec(document.cookie);

  return matches ? matches[1] : null;
};

/**
 * Get value of cid from URL query param or cookies
 * @returns {String} value of cid if found else empty string
 */
const getCidValue = () => {
  const cidFromQuery = getQueryParamValue('cid') || getQueryParamValue('CID');
  if (cidFromQuery) {
    return cidFromQuery;
  }

  let cidVal = getCookieValue('qbn.qbo_sc') || '';
  cidVal = (cidVal && cidVal.includes('|') && cidVal.split('|')[0]) || '';
  cidVal = (cidVal && cidVal.includes(':') && cidVal.split(':')[1]) || '';
  return cidVal;
};


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
    enableMunchkinTag: found.enableMunchkinTag === 'true',
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

// Submit tracking. `window.utag` only ever exists when scripts/scripts.js chose the Tealium
// provider (the default) AND that instance is enabled — i.e. the hostname resolves to a utag
// environment (see plugins/tealium-martech/src/index.js `resolveEnvironment`).
function trackFormSubmit(fields) {
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
  }
  // Uncomment with the AEP/WebSDK integration in scripts/scripts.js.
  // if (!window.utag?.link) sendEvent({ xdm: buildIdentityXdm(fields) }).catch(() => {});
}

/**
 * Get dynamic screen data based on geo and pathname
 * @param {String} countryCode
 * @returns {String|""}
 */
const getDynamicScreenData = (countryCode) => {
  const pathName = window?.location.pathname;
  if (pathName) {
    const pathnameArr = pathName.replace(/\/+$/, '').split('/');
    if (pathnameArr && pathnameArr.length > 1) {
      if (countryCode === pathnameArr[1]) {
        return pathnameArr.length > 2
          ? pathnameArr.splice(2).join('/')
          : 'homepage';
      }
      return pathnameArr.splice(1).join('/');
    }
    return 'homepage';
  }
  return '';
};

/**
 * Split full name into First and Last name
 * @returns first or last name {String}
 * @param fullName
 * @param fieldName
 */
export const getFirstAndLastName = (fullName, fieldName) => {
  if (fullName) {
    const [firstName, ...rest] = fullName.trim().split(' ');
    const lastName = rest.join(' ');

    if (fieldName === 'first_name') return firstName;
    if (fieldName === 'last_name') return lastName || 'NotProvided';
  }
  return null;
};

/**
 * Build Trait data object
 * @returns trait object:{Object}
 * @param values
 */
export const getTraitData = (formVals) => {
  // get phone number country code
  const phCountryCode =
  formVals?.CountryCode && values?.Phone
      ? getPhCountryCodeForGeo(values.CountryCode)
      : '';

  return {
    first_name:
    formVals?.FirstName ||
      getFirstAndLastName(formVals?.Full_Name__c, 'first_name'),
    last_name:
    formVals?.LastName ||
      getFirstAndLastName(formVals?.Full_Name__c, 'last_name'),
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
 * get dynamic scope data based on geo and pathname
 * @param {String} countryCode
 * @returns {String|""}
 */
const getDynamicScopeArea = (countryCode) => {
  const pathName = window?.location?.pathname;
  if (pathName) {
    const pathnameArr = pathName.replace(/\/+$/, '').split('/');
    if (pathnameArr && pathnameArr.length > 1) {
      if (countryCode === pathnameArr[1]) {
        if (pathnameArr.length > 2) {
          return pathnameArr[2];
        }
        return 'homepage';
      }
      return pathnameArr[1];
    }
    return 'homepage';
  }
  return '';
};

/**
 * Get Page Hierarchy value
 * returns {String} page hierarchy
 * @param initConfig
 * @param trackObj
 */
const buildPageHierarchy = (
  initConfig,
  trackObj
) => {
  const arr = ['', '', '', '', ''];
  if (initConfig) {
    arr[0] = initConfig.org || '';
    arr[1] = initConfig.purpose || '';
    arr[2] = initConfig.scope || '';
  }
  if (trackObj) {
    arr[3] = trackObj.scope_area || '';
    arr[4] = trackObj.screen || '';
  }
  return arr.join('|');
};

/**
 * Build Track data object.
 * Defaults to the form-submit event shape, but any attribute (action,
 * ui_action, ui_object, ui_object_detail, etc.) can be overridden via
 * `eventOverrides` so this builder can be reused for other event types
 * @returns track object:{Object}
 * @param countryCode
 * @param eventOverrides
 */
const getTrackData = (countryCode) => {
  return {
    scope_area: getDynamicScopeArea(countryCode),
    screen: getDynamicScreenData(countryCode),
    action: 'create_submitted',
    object: 'lead',
    ui_action: 'clicked',
    ui_object: 'button',
    ui_object_detail: 'Submit',
    ui_access_point: 'form|form_group',
    type: 'track',
    cid: getCidValue(),
    page_name_parameter: '',
    custom_properties: {},
    _mkto_trk: getCookieValue('_mkto_trk'),
  }
};
/**
 * Build custom/campaign details object
 * @returns campaign details object:{Object}
 * @param values
 */
const getCustomProperties = (formVals) => {
  return {
    form_id: formVals?.formid || '',
    product_family_of_interest: formVals?.Product_Family_of_Interest__c || '',
    product_of_interest: formVals?.Primary_Product_of_Interest__c || '',
    lead_source: formVals?.LeadSource || '',
    lead_treatment_name: formVals?.Legacy_Treatment_Name__c || '',
    lead_language: formVals?.Language__c || 'English',
    lead_xref_id: formVals?.Lead_XRef_ID__c || '',
    legacy_campaign_name: formVals?.Legacy_Campaign_Name__c || '',
    market: formVals?.CountryCode || '',
    productRegion: formVals?.CountryCode || ''
  };
};

function trackLeadCreated(formVals) {
  const webAnalyticsObj = window.intuit?.tracking?.ecs?.webAnalytics;
  if (typeof webAnalyticsObj?.track !== 'function') return false;

  const trackObj = getTrackData(values?.CountryCode || 'us',);
  trackObj.custom_properties = getCustomProperties(values);

  if (webAnalyticsObj) {
    const { segment } = webAnalyticsObj;
    const initialConfig = segment?.initConfig;
    trackObj.page_name_parameter = buildPageHierarchy(initialConfig, trackObj);

    if (typeof webAnalyticsObj?.track === 'function') webAnalyticsObj.track(trackObj);
    if (typeof webAnalyticsObj?.identify === 'function') webAnalyticsObj.identify(getTraitData(values));
  }
}

// Marketo field names → the lower-cased lead shape trackFormSubmit expects, so
// the Tealium analytics event fires on a live submit as on the former mock.
function marketoValuesToLead(vals = {}) {
  return {
    email: vals.Email || '',
    firstName: vals.FirstName || '',
    lastName: vals.LastName || '',
    businessName: vals.Company || '',
    phone: vals.Phone || '',
  };
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

// Post-Marketo handoff: submit the lead via the shared submitChiliPiper (prod-parity args +
// the Lead_XRef_ID__c event), then only dismiss the hosting schedule-call modal once ChiliPiper's
// own overlay has actually taken over. Returns false when the submit or the overlay never lands so
// the caller can show a fallback rather than leaving the visitor with nothing.
async function chiliPiperHandoff(router, form) {
  const submitted = await submitChiliPiper(router, form.getValues());
  if (!submitted) return false;
  // submitChiliPiper is fire-and-forget, so close the dialog only once the overlay is really up —
  // closing unconditionally would leave a visitor with no calendar, no form and no error.
  const tookOver = await waitForChiliPiperOverlay();
  if (!tookOver) return false;
  const formEl = form.getFormElem?.()?.[0] || document.getElementById(`mktoForm_${form.getId?.()}`);
  const dialog = formEl?.closest('dialog');
  if (dialog) {
    // Distinct from a user-initiated close: skip the focus restore so we don't
    // pull focus off ChiliPiper's overlay as it takes over (see modal.js).
    dialog.dataset.suppressFocusRestore = 'true';
    dialog.close();
  }
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
  form.onValidate(() => {
    const formValues = form.getValues();
    if (formValues?.Full_Name__c) {
      form.addHiddenFields({
        FirstName:
          getFirstAndLastName(
            form.getValues()?.Full_Name__c,
            'first_name'
          ) || '',
        LastName:
          getFirstAndLastName(
            form.getValues()?.Full_Name__c,
            'last_name'
          ) || ''
      });
    }

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

async function embedMarketoForm(formEl, cfg, config, env) {
  // Munchkin for the active instance, falling back to the base (prod) key. The
  // Forms2 script URL is generated from it — one host per Marketo instance.
  const munchkin = cfg[MARKETO_MUNCHKIN_KEYS[env]] || cfg['marketo.munchkin'];
  if (!munchkin) return;
  const host = `//${munchkin.toLowerCase()}.mktoweb.com`;
  const forms2Src = `${host}/js/forms2/js/forms2.min.js`;
  // Resolved before `onSuccess` is registered because that callback has to run
  // synchronously — it can't await the sheet. Cached per prefix, so this is one
  // request no matter how many forms a page has.
  const placeholders = await fetchPlaceholders();
  await loadScript(forms2Src);

  if (config.enableMunchkinTag && getCookieValue('ccpa') === '1|1') {
    loadMunchkinTag(munchkin);
  }

  window.MktoForms2.loadForm(host, munchkin, config.formId, (form) => {

    // One lead-correlation id per form: stamp it into the Marketo hidden field up front (so it's
    // persisted with the lead in SFDC), then reuse the same id for the ECS lead track and the
    // ChiliPiper handoff on success. IVID__c is added when the ivid data-layer value is present.
    const leadXref = createUUID();
    const hiddenFields = { Lead_XRef_ID__c: leadXref };
    hiddenFields.IVID__c = window?.utag_data?.ivid || getCookieValue('ivid') || '';
    hiddenFields.cID = getCidValue() || '';

    form.addHiddenFields?.(hiddenFields);

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
      //try { trackFormSubmit(marketoValuesToLead(vals)); } catch (e) { /* non-fatal */ }
      // ECS lead track → IES_lead in the ies-erp container (IES_booking then fires from
      // ChiliPiper's booking-confirmed postMessage). Same xref as the hidden field + handoff.

      // try {
      //   trackLeadCreated({ leadXrefId: leadXref, formId: config.formId });
      // } catch (e) { /* non-fatal */ }
      trackLeadCreated(vals);

      // Marketo relabels its submit button to "Please Wait" and only restores it
      // from its own thank-you/redirect, suppressed below whenever we supply our
      // own feedback — so swap the form for the confirmation now. This covers
      // both outcomes of the fire-and-forget handoff (onSuccess must return
      // synchronously): the visitor sees it whether ChiliPiper's calendar takes
      // over or never loads.
      if (canHandoff) {
        showThankYou(form, placeholders);
        chiliPiperHandoff(config.chiliPiperRouter, form);
      }
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

// Book-a-demo: ChiliPiper scheduler directly (no Marketo form). Router is the
// only per-page value; subdomain/script come from /site-config.json.
export async function bookDemo(router) {
  await openChiliPiper(router);
}
