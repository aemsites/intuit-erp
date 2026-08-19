/**
 * blog-template — auto-block for /blog/* article pages (case study / research /
 * standard post). Authors write only the Title + hero image (section 1) and the
 * prose (section 2+). Which templates land here is decided by isBlogPage
 * (./blog-detect.js) — `Blog Article`, `Case Study` and `Research`, which all
 * get the identical treatment below.
 *
 * Invoked from scripts.js's buildAutoBlocks BEFORE the fragment-link collection
 * runs, it renders everything the author didn't write from page metadata:
 *
 *   - a `.blog-hero` band in section 1: tag eyebrow before the H1, a byline meta
 *     (author link / published + updated dates) after it, hero image last —
 *     desktop CSS turns this into a 2-col band (text left, image right)
 *   - a collapsible, numbered table of contents from the article's H2 sections
 *     only (h3s inside callouts/testimonials and "Recommended for you" are
 *     excluded) with scroll-spy active-section highlighting; on mobile the
 *     collapsed bar's label follows the active section, and the whole rail
 *     (share icons + TOC) is a sticky left column on desktop that unsticks
 *     at the end of the article body (see tocRailRowEnd)
 *   - a `.blog-share` widget (Facebook/X/LinkedIn share-intent links built
 *     from the current article URL, plus a static "visit us" YouTube link)
 *     — one element, relocated between the hero (mobile) and the top of the
 *     TOC rail (desktop) by matchMedia, not duplicated
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
import { hasAuthoredCaseStudyHeader } from './blog-detect.js';

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
 * Computes the grid-row end line for the sticky left rail (`.blog-toc-rail`,
 * and — to match — the right rail) so it spans exactly the article body
 * (hero + content sections) and unsticks before trailing appendix sections
 * like "Recommended for you" (which has no TOC-eligible heading, so it's
 * naturally excluded).
 *
 * Layout assumption this relies on: the hero occupies grid row 1 (full
 * width) and every other top-level `main > div` section auto-places into
 * one row each, in DOM order, starting at row 2 — true as long as ordinary
 * sections aren't given an explicit multi-row span (they aren't). So the
 * Nth section (0-indexed, hero = 0) sits at row `N + 1`, and a rail that
 * should stop after that section needs `grid-row-end: N + 2`.
 * @param {Element[]} sections `main`'s original top-level children
 *   (`main > div`), captured before any rail/toc wrapper is inserted —
 *   index 0 is the hero.
 * @param {HTMLHeadingElement[]} headings the TOC's headings, in order
 * @returns {number|null} the grid-row end line, or null if there are no
 *   TOC headings to anchor on (caller should fall back to a generous span)
 */
export function tocRailRowEnd(sections, headings) {
  if (!headings.length) return null;
  const lastHeading = headings[headings.length - 1];
  const lastSection = sections.find((s) => s.contains(lastHeading));
  if (!lastSection) return null;
  return sections.indexOf(lastSection) + 2;
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
  // Link the eyebrow to the category listing to match production (e.g. /blog/erp/).
  const link = document.createElement('a');
  link.href = `/blog/${toClassName(tag)}/`;
  link.textContent = tag.replace(/-/g, ' ');
  eyebrow.append(link);
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

// Icon files live in /icons (facebook.svg, x.svg, linkedin.svg, youtube.svg)
// — glyphs match the ones in blocks/footer/footer.js's `.social` links,
// baked to a fixed white fill since they're always shown on the widget's
// solid-color circle (see .blog-share-link in blog-template.css).
const SHARE_ICON_DIMS = {
  facebook: { width: 18, height: 18 },
  x: { width: 16, height: 16 },
  linkedin: { width: 17, height: 17 },
  youtube: { width: 20, height: 20 },
};

/**
 * Builds the 4 share-widget entries: Facebook/X/LinkedIn are share-intent
 * links carrying the current article's URL (matching production's
 * `sharer.php?u=`, `share?url=`, `sharing/share-offsite/?url=` endpoints);
 * YouTube is a static "visit our channel" follow link, matching production
 * (its share row's 4th icon links to Intuit's channel, not a share intent).
 * @returns {{label: string, href: string, icon: string}[]}
 */
function buildShareLinks() {
  const url = encodeURIComponent(window.location.href);
  return [
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${url}`, icon: 'facebook' },
    { label: 'X', href: `https://twitter.com/share?url=${url}`, icon: 'x' },
    { label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`, icon: 'linkedin' },
    { label: 'YouTube', href: 'https://www.youtube.com/user/intuit', icon: 'youtube' },
  ];
}

/**
 * Builds the "Share this article" widget: a visible label + 4 social links
 * (Facebook, X, LinkedIn, YouTube, in that order). A plain `<p>`, not a
 * `<div>` — deliberately, so that when it's inserted as a section child
 * decorateSections() groups it into the surrounding `.default-content-wrapper`
 * instead of splitting into a second (block-look-alike) wrapper the way a
 * bare `<div>` child would; that would make decorateBlocks() try to load a
 * non-existent "blog-share" block module.
 * @returns {HTMLParagraphElement} <p class="blog-share">
 */
export function buildShare() {
  const wrap = document.createElement('p');
  wrap.className = 'blog-share';

  const label = document.createElement('span');
  label.className = 'blog-share-label';
  label.textContent = 'Share this article:';
  wrap.append(label);

  buildShareLinks().forEach(({ label: name, href, icon }) => {
    const a = document.createElement('a');
    a.className = 'blog-share-link';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('aria-label', name);
    const img = document.createElement('img');
    img.src = `${window.hlx.codeBasePath}/icons/${icon}.svg`;
    img.alt = '';
    img.loading = 'lazy';
    img.width = SHARE_ICON_DIMS[icon].width;
    img.height = SHARE_ICON_DIMS[icon].height;
    a.append(img);
    wrap.append(a);
  });

  return wrap;
}

/**
 * Keeps the single `.blog-share` element in the right home as the viewport
 * crosses the desktop breakpoint — mobile keeps it inside the hero, desktop
 * moves it to the top of the TOC rail (above the nav). Sets the initial
 * position from the current match state, then keeps it in sync on resize.
 * @param {HTMLElement} share the `.blog-share` element
 * @param {() => void} placeMobile inserts `share` at its mobile position
 * @param {(() => void)|null} placeDesktop inserts `share` at its desktop
 *   position — null when there's no TOC rail to move it into, in which case
 *   it stays at the mobile position at every width
 * @param {MediaQueryList} mq matchMedia('(min-width: 900px)')
 */
export function relocateShare(share, placeMobile, placeDesktop, mq) {
  const place = (isDesktop) => {
    if (isDesktop && placeDesktop) placeDesktop();
    else placeMobile();
  };
  place(mq.matches);
  mq.addEventListener('change', (e) => place(e.matches));
}

// isBlogPage moved to ./blog-detect.js so scripts.js can gate blog decoration
// in the eager phase without pulling this whole module onto every page's
// critical path. Re-exported here so the public API is unchanged.
export { isBlogPage } from './blog-detect.js';

/**
 * Wires up the TOC's interactive behavior once it's in the document:
 *  - click the toggle button to collapse/expand (mobile panel / desktop rail
 *    ↔ vertical tab — the actual visual states are CSS, driven off the
 *    `blog-toc-collapsed` class + `aria-expanded`); mobile defaults to
 *    collapsed (a bar), desktop defaults to expanded (the full rail)
 *  - highlight the toc entry for whichever H2 section is currently at the
 *    top of the viewport (IntersectionObserver, biased toward the top band
 *    via rootMargin so exactly one section reads "active" at a time), and
 *    on mobile, while collapsed, swap the bar's visible label to that
 *    section's heading text (desktop always keeps "Table of contents")
 * @param {HTMLElement} tocWrap the `.blog-toc-rail` wrapper (collapse target)
 * @param {HTMLElement} nav the `.blog-toc` nav returned by buildToc
 * @param {HTMLHeadingElement[]} headings the H2s the nav links to, in order
 * @param {MediaQueryList} mq matchMedia('(min-width: 900px)')
 */
function wireToc(tocWrap, nav, headings, mq) {
  const toggle = nav.querySelector('.blog-toc-toggle');
  const label = nav.querySelector('.blog-toc-label');
  let activeText = null;

  const updateLabel = () => {
    const showActiveSection = !mq.matches && tocWrap.classList.contains('blog-toc-collapsed');
    label.textContent = (showActiveSection && activeText) ? activeText : 'Table of contents';
  };

  // mobile starts collapsed (a sticky bar whose label tracks the section the
  // reader is in); desktop starts expanded (the full rail). Re-apply on
  // breakpoint cross so a resized window lands in the right default.
  const applyDefaultState = (isDesktop) => {
    tocWrap.classList.toggle('blog-toc-collapsed', !isDesktop);
    toggle.setAttribute('aria-expanded', String(isDesktop));
    updateLabel();
  };
  applyDefaultState(mq.matches);
  mq.addEventListener('change', (e) => applyDefaultState(e.matches));

  // Once the reader has clicked the toggle themselves, their choice wins and
  // the auto-collapse below stops firing — matching the source, which never
  // re-collapses a rail the reader has deliberately re-opened.
  let userToggled = false;

  toggle.addEventListener('click', () => {
    userToggled = true;
    const collapsed = tocWrap.classList.toggle('blog-toc-collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    updateLabel();
  });

  // Desktop: collapse the rail to its narrow tab once the reader is properly
  // into the article, so the prose gets the width back. One-way — scrolling
  // back up does NOT re-expand it, and a reader who re-opens it manually keeps
  // it open (both verified against the source).
  //
  // Triggers when the first article heading scrolls up out of the viewport,
  // which tracks the article's own layout instead of a hard-coded offset. The
  // scroll-position guard is load-bearing: IntersectionObserver always fires
  // an initial callback on observe(), and at that point the block's images are
  // still unsized, so the heading's reported rect can be at/above the viewport
  // top and the rail would fold away instantly at scrollY 0.
  const collapseTrigger = headings[0];
  if (collapseTrigger && typeof IntersectionObserver !== 'undefined') {
    const autoObserver = new IntersectionObserver(([entry]) => {
      if (!mq.matches || userToggled || !entry) return;
      if (window.scrollY < window.innerHeight) return;
      if (entry.isIntersecting || entry.boundingClientRect.top > 0) return;
      if (tocWrap.classList.contains('blog-toc-collapsed')) return;
      tocWrap.classList.add('blog-toc-collapsed');
      toggle.setAttribute('aria-expanded', 'false');
      updateLabel();
    }, { threshold: 0 });
    autoObserver.observe(collapseTrigger);
  }

  if (!headings.length || typeof IntersectionObserver === 'undefined') return;

  const links = new Map(headings.map((h) => [h.id, nav.querySelector(`a[href="#${h.id}"]`)]));
  const setActive = (id, text) => {
    links.forEach((a, headingId) => a?.classList.toggle('active', headingId === id));
    activeText = text;
    updateLabel();
  };

  // top ~30% band of the viewport, below the sticky nav — only one heading
  // is normally inside it at a time as the page scrolls.
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.find((entry) => entry.isIntersecting);
    if (visible) setActive(visible.target.id, visible.target.textContent);
  }, { rootMargin: '-120px 0px -70% 0px', threshold: 0 });

  headings.forEach((h) => observer.observe(h));
}

/**
 * Auto-block orchestrator. Called from scripts.js buildAutoBlocks() when
 * isBlogPage() is true, BEFORE the fragment-link collection runs. Every article
 * template it runs for (`Blog Article`, `Case Study`, `Research`) gets the same
 * hero band + TOC + rails treatment.
 * @param {Element} main the page's <main>
 */
export function buildBlogTemplate(main) {
  // Three case studies author a `case-study-header` block in section 1 (its own
  // centred banner, share row and inline TOC). Bail out so those pages aren't
  // decorated twice — the hero band would wrap the banner. The migrated case
  // studies, which have a bare H1 + hero image, fall through and get the band
  // that upstream uses.
  //
  // Only ONE of the three is genuinely net-new (steves-construction-company; no
  // erp.intuit.com counterpart under any slug). The other two —
  // aprio-intuit-enterprise-suite and sparq-partners — ARE migrated pages whose
  // upstream counterparts render this article band, so the authored block is a
  // content discrepancy on those two, tracked separately; it is not this
  // function's job to override an authored block to paper over it. Overriding
  // would also strip the header from the one page that legitimately owns it.
  // (The validation report files all three under `newPages`, which is why they
  // were previously believed net-new — but that run mapped against the migrated
  // sitemap with `sourceSite: null`, and erp.intuit.com's own sitemap.xml omits
  // aprio and sparq even though both are live and linked from
  // /blog/case-study/. Verified with a real browser: both return HTTP 200 with
  // the eyebrow + headline-left + image-right band.)
  if (hasAuthoredCaseStudyHeader(main)) return;

  main.classList.add('blog-article');

  // 0. load this autoblock's stylesheet — it is invoked directly (not via the
  //    block loader), so its CSS would otherwise never be fetched.
  loadCSS(`${window.hlx.codeBasePath}/blocks/blog-template/blog-template.css`);

  // capture the ORIGINAL top-level sections (index 0 = hero) before we
  // insert the toc-rail/right-rail wrappers — tocRailRowEnd needs this to
  // find which grid row the last TOC-eligible section lands in.
  const sections = [...main.querySelectorAll(':scope > div')];
  const desktopMQ = window.matchMedia('(min-width: 900px)');

  // 1. hero (section 1): eyebrow before the H1, byline meta after it, hero
  //    image left in place (last) — natural DOM order so mobile needs no
  //    special handling; the 2-col band is desktop-only CSS (grid-column: 2
  //    on the image, spanning every row of the text column beside it).
  const firstSection = sections[0];
  let h1;
  let meta;
  if (firstSection) {
    firstSection.classList.add('blog-hero');

    // an article may carry several comma-separated categories; the byline shows
    // the primary (first) one.
    const primaryCategory = (getMetadata('category') || '').split(',')[0].trim();
    const eyebrow = buildEyebrow(primaryCategory || getMetadata('tags'));
    meta = buildBylineMeta({
      author: getMetadata('author'),
      date: getMetadata('date'),
      updated: getMetadata('updated'),
    });

    h1 = firstSection.querySelector('h1');
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
  let headings = [];
  if (toc) {
    tocWrap = document.createElement('div');
    tocWrap.className = 'blog-toc-rail';
    tocWrap.append(toc);
    if (firstSection) firstSection.after(tocWrap);
    else main.prepend(tocWrap);

    headings = [...toc.querySelectorAll('.blog-toc-list a')]
      .map((a) => main.querySelector(a.getAttribute('href')))
      .filter(Boolean);
    wireToc(tocWrap, toc, headings, desktopMQ);
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

  // 4. desktop sticky rails should unstick at the end of the article body,
  //    not overlap trailing appendix sections (e.g. "Recommended for you")
  //    or the footer — set an explicit grid-row-end on both rails so their
  //    sticky containing block is exactly the article body's height. Falls
  //    back to the stylesheet's generous `span` default when it can't be
  //    computed (no TOC headings to anchor on).
  const rowEnd = tocRailRowEnd(sections, headings);
  if (rowEnd) {
    if (tocWrap) tocWrap.style.gridRow = `2 / ${rowEnd}`;
    rail.style.gridRow = `2 / ${rowEnd}`;
  }

  // 5. share widget — a single element relocated between the hero (mobile)
  //    and the top of the TOC rail (desktop) as the viewport crosses 900px.
  const share = buildShare();
  relocateShare(
    share,
    () => {
      if (meta && meta.childElementCount) meta.before(share);
      else if (h1) h1.after(share);
      else firstSection?.prepend(share);
    },
    toc ? () => toc.before(share) : null,
    desktopMQ,
  );
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
