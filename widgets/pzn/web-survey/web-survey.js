/**
 * PZN treatment for the IES Web Survey access point (SBSEGICOMMContentIESWebSurveyModal, /).
 *
 * After a delay, opens a modal built from an authored content fragment inviting the visitor to take
 * an IntelliSurvey; on accept it opens the survey with their ivid as the transaction id. Suppressed
 * once the visitor has seen/accepted/declined it (cookies scoped to `.intuit.com` in prod, the
 * current host elsewhere). Control (0% — no survey) is the page baseline, so there is no control
 * fragment.
 *
 * The modal copy/image live in a DA content fragment (default /fragments/pzn/web-survey/modal)
 * instead of in code, so authors can edit them without a deploy. Rebuilt on the shared modal
 * (blocks/modal/modal.js createModal) instead of the OICMS `#clicktoshowmodal` + observer hack.
 *
 * Author config (widget href query params → widget.dataset):
 *   fragment – content fragment path for the modal body (default: /fragments/pzn/web-survey/modal)
 *   survey   – IntelliSurvey base URL; default = the fragment CTA href if absolute, else is14262
 *   delay    – ms before the modal is shown (default: 15000)
 */
import { createModal } from '../../../blocks/modal/modal.js';
import { loadFragment } from '../../../blocks/fragment/fragment.js';

const SURVEY_URL_DEFAULT = 'https://j1.intellisurvey.com/pub/is14262?pan=991';
const FRAGMENT_DEFAULT = '/fragments/pzn/web-survey/modal';
const DELAY_DEFAULT = 15000;

// Click-tracking attributes preserved from the OICMS variant, stamped onto the fragment's CTA.
const ACCEPT_TRACKING = {
  'data-tracking': 'button',
  'data-object': 'content',
  'data-ui-object': 'button',
  'data-ui-object-detail': 'ies-web-survey-popup-modal continue button',
  'data-action': 'interacted',
  'data-ui-action': 'clicked',
};

function getCookie(name) {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : '';
}

// Persistent by default (suppress across visits); pass { session: true } for the "shown this
// session" flag so a new session can re-offer it. On *.intuit.com the cookie is scoped to the
// shared parent domain so suppression spans subdomains; elsewhere (aem.page/aem.live/localhost)
// a `.intuit.com` cookie would be silently rejected, so scope to the current host — otherwise the
// modal would re-pop every reload during preview QA. `secure`/`samesite` only apply over https.
function setCookie(name, value, { session = false } = {}) {
  const domain = /(?:^|\.)intuit\.com$/.test(window.location.hostname) ? '; domain=.intuit.com' : '';
  const secure = window.location.protocol === 'https:' ? '; secure; samesite=None' : '';
  const expires = session ? '' : '; expires=Fri, 31 Dec 2027 23:59:59 GMT';
  document.cookie = `${name}=${value}; path=/${domain}${secure}${expires}`;
}

export function alreadyHandled() {
  return ['wsp_accepted', 'wsp_declined', 'wsp_displayed'].some((c) => getCookie(c) === 'true');
}

// The IntelliSurvey URL for one respondent — their ivid becomes the transaction id.
export function surveyUrl(base, ivid) {
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}transid=${encodeURIComponent(ivid)}`;
}

function log(message) {
  window.coreServiceAdapter?.logger?.info?.(message);
}

// The visitor's survey destination: the widget's `?survey=` override wins, else the fragment CTA's
// own href when it's an absolute URL (authors can bake the destination into the fragment), else the
// built-in default.
export function resolveSurveyBase(widget, accept) {
  if (widget.dataset.survey) return widget.dataset.survey;
  const href = accept?.getAttribute('href') || '';
  return /^https?:\/\//i.test(href) ? href : SURVEY_URL_DEFAULT;
}

// Turns the fragment's Continue CTA into the survey accept button: preserves the OICMS
// click-tracking attributes and hands the visitor off to their IntelliSurvey URL (ivid → transid).
export function bindAccept(accept, surveyBase) {
  Object.entries(ACCEPT_TRACKING).forEach(([k, v]) => accept.setAttribute(k, v));
  accept.addEventListener('click', (e) => {
    e.preventDefault();
    setCookie('wsp_accepted', 'true');
    window.open(surveyUrl(surveyBase, getCookie('ivid')), '_self');
  });
}

export default async function decorate(widget) {
  if (alreadyHandled()) return;
  const fragmentPath = widget.dataset.fragment || FRAGMENT_DEFAULT;
  const delay = Number(widget.dataset.delay) || DELAY_DEFAULT;

  setTimeout(async () => {
    if (alreadyHandled()) return;
    const fragment = await loadFragment(fragmentPath);
    if (!fragment) {
      log('IES web survey fragment failed to load');
      return;
    }

    const { showModal, block } = await createModal([...fragment.childNodes]);
    const dialog = block.querySelector('dialog');
    const accept = block.querySelector('.modal-content a.button')
      || block.querySelector('.modal-content a');
    if (accept) bindAccept(accept, resolveSurveyBase(widget, accept));

    setCookie('wsp_displayed', 'true', { session: true });
    log('IES web survey modal displayed');

    dialog.addEventListener('close', () => {
      if (getCookie('wsp_accepted') !== 'true') setCookie('wsp_declined', 'true');
    });

    showModal();
  }, delay);
}
