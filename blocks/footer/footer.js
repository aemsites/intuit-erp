/**
 * footer — two-tier IES footer (link columns + search + sitemap/social; then
 * legal tier with Intuit logo, brand marks, copyright, legal links, TRUSTe).
 * Reads the authorable /footer fragment when available, else renders the
 * built-in chrome so it always paints (local QA + preview).
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

const CHROME = `
<div class="ies-footer">
  <div class="ftr-main">
    <div class="container">
      <div class="footer-cols">
        <div>
          <h4>Company</h4>
          <ul>
            <li><a href="https://www.intuit.com/company/">About Intuit</a></li>
            <li><a href="https://investors.intuit.com">Investor Relations</a></li>
            <li><a href="https://www.intuit.com/company/corporate-responsibility/">Corporate Responsibility</a></li>
            <li><a href="https://www.intuit.com/partners/">Partner with Intuit</a></li>
            <li><a href="https://www.intuit.com/company/contact">Contact Us</a></li>
          </ul>
        </div>
        <div>
          <h4>For Individuals</h4>
          <ul>
            <li><a href="https://turbotax.intuit.com/">TurboTax</a></li>
            <li><a href="https://turbotax.intuit.com/personal-taxes/online/live/full-service/">TurboTax Live</a></li>
            <li><a href="https://www.creditkarma.com/">Credit Karma</a></li>
            <li><a href="https://www.creditkarma.com/credit-cards">Credit Cards</a></li>
            <li><a href="https://www.creditkarma.com/personal-loans/shop">Personal Loans</a></li>
            <li><a href="https://www.creditkarma.com/shop/autos">Auto Loans</a></li>
            <li><a href="https://www.creditkarma.com/home-loans/mortgage-rates">Home Loans</a></li>
            <li><a href="https://quickbooks.intuit.com/solopreneur/">QuickBooks Solopreneur</a></li>
          </ul>
        </div>
        <div>
          <h4>For Small Business</h4>
          <ul>
            <li><a href="https://quickbooks.intuit.com/">QuickBooks</a></li>
            <li><a href="https://quickbooks.intuit.com/accounting/">Accounting Software</a></li>
            <li><a href="https://quickbooks.intuit.com/payroll">Payroll</a></li>
            <li><a href="https://quickbooks.intuit.com/payments/">Online Payments</a></li>
            <li><a href="https://quickbooks.intuit.com/accounting/invoicing/">Invoicing Software</a></li>
            <li><a href="https://quickbooks.intuit.com/time-tracking/">Time Tracking</a></li>
            <li><a href="https://quickbooks.intuit.com/business-banking/loans/term-loans/">Term Loans</a></li>
            <li><a href="https://quickbooks.intuit.com/business-banking/loans/line-of-credit/">Line of Credit</a></li>
            <li><a href="https://quickbooks.intuit.com/live/">Bookkeeper Services</a></li>
            <li><a href="https://mailchimp.com/">Mailchimp</a></li>
            <li><a href="https://turbotax.intuit.com/small-business-taxes/">TurboTax Live for Business</a></li>
            <li><a href="https://quickbooks.intuit.com/business-banking/">Business Credit Card</a></li>
          </ul>
        </div>
        <div>
          <h4>For Accountants</h4>
          <ul>
            <li><a href="https://accountants.intuit.com/">Intuit Accountant Suite</a></li>
            <li><a href="https://accountants.intuit.com/tax/lacerte/">Lacerte Tax</a></li>
            <li><a href="https://proconnect.intuit.com/tax-online/">ProConnect Tax</a></li>
            <li><a href="https://accountants.intuit.com/tax/proseries/">ProSeries Tax</a></li>
            <li><a href="https://proadvisor.intuit.com/">ProAdvisor Program</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-search">
        <input type="search" placeholder="Search this site" aria-label="Search this site">
      </div>
      <div class="footer-sitemap">
        <a href="https://www.intuit.com/sitemap/">Sitemap</a>
        <label class="country"><span class="flag" aria-hidden="true">🇺🇸</span> Select Country <span aria-hidden="true">▾</span></label>
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
          <ul>
            <li><a href="https://www.intuit.com/company/">About Intuit</a></li>
            <li><a href="https://www.intuit.com/careers/">Join Our Team</a></li>
            <li><a href="https://www.intuit.com/company/press-room/">Press Room</a></li>
            <li><a href="https://www.intuit.com/accessibility/">Accessibility</a></li>
            <li><a href="https://www.intuit.com/legal/">Terms and Conditions</a></li>
          </ul>
        </div>
        <div class="legal-center">
          <div class="brand-logos">
            <a href="https://turbotax.intuit.com/" class="ftr-brand" target="_blank" rel="noopener" aria-label="TurboTax">${FOOTER_LOGO_TURBOTAX}</a>
            <a href="https://www.creditkarma.com/" class="ftr-brand" target="_blank" rel="noopener" aria-label="Credit Karma">${FOOTER_LOGO_CREDITKARMA}</a>
            <a href="https://quickbooks.intuit.com/" class="ftr-brand" target="_blank" rel="noopener" aria-label="QuickBooks">${FOOTER_LOGO_QUICKBOOKS}</a>
            <a href="https://mailchimp.com/" class="ftr-brand ftr-brand-mailchimp" target="_blank" rel="noopener" aria-label="Mailchimp">${LOGO_MAILCHIMP_ICON}${LOGO_MAILCHIMP_WORD}</a>
          </div>
          <p class="footer-copy">© 2026 Intuit Inc. All rights reserved.</p>
          <p class="footer-copy">Intuit, QuickBooks, QB, TurboTax, Credit Karma, and Mailchimp are registered trademarks of Intuit Inc. Terms and conditions, features, support, pricing, and service options subject to change without notice.</p>
          <p class="footer-copy">Money movement services are provided by Intuit Payments Inc., licensed as a Money Transmitter by the New York State Department of Financial Services. For details about our money transmission licenses, or for Texas customers with complaints about our service, please <a href="https://www.intuit.com/legal/licenses/payment-licenses/">click here.</a></p>
          <p class="footer-copy"><a href="https://security.intuit.com/index.php/intuit-cookie-policy/">About cookies</a> | <a href="#">Your California Privacy Rights</a></p>
        </div>
        <div class="legal-right">
          <div class="legal-links">
            <a href="https://www.intuit.com/legal/">Legal</a> |
            <a href="https://www.intuit.com/privacy/">Privacy</a> |
            <a href="https://security.intuit.com">Security</a> |
            <a href="https://www.intuit.com/compliance/">Compliance</a>
          </div>
          <a class="truste" href="https://privacy.trustarc.com/privacy-seal/validation?rid=ab182efc-5237-493d-8952-9295f7f3800b" target="_blank" rel="noopener">
            <img src="https://hostedseal.trustarc.com/privacy-seal/seal?rid=ab182efc-5237-493d-8952-9295f7f3800b" width="142" height="45" alt="TRUSTe" loading="lazy">
          </a>
        </div>
      </div>
    </div>
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

export default async function decorate(block) {
  const footerMeta = getMetadata('footer');
  const footerPath = footerMeta ? new URL(footerMeta, window.location).pathname : '/footer';
  // Prefer the authored fragment only when it preserves the chrome markup;
  // the EDS content pipeline strips the ies-* classes, so fall back to the
  // canonical embedded chrome for a faithful, reliable render.
  const frag = await fetchFragment(footerPath);
  block.innerHTML = (frag && frag.includes('ies-footer')) ? frag : CHROME;
}
