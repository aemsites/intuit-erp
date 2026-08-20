/**
 * footer — two-tier IES footer (link columns + search + sitemap/social; then
 * legal tier with Intuit logo, brand marks, copyright, legal links, TRUSTe).
 * On mobile the link columns collapse into accordions, the "Select Country"
 * selector drops under the columns, and the legal tier regroups (logos on one
 * row, About links beside the copyright) to mirror erp.intuit.com.
 * Reads the authorable /footer fragment: a "Footer Columns" block supplies
 * the 4 link columns and a "Footer Legal" block supplies the legal nav,
 * copyright paragraphs, and legal links line. Brand/social SVGs, the country
 * selector, and the search input are fixed UI chrome, not authored content.
 * If a block is missing from the fragment, that section renders empty.
 * Authored markup is trusted (DA authors, not end users) and injected as-is —
 * no HTML escaping/sanitization here by design.
 * CSS: blocks/footer/footer.css · source fragment: content/footer.html
 */
import { getMetadata } from '../../scripts/aem.js';
import {
  FOOTER_LOGO_INTUIT,
  FOOTER_LOGO_TURBOTAX,
  FOOTER_LOGO_CREDITKARMA,
  FOOTER_LOGO_QUICKBOOKS,
} from './brand-logos.js';
import { LOGO_MAILCHIMP_ICON, LOGO_MAILCHIMP_WORD } from '../header/brand-logos.js';
import { wireFooterSearch } from '../blog-search/search-utils.js';

// "Footer Columns" content model: one row per column, cell 1 = heading text,
// cell 2 = a list of links. Authors add/remove/reorder rows to add/remove
// columns, and edit/reorder the <li> items per column (hyperlinked or plain
// text) freely — the authored <ul> markup is used as-is.
function parseFooterColumns(doc) {
  const block = doc.querySelector('.footer-columns');
  if (!block) return null;
  const columns = [...block.children].map((row) => {
    const [titleCell, linksCell] = row.children;
    const title = (titleCell?.textContent || '').trim();
    const listHtml = (linksCell?.querySelector('ul')?.innerHTML || '').trim();
    return { title, listHtml };
  }).filter((col) => col.title && col.listHtml);
  return columns.length ? columns : null;
}

// "Footer Legal" content model: one row with a <ul> of links (legal nav),
// one row with 2+ <p> (copyright/disclosure copy), and one remaining row
// (the Legal | Privacy | Security | Compliance links line) — identified by
// shape rather than position, so reordering the rows doesn't misparse them.
function parseFooterLegal(doc) {
  const block = doc.querySelector('.footer-legal');
  if (!block) return null;
  const rows = [...block.children];
  const navRow = rows.find((row) => row.querySelector('ul'));
  const remaining = rows.filter((row) => row !== navRow);
  const copyRow = remaining.find((row) => row.querySelectorAll('p').length > 1);
  const linksRow = remaining.find((row) => row !== copyRow);

  const navHtml = (navRow?.querySelector('ul')?.innerHTML || '').trim();
  const copyHtml = (copyRow ? [...copyRow.querySelectorAll('p')].map((p) => `<p class="footer-copy">${p.innerHTML}</p>`).join('\n            ') : '');
  const linksHtml = (linksRow?.querySelector('p')?.innerHTML || '').trim();

  if (!navHtml && !copyHtml && !linksHtml) return null;
  return { navHtml, copyHtml, linksHtml };
}

function renderColumns(columns) {
  return columns.map((col) => `
        <div class="footer-col open">
          <h2><button type="button" class="col-toggle" aria-expanded="true">${col.title}<i class="caret" aria-hidden="true"></i></button></h2>
          <ul>
            ${col.listHtml}
          </ul>
        </div>`).join('');
}

function renderLegalCopy(copyHtml) {
  // Cookie preferences row is wired to the OneTrust widget, not authored.
  const cookieRow = '<p class="footer-copy"><a href="https://security.intuit.com/index.php/intuit-cookie-policy/">About cookies</a> | <button type="button" class="ot-sdk-show-settings footer-copy-btn">Manage cookies</button></p>';
  return `${copyHtml}\n            ${cookieRow}`;
}

// Locale dropdown — rendered twice: a `country-mobile` row that stacks under
// the menu columns (accordion-style) and a `country-desktop` chip inside the
// sitemap row. CSS shows one per breakpoint; wireCountry() wires both.
const countryMenu = (id, variant) => `
        <div class="country country-${variant}">
          <button type="button" class="country-toggle" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}">
            <span class="flag" aria-hidden="true">🇺🇸</span> <span class="country-label">Select Country</span> <i class="caret" aria-hidden="true"></i>
          </button>
          <ul class="country-menu" id="${id}" role="listbox" hidden>
            <li role="option"><a href="https://www.intuit.com/"><span class="flag" aria-hidden="true">🇺🇸</span> United States</a></li>
            <li role="option"><a href="https://www.intuit.com/ca/"><span class="flag" aria-hidden="true">🇨🇦</span> Canada (English)</a></li>
            <li role="option"><a href="https://www.intuit.com/fr-ca/"><span class="flag" aria-hidden="true">🇨🇦</span> Canada (French)</a></li>
            <li role="option"><a href="https://www.intuit.com/in/"><span class="flag" aria-hidden="true">🇮🇳</span> India</a></li>
          </ul>
        </div>`;

function buildChrome(columns, legal) {
  return `
<div class="ies-footer">
  <div class="ftr-main">
    <div class="container">
      <div class="footer-cols">
        ${renderColumns(columns)}
      </div>
      ${countryMenu('footer-country-menu-m', 'mobile')}
      <div class="footer-search">
        <input type="search" placeholder="Search this site" aria-label="Search this site">
      </div>
      <div class="footer-sitemap">
        <a class="ftr-sitemap-link" href="https://www.intuit.com/sitemap/">Sitemap</a>
        ${countryMenu('footer-country-menu', 'desktop')}
        <div class="social">
          <a href="https://www.facebook.com/intuit" aria-label="Facebook"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5H17V3.6c-.3 0-1.3-.1-2.45-.1-2.42 0-4.05 1.48-4.05 4.2v2.2H7.7V13h2.8v8h3z"/></svg></a>
          <a href="https://twitter.com/intuit" aria-label="X"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17.5 3h3l-6.6 7.6L22 21h-6.3l-4.4-5.8L6.2 21H3.2l7-8.1L2.5 3h6.4l4 5.3L17.5 3zm-1.1 16h1.7L7.7 4.8H5.9L16.4 19z"/></svg></a>
          <a href="https://www.youtube.com/user/intuit" aria-label="YouTube"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M23 12s0-3.2-.4-4.7c-.2-.9-.9-1.5-1.7-1.7C19.4 5.2 12 5.2 12 5.2s-7.4 0-8.9.4c-.8.2-1.5.8-1.7 1.7C1 8.8 1 12 1 12s0 3.2.4 4.7c.2.9.9 1.5 1.7 1.7 1.5.4 8.9.4 8.9.4s7.4 0 8.9-.4c.8-.2 1.5-.8 1.7-1.7.4-1.5.4-4.7.4-4.7zM9.8 15V9l5.2 3-5.2 3z"/></svg></a>
          <a href="https://www.linkedin.com/company/intuit" aria-label="LinkedIn"><svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M6.5 8.8H3.7V21h2.8V8.8zM5.1 3.5A1.6 1.6 0 105 6.7a1.6 1.6 0 00.1-3.2zM21 21v-6.7c0-3.3-1.8-4.8-4.1-4.8-1.9 0-2.7 1-3.2 1.8V8.8H8.9c0 .8 0 12.2 0 12.2h2.8v-6.8c0-.4 0-.7.1-1 .3-.7.9-1.5 2-1.5 1.5 0 2 1.1 2 2.7V21H21z"/></svg></a>
        </div>
      </div>
    </div>
  </div>
  <div class="ftr-legal">
    <div class="container">
      <div class="legal-grid">
        <div class="legal-left">
          <a href="https://www.intuit.com/" class="ftr-logo" aria-label="Intuit">${FOOTER_LOGO_INTUIT}</a>
          <ul class="legal-nav">
            ${legal.navHtml}
          </ul>
        </div>
        <div class="legal-center">
          <div class="brand-logos">
            <a href="https://turbotax.intuit.com/" class="ftr-brand" target="_blank" rel="noopener" aria-label="TurboTax">${FOOTER_LOGO_TURBOTAX}</a>
            <a href="https://www.creditkarma.com/" class="ftr-brand" target="_blank" rel="noopener" aria-label="Credit Karma">${FOOTER_LOGO_CREDITKARMA}</a>
            <a href="https://quickbooks.intuit.com/" class="ftr-brand" target="_blank" rel="noopener" aria-label="QuickBooks">${FOOTER_LOGO_QUICKBOOKS}</a>
            <a href="https://mailchimp.com/" class="ftr-brand ftr-brand-mailchimp" target="_blank" rel="noopener" aria-label="Mailchimp">${LOGO_MAILCHIMP_ICON}${LOGO_MAILCHIMP_WORD}</a>
          </div>
          <div class="legal-copy">
            ${renderLegalCopy(legal.copyHtml)}
          </div>
        </div>
        <div class="legal-right">
          <div class="legal-links">
            ${legal.linksHtml}
          </div>
          <a class="truste" href="https://privacy.trustarc.com/privacy-seal/validation?rid=ab182efc-5237-493d-8952-9295f7f3800b" target="_blank" rel="noopener">
            <img src="https://hostedseal.trustarc.com/privacy-seal/seal?rid=ab182efc-5237-493d-8952-9295f7f3800b" width="142" height="45" alt="TRUSTe" loading="lazy">
          </a>
        </div>
      </div>
    </div>
  </div>
</div>`;
}

async function fetchFragment(path) {
  try {
    const resp = await fetch(`${path}.plain.html`);
    if (resp.ok) {
      const text = await resp.text();
      if (text && text.trim()) return text;
    }
  } catch (e) { /* fall back to built-in defaults */ }
  return null;
}

// Mobile accordions: each link column's heading toggles its list. Columns open
// independently. On desktop the lists are always shown (CSS), so the toggled
// `.open` class is inert there.
function wireAccordions(block) {
  block.querySelectorAll('.footer-col .col-toggle').forEach((btn) => {
    const col = btn.closest('.footer-col');
    btn.addEventListener('click', () => {
      const open = col.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });
}

// Wire every "Select Country" dropdown (mobile + desktop copies): click or
// keyboard toggles its locale menu, which closes on outside click or Escape.
function wireCountry(block) {
  const countries = [...block.querySelectorAll('.country')];
  countries.forEach((country) => {
    const btn = country.querySelector('.country-toggle');
    const menu = country.querySelector('.country-menu');
    if (!btn || !menu) return;

    const setOpen = (open) => {
      country.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      menu.hidden = !open;
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!country.classList.contains('open'));
    });
    document.addEventListener('click', (e) => { if (!country.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && country.classList.contains('open')) {
        setOpen(false);
        btn.focus();
      }
    });
  });
}

// The OneTrust widget (wired via the .ot-sdk-show-settings class) overwrites
// this button's label from its own account config once it loads, clobbering
// our "Manage cookies" casing (issue #79) — keep correcting it back rather
// than fighting OneTrust for the click-wiring itself.
function normalizeCookieLabel(block) {
  const btn = block.querySelector('.ot-sdk-show-settings');
  if (!btn) return;
  const desired = 'Manage cookies';
  const fix = () => { if (btn.textContent !== desired) btn.textContent = desired; };
  fix();
  new MutationObserver(fix).observe(btn, { childList: true, characterData: true, subtree: true });
}

export default async function decorate(block) {
  const footerMeta = getMetadata('footer');
  const footerPath = footerMeta ? new URL(footerMeta, window.location).pathname : '/footer';
  const frag = await fetchFragment(footerPath);
  const doc = frag ? new DOMParser().parseFromString(frag, 'text/html') : null;
  const columns = (doc && parseFooterColumns(doc)) || [];
  const legal = (doc && parseFooterLegal(doc)) || { navHtml: '', copyHtml: '', linksHtml: '' };

  block.innerHTML = buildChrome(columns, legal);
  wireAccordions(block);
  wireCountry(block);
  normalizeCookieLabel(block);
  // Resource Center search (issue #60): the "Search this site" input submits
  // to /blog/search on Enter.
  wireFooterSearch(block);
}
