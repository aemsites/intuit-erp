/**
 * header — Intuit Enterprise Suite chrome: brand strip + sticky nav + an
 * optional cyan events/announcement bar. Brand strip, logo, and CTA are
 * fixed built-in chrome (CHROME below); the events bar is opt-in per page
 * via its Metadata block (see eventsBarHTML) so it doesn't show everywhere
 * by default; the primary nav-main menu is authorable content — see
 * blocks/nav-menu/nav-menu.js and content/nav.html's nav-menu block — with
 * NAV/navItemHTML below kept only as the fallback render if that content is
 * missing or malformed, so the header always paints.
 * Sticky-nav scroll-morph, the click-to-open flyout menus, and the mobile
 * menu toggle are wired here. The nav CTA opens the shared "Schedule a call"
 * modal (scripts/schedule-modal.js) — also used by the hero CTA.
 * On /blog/* pages only, a second "Resource center" nav bar renders below the
 * primary one (see secondaryNavHTML/isResourceCenterPath) — matching
 * erp.intuit.com, which has a dedicated Resource Center nav there too
 * (issue #59). On desktop it's this secondary nav that becomes sticky on
 * scroll, not the primary one — see the has-secondary-nav rules in header.css.
 * CSS: blocks/header/header.css · nav content: content/nav.html (nav-menu block)
 */
import { getMetadata } from '../../scripts/aem.js';
import { openScheduleModal } from '../form/form.js';
import { loadFragment } from '../fragment/fragment.js';
import { enhanceSecondaryNavSearch } from '../blog-search/search-utils.js';
import {
  LOGO_INTUIT,
  LOGO_TURBOTAX_ICON,
  LOGO_TURBOTAX_WORD,
  LOGO_CREDITKARMA_ICON,
  LOGO_CREDITKARMA_WORD,
  LOGO_QUICKBOOKS_ICON,
  LOGO_QUICKBOOKS_WORD,
  LOGO_MAILCHIMP_ICON,
  LOGO_MAILCHIMP_WORD,
  LOGO_IES,
} from './brand-logos.js';

// Shared with SECONDARY_NAV_ITEMS below (the /blog/* "Resource center" nav,
// see issue #59) so both navs list the exact same categories/links from one
// source instead of two copies drifting apart.
const INSIGHTS_LEARNING_LINKS = [
  { text: 'Thought leadership', href: '/blog/thought-leadership', internal: true },
  { text: 'Trends & research', href: '/blog/research', internal: true },
  { text: 'Compare ERPs', href: '/compare', internal: true },
];
const INDUSTRY_KNOWLEDGE_LINKS = [
  { text: 'Construction', href: '/blog/construction', internal: true },
  { text: 'Professional services', href: '/blog/professional-services', internal: true },
  { text: 'Manufacturing', href: '/blog/manufacturing', internal: true },
  { text: 'Non-profit', href: '/blog/non-profit', internal: true },
  { text: 'Retail', href: '/blog/retail', internal: true },
  { text: 'Food service', href: '/blog/food-service', internal: true },
];
const CUSTOMER_STORIES_LINKS = [
  { text: 'Case studies', href: '/blog/case-study', internal: true },
  { text: 'Testimonials', href: '/blog/videos/customer-testimonials', internal: true },
];
const EVENTS_WEBINARS_LINKS = [
  { text: 'Upcoming events', href: '/events', internal: true },
  { text: 'On-demand webinars', href: 'https://ieswebinars.intuit.com/hub/ondemand' },
];
const PRODUCT_RESOURCES_LINKS = [
  { text: 'Product demos', href: 'https://ieswebinars.intuit.com/hub/productdemo' },
  { text: 'New features & releases', href: '/blog/product-update', internal: true },
];

// Fallback nav model, used only when the authorable nav-menu block (see
// blocks/nav-menu/nav-menu.js) isn't available. `menu` entries open a flyout
// panel; `link` entries navigate directly. Links marked `internal: true`
// resolve to pages on this site and navigate in the same tab; the few
// remaining absolute links (ieswebinars.intuit.com) are external partner
// destinations that open in a new tab.
const NAV = [
  {
    type: 'menu',
    label: 'Capabilities',
    columns: [
      {
        heading: 'Financial management',
        links: [
          { text: 'Overview', href: '/accounting', internal: true },
          { text: 'Multi-entity management', href: '/accounting/multi-entity', internal: true },
          { text: 'Intelligent reporting', href: '/accounting/business-intelligence-reports', internal: true },
          { text: 'Dimensional forecasting', href: '/accounting/business-forecasting', internal: true },
          { text: 'Intuit AI', href: '/ai-agents', internal: true },
        ],
      },
      {
        heading: 'Streamlined tools',
        links: [
          { text: 'Overview', href: '/workforce-automation', internal: true },
          { text: 'HR & payroll', href: '/human-capital-management', internal: true },
          { text: 'Payments & bill pay', href: '/automation-tools/payments-bill-pay', internal: true },
        ],
      },
    ],
  },
  {
    type: 'menu',
    label: 'Industry tools',
    columns: [
      {
        links: [
          { text: 'Overview', href: '/custom-erp', internal: true },
          { text: 'Construction', href: '/construction', internal: true },
          { text: 'Professional services', href: '/professional-services', internal: true },
          { text: 'Financial services', href: '/financial-services', internal: true },
        ],
      },
    ],
  },
  {
    type: 'menu',
    label: 'Pricing',
    columns: [
      {
        links: [
          { text: 'Plans', href: '/pricing', internal: true },
          { text: 'Enterprise solutions', href: '/erp-solutions', internal: true },
        ],
      },
    ],
  },
  {
    type: 'menu',
    label: 'Resources',
    columns: [
      {
        heading: 'Resource center',
        links: [
          { text: 'Overview', href: '/blog', internal: true },
        ],
      },
      { heading: 'Insights & learning', links: INSIGHTS_LEARNING_LINKS },
      { heading: 'Industry knowledge', links: INDUSTRY_KNOWLEDGE_LINKS },
      { heading: 'Customer stories', links: CUSTOMER_STORIES_LINKS },
      { heading: 'Events & webinars', links: EVENTS_WEBINARS_LINKS },
      { heading: 'Product resources', links: PRODUCT_RESOURCES_LINKS },
    ],
  },
  {
    type: 'menu',
    label: 'Support',
    columns: [
      {
        links: [
          { text: 'How-to migrate', href: '/migration', internal: true },
          { text: 'Account management', href: '/account-management', internal: true },
        ],
      },
    ],
  },
  {
    type: 'link', label: 'For accounting firms', href: '/accountant', cls: 'acct-link', internal: true,
  },
];

// The secondary "Resource center" nav — a second, dedicated nav bar erp.intuit.com
// renders only on /blog/* pages (issue #59), separate from the primary nav above.
// Same `navItemHTML` menu-entry shape as NAV, built from the shared link arrays
// above so both navs can't drift apart. Search (also present on the live
// secondary nav) is tracked separately as issue #60 — not implemented here.
const SECONDARY_NAV_ITEMS = [
  { type: 'menu', label: 'Insights & learning', columns: [{ links: INSIGHTS_LEARNING_LINKS }] },
  { type: 'menu', label: 'Industries', columns: [{ links: INDUSTRY_KNOWLEDGE_LINKS }] },
  { type: 'menu', label: 'Customer stories', columns: [{ links: CUSTOMER_STORIES_LINKS }] },
  { type: 'menu', label: 'Events & webinars', columns: [{ links: EVENTS_WEBINARS_LINKS }] },
  { type: 'menu', label: 'Product resources', columns: [{ links: PRODUCT_RESOURCES_LINKS }] },
];

const CTA_CHEVRON_SVG = `<svg viewBox="0 0 6 10" width="6" height="10" focusable="false">
            <path fill="currentColor" d="M0.750913 2.86102e-06C0.602552 -0.00039196 0.457411 0.0412617 0.333906 0.119678C0.210401 0.198094 0.1141 0.309739 0.0572195 0.440448C0.000339537 0.571156 -0.0145552 0.715035 0.0144259 0.853832C0.0434069 0.992628 0.114957 1.12008 0.219998 1.22003L4.18876 4.99511L0.234226 8.7809C0.164751 8.84731 0.109669 8.92613 0.0721264 9.01285C0.0345832 9.09957 0.0153135 9.19249 0.0154178 9.28631C0.0155221 9.38013 0.0349982 9.47302 0.0727341 9.55966C0.11047 9.6463 0.165727 9.72501 0.235349 9.79128C0.304972 9.85755 0.387596 9.91009 0.478506 9.94591C0.569415 9.98172 0.66683 10.0001 0.765186 10C0.863543 9.9999 0.960916 9.98132 1.05175 9.94533C1.14258 9.90933 1.22508 9.85662 1.29456 9.79021L5.78075 5.49798C5.92114 5.36402 6 5.18237 6 4.99296C6 4.80356 5.92114 4.62191 5.78075 4.48795L1.27958 0.208579C1.21024 0.142269 1.12783 0.0897026 1.03709 0.0539055C0.946361 0.0181093 0.8491 -0.000210762 0.750913 2.86102e-06Z"/>
          </svg>`;

// Appended to .nav-main by decorate() (not part of chromeHTML's nav row) so
// it's present regardless of whether the nav-menu content is authored or
// falls back to NAV_MAIN_FALLBACK. Mobile-only — see header.css — matching
// erp.intuit.com's own mobile menu, which puts a "Schedule a call" CTA and
// the cross-sell brand strip inside the opened drawer, after the nav links.
// Each brand link renders as its own full-width filled button/bar (icon +
// name + trailing chevron) — matching erp.intuit.com's own mobile drawer
// exactly (confirmed live: .S01MegaNav-brand-button, 48px bars, 16px gap) —
// not the small inline icon+wordmark row used in .ies-topstrip (issue #78).
// Intuit's own bar uses the brand-blue fill (#236cff, the same blue as the
// Intuit logomark itself) with the logo inverted to white via CSS filter;
// the other four use the shared navy fill with a plain lowercase brand-name
// label, since source renders those as plain text there, not their full
// wordmark lockups.
function mobileExtraHTML() {
  return `
    <div class="nav-mobile-extra">
      <button type="button" class="btn btn-primary nav-cta">
        <span class="nav-cta-text">Schedule a call</span>
        <span class="nav-cta-icon" aria-hidden="true">${CTA_CHEVRON_SVG}</span>
      </button>
      <ul class="nav-mobile-brands">
        <li><a href="https://www.intuit.com/" class="mobile-brand-btn mobile-brand-intuit" aria-label="Intuit">${LOGO_INTUIT}<span class="mobile-brand-chevron" aria-hidden="true">${CTA_CHEVRON_SVG}</span></a></li>
        <li><a href="https://turbotax.intuit.com/" class="mobile-brand-btn" target="_blank" rel="noopener">${LOGO_TURBOTAX_ICON}<span>turbotax</span><span class="mobile-brand-chevron" aria-hidden="true">${CTA_CHEVRON_SVG}</span></a></li>
        <li><a href="https://www.creditkarma.com/" class="mobile-brand-btn" target="_blank" rel="noopener">${LOGO_CREDITKARMA_ICON}<span>creditkarma</span><span class="mobile-brand-chevron" aria-hidden="true">${CTA_CHEVRON_SVG}</span></a></li>
        <li><a href="https://quickbooks.intuit.com/" class="mobile-brand-btn" target="_blank" rel="noopener">${LOGO_QUICKBOOKS_ICON}<span>quickbooks</span><span class="mobile-brand-chevron" aria-hidden="true">${CTA_CHEVRON_SVG}</span></a></li>
        <li><a href="https://mailchimp.com/" class="mobile-brand-btn" target="_blank" rel="noopener">${LOGO_MAILCHIMP_ICON}<span>mailchimp</span><span class="mobile-brand-chevron" aria-hidden="true">${CTA_CHEVRON_SVG}</span></a></li>
      </ul>
    </div>`;
}

// Mobile-only "Back" control at the top of each flyout, returning to the
// top-level list — see the drill-down CSS in header.css. Hidden on desktop.
const FLYOUT_BACK_HTML = '<button type="button" class="flyout-back"><i class="flyout-back-icon"></i>Back</button>';

function linkHTML(l) {
  const cls = `flyout-link${l.internal ? ' is-internal' : ''}`;
  const tgt = l.internal ? '' : ' target="_blank" rel="noopener"';
  const desc = l.desc ? `<span class="flyout-desc">${l.desc}</span>` : '';
  return `<a class="${cls}" href="${l.href}"${tgt}><span class="flyout-label">${l.text}</span>${desc}</a>`;
}

// idPrefix keeps flyout ids unique when the primary and secondary nav (see
// SECONDARY_NAV_ITEMS) render on the same page — both call this with their
// own prefix so ids never collide.
function navItemHTML(entry, idx, idPrefix = 'flyout') {
  if (entry.type === 'link') {
    const cls = entry.cls || 'nav-link';
    const tgt = entry.internal ? '' : ' target="_blank" rel="noopener"';
    return `<a class="${cls}" href="${entry.href}"${tgt}>${entry.label}</a>`;
  }
  const id = `${idPrefix}-${idx}`;
  const cols = entry.columns.map((c) => `
        <div class="flyout-col">
          ${c.heading ? `<p class="flyout-heading">${c.heading}</p>` : ''}
          ${c.links.map(linkHTML).join('')}
        </div>`).join('');
  // flyout-title is mobile-only (see header.css) — the drill-down panel's own
  // page-title label repeating the trigger's label, since that trigger
  // itself has slid off-screen by the time the panel is showing (issue #78).
  // Not a heading element: this is nav chrome, not page content, so it must
  // stay out of the document's heading outline (issue: nav h2 breaks
  // heading hierarchy) — aria-labelledby gives the panel the same
  // screen-reader context without a fake <h2>.
  const titleId = `${id}-title`;
  return `
      <div class="nav-item">
        <button type="button" aria-expanded="false" aria-controls="${id}">${entry.label}<i class="caret"></i></button>
        <div class="flyout" id="${id}" aria-hidden="true" aria-labelledby="${titleId}">${FLYOUT_BACK_HTML}<p class="flyout-title" id="${titleId}">${entry.label}</p><div class="flyout-inner">${cols}</div></div>
      </div>`;
}

const NAV_MAIN_FALLBACK = `<nav class="nav-main" aria-label="Primary">${NAV.map((e, i) => navItemHTML(e, i)).join('')}</nav>`;

// True on /blog and every /blog/* page — the whole Resource Center section,
// not just article pages (contrast with blog-template.js's narrower
// isBlogPage(), which is limited to article templates for its TOC/hero UI).
export function isResourceCenterPath(pathname = window.location.pathname) {
  return pathname === '/blog' || pathname.startsWith('/blog/');
}

// The secondary "Resource center" nav bar (issue #59) — desktop renders it as
// its own row with a brand link + inline flyout items; mobile collapses it
// behind its own toggle (.secondary-nav-toggle), independent of the primary
// hamburger — see header.css. Returns '' outside the Resource Center section
// so decorate() can skip wiring it up entirely.
function secondaryNavHTML() {
  if (!isResourceCenterPath()) return '';
  const items = SECONDARY_NAV_ITEMS.map((e, i) => navItemHTML(e, i, 'secondary-flyout')).join('');
  return `
<div class="ies-secondary-nav-spacer">
  <nav class="ies-secondary-nav" aria-label="Resource center">
    <div class="container">
      <a class="secondary-nav-brand" href="/blog">Resource center</a>
      <button type="button" class="secondary-nav-toggle" aria-expanded="false" aria-controls="secondary-nav-items" aria-label="Toggle Resource center menu"><i class="caret"></i></button>
      <div class="nav-main secondary-nav-items" id="secondary-nav-items">${items}</div>
    </div>
  </nav>
</div>`;
}

// Cyan events bar under the nav — off by default, per-page opt-in via the
// page's Metadata block (e.g. a row labeled "Events Bar" with value "true"
// becomes <meta name="events-bar" content="true">, following the same
// kebab-cased convention as "nav"/"footer"/"right-rail" elsewhere). Text,
// link, and CTA label are independently overridable the same way, so a
// page can reuse the bar for an unrelated announcement instead of events.
function eventsBarHTML() {
  const enabled = ['true', 'yes'].includes(getMetadata('events-bar').trim().toLowerCase());
  if (!enabled) return '';
  const text = getMetadata('events-bar-text') || 'Check out';
  const href = getMetadata('events-bar-link') || '/events';
  const cta = getMetadata('events-bar-cta') || 'upcoming events and Intuit Enterprise Suite updates';
  // Optional per-page colour variant. Default is the cyan bar; "dark" gives the
  // navy/white treatment (e.g. /construction's open-beta banner on the source).
  const variant = (getMetadata('events-bar-variant') || '').trim().toLowerCase();
  const variantClass = variant === 'dark' ? ' ies-events-dark' : '';
  // Optional accent phrase inside the text (e.g. "construction edition"),
  // rendered in the accent colour to match the source. Plain-text match so
  // authoring stays a simple metadata value.
  const highlight = (getMetadata('events-bar-highlight') || '').trim();
  const renderedText = highlight && text.includes(highlight)
    ? text.replace(highlight, `<span class="ies-events-hl">${highlight}</span>`)
    : text;
  return `
<div class="ies-events${variantClass}">
  <div class="container">
    ${renderedText} <a href="${href}">${cta}</a>
  </div>
</div>`;
}

function chromeHTML(navMainHTML, eventsHTML, secondaryNavHtml) {
  return `
<div class="ies-topstrip">
  <div class="container">
    <a href="https://www.intuit.com/" class="bs-logo bs-logo-intuit" aria-label="Intuit">${LOGO_INTUIT}</a>
    <a href="https://turbotax.intuit.com/" class="bs-logo bs-logo-turbotax" target="_blank" rel="noopener" aria-label="TurboTax">${LOGO_TURBOTAX_ICON}${LOGO_TURBOTAX_WORD}</a>
    <a href="https://www.creditkarma.com/" class="bs-logo bs-logo-creditkarma" target="_blank" rel="noopener" aria-label="Credit Karma">${LOGO_CREDITKARMA_ICON}${LOGO_CREDITKARMA_WORD}</a>
    <a href="https://quickbooks.intuit.com/" class="bs-logo bs-logo-quickbooks" target="_blank" rel="noopener" aria-label="QuickBooks">${LOGO_QUICKBOOKS_ICON}${LOGO_QUICKBOOKS_WORD}</a>
    <a href="https://mailchimp.com/" class="bs-logo bs-logo-mailchimp" target="_blank" rel="noopener" aria-label="Mailchimp">${LOGO_MAILCHIMP_ICON}${LOGO_MAILCHIMP_WORD}</a>
  </div>
</div>
<div class="ies-nav-spacer">
  <div class="ies-nav" id="iesNav">
    <div class="container">
      <a class="nav-logo" href="/" aria-label="Intuit Enterprise Suite">${LOGO_IES}</a>
      ${navMainHTML}
      <div class="nav-right">
        <button type="button" class="btn btn-primary nav-cta">
          <span class="nav-cta-text">Schedule a call</span>
          <span class="nav-cta-icon" aria-hidden="true">${CTA_CHEVRON_SVG}</span>
        </button>
        <button class="nav-toggle" aria-label="Menu"><span></span><span></span><span></span></button>
      </div>
    </div>
  </div>
</div>
${secondaryNavHtml}
${eventsHTML}`;
}

// The nav-menu block (blocks/nav-menu/nav-menu.js) is decorated in full by
// loadFragment before it returns, so menuBlock's markup is already the final
// nav-item/flyout DOM — just needs the <nav> landmark wrapped around it.
async function fetchNavMainHTML(path) {
  try {
    const frag = await loadFragment(path);
    const menuBlock = frag && frag.querySelector('.nav-menu');
    if (menuBlock && menuBlock.querySelector('.nav-item, .nav-link, .acct-link')) {
      return `<nav class="nav-main" aria-label="Primary">${menuBlock.innerHTML}</nav>`;
    }
  } catch (e) { /* fall back to built-in nav */ }
  return null;
}

// Wire the click-to-open flyouts for one nav group (primary .nav-main, or the
// secondary Resource Center nav's .secondary-nav-items — see wireFlyouts):
// one panel open at a time within the group, closes on outside click or
// Escape. Desktop shows the open one as a dropdown; mobile drills into it
// full-screen instead (see header.css) — the group's "has-open" class (kept
// in sync with whether any item is open) drives that slide, and each
// flyout's "Back" control (.flyout-back) just calls closeAll().
// aria-hidden="true" on a still-focusable subtree is an accessibility
// violation (keyboard/AT users can tab into content the screen reader is
// told doesn't exist), so a closed flyout's links/buttons also need
// tabindex="-1" pulled out of the tab order; reopening restores default
// (DOM-order) focusability by removing the override entirely.
const FLYOUT_FOCUSABLE = 'a[href], button:not(:disabled)';
function syncFlyoutFocusability(panel, open) {
  panel.querySelectorAll(FLYOUT_FOCUSABLE).forEach((el) => {
    if (open) el.removeAttribute('tabindex');
    else el.setAttribute('tabindex', '-1');
  });
}

function wireFlyoutGroup(nav) {
  const items = [...nav.querySelectorAll('.nav-item')];
  if (!items.length) return;

  const setOpen = (item, open) => {
    item.classList.toggle('open', open);
    const btn = item.querySelector('button');
    const panel = item.querySelector('.flyout');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (panel) {
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
      syncFlyoutFocusability(panel, open);
    }
    nav.classList.toggle('has-open', items.some((it) => it.classList.contains('open')));
  };
  // panels start aria-hidden="true" in the authored markup, so their
  // focusable descendants need the same tabindex="-1" sync up front.
  nav.querySelectorAll('.flyout').forEach((panel) => syncFlyoutFocusability(panel, false));
  const closeAll = (except) => items.forEach((it) => { if (it !== except) setOpen(it, false); });

  items.forEach((item) => {
    const btn = item.querySelector('button');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !item.classList.contains('open');
      closeAll(item);
      setOpen(item, willOpen);
    });
  });

  nav.querySelectorAll('.flyout-back').forEach((backBtn) => {
    backBtn.addEventListener('click', () => closeAll());
  });

  document.addEventListener('click', (e) => { if (!nav.contains(e.target)) closeAll(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
}

// Primary nav and, on /blog/* pages, the secondary Resource Center nav (see
// secondaryNavHTML) each get their own independent group — opening a flyout
// in one never affects the other.
function wireFlyouts(block) {
  block.querySelectorAll('.nav-main').forEach(wireFlyoutGroup);
}

export default async function decorate(block) {
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : '/nav';
  const navMainHTML = (await fetchNavMainHTML(navPath)) || NAV_MAIN_FALLBACK;
  const eventsHTML = eventsBarHTML();
  const secondaryHTML = secondaryNavHTML();
  block.innerHTML = chromeHTML(navMainHTML, eventsHTML, secondaryHTML);
  // The min-height reserved to avoid layout shift while this decorates
  // async only needs to be the taller value (see header.css) on the pages
  // that actually opted into the events bar / have the secondary nav.
  block.classList.toggle('has-events-bar', !!eventsHTML);
  block.classList.toggle('has-secondary-nav', !!secondaryHTML);
  // Also on the outer <header> element (not just this block) — that's where
  // position:sticky lives (see header.css), and on /blog/* pages it's the
  // secondary nav that should stick on scroll, not the primary one.
  block.closest('header')?.classList.toggle('has-secondary-nav', !!secondaryHTML);
  block.querySelector('.ies-nav .nav-main')?.insertAdjacentHTML('beforeend', mobileExtraHTML());

  // Sticky nav, matching erp.intuit.com's own scroll behavior exactly
  // (confirmed live: its nav row is position:fixed with a `top` inline style
  // computed as max(0, topstripHeight - scrollY) on every scroll tick — not a
  // CSS transition or class toggle, hence the smooth 1:1 slide as the brand
  // strip scrolls away underneath it, rather than an abrupt snap. .ies-nav
  // itself is position:fixed in header.css; .ies-nav-spacer reserves its
  // height in flow so nothing jumps. .ies-topstrip and .ies-events are plain,
  // non-sticky flow content — they simply scroll away like any other page
  // content (issue #78).
  // On /blog/* pages (has-secondary-nav) it's the secondary Resource Center
  // nav that becomes the fixed band instead at desktop widths, sliding up to
  // cover the combined height of the topstrip + primary nav — matching the
  // documented intent that those two rows scroll away above it, not the
  // primary nav (see the has-secondary-nav rules in header.css).
  const topstrip = block.querySelector('.ies-topstrip');
  const nav = block.querySelector('#iesNav, .ies-nav');
  const fixedSecondaryNav = block.querySelector('.ies-secondary-nav');
  const desktopMedia = window.matchMedia('(min-width: 1300px)');
  if (nav) {
    let scrollTicking = false;
    const onScroll = () => {
      const topstripH = topstrip ? topstrip.offsetHeight : 0;
      const y = window.scrollY;
      if (fixedSecondaryNav && desktopMedia.matches) {
        fixedSecondaryNav.style.top = `${Math.max(0, (topstripH + nav.offsetHeight) - y)}px`;
      } else {
        const offset = Math.max(0, topstripH - y);
        nav.style.top = `${offset}px`;
        nav.classList.toggle('scrolled', offset === 0 && y > 0);
      }
      scrollTicking = false;
    };
    const requestScrollTick = () => {
      if (!scrollTicking) {
        scrollTicking = true;
        requestAnimationFrame(onScroll);
      }
    };
    requestScrollTick();
    window.addEventListener('scroll', requestScrollTick, { passive: true });
    window.addEventListener('resize', requestScrollTick, { passive: true });
  }

  wireFlyouts(block);

  // Resource Center search (issue #60): adds the expand-on-click search widget
  // to the secondary "Resource center" nav (issue #59) when it's present. No-op
  // otherwise — dormant on main until that nav lands, absent off /blog after.
  enhanceSecondaryNavSearch(block);

  // mobile menu toggle — locks body scroll and morphs the hamburger into an
  // "X" while the full-screen drawer is open (see .header.nav-open .nav-main
  // in header.css), matching erp.intuit.com's own mobile menu behavior.
  const toggle = block.querySelector('.nav-toggle');
  const navMain = block.querySelector('.ies-nav .nav-main');
  if (toggle && navMain) {
    toggle.addEventListener('click', () => {
      const open = block.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
      document.body.classList.toggle('nav-scroll-lock', open);
    });
  }

  // Secondary (Resource Center) nav accordion — mobile only, separate from the
  // primary hamburger above so opening one never opens the other (see the
  // .ies-secondary-nav rules in header.css). On mobile the WHOLE top bar
  // toggles it (brand text, caret, and the gap between), not just the caret: a
  // single click handler on the nav catches clicks anywhere except inside the
  // expanded item list (.secondary-nav-items, whose own links/flyouts must
  // still work), and preventDefault stops the brand link (href="/blog") from
  // navigating away on tap. On desktop (>=1300, where the caret toggle is
  // display:none) the media guard bails out immediately, so the brand stays a
  // normal link to the blog home and the item flyouts behave as usual.
  const secondaryNav = block.querySelector('.ies-secondary-nav');
  const secondaryToggle = block.querySelector('.secondary-nav-toggle');
  if (secondaryNav && secondaryToggle) {
    const mobileAccordion = window.matchMedia('(max-width: 1299px)');
    secondaryNav.addEventListener('click', (e) => {
      if (!mobileAccordion.matches) return;
      if (e.target.closest('.secondary-nav-items')) return;
      e.preventDefault();
      const open = secondaryNav.classList.toggle('open');
      secondaryToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // "Schedule a call" — opens the modal instead of navigating
  block.querySelectorAll('.nav-cta').forEach((btn) => {
    btn.addEventListener('click', () => openScheduleModal());
  });
}
