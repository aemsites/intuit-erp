/**
 * case-study-header — article header for a case-study detail page.
 * Authoring rows (each row = one cell, following the hero.js convention of
 * the block owning its full head, not mixed with default content):
 *   1. eyebrow text        ("Case study")
 *   2. <h1> headline
 *   3. byline paragraph    ("By {author} · Published {date}")
 *   4. media row           cell 1 = the single hero photo (matches
 *                          erp.intuit.com's one-image banner, not a
 *                          two-tile logo+photo split). Extra cells are
 *                          accepted but hidden via CSS, so existing pages
 *                          authored with a second (logo) cell still work.
 *                          This is also the page's lead image, since the
 *                          Helix pipeline auto-derives og:image from the
 *                          first image on the page — the case-study-cards
 *                          block uses that as the card thumbnail.
 *
 * Also builds a share-icon row (JS-generated, LinkedIn/X share intents +
 * copy-link) and a boxed table of contents (inline in the article, right
 * after the banner — not a floating rail, so it's visible at every viewport
 * width) from every <h2> in the page (safe: decorateMain() runs over the
 * full page before any block decorates, so all sections' headings already
 * exist in the DOM at this point). Utility
 * sections that aren't real narrative content (e.g. "Recommended for you",
 * "Hear from our customers") are authored as <h3>, not <h2>, so they're
 * naturally excluded — DA doesn't preserve custom classes on headings
 * through its content roundtrip, so heading level is the durable signal.
 * CSS: blocks/case-study-header/case-study-header.css
 */
import { toClassName } from '../../scripts/aem.js';

function shareRow() {
  const nav = document.createElement('div');
  nav.className = 'case-study-share';
  const url = encodeURIComponent(window.location.href);
  const links = [
    { label: 'Share on LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`, path: 'M6.5 8.8H3.7V21h2.8V8.8zM5.1 3.5A1.6 1.6 0 105 6.7a1.6 1.6 0 00.1-3.2zM21 21v-6.7c0-3.3-1.8-4.8-4.1-4.8-1.9 0-2.7 1-3.2 1.8V8.8H8.9c0 .8 0 12.2 0 12.2h2.8v-6.8c0-.4 0-.7.1-1 .3-.7.9-1.5 2-1.5 1.5 0 2 1.1 2 2.7V21H21z' },
    { label: 'Share on X', href: `https://twitter.com/intent/tweet?url=${url}`, path: 'M17.5 3h3l-6.6 7.6L22 21h-6.3l-4.4-5.8L6.2 21H3.2l7-8.1L2.5 3h6.4l4 5.3L17.5 3zm-1.1 16h1.7L7.7 4.8H5.9L16.4 19z' },
  ];
  links.forEach(({ label, href, path }) => {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('aria-label', label);
    a.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="${path}"/></svg>`;
    nav.append(a);
  });
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.setAttribute('aria-label', 'Copy link');
  copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 14a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
  copyBtn.addEventListener('click', () => navigator.clipboard?.writeText(window.location.href));
  nav.append(copyBtn);
  return nav;
}

// Highlights the ToC entry for the last section heading that's scrolled past
// the top threshold, matching the blue active-bar behavior on
// erp.intuit.com's sticky table of contents. An IntersectionObserver with a
// narrow band leaves gaps between headings with nothing marked active, so
// this tracks scroll position directly instead.
function watchActiveSection(headings, items) {
  const THRESHOLD = 140;
  let ticking = false;
  const update = () => {
    ticking = false;
    let current = 0;
    headings.forEach((h, i) => {
      if (h.getBoundingClientRect().top <= THRESHOLD) current = i;
    });
    items.forEach((li, i) => li.classList.toggle('active', i === current));
  };
  const schedule = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };
  document.addEventListener('scroll', schedule, { passive: true });
  // Images loading after this runs (the banner photo especially) push
  // heading positions down, so a plain synchronous call here can capture a
  // bogus pre-layout snapshot. A ResizeObserver on <main> catches every
  // later layout shift (images, fonts) and recomputes, not just scrolling.
  new ResizeObserver(schedule).observe(document.querySelector('main'));
}

function buildToc() {
  const headings = [...document.querySelectorAll('main h2')];
  if (!headings.length) return null;
  const nav = document.createElement('nav');
  nav.className = 'case-study-toc';
  nav.setAttribute('aria-label', 'Table of contents');
  const label = document.createElement('p');
  label.className = 'case-study-toc-label';
  label.textContent = 'Table of contents';
  const list = document.createElement('ol');
  const items = headings.map((h, i) => {
    if (!h.id) h.id = `${toClassName(h.textContent)}-${i}`;
    const li = document.createElement('li');
    li.innerHTML = `<a href="#${h.id}">${h.textContent}</a>`;
    list.append(li);
    return li;
  });
  nav.append(label, list);
  watchActiveSection(headings, items);
  return nav;
}

export default function decorate(block) {
  const rows = [...block.children];
  const copy = document.createElement('div');
  copy.className = 'case-study-copy';
  let bannerCells = null;

  rows.forEach((row) => {
    const cells = [...row.children];
    if (cells.some((c) => c.querySelector('picture, img'))) {
      bannerCells = cells;
      return;
    }
    cells.forEach((cell) => { [...cell.childNodes].forEach((n) => copy.append(n)); });
  });

  const heading = copy.querySelector('h1');
  copy.querySelectorAll('p').forEach((p) => {
    // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask
    if (heading && (p.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      p.classList.add('eyebrow', 'case-study-eyebrow');
    } else {
      p.classList.add('case-study-byline');
    }
  });
  copy.append(shareRow());

  const wrap = document.createElement('div');
  wrap.className = 'case-study-header-inner';
  wrap.append(copy);

  if (bannerCells) {
    const banner = document.createElement('div');
    banner.className = 'case-study-banner';
    bannerCells.forEach((cell) => {
      const tile = document.createElement('div');
      tile.className = 'case-study-banner-tile';
      [...cell.childNodes].forEach((n) => tile.append(n));
      banner.append(tile);
    });
    wrap.append(banner);
  }

  const toc = buildToc();
  if (toc) wrap.append(toc);

  block.replaceChildren(wrap);
}
