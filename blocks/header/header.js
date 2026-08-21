import { getMetadata } from '../../scripts/aem.js';
import { openScheduleModal } from '../form/form.js';
import { loadFragment } from '../fragment/fragment.js';
import { enhanceSecondaryNavSearch } from '../blog-search/search-utils.js';
import { trackAs } from '../../scripts/tracking.js';

function isExternal(href) {
  return /^https?:\/\//.test(href);
}

const CTA_CHEVRON_SVG = `<svg viewBox="0 0 6 10" width="6" height="10" focusable="false">
            <path fill="currentColor" d="M0.750913 2.86102e-06C0.602552 -0.00039196 0.457411 0.0412617 0.333906 0.119678C0.210401 0.198094 0.1141 0.309739 0.0572195 0.440448C0.000339537 0.571156 -0.0145552 0.715035 0.0144259 0.853832C0.0434069 0.992628 0.114957 1.12008 0.219998 1.22003L4.18876 4.99511L0.234226 8.7809C0.164751 8.84731 0.109669 8.92613 0.0721264 9.01285C0.0345832 9.09957 0.0153135 9.19249 0.0154178 9.28631C0.0155221 9.38013 0.0349982 9.47302 0.0727341 9.55966C0.11047 9.6463 0.165727 9.72501 0.235349 9.79128C0.304972 9.85755 0.387596 9.91009 0.478506 9.94591C0.569415 9.98172 0.66683 10.0001 0.765186 10C0.863543 9.9999 0.960916 9.98132 1.05175 9.94533C1.14258 9.90933 1.22508 9.85662 1.29456 9.79021L5.78075 5.49798C5.92114 5.36402 6 5.18237 6 4.99296C6 4.80356 5.92114 4.62191 5.78075 4.48795L1.27958 0.208579C1.21024 0.142269 1.12783 0.0897026 1.03709 0.0539055C0.946361 0.0181093 0.8491 -0.000210762 0.750913 2.86102e-06Z"/>
          </svg>`;

function brandLabel(img) {
  if (img.alt) return img.alt;
  const { iconName } = img.dataset;
  return iconName ? iconName.charAt(0).toUpperCase() + iconName.slice(1) : '';
}

function mobileBrandsHTML(brandLinks) {
  if (!brandLinks.length) return '';
  const items = brandLinks.map(({ a, label }) => {
    const img = a.querySelector('img');
    if (!img) return '';
    const href = a.getAttribute('href');
    const tgt = isExternal(href) ? ' target="_blank" rel="noopener"' : '';
    const text = label || brandLabel(img);
    return `<li><a href="${href}" class="mobile-brand-btn"${tgt}>${img.outerHTML}${text ? `<span>${text}</span>` : ''}<span class="mobile-brand-chevron" aria-hidden="true">${CTA_CHEVRON_SVG}</span></a></li>`;
  }).join('');
  return `<ul class="nav-mobile-brands">${items}</ul>`;
}

function mobileExtraHTML(brandLinks) {
  return `
    <div class="nav-mobile-extra">
      <button type="button" class="btn btn-primary nav-cta">
        <span class="nav-cta-text">Schedule a call</span>
        <span class="nav-cta-icon" aria-hidden="true">${CTA_CHEVRON_SVG}</span>
      </button>
      ${mobileBrandsHTML(brandLinks)}
    </div>`;
}

const FLYOUT_BACK_HTML = '<button type="button" class="flyout-back"><i class="flyout-back-icon"></i>Back</button>';

export function isResourceCenterPath(pathname = window.location.pathname) {
  return pathname === '/blog' || pathname.startsWith('/blog/');
}

function secondaryItemHTML(col, idx) {
  const clone = col.cloneNode(true);
  const heading = clone.querySelector(':scope > .flyout-heading')?.textContent.trim() || '';
  clone.querySelector(':scope > .flyout-heading')?.remove();
  const id = `secondary-flyout-${idx}`;
  const titleId = `${id}-title`;
  return `
      <div class="nav-item">
        <button type="button" aria-expanded="false" aria-controls="${id}">${heading}<i class="caret"></i></button>
        <div class="flyout" id="${id}" aria-hidden="true" aria-labelledby="${titleId}">${FLYOUT_BACK_HTML}<p class="flyout-title" id="${titleId}">${heading}</p><div class="flyout-inner"><div class="flyout-col">${clone.innerHTML}</div></div></div>
      </div>`;
}

function secondaryNavHTML(resourcesItem) {
  if (!isResourceCenterPath() || !resourcesItem) return '';
  const cols = [...resourcesItem.querySelectorAll('.flyout-col')].slice(1);
  const items = cols.map(secondaryItemHTML).join('');
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

function eventsBarHTML() {
  const enabled = ['true', 'yes'].includes(getMetadata('events-bar').trim().toLowerCase());
  if (!enabled) return '';
  const text = getMetadata('events-bar-text') || 'Check out';
  const href = getMetadata('events-bar-link') || '/events';
  const cta = getMetadata('events-bar-cta') || 'upcoming events and Intuit Enterprise Suite updates';
  const variant = (getMetadata('events-bar-variant') || '').trim().toLowerCase();
  const variantClass = variant === 'dark' ? ' ies-events-dark' : '';
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

function chromeHTML(topstripHTML, logoHTML, navMainHTML, eventsHTML, secondaryNavHtml) {
  return `
<div class="ies-topstrip">
  <div class="container">${topstripHTML}
  </div>
</div>
<div class="ies-nav-spacer">
  <div class="ies-nav" id="iesNav">
    <div class="container">
      ${logoHTML}
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

function topstripRowsHTML(brandLinks) {
  return brandLinks.map(({ a, label }) => {
    const img = a.querySelector('img');
    if (!img) return '';
    const href = a.getAttribute('href');
    const tgt = isExternal(href) ? ' target="_blank" rel="noopener"' : '';
    const ariaLabel = label ? '' : brandLabel(img);
    return `<a href="${href}" class="bs-logo"${tgt}${ariaLabel ? ` aria-label="${ariaLabel}"` : ''}>${img.outerHTML}${label ? `<span class="bs-logo-label">${label}</span>` : ''}</a>`;
  }).join('');
}

function chromeLogoHTML(logoLink) {
  if (!logoLink) return '';
  logoLink.classList.add('nav-logo');
  logoLink.setAttribute('aria-label', 'Intuit Enterprise Suite');
  return logoLink.outerHTML;
}

function brandLinksFromRow(row) {
  const lead = row?.children[0]?.querySelector('a');
  const rest = [...(row?.children[1]?.querySelectorAll(':scope > ul > li') || [])]
    .map((li) => {
      const a = li.querySelector('a');
      return a ? { a, label: li.textContent.trim() } : null;
    })
    .filter(Boolean);
  return lead ? [{ a: lead, label: '' }, ...rest] : rest;
}

// navigation.js has already decorated the main row's cell 2 into flat
// .nav-item/.nav-link markup by the time loadFragment returns, so it's
// identified here by that markup rather than the (now-gone) nested <ul>
// navigation.js itself used to find it.
async function fetchChromeHTML(path) {
  let frag = null;
  try {
    frag = await loadFragment(path);
  } catch (e) { /* missing/broken fragment — render no chrome content */ }
  const block = frag && frag.querySelector('.navigation');
  const rows = block ? [...block.children] : [];
  const mainRow = rows.find((row) => row.children[1]?.querySelector(':scope > .nav-item, :scope > .nav-link, :scope > .acct-link'));
  const utilityRow = rows.find((row) => row !== mainRow);

  const brandLinks = brandLinksFromRow(utilityRow);

  const logoLink = mainRow?.children[0]?.querySelector('a');
  const menuCell = mainRow?.children[1];
  const navMainHTML = menuCell?.children.length
    ? `<nav class="nav-main" aria-label="Primary">${menuCell.innerHTML}</nav>`
    : '';
  const resourcesItem = [...(menuCell?.children || [])]
    .find((item) => item.querySelector(':scope > button')?.textContent.trim() === 'Resources');

  return {
    navMainHTML, brandLinks, logoHTML: chromeLogoHTML(logoLink), resourcesItem,
  };
}

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

function wireFlyouts(block) {
  block.querySelectorAll('.nav-main').forEach(wireFlyoutGroup);
}

export default async function decorate(block) {
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : '/nav';
  const {
    navMainHTML, brandLinks, logoHTML, resourcesItem,
  } = await fetchChromeHTML(navPath);
  const stripHTML = topstripRowsHTML(brandLinks);
  const eventsHTML = eventsBarHTML();
  const secondaryHTML = secondaryNavHTML(resourcesItem);
  block.innerHTML = chromeHTML(stripHTML, logoHTML, navMainHTML, eventsHTML, secondaryHTML);
  block.classList.toggle('has-events-bar', !!eventsHTML);
  block.classList.toggle('has-secondary-nav', !!secondaryHTML);
  block.closest('header')?.classList.toggle('has-secondary-nav', !!secondaryHTML);
  block.querySelector('.ies-nav .nav-main')?.insertAdjacentHTML('beforeend', mobileExtraHTML(brandLinks));

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

  enhanceSecondaryNavSearch(block);

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

  block.querySelectorAll('.nav-cta').forEach((btn) => {
    btn.addEventListener('click', () => openScheduleModal());
  });

  // Click tracking (code-built chrome): nav toggles, brand logos and mega-menu
  // links report object=content / action=engaged (event content:engaged) with an
  // EMPTY ui_access_point — the header sits outside <main>, so the data-tracking
  // trail resolves to ''. link_name is suppressed (prod omits it on nav links).
  // ui_object is derived (link / link_icon for logos). The per-link residue
  // (data-wa-link like ies-nav:capabilities, object_detail like nav|capabilities)
  // and the primary "Schedule a call" CTA's action=interacted are authored
  // residue supplied by the tracking sheet, not derivable here.
  trackAs(null, block, { key: 'nav', action: 'engaged', linkName: false });
}
