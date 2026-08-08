/**
 * talk-to-sales — the persistent bottom-right sales widget from erp.intuit.com,
 * ported to EDS. Injected once into <body> during the lazy phase (see
 * scripts/scripts.js), so it never touches the LCP path.
 *
 * Two content variants, chosen by URL:
 *   - default : every non-blog page — bubble "Contact us" → "Questions about
 *               Intuit Enterprise Suite?" panel with the sales phone + hours.
 *   - blog    : /blog and all subpaths — bubble "Talk to sales" → "How can we
 *               help?" panel with Schedule a call + Visit support page CTAs.
 *
 * Each variant has a distinct desktop (white circle → card) and mobile
 * (dark ball/pill → bottom sheet) design; the split is handled in CSS at 600px.
 * The blog "Schedule a call" CTA reuses the shared schedule-call modal.
 * CSS: styles/lazy-styles.css (.talk-to-sales rules).
 */
// eslint-disable-next-line import/no-cycle
import { openScheduleModal } from '../../scripts/schedule-modal.js';

// Content — matches erp.intuit.com. Kept here so it's trivial to edit later.
const SALES_PHONE = '1-800-942-8127';
const SALES_HOURS = 'Monday - Friday 5 AM PT to 6 PM PT';
const SUPPORT_URL = 'https://quickbooks.intuit.com/learn-support/en-us/help-custom/L51DdHqau';

// Icons (functional UI glyphs). Paths carry fill="currentColor" so the same
// markup is tinted green on desktop and white on mobile purely via CSS.
const ICON_PHONE = '<svg class="tts-ico tts-ico-phone" width="21" height="21" viewBox="0 0 21 21" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.9789 2.23423L16.9886 4.24293C18.9529 6.20828 18.9529 9.40526 16.9886 11.3696L11.287 17.0711C10.3356 18.0236 9.0697 18.5477 7.72418 18.5477C6.37766 18.5477 5.11178 18.0236 4.16034 17.0711L2.15064 15.0625L5.47663 12.6869L6.29905 13.5083C7.43996 14.6482 9.43152 14.6502 10.5745 13.5083L13.4247 10.657C13.9952 10.0866 14.3106 9.32664 14.3106 8.51933C14.3106 7.71203 13.9952 6.95209 13.4247 6.38063L12.6033 5.55921L14.9789 2.23423ZM7.72418 20.5634C9.60891 20.5634 11.3797 19.8297 12.7122 18.4963L18.4137 12.7957C21.1642 10.0442 21.1642 5.56929 18.4137 2.81779L16.404 0.80809C15.9847 0.389823 15.4112 0.177161 14.8136 0.224531C14.2219 0.273917 13.6848 0.578295 13.3391 1.06207L10.9635 4.38806C10.387 5.19335 10.4777 6.28488 11.1782 6.98434L11.9996 7.80677C12.1901 7.99726 12.2949 8.25023 12.2949 8.51933C12.2949 8.78844 12.1901 9.04141 11.9996 9.23089L9.14932 12.0822C8.76834 12.4631 8.10315 12.4621 7.72418 12.0822L6.90176 11.2608C6.20129 10.5603 5.10976 10.4716 4.30447 11.0461L0.979492 13.4216C0.495712 13.7673 0.190327 14.3045 0.141947 14.8962C0.0925617 15.4878 0.306231 16.0683 0.725508 16.4876L2.73521 18.4963C4.06762 19.8297 5.83946 20.5634 7.72418 20.5634Z" fill="currentColor"/></svg>';
const ICON_CHAT = '<svg class="tts-ico tts-ico-chat" width="21" height="21" viewBox="0 0 21 21" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M10.6852 20.4332C10.5113 20.4331 10.3403 20.3881 10.189 20.3024C10.0376 20.2168 9.911 20.0934 9.82144 19.9443L7.69482 16.4017H5.21243C4.00067 16.4094 2.83528 15.9364 1.97183 15.0861C1.10838 14.2359 0.617361 13.078 0.606445 11.8662V4.81111C0.617096 3.59929 1.10803 2.44118 1.97154 1.59091C2.83505 0.740626 4.00059 0.26762 5.21243 0.275675H16.1579C17.3698 0.26762 18.5353 0.740626 19.3988 1.59091C20.2623 2.44118 20.7533 3.59929 20.7639 4.81111V11.8662C20.753 13.078 20.262 14.2359 19.3985 15.0861C18.5351 15.9364 17.3697 16.4094 16.1579 16.4017H13.6755L11.5489 19.9443C11.4594 20.0934 11.3328 20.2168 11.1814 20.3024C11.03 20.3881 10.8591 20.4331 10.6852 20.4332ZM5.21243 2.29142C4.53503 2.28281 3.88187 2.54326 3.39627 3.01563C2.91067 3.48801 2.63228 4.13373 2.62219 4.81111V11.8662C2.63228 12.5436 2.91067 13.1893 3.39627 13.6617C3.88187 14.1341 4.53503 14.3945 5.21243 14.3859H8.26629C8.4402 14.3859 8.61115 14.431 8.7625 14.5166C8.91386 14.6023 9.04047 14.7257 9.13004 14.8747L10.6852 17.467L12.2403 14.8747C12.3299 14.7257 12.4565 14.6023 12.6079 14.5166C12.7592 14.431 12.9302 14.3859 13.1041 14.3859H16.1579C16.8353 14.3945 17.4885 14.1341 17.9741 13.6617C18.4597 13.1893 18.7381 12.5436 18.7482 11.8662V4.81111C18.7381 4.13373 18.4597 3.48801 17.9741 3.01563C17.4885 2.54326 16.8353 2.28281 16.1579 2.29142H5.21243Z" fill="currentColor"/></svg>';
const ICON_CHAT_BALL = '<svg class="tts-ico tts-ico-ball" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M12 22C11.8274 21.9999 11.6578 21.9553 11.5077 21.8703C11.3575 21.7853 11.2319 21.6629 11.143 21.515L9.033 18H6.57C5.36771 18.0077 4.21142 17.5383 3.35472 16.6947C2.49802 15.8511 2.01083 14.7022 2 13.5V6.49998C2.01057 5.29763 2.49767 4.14857 3.35443 3.30493C4.21119 2.4613 5.36763 1.99199 6.57 1.99998H17.43C18.6324 1.99199 19.7888 2.4613 20.6456 3.30493C21.5023 4.14857 21.9894 5.29763 22 6.49998V13.5C21.9892 14.7022 21.502 15.8511 20.6453 16.6947C19.7886 17.5383 18.6323 18.0077 17.43 18H14.967L12.857 21.515C12.7681 21.6629 12.6425 21.7853 12.4923 21.8703C12.3422 21.9553 12.1726 21.9999 12 22ZM6.57 3.99998C5.89789 3.99143 5.24984 4.24985 4.76803 4.71853C4.28622 5.18722 4.01001 5.82789 4 6.49998V13.5C4.01001 14.1721 4.28622 14.8127 4.76803 15.2814C5.24984 15.7501 5.89789 16.0085 6.57 16H9.6C9.77255 16 9.94216 16.0447 10.0923 16.1297C10.2425 16.2147 10.3681 16.3371 10.457 16.485L12 19.057L13.543 16.485C13.6319 16.3371 13.7575 16.2147 13.9077 16.1297C14.0578 16.0447 14.2274 16 14.4 16H17.43C18.1021 16.0085 18.7502 15.7501 19.232 15.2814C19.7138 14.8127 19.99 14.1721 20 13.5V6.49998C19.99 5.82789 19.7138 5.18722 19.232 4.71853C18.7502 4.24985 18.1021 3.99143 17.43 3.99998H6.57Z" fill="currentColor"/><path d="M8 11C8.55228 11 9 10.5523 9 10C9 9.44772 8.55228 9 8 9C7.44772 9 7 9.44772 7 10C7 10.5523 7.44772 11 8 11Z" fill="currentColor"/><path d="M12 11C12.5523 11 13 10.5523 13 10C13 9.44772 12.5523 9 12 9C11.4477 9 11 9.44772 11 10C11 10.5523 11.4477 11 12 11Z" fill="currentColor"/><path d="M16 11C16.5523 11 17 10.5523 17 10C17 9.44772 16.5523 9 16 9C15.4477 9 15 9.44772 15 10C15 10.5523 15.4477 11 16 11Z" fill="currentColor"/></svg>';
const ICON_CLOSE = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M8.42288 8.0196L13.7249 2.68904C14.1149 2.29568 14.1159 1.65722 13.7269 1.26285C13.3359 0.868482 12.7029 0.867473 12.3129 1.26084L7.01188 6.59039L1.72688 1.2447C1.33688 0.850327 0.703876 0.849318 0.312876 1.24268C-0.078124 1.63503 -0.0791238 2.2745 0.310876 2.66887L5.59488 8.01557L0.293876 13.3461C-0.097124 13.7385 -0.0981239 14.3779 0.291876 14.7723C0.486876 14.97 0.742876 15.0689 0.999877 15.0689C1.25588 15.0689 1.51088 14.971 1.70588 14.7743L7.00688 9.44377L12.2919 14.7905C12.4869 14.9882 12.7429 15.087 12.9999 15.087C13.2559 15.087 13.5109 14.9892 13.7059 14.7925C14.0969 14.3991 14.0979 13.7607 13.7079 13.3663L8.42288 8.0196Z" fill="currentColor"/></svg>';

/** True on /blog and every subpath — the "Talk to sales" variant. */
function isBlogVariant() {
  return window.location.pathname.startsWith('/blog');
}

/** Desktop trigger: white circle with phone | chat icons + label. */
function desktopBubble(label) {
  return `
    <button type="button" class="tts-bubble tts-desktop" aria-label="${label}">
      <span class="tts-bubble-icons">
        ${ICON_PHONE}<span class="tts-pipe" aria-hidden="true"></span>${ICON_CHAT}
      </span>
      <span class="tts-bubble-label">${label}</span>
    </button>`;
}

/** Mobile trigger: dark ball (default) or dark pill (blog). */
function mobileBubble(label, blog) {
  return `
    <button type="button" class="tts-ball tts-mobile${blog ? ' tts-ball-pill' : ''}" aria-label="${label}">
      ${ICON_CHAT_BALL}${blog ? `<span class="tts-ball-label">${label}</span>` : ''}
    </button>`;
}

/** Variant-specific panel body. */
function panelBody(blog) {
  if (blog) {
    return `
      <div class="tts-headline tts-headline-blog">How can we help?</div>
      <div class="tts-subhead tts-mobile-only">Talk to sales</div>
      <button type="button" class="tts-btn tts-btn-secondary tts-schedule">Schedule a call</button>
      <div class="tts-support-label">Get product support</div>
      <a class="tts-btn tts-btn-secondary tts-support" href="${SUPPORT_URL}">Visit support page</a>`;
  }
  return `
    <div class="tts-headline tts-headline-default">Questions about Intuit Enterprise Suite?</div>
    <div class="tts-subhead tts-desktop-only">Call us ${SALES_PHONE}</div>
    <a class="tts-btn tts-btn-primary tts-call tts-mobile-only" href="tel:${SALES_PHONE}">Call us ${SALES_PHONE}</a>
    <p class="tts-hours">${SALES_HOURS}</p>`;
}

/**
 * Builds, wires and appends the widget. Idempotent — a second call is a no-op.
 */
export default function initTalkToSales() {
  if (document.getElementById('talk-to-sales')) return;

  const blog = isBlogVariant();
  const label = blog ? 'Talk to sales' : 'Contact us';

  const root = document.createElement('div');
  root.id = 'talk-to-sales';
  root.className = `talk-to-sales tts-${blog ? 'blog' : 'default'}`;
  root.innerHTML = `
    ${desktopBubble(label)}
    ${mobileBubble(label, blog)}
    <div class="tts-panel" role="dialog" aria-label="${label}" aria-modal="false" hidden>
      <button type="button" class="tts-close" aria-label="Close">${ICON_CLOSE}</button>
      <div class="tts-panel-body">${panelBody(blog)}</div>
    </div>`;

  const panel = root.querySelector('.tts-panel');
  const closeBtn = root.querySelector('.tts-close');
  const triggers = root.querySelectorAll('.tts-bubble, .tts-ball');
  let lastTrigger = null;

  function onKeydown(e) {
    // eslint-disable-next-line no-use-before-define
    if (e.key === 'Escape') close();
  }

  function onOutside(e) {
    // eslint-disable-next-line no-use-before-define
    if (!root.contains(e.target)) close();
  }

  function open(trigger) {
    lastTrigger = trigger || triggers[0];
    root.classList.add('tts-open');
    panel.hidden = false;
    closeBtn.focus();
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('click', onOutside, true);
  }

  function close() {
    root.classList.remove('tts-open');
    panel.hidden = true;
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('click', onOutside, true);
    if (lastTrigger) lastTrigger.focus();
  }

  triggers.forEach((t) => t.addEventListener('click', () => open(t)));
  closeBtn.addEventListener('click', close);

  // Blog "Schedule a call" reuses the shared modal; close the widget first so
  // the two overlays don't stack.
  const schedule = root.querySelector('.tts-schedule');
  if (schedule) {
    schedule.addEventListener('click', () => {
      close();
      openScheduleModal();
    });
  }

  document.body.append(root);
}
