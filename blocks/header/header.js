/**
 * header — Intuit Enterprise Suite chrome: brand strip + sticky nav + cyan
 * events bar. Reads the authorable /nav fragment when available (deployed),
 * otherwise renders the built-in chrome so it always paints (local QA + preview).
 * Sticky-nav scroll-morph, the click-to-open flyout menus, and the mobile
 * menu toggle are wired here. The nav CTA opens the shared "Schedule a call"
 * modal (scripts/schedule-modal.js) — also used by the hero CTA.
 * CSS: blocks/header/header.css · source fragment: content/nav.html
 */
import { getMetadata } from '../../scripts/aem.js';
import { openScheduleModal } from '../../scripts/schedule-modal.js';

// Primary nav model. `menu` entries open a flyout panel; `link` entries navigate
// directly. Links marked `internal: true` resolve to pages that already live on
// this site (they get an "On this site" tag); the rest fall back to the live
// erp.intuit.com pages so the whole nav is clickable while the migration is in flight.
const NAV = [
  {
    type: 'menu',
    label: 'Capabilities',
    columns: [
      {
        heading: 'Platform',
        links: [
          { text: 'ERP solutions overview', desc: 'The mid-market ERP for modern finance', href: '/erp-solutions', internal: true },
          { text: 'Accounting', desc: 'Powerful, connected financial tools', href: '/accounting', internal: true },
        ],
      },
      {
        heading: 'Automation & AI',
        links: [
          { text: 'AI agents', href: '/ai-agents', internal: true },
          { text: 'Workforce automation', href: '/workforce-automation', internal: true },
          { text: 'Payments & bill pay', href: '/payments-bill-pay', internal: true },
        ],
      },
      {
        heading: 'Finance & reporting',
        links: [
          { text: 'Multi-entity consolidation', href: '/multi-entity', internal: true },
          { text: 'Business intelligence & reporting', href: '/business-intelligence-reports', internal: true },
          { text: 'Business forecasting', href: '/business-forecasting', internal: true },
          { text: 'Custom ERP', href: '/custom-erp', internal: true },
        ],
      },
    ],
  },
  {
    type: 'menu',
    label: 'Industry tools',
    columns: [
      {
        heading: 'By industry',
        links: [
          { text: 'Construction', href: '/construction', internal: true },
          { text: 'Professional services', href: '/professional-services', internal: true },
          { text: 'Financial services', href: '/financial-services', internal: true },
        ],
      },
    ],
  },
  { type: 'link', label: 'Pricing', href: '/pricing', internal: true },
  {
    type: 'menu',
    label: 'Resources',
    columns: [
      {
        heading: 'Explore',
        links: [
          { text: 'Compare Intuit Enterprise Suite', desc: 'See how IES stacks up', href: '/compare', internal: true },
          { text: 'Blog', href: 'https://erp.intuit.com/blog/' },
          { text: 'Events', href: 'https://erp.intuit.com/events/' },
          { text: 'Case studies', href: '/case-studies', internal: true },
          { text: 'Research & Downloads', href: '/research', internal: true },
          { text: 'Migration', href: 'https://erp.intuit.com/migration/' },
        ],
      },
    ],
  },
  {
    type: 'menu',
    label: 'Support',
    columns: [
      {
        heading: 'Get help',
        links: [
          { text: 'Account management', href: 'https://erp.intuit.com/account-management/' },
          { text: 'Migration', href: 'https://erp.intuit.com/migration/' },
        ],
      },
    ],
  },
  { type: 'link', label: 'For accounting firms', href: 'https://erp.intuit.com/accountant/', cls: 'acct-link' },
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
  return `
      <div class="nav-item">
        <button type="button" aria-expanded="false" aria-controls="${id}">${entry.label}<i class="caret"></i></button>
        <div class="flyout" id="${id}" hidden><div class="flyout-inner">${cols}</div></div>
      </div>`;
}

const NAV_MAIN = `<nav class="nav-main" aria-label="Primary">${NAV.map(navItemHTML).join('')}</nav>`;

const CHROME = `
<div class="ies-topstrip">
  <div class="container">
    <a href="https://www.intuit.com/" class="intuit-word" aria-label="Intuit">INTUIT</a>
    <a href="https://turbotax.intuit.com/" class="bs-wm"><i class="bs-ic bs-tt">✓</i>turbotax</a>
    <a href="https://www.creditkarma.com/" class="bs-wm"><i class="bs-ic bs-ck">ck</i>creditkarma</a>
    <a href="https://quickbooks.intuit.com/" class="bs-wm"><i class="bs-ic bs-qb">qb</i>quickbooks</a>
    <a href="https://mailchimp.com/" class="bs-wm"><i class="bs-ic bs-mc">c</i>mailchimp</a>
  </div>
</div>
<div class="ies-nav" id="iesNav">
  <div class="container">
    <a class="nav-logo" href="/"><span class="ies-intuit">INTUIT</span><span class="ies-word">Enterprise&nbsp;Suite</span></a>
    ${NAV_MAIN}
    <div class="nav-right">
      <button type="button" class="btn btn-primary nav-cta">
        <span>Schedule a call</span>
        <svg class="nav-cta-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path d="M3 8h9M8.5 3.5 13 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button class="nav-toggle" aria-label="Menu"><span></span><span></span><span></span></button>
    </div>
  </div>
</div>
<div class="ies-events">
  <div class="container">
    Check out upcoming events and learn more about Intuit Enterprise Suite. <a href="https://erp.intuit.com/events/">Learn more</a>
  </div>
</div>`;

async function fetchFragment(path) {
  try {
    const resp = await fetch(`${path}.plain.html`);
    if (resp.ok) {
      const text = await resp.text();
      if (text && text.trim()) return text;
    }
  } catch (e) { /* fall back to built-in chrome */ }
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
  // Prefer the authored fragment only when it preserves the chrome markup AND the
  // flyout structure; the EDS content pipeline strips the ies-* classes, so fall
  // back to the canonical embedded chrome for a faithful, reliable render.
  const frag = await fetchFragment(navPath);
  block.innerHTML = (frag && frag.includes('nav-item') && frag.includes('flyout')) ? frag : CHROME;

  // sticky-nav scroll-morph
  const nav = block.querySelector('#iesNav, .ies-nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 36);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
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
