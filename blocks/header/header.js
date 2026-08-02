/**
 * header — Intuit Enterprise Suite chrome: brand strip + sticky nav + cyan
 * events bar. Brand strip, logo, CTA, and events bar are the fixed built-in
 * chrome (CHROME below); the primary nav-main menu is authorable content —
 * see blocks/nav-menu/nav-menu.js and content/nav.html's nav-menu block —
 * with NAV/navItemHTML below kept only as the fallback render if that
 * content is missing or malformed, so the header always paints.
 * Sticky-nav scroll-morph, the click-to-open flyout menus, and the mobile
 * menu toggle are wired here. The nav CTA opens the shared "Schedule a call"
 * modal (scripts/schedule-modal.js) — also used by the hero CTA.
 * CSS: blocks/header/header.css · nav content: content/nav.html (nav-menu block)
 */
import { getMetadata } from '../../scripts/aem.js';
import { openScheduleModal } from '../../scripts/schedule-modal.js';
import { loadFragment } from '../fragment/fragment.js';
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

// Fallback nav model, used only when the authorable nav-menu block (see
// blocks/nav-menu/nav-menu.js) isn't available. `menu` entries open a flyout
// panel; `link` entries navigate directly. Links marked `internal: true`
// resolve to pages that already live on this site; the rest fall back to the
// live erp.intuit.com pages so the whole nav is clickable while the
// migration is in flight.
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
          { text: 'HR & payroll', href: 'https://erp.intuit.com/human-capital-management/' },
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
          { text: 'Overview', href: 'https://erp.intuit.com/blog/' },
        ],
      },
      {
        heading: 'Insights & learning',
        links: [
          { text: 'Thought leadership', href: 'https://erp.intuit.com/blog/thought-leadership/' },
          { text: 'Trends & research', href: '/blog/research', internal: true },
          { text: 'Compare ERPs', href: '/compare', internal: true },
        ],
      },
      {
        heading: 'Industry knowledge',
        links: [
          { text: 'Construction', href: 'https://erp.intuit.com/blog/construction/' },
          { text: 'Professional services', href: 'https://erp.intuit.com/blog/professional-services/' },
          { text: 'Manufacturing', href: 'https://erp.intuit.com/blog/manufacturing/' },
          { text: 'Non-profit', href: 'https://erp.intuit.com/blog/non-profit/' },
          { text: 'Retail', href: 'https://erp.intuit.com/blog/retail/' },
          { text: 'Food service', href: 'https://erp.intuit.com/blog/food-service/' },
        ],
      },
      {
        heading: 'Customer stories',
        links: [
          { text: 'Case studies', href: '/blog/case-study', internal: true },
          { text: 'Testimonials', href: 'https://erp.intuit.com/blog/videos/customer-testimonials/' },
        ],
      },
      {
        heading: 'Events & webinars',
        links: [
          { text: 'Upcoming events', href: '/events', internal: true },
          { text: 'On-demand webinars', href: 'https://ieswebinars.intuit.com/hub/ondemand' },
        ],
      },
      {
        heading: 'Product resources',
        links: [
          { text: 'Product demos', href: 'https://ieswebinars.intuit.com/hub/productdemo' },
          { text: 'New features & releases', href: 'https://erp.intuit.com/blog/product-update/' },
        ],
      },
    ],
  },
  {
    type: 'menu',
    label: 'Support',
    columns: [
      {
        links: [
          { text: 'How-to migrate', href: '/migration', internal: true },
          { text: 'Account management', href: 'https://erp.intuit.com/account-management/' },
        ],
      },
    ],
  },
  {
    type: 'link', label: 'For accounting firms', href: 'https://erp.intuit.com/accountant/', cls: 'acct-link',
  },
];

function linkHTML(l) {
  const cls = `flyout-link${l.internal ? ' is-internal' : ''}`;
  const tgt = l.internal ? '' : ' target="_blank" rel="noopener"';
  const desc = l.desc ? `<span class="flyout-desc">${l.desc}</span>` : '';
  return `<a class="${cls}" href="${l.href}"${tgt}><span class="flyout-label">${l.text}</span>${desc}</a>`;
}

function navItemHTML(entry, idx) {
  if (entry.type === 'link') {
    const cls = entry.cls || 'nav-link';
    const tgt = entry.internal ? '' : ' target="_blank" rel="noopener"';
    return `<a class="${cls}" href="${entry.href}"${tgt}>${entry.label}</a>`;
  }
  const id = `flyout-${idx}`;
  const cols = entry.columns.map((c) => `
        <div class="flyout-col">
          ${c.heading ? `<p class="flyout-heading">${c.heading}</p>` : ''}
          ${c.links.map(linkHTML).join('')}
        </div>`).join('');
  const wideCls = entry.columns.length > 3 ? ' flyout-wide' : '';
  return `
      <div class="nav-item">
        <button type="button" aria-expanded="false" aria-controls="${id}">${entry.label}<i class="caret"></i></button>
        <div class="flyout${wideCls}" id="${id}" hidden><div class="flyout-inner">${cols}</div></div>
      </div>`;
}

const NAV_MAIN_FALLBACK = `<nav class="nav-main" aria-label="Primary">${NAV.map(navItemHTML).join('')}</nav>`;

function chromeHTML(navMainHTML) {
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
<div class="ies-nav" id="iesNav">
  <div class="container">
    <a class="nav-logo" href="/" aria-label="Intuit Enterprise Suite">${LOGO_IES}</a>
    ${navMainHTML}
    <div class="nav-right">
      <button type="button" class="btn btn-primary nav-cta">
        <span class="nav-cta-text">Schedule a call</span>
        <span class="nav-cta-icon" aria-hidden="true">
          <svg viewBox="0 0 6 10" width="6" height="10" focusable="false">
            <path fill="currentColor" d="M0.750913 2.86102e-06C0.602552 -0.00039196 0.457411 0.0412617 0.333906 0.119678C0.210401 0.198094 0.1141 0.309739 0.0572195 0.440448C0.000339537 0.571156 -0.0145552 0.715035 0.0144259 0.853832C0.0434069 0.992628 0.114957 1.12008 0.219998 1.22003L4.18876 4.99511L0.234226 8.7809C0.164751 8.84731 0.109669 8.92613 0.0721264 9.01285C0.0345832 9.09957 0.0153135 9.19249 0.0154178 9.28631C0.0155221 9.38013 0.0349982 9.47302 0.0727341 9.55966C0.11047 9.6463 0.165727 9.72501 0.235349 9.79128C0.304972 9.85755 0.387596 9.91009 0.478506 9.94591C0.569415 9.98172 0.66683 10.0001 0.765186 10C0.863543 9.9999 0.960916 9.98132 1.05175 9.94533C1.14258 9.90933 1.22508 9.85662 1.29456 9.79021L5.78075 5.49798C5.92114 5.36402 6 5.18237 6 4.99296C6 4.80356 5.92114 4.62191 5.78075 4.48795L1.27958 0.208579C1.21024 0.142269 1.12783 0.0897026 1.03709 0.0539055C0.946361 0.0181093 0.8491 -0.000210762 0.750913 2.86102e-06Z"/>
          </svg>
        </span>
      </button>
      <button class="nav-toggle" aria-label="Menu"><span></span><span></span><span></span></button>
    </div>
  </div>
</div>
<div class="ies-events">
  <div class="container">
    Check out upcoming events and learn more about Intuit Enterprise Suite. <a href="/events">Learn more</a>
  </div>
</div>`;
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

// Wire the click-to-open flyouts: one panel open at a time, closes on outside
// click or Escape. Works as a stacked accordion on mobile via CSS.
function wireFlyouts(block) {
  const nav = block.querySelector('.nav-main');
  if (!nav) return;
  const items = [...nav.querySelectorAll('.nav-item')];
  if (!items.length) return;

  const setOpen = (item, open) => {
    item.classList.toggle('open', open);
    const btn = item.querySelector('button');
    const panel = item.querySelector('.flyout');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (panel) panel.hidden = !open;
  };
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

  document.addEventListener('click', (e) => { if (!nav.contains(e.target)) closeAll(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
}

export default async function decorate(block) {
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : '/nav';
  const navMainHTML = (await fetchNavMainHTML(navPath)) || NAV_MAIN_FALLBACK;
  block.innerHTML = chromeHTML(navMainHTML);

  // sticky-nav scroll-morph. Reading window.scrollY forces a synchronous
  // layout if styles were just invalidated (e.g. the innerHTML write above),
  // so the read is rAF-deferred rather than run inline — this also throttles
  // it to once per frame instead of once per scroll event.
  const nav = block.querySelector('#iesNav, .ies-nav');
  if (nav) {
    let scrollTicking = false;
    const onScroll = () => {
      nav.classList.toggle('scrolled', window.scrollY > 36);
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
  }

  wireFlyouts(block);

  // mobile menu toggle
  const toggle = block.querySelector('.nav-toggle');
  const navMain = block.querySelector('.nav-main');
  if (toggle && navMain) {
    toggle.addEventListener('click', () => {
      const open = block.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // "Schedule a call" — opens the modal instead of navigating
  block.querySelectorAll('.nav-cta').forEach((btn) => {
    btn.addEventListener('click', () => openScheduleModal());
  });
}
