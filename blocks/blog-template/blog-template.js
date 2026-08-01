/**
 * blog-template — auto-block for /blog/* article pages (case study / research /
 * standard post). Authors write only the Title + hero image (section 1) and the
 * prose (section 2+). This block, invoked from scripts.js's buildAutoBlocks BEFORE
 * the fragment-link collection runs, renders everything else from page metadata:
 *
 *   - a byline (tag eyebrow / author / published + updated dates) into section 1
 *   - a left-rail table of contents auto-generated from the prose h2/h3 headings
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
import { getMetadata, toClassName } from '../../scripts/aem.js';

/**
 * Builds a table-of-contents nav from the h2/h3 headings inside `main`.
 * Assigns an id to any heading missing one so the links resolve.
 * @param {Element} main container to scan for headings
 * @returns {HTMLElement|null} <nav class="blog-toc">, or null if < 2 headings
 */
export function buildToc(main) {
  const headings = [...main.querySelectorAll('h2, h3')];
  if (headings.length < 2) return null;

  const nav = document.createElement('nav');
  nav.className = 'blog-toc';
  nav.setAttribute('aria-label', 'Table of contents');

  const label = document.createElement('p');
  label.className = 'blog-toc-label';
  label.textContent = 'On this page';

  const list = document.createElement('ol');
  headings.forEach((h, i) => {
    if (!h.id) h.id = `${toClassName(h.textContent) || 'section'}-${i}`;
    const li = document.createElement('li');
    li.className = `blog-toc-${h.tagName.toLowerCase()}`;
    const a = document.createElement('a');
    a.href = `#${h.id}`;
    a.textContent = h.textContent;
    li.append(a);
    list.append(li);
  });

  nav.append(label, list);
  return nav;
}

/**
 * Builds the byline block from resolved metadata fields. Missing fields are
 * simply omitted (no empty nodes rendered).
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

  if (tag) {
    const eyebrow = document.createElement('p');
    eyebrow.className = 'blog-byline-tag';
    eyebrow.textContent = tag;
    wrapper.append(eyebrow);
  }

  const meta = document.createElement('p');
  meta.className = 'blog-byline-meta';

  if (author) {
    const a = document.createElement('span');
    a.className = 'blog-byline-author';
    a.textContent = author;
    meta.append(a);
  }
  if (date) {
    const d = document.createElement('span');
    d.className = 'blog-byline-date';
    d.textContent = date;
    meta.append(d);
  }
  if (updated) {
    const u = document.createElement('span');
    u.className = 'blog-byline-updated';
    u.textContent = `Updated ${updated}`;
    meta.append(u);
  }

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
 * Auto-block orchestrator. Called from scripts.js buildAutoBlocks() when
 * isBlogPage() is true, BEFORE the fragment-link collection runs.
 * @param {Element} main the page's <main>
 */
export function buildBlogTemplate(main) {
  main.classList.add('blog-article');

  // 1. byline from metadata → top of section 1
  const byline = buildByline({
    author: getMetadata('author'),
    tag: getMetadata('category') || getMetadata('tags'),
    date: getMetadata('date'),
    updated: getMetadata('updated'),
  });
  const firstSection = main.querySelector(':scope > div');
  if (firstSection) firstSection.prepend(byline);
  else main.prepend(byline);

  // 2. left-rail TOC from prose headings
  const toc = buildToc(main);
  if (toc) {
    const tocWrap = document.createElement('div');
    tocWrap.className = 'blog-toc-rail';
    tocWrap.append(toc);
    main.prepend(tocWrap);
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
