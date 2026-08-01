/**
 * blog-template — auto-block for /blog/* article pages (case study / research /
 * standard post). Authors write only the Title + hero image (section 1) and the
 * prose (section 2+). This block, invoked from scripts.js's buildAutoBlocks BEFORE
 * the fragment-link collection runs, renders everything else from page metadata:
 *
 *   - a `.blog-hero` band in section 1: tag eyebrow before the H1, a byline meta
 *     (author link / published + updated dates) after it, hero image last —
 *     desktop CSS turns this into a 2-col band (text left, image right)
 *   - a collapsible, numbered table of contents from the article's H2 sections
 *     only (h3s inside callouts/testimonials and "Recommended for you" are
 *     excluded) with scroll-spy active-section highlighting
 *   - a shared right-rail fragment link (`/fragments/<right-rail>`, default
 *     `/fragments/right-rail`) which the EXISTING fragment autoblock then loads —
 *     this is why buildBlogTemplate must run before that collection query
 *   - the 3-col article layout class on <main>
 *
 * The right-rail fragment (authored separately, Task 13) is what references the
 * highlight (Task 1) and blog-cards (Task 11) blocks — blog-template.js itself
 * imports neither.
 *
 * Metadata contract (matches the Task-10 query indices):
 *   author  ← getMetadata('author')
 *   tag     ← getMetadata('category') || getMetadata('tags')
 *   date    ← getMetadata('date')      (published)
 *   updated ← getMetadata('updated')
 *
 * buildToc / buildByline / isBlogPage are pure/DOM (no network) and unit-tested
 * directly; buildBlogTemplate wires them to getMetadata + the layout.
 *
 * CSS: blocks/blog-template/blog-template.css
 */
import { getMetadata, toClassName, loadCSS } from '../../scripts/aem.js';

/**
 * Selects the article's main H2 sections only — excludes headings nested
 * inside callout/highlight-style blocks (which use h3 for their own internal
 * heading) and the "Recommended for you" blog-cards section.
 * @param {Element} main container to scan for headings
 * @returns {HTMLHeadingElement[]}
 */
function tocHeadings(main) {
  return [...main.querySelectorAll('h2')].filter((h) => !h.closest(
    '.blog-cards,.highlight,.testimonial,.stat-band,.cta-band,.media-text,.download-form',
  ) && !(h.parentElement && h.parentElement.querySelector('.blog-cards')));
}

/**
 * Builds a numbered, collapsible table-of-contents nav from the article's H2
 * sections inside `main`. Assigns an id to any heading missing one so the
 * links resolve. The toggle button and active-section highlighting are wired
 * up separately (see buildBlogTemplate) once the nav is in the document.
 * @param {Element} main container to scan for headings
 * @returns {HTMLElement|null} <nav class="blog-toc">, or null if < 2 headings
 */
export function buildToc(main) {
  const headings = tocHeadings(main);
  if (headings.length < 2) return null;

  const nav = document.createElement('nav');
  nav.className = 'blog-toc';
  nav.setAttribute('aria-label', 'Table of contents');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'blog-toc-toggle';
  toggle.setAttribute('aria-expanded', 'true');
  const label = document.createElement('span');
  label.className = 'blog-toc-label';
  label.textContent = 'Table of contents';
  toggle.append(label);

  const list = document.createElement('ol');
  list.className = 'blog-toc-list';
  headings.forEach((h, i) => {
    if (!h.id) h.id = `${toClassName(h.textContent) || 'section'}-${i}`;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${h.id}`;
    a.textContent = h.textContent;
    li.append(a);
    list.append(li);
  });

  nav.append(toggle, list);
  return nav;
}

/**
 * Builds the eyebrow tag paragraph ("case study" → "CASE STUDY" via CSS).
 * @param {string} [tag] category / tag slug
 * @returns {HTMLParagraphElement|null}
 */
export function buildEyebrow(tag) {
  if (!tag) return null;
  const eyebrow = document.createElement('p');
  eyebrow.className = 'blog-byline-tag';
  // display-only: slugs like "case-study" read as "case study" (CSS uppercases);
  // the underlying category value is unchanged so blog-cards filters still match.
  eyebrow.textContent = tag.replace(/-/g, ' ');
  return eyebrow;
}

/**
 * Builds the byline meta paragraph — "By {author}" (author links to their
 * author page), "Published on {date}", "Updated {updated}". Missing fields
 * are simply omitted (no empty spans rendered).
 * @param {object} data
 * @param {string} [data.author] author name
 * @param {string} [data.date] published date (display string)
 * @param {string} [data.updated] updated date (display string)
 * @returns {HTMLParagraphElement} <p class="blog-byline-meta"> (possibly empty)
 */
export function buildBylineMeta({ author, date, updated } = {}) {
  const meta = document.createElement('p');
  meta.className = 'blog-byline-meta';

  if (author) {
    const a = document.createElement('span');
    a.className = 'blog-byline-author';
    a.append('By ');
    const link = document.createElement('a');
    link.href = `/blog/author/${toClassName(author)}`;
    link.textContent = author;
    a.append(link);
    meta.append(a);
  }
  if (date) {
    const d = document.createElement('span');
    d.className = 'blog-byline-date';
    d.textContent = `Published on ${date}`;
    meta.append(d);
  }
  if (updated) {
    const u = document.createElement('span');
    u.className = 'blog-byline-updated';
    u.textContent = `Updated ${updated}`;
    meta.append(u);
  }

  return meta;
}

/**
 * Builds the byline block from resolved metadata fields — a plain composite
 * of buildEyebrow + buildBylineMeta. Only used directly by tests/legacy
 * callers; buildBlogTemplate composes the two pieces itself so the eyebrow
 * can land before the H1 and the meta after it (see the hero DOM below).
 * @param {object} data
 * @param {string} [data.author] author name
 * @param {string} [data.tag] category / tag eyebrow
 * @param {string} [data.date] published date (display string)
 * @param {string} [data.updated] updated date (display string)
 * @returns {HTMLElement} <div class="blog-byline">
 */
export function buildByline({
  author, tag, date, updated,
} = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'blog-byline';

  const eyebrow = buildEyebrow(tag);
  if (eyebrow) wrapper.append(eyebrow);

  const meta = buildBylineMeta({ author, date, updated });
  if (meta.childElementCount) wrapper.append(meta);

  return wrapper;
}

/**
 * True when the current page is a /blog/* article (not a listing/author/category
 * root, which are card-list pages rendered by blog-cards). Gate for the autoblock.
 * @returns {boolean}
 */
export function isBlogPage() {
  const path = window.location.pathname;
  if (!path.startsWith('/blog/')) return false;
  // exclude the listing roots: /blog/, /blog/author/*, /blog/category/*
  if (path === '/blog/' || path === '/blog') return false;
  if (path.startsWith('/blog/author/') || path === '/blog/author') return false;
  if (path.startsWith('/blog/category/') || path === '/blog/category') return false;
  return true;
}

/**
 * Wires up the TOC's interactive behavior once it's in the document:
 *  - click the toggle button to collapse/expand (mobile panel / desktop rail
 *    ↔ vertical tab — the actual visual states are CSS, driven off the
 *    `blog-toc-collapsed` class + `aria-expanded`)
 *  - highlight the toc entry for whichever H2 section is currently at the
 *    top of the viewport (IntersectionObserver, biased toward the top band
 *    via rootMargin so exactly one section reads "active" at a time)
 * @param {HTMLElement} tocWrap the `.blog-toc-rail` wrapper (collapse target)
 * @param {HTMLElement} nav the `.blog-toc` nav returned by buildToc
 * @param {HTMLHeadingElement[]} headings the H2s the nav links to, in order
 */
function wireToc(tocWrap, nav, headings) {
  const toggle = nav.querySelector('.blog-toc-toggle');
  toggle.addEventListener('click', () => {
    const collapsed = tocWrap.classList.toggle('blog-toc-collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
  });

  if (!headings.length || typeof IntersectionObserver === 'undefined') return;

  const links = new Map(headings.map((h) => [h.id, nav.querySelector(`a[href="#${h.id}"]`)]));
  const setActive = (id) => {
    links.forEach((a, headingId) => a?.classList.toggle('active', headingId === id));
  };

  // top ~30% band of the viewport, below the sticky nav — only one heading
  // is normally inside it at a time as the page scrolls.
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.find((entry) => entry.isIntersecting);
    if (visible) setActive(visible.target.id);
  }, { rootMargin: '-120px 0px -70% 0px', threshold: 0 });

  headings.forEach((h) => observer.observe(h));
}

/**
 * Auto-block orchestrator. Called from scripts.js buildAutoBlocks() when
 * isBlogPage() is true, BEFORE the fragment-link collection runs.
 * @param {Element} main the page's <main>
 */
export function buildBlogTemplate(main) {
  main.classList.add('blog-article');

  // 0. load this autoblock's stylesheet — it is invoked directly (not via the
  //    block loader), so its CSS would otherwise never be fetched.
  loadCSS(`${window.hlx.codeBasePath}/blocks/blog-template/blog-template.css`);

  // 1. hero (section 1): eyebrow before the H1, byline meta after it, hero
  //    image left in place (last) — natural DOM order so mobile needs no
  //    special handling; the 2-col band is desktop-only CSS (grid-column: 2
  //    on the image, spanning every row of the text column beside it).
  const firstSection = main.querySelector(':scope > div');
  if (firstSection) {
    firstSection.classList.add('blog-hero');

    const eyebrow = buildEyebrow(getMetadata('category') || getMetadata('tags'));
    const meta = buildBylineMeta({
      author: getMetadata('author'),
      date: getMetadata('date'),
      updated: getMetadata('updated'),
    });

    const h1 = firstSection.querySelector('h1');
    if (h1) {
      if (eyebrow) h1.before(eyebrow);
      if (meta.childElementCount) h1.after(meta);
    } else {
      // no H1 authored — degrade gracefully, still put content at the top
      if (meta.childElementCount) firstSection.prepend(meta);
      if (eyebrow) firstSection.prepend(eyebrow);
    }

    const heroImg = firstSection.querySelector('img');
    heroImg?.closest('p')?.classList.add('blog-hero-image');
  }

  // 2. TOC from the article's H2 sections — inserted right after the hero
  //    (section 1) so mobile stacks hero → toc panel → body naturally; CSS
  //    grid re-places it into the left rail on wide viewports regardless of
  //    DOM order.
  const toc = buildToc(main);
  let tocWrap;
  if (toc) {
    tocWrap = document.createElement('div');
    tocWrap.className = 'blog-toc-rail';
    tocWrap.append(toc);
    if (firstSection) firstSection.after(tocWrap);
    else main.prepend(tocWrap);

    const headings = [...toc.querySelectorAll('.blog-toc-list a')]
      .map((a) => main.querySelector(a.getAttribute('href')))
      .filter(Boolean);
    wireToc(tocWrap, toc, headings);
  }

  // 3. right-rail fragment link — the existing fragment autoblock (which runs
  //    AFTER this in buildAutoBlocks) picks it up and loads it.
  const railName = getMetadata('right-rail') || '/fragments/right-rail';
  const railPath = railName.startsWith('/') ? railName : `/fragments/${railName}`;
  const rail = document.createElement('div');
  rail.className = 'blog-rail';
  const railLink = document.createElement('a');
  railLink.href = railPath;
  railLink.textContent = railPath;
  const railP = document.createElement('p');
  railP.append(railLink);
  rail.append(railP);
  main.append(rail);
}

/**
 * Block entry point — supports authoring an explicit `blog-template` block, though
 * the primary path is the autoblock (buildBlogTemplate) driven from scripts.js.
 * @param {Element} block the block element
 */
export default async function decorate(block) {
  const main = block.closest('main');
  if (main && !main.classList.contains('blog-article')) buildBlogTemplate(main);
}
