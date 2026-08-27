/**
 * PZN treatment for the IES Web Survey access point (SBSEGICOMMContentIESWebSurveyModal, /).
 *
 * After a delay, invites the visitor to take an IntelliSurvey; on accept it opens the survey
 * with their ivid as the transaction id. Suppressed once the visitor has seen/accepted/declined
 * it (cookies on the .intuit.com domain). Control (0% — no survey) is the page baseline, so
 * there is no control fragment.
 *
 * Rebuilt on the shared modal (blocks/modal/modal.js createModal) instead of the OICMS
 * `#clicktoshowmodal` + MutationObserver hack.
 *
 * Author config (widget href query params → widget.dataset):
 *   survey – IntelliSurvey base URL (default: the is14262 pub link)
 *   delay  – ms before the modal is shown (default: 15000)
 */
import { createModal } from '../../../blocks/modal/modal.js';

const SURVEY_URL_DEFAULT = 'https://j1.intellisurvey.com/pub/is14262?pan=991';
const DELAY_DEFAULT = 15000;
const COOKIE_DOMAIN = '.intuit.com';

function getCookie(name) {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : '';
}

// Persistent by default (suppress across visits); pass { session: true } for the "shown this
// session" flag so a new session can re-offer it.
function setCookie(name, value, { session = false } = {}) {
  const expires = session ? '' : '; expires=Fri, 31 Dec 2027 23:59:59 GMT';
  document.cookie = `${name}=${value}; path=/; domain=${COOKIE_DOMAIN}; secure; samesite=None${expires}`;
}

function alreadyHandled() {
  return ['wsp_accepted', 'wsp_declined', 'wsp_displayed'].some((c) => getCookie(c) === 'true');
}

function log(message) {
  window.coreServiceAdapter?.logger?.info?.(message);
}

function buildContent() {
  const content = document.createElement('div');
  content.className = 'web-survey-modal';
  content.innerHTML = '<h2>Help us improve</h2>'
    + '<p>Do you have a few minutes to share your feedback?</p>';

  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'button web-survey-accept';
  accept.textContent = 'Take the survey';
  // Click-tracking attributes preserved from the OICMS variant.
  Object.entries({
    'data-tracking': 'button',
    'data-object': 'content',
    'data-ui-object': 'button',
    'data-ui-object-detail': 'ies-web-survey-popup-modal continue button',
    'data-action': 'interacted',
    'data-ui-action': 'clicked',
  }).forEach(([k, v]) => accept.setAttribute(k, v));

  const actions = document.createElement('div');
  actions.className = 'web-survey-actions';
  actions.append(accept);
  content.append(actions);
  return { content, accept };
}

export default async function decorate(widget) {
  if (alreadyHandled()) return;
  const surveyUrl = widget.dataset.survey || SURVEY_URL_DEFAULT;
  const delay = Number(widget.dataset.delay) || DELAY_DEFAULT;

  setTimeout(async () => {
    if (alreadyHandled()) return;
    const { content, accept } = buildContent();
    const { showModal, block } = await createModal([content]);
    const dialog = block.querySelector('dialog');

    setCookie('wsp_displayed', 'true', { session: true });
    log('IES web survey modal displayed');

    accept.addEventListener('click', () => {
      setCookie('wsp_accepted', 'true');
      const ivid = getCookie('ivid');
      const sep = surveyUrl.includes('?') ? '&' : '?';
      window.open(`${surveyUrl}${sep}transid=${encodeURIComponent(ivid)}`, '_self');
    });
    dialog.addEventListener('close', () => {
      if (getCookie('wsp_accepted') !== 'true') setCookie('wsp_declined', 'true');
    });

    showModal();
  }, delay);
}
