/**
 * header — Intuit Enterprise Suite chrome: brand strip + sticky nav + cyan
 * events bar. Reads the authorable /nav fragment when available (deployed),
 * otherwise renders the built-in chrome so it always paints (local QA + preview).
 * Sticky-nav scroll-morph and the mobile menu toggle are wired here.
 * CSS: blocks/header/header.css · source fragment: content/nav.html
 */
import { getMetadata } from '../../scripts/aem.js';

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
    <nav class="nav-main" aria-label="Primary">
      <button type="button">Capabilities<i class="caret"></i></button>
      <button type="button">Industry tools<i class="caret"></i></button>
      <button type="button">Pricing<i class="caret"></i></button>
      <button type="button">Resources<i class="caret"></i></button>
      <button type="button">Support<i class="caret"></i></button>
      <a href="https://erp.intuit.com/accountant/" class="acct-link">For accounting firms</a>
    </nav>
    <div class="nav-right">
      <a class="btn btn-primary nav-cta" href="#schedule">Schedule a call</a>
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

export default async function decorate(block) {
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : '/nav';
  block.innerHTML = (await fetchFragment(navPath)) || CHROME;

  // sticky-nav scroll-morph
  const nav = block.querySelector('#iesNav, .ies-nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 36);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // mobile menu toggle
  const toggle = block.querySelector('.nav-toggle');
  const navMain = block.querySelector('.nav-main');
  if (toggle && navMain) {
    toggle.addEventListener('click', () => {
      const open = block.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
}
