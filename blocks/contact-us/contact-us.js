/**
 * contact-us — the persistent bottom-right sales widget from erp.intuit.com,
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
 * CSS: blocks/contact-us/contact-us.css.
 */
// eslint-disable-next-line import/no-cycle
import { openScheduleModal } from '../../scripts/schedule-modal.js';
import { getMetadata } from '../../scripts/aem.js';
import { trackAs } from '../../scripts/tracking.js';
import {
  LIVEPERSON_FACADE_ACTIVATE,
  LIVEPERSON_FACADE_STARTED,
} from '../../scripts/liveperson-facade.js';

// Contact info (sales phone, hours, support URL) is authored in DA — a
// fragment table, not hardcoded here — so it can change without a code
// deploy. See /fragments/contact-info (block: contact-info).
const CONTACT_FRAGMENT = getMetadata('contact-info') || '/fragments/contact-info';
let contactInfo;

/** Fetches & parses the contact-info fragment into { phone, hours, supportUrl }; caches it. */
async function loadContactInfo() {
  if (!contactInfo) {
    contactInfo = fetch(`${CONTACT_FRAGMENT}.plain.html`)
      .then((res) => (res.ok ? res.text() : ''))
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const rows = doc.querySelectorAll('.contact-info > div');
        const fields = {};
        rows.forEach((row) => {
          const [label, value] = row.children;
          if (!label || !value) return;
          const link = value.querySelector('a');
          fields[label.textContent.trim()] = link ? link.href : value.textContent.trim();
        });
        return {
          phone: fields['Sales Phone'] || '',
          hours: fields['Sales Hours'] || '',
          supportUrl: fields['Support URL'] || '',
        };
      });
  }
  return contactInfo;
}

// Icons (functional UI glyphs) live in /icons and are fetched + inlined at
// runtime (not <img>) because they carry fill="currentColor" so the same
// markup is tinted green on desktop and white on mobile purely via CSS.
const iconCache = new Map();

/** Fetches an icon's raw SVG markup from /icons, caching the result. */
async function loadIcon(name) {
  if (!iconCache.has(name)) {
    iconCache.set(name, fetch(`${window.hlx.codeBasePath}/icons/${name}.svg`)
      .then((res) => (res.ok ? res.text() : '')));
  }
  return iconCache.get(name);
}

/** Stamps a block-scoped class onto a fetched icon's root <svg> element. */
function withClass(svg, className) {
  return svg.replace('<svg', `<svg class="${className}"`);
}

/** True on /blog and every subpath — the "Talk to sales" variant. */
function isBlogVariant() {
  return window.location.pathname.startsWith('/blog');
}

/** Desktop trigger: white circle with phone | chat icons + label. */
function desktopBubble(label, phoneIcon, chatIcon) {
  return `
    <button type="button" class="cu-bubble cu-desktop" aria-label="${label}">
      <span class="cu-bubble-icons">
        ${withClass(phoneIcon, 'cu-ico cu-ico-phone')}<span class="cu-pipe" aria-hidden="true"></span>${withClass(chatIcon, 'cu-ico cu-ico-chat')}
      </span>
      <span class="cu-bubble-label">${label}</span>
    </button>`;
}

/** Mobile trigger: dark ball (default) or dark pill (blog). */
function mobileBubble(label, blog, ballIcon) {
  return `
    <button type="button" class="cu-ball cu-mobile${blog ? ' cu-ball-pill' : ''}" aria-label="${label}">
      ${withClass(ballIcon, 'cu-ico cu-ico-ball')}${blog ? `<span class="cu-ball-label">${label}</span>` : ''}
    </button>`;
}

/**
 * Variant-specific panel body. When chatNow is set, appends the LivePerson placeholder div
 * that the Tealium-loaded lpTag paints its "Chat now" button into (see initContactUs). The id
 * is verbatim from erp.intuit.com because the LivePerson campaign targets it by id.
 */
function panelBody(blog, contact, chatNow) {
  const chatCta = chatNow ? `
    <div id="ies-button-div" class="cu-chat-cta">
      <button type="button" class="cu-btn cu-btn-secondary cu-chat-facade">Chat now</button>
    </div>` : '';
  if (blog) {
    return `
      <div class="cu-headline cu-headline-blog">How can we help?</div>
      <div class="cu-subhead cu-mobile-only">Talk to sales</div>
      <button type="button" class="cu-btn cu-btn-secondary cu-schedule">Schedule a call</button>
      <div class="cu-support-label">Get product support</div>
      <a class="cu-btn cu-btn-secondary cu-support" href="${contact.supportUrl}">Visit support page</a>
      ${chatCta}`;
  }
  return `
    <div class="cu-headline cu-headline-default">Questions about Intuit Enterprise Suite?</div>
    <div class="cu-subhead cu-desktop-only">Call us ${contact.phone}</div>
    <a class="cu-btn cu-btn-primary cu-call cu-mobile-only" href="tel:${contact.phone}">Call us ${contact.phone}</a>
    <p class="cu-hours">${contact.hours}</p>
    ${chatCta}`;
}

/**
 * Builds, wires and appends the widget. Idempotent — a second call is a no-op.
 */
export default async function initContactUs({ requestLivePerson } = {}) {
  if (document.getElementById('contact-us')) return;

  const blog = isBlogVariant();
  const label = blog ? 'Talk to sales' : 'Contact us';
  const closeTrackId = blog
    ? 'talk-to-sales:close-sales-widget-blog'
    : 'talk-to-sales:close-sales-widget';

  const chatNow = ['true', 'yes'].includes((getMetadata('chat-now') || '').trim().toLowerCase());
  if (chatNow) {
    window.lpSectionDesktop = 'iessales:ies-button-div';
    window.lpSectionMobile = 'iessales:ies-button-div';
  }

  const [phoneIcon, chatIcon, ballIcon, closeIcon, contact] = await Promise.all([
    loadIcon('cu-phone'),
    loadIcon('cu-chat'),
    loadIcon('cu-chat-ball'),
    loadIcon('cu-close'),
    loadContactInfo(),
  ]);

  const root = document.createElement('div');
  root.id = 'contact-us';
  root.className = `contact-us cu-${blog ? 'blog' : 'default'}`;
  root.innerHTML = `
    ${desktopBubble(label, phoneIcon, chatIcon)}
    ${mobileBubble(label, blog, ballIcon)}
    <div class="cu-panel" role="dialog" aria-label="${label}" aria-modal="false" hidden>
      <button type="button" class="cu-close" aria-label="Close" data-track-id="${closeTrackId}">${closeIcon}</button>
      <div class="cu-panel-body">${panelBody(blog, contact, chatNow)}</div>
    </div>`;

  const panel = root.querySelector('.cu-panel');
  const closeBtn = root.querySelector('.cu-close');
  const triggers = root.querySelectorAll('.cu-bubble, .cu-ball');
  const chatTarget = root.querySelector('#ies-button-div');
  const chatFacade = root.querySelector('.cu-chat-facade');
  let lastTrigger = null;
  let livePersonRequested = false;
  let proactiveActivation = false;
  let livePersonStarted = false;
  let vendorInviteSuppressed = false;
  let vendorInviteObserverTimeout;
  let proactiveStartTimeout;
  let vendorInviteObserver;

  function stopVendorInviteObserver() {
    vendorInviteObserver?.disconnect();
    window.clearTimeout(vendorInviteObserverTimeout);
  }

  const suppressVendorInvite = () => {
    if (!proactiveActivation) return;
    document.querySelectorAll('.LPMcontainer.LPMoverlay').forEach((offer) => {
      if (chatTarget?.contains(offer)) return;
      const campaignAsset = offer.querySelector('img[src*="qb-IES-proactive-invite"]');
      if (!campaignAsset) return;
      offer.hidden = true;
      offer.style.setProperty('display', 'none', 'important');
      vendorInviteSuppressed = true;
    });
    if (livePersonStarted && vendorInviteSuppressed) stopVendorInviteObserver();
  };
  vendorInviteObserver = chatTarget ? new MutationObserver(suppressVendorInvite) : null;

  function enableProactiveActivation() {
    proactiveActivation = true;
    suppressVendorInvite();
    vendorInviteObserver?.observe(document.body, { childList: true, subtree: true });
    vendorInviteObserverTimeout = window.setTimeout(stopVendorInviteObserver, 15000);
    proactiveStartTimeout = window.setTimeout(() => {
      if (livePersonStarted) return;
      proactiveActivation = false;
      stopVendorInviteObserver();
      if (chatFacade) chatFacade.textContent = 'Chat is taking longer than expected';
      triggers[0]?.click();
    }, 15000);
  }

  function requestChat({ autoStart = false } = {}) {
    if (autoStart) enableProactiveActivation();
    if (!chatNow || livePersonRequested) return;
    livePersonRequested = true;
    if (chatFacade) {
      chatFacade.disabled = true;
      chatFacade.textContent = 'Loading chat…';
    }
    try {
      requestLivePerson?.();
    } catch (e) { /* non-fatal — the phone/schedule options remain available */ }
  }

  const livePersonObserver = chatTarget ? new MutationObserver(() => {
    const container = chatTarget.querySelector('.LPMcontainer');
    if (!container) return;
    if (chatFacade) chatFacade.hidden = true;
    if (proactiveActivation && !livePersonStarted) {
      const engagement = container.querySelector('[data-lp-event="click"], button, [role="button"]');
      if (!engagement) return;
      livePersonStarted = true;
      suppressVendorInvite();
      engagement.click();
      window.clearTimeout(proactiveStartTimeout);
      window.dispatchEvent(new CustomEvent(LIVEPERSON_FACADE_STARTED));
    }
    livePersonObserver.disconnect();
  }) : null;
  livePersonObserver?.observe(chatTarget, { childList: true, subtree: true });

  function onKeydown(e) {
    // eslint-disable-next-line no-use-before-define
    if (e.key === 'Escape') close();
  }

  function onOutside(e) {
    // eslint-disable-next-line no-use-before-define
    if (!root.contains(e.target)) close();
  }

  function open(trigger) {
    if (!document.documentElement.dataset.livepersonInviteActivated) {
      document.documentElement.dataset.livepersonInviteActivated = 'panel';
    }
    const proactiveFacade = document.getElementById('liveperson-invite-facade');
    if (proactiveFacade) proactiveFacade.hidden = true;
    lastTrigger = trigger || triggers[0];
    root.classList.add('cu-open');
    panel.hidden = false;
    closeBtn.focus();
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('click', onOutside, true);
    requestChat();
  }

  const activateFromInvite = (event) => {
    const source = event?.detail?.source
      || document.documentElement.dataset.livepersonInviteActivated;
    if (source === 'proactive') requestChat({ autoStart: true });
    else open(triggers[0]);
  };
  const inviteActivated = document.documentElement.dataset.livepersonInviteActivated;
  if (!inviteActivated) {
    window.addEventListener(LIVEPERSON_FACADE_ACTIVATE, activateFromInvite, { once: true });
  }

  const cleanup = (event) => {
    if (event.persisted) return;
    stopVendorInviteObserver();
    livePersonObserver?.disconnect();
    window.clearTimeout(proactiveStartTimeout);
    window.removeEventListener(LIVEPERSON_FACADE_ACTIVATE, activateFromInvite);
    window.removeEventListener('pagehide', cleanup);
  };
  window.addEventListener('pagehide', cleanup);

  function close() {
    root.classList.remove('cu-open');
    panel.hidden = true;
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('click', onOutside, true);
    if (lastTrigger) lastTrigger.focus();
  }

  triggers.forEach((t) => t.addEventListener('click', () => open(t)));
  closeBtn.addEventListener('click', close);

  // Blog "Schedule a call" reuses the shared modal; close the widget first so
  // the two overlays don't stack.
  const schedule = root.querySelector('.cu-schedule');
  if (schedule) {
    schedule.addEventListener('click', () => {
      close();
      openScheduleModal();
    });
  }

  // Floating sales widget -> talk_to_sales (a declared block tracks in <body>).
  // Every interactive item in this widget is presented as a CTA button,
  // including the support destination rendered as an <a>. Keep that visual
  // contract in the payload instead of letting the generic anchor derive
  // `ui_object=link` for the support CTA.
  trackAs('talk_to_sales', root, {
    key: 'talk-to-sales', linkName: false, uiObject: 'button',
  });

  document.body.append(root);
  if (inviteActivated) activateFromInvite();
}
