/**
 * extract.mjs — source SSR HTML (+ __NEXT_DATA__) -> intermediate page model.
 *
 * This is the single place that owns the source -> DA-block mapping. It parses
 * the erp.intuit.com Next.js article: metadata from __NEXT_DATA__.metaData, and
 * body content by walking the SSR article container (the element with the most
 * direct `.Responsivetext` children — the class is reused by the global nav, so
 * we MUST scope to that container).
 *
 * Sectioning rule (verified against high-fidelity DA pages): a new <main>
 * section starts at every <h2> and at every CTA; CTAs are their own section in
 * source order; the intro before the first <h2> is one section. We append a
 * "Recommended for you" blog-cards section and the pricing-disclaimer fragment.
 */
import { JSDOM } from 'jsdom';
import { matchCta, mediaPromoUrl, PRICING_DISCLAIMER } from './catalog.mjs';

const ERP_HOST = 'https://erp.intuit.com';

/* ------------------------------ small helpers ----------------------------- */

const stripTags = (h) => (h || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cleanText = (s) => (s || '').replace(/ /g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** erp.intuit.com links -> site-relative; everything else untouched. */
function siteRel(href) {
  if (!href) return href;
  if (href.startsWith('#') || href.startsWith('/')) return href;
  const h = href.replace(/^https?:\/\/erp\.intuit\.com/i, '');
  if (h === href) return href; // external
  return h === '' ? '/' : h;
}

/** Unwrap every element matching `selector`, keeping its children. */
function unwrapAll(root, selector) {
  let el = root.querySelector(selector);
  let guard = 0;
  while (el && guard < 5000) {
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    el = root.querySelector(selector);
    guard += 1;
  }
}

/** Clone `el`, strip Quill/wrapper cruft, keep semantic inline tags -> innerHTML. */
function cleanInlineHtml(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('style,script').forEach((n) => n.remove());
  unwrapAll(c, 'span,font,u,left,small,label');
  c.querySelectorAll('*').forEach((n) => {
    if (n.tagName === 'A') {
      const href = siteRel(n.getAttribute('href') || '');
      [...n.attributes].forEach((a) => n.removeAttribute(a.name));
      if (href) n.setAttribute('href', href);
    } else if (n.tagName === 'IMG') {
      const src = n.getAttribute('src');
      const alt = n.getAttribute('alt') || '';
      [...n.attributes].forEach((a) => n.removeAttribute(a.name));
      if (src) n.setAttribute('src', src);
      n.setAttribute('alt', alt);
    } else {
      [...n.attributes].forEach((a) => n.removeAttribute(a.name));
    }
  });
  // drop empty inline wrappers left behind (e.g. <strong></strong>)
  c.querySelectorAll('strong,em,a').forEach((n) => { if (!n.textContent.trim() && !n.querySelector('img')) n.remove(); });
  return c.innerHTML.replace(/ /g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

const headingLevel = (tag) => (tag === 'h2' ? 2 : 3);

/** Walk block-level descendants of `container` in order -> node list. */
function extractBlocks(container, out = []) {
  [...container.children].forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const html = cleanInlineHtml(el);
      if (html) out.push({ type: 'heading', level: headingLevel(tag), html });
    } else if (tag === 'p') {
      const html = cleanInlineHtml(el);
      // drop in-page "jump"/"back to top" anchor-only paragraphs (nav noise DA strips)
      if (/^<a href="#[^"]*">[^<]*<\/a>$/.test(html)) return;
      if (stripTags(html) || /<img/.test(html)) out.push({ type: 'paragraph', html });
    } else if (tag === 'ul' || tag === 'ol') {
      const items = [...el.children]
        .filter((li) => li.tagName === 'LI')
        .map((li) => cleanInlineHtml(li))
        .filter((h) => stripTags(h) || /<img/.test(h));
      if (items.length) out.push({ type: 'list', ordered: tag === 'ol', items });
    } else if (tag === 'blockquote') {
      const html = cleanInlineHtml(el);
      if (html) out.push({ type: 'blockquote', html });
    } else if (tag === 'div' || tag === 'section') {
      extractBlocks(el, out);
    }
  });
  return out;
}

/* ----------------------------- classification ----------------------------- */

const styleText = (el) => el.querySelector('style')?.textContent || '';
const hasClass = (el, re) => re.test(el.className || '');

function ytId(src) {
  const m = (src || '').match(/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{6,})\//)
    || (src || '').match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

function classify(el) {
  const style = styleText(el);
  if (hasClass(el, /core-block-container/)) return 'cta';
  if (/colored-box/.test(style) || hasClass(el, /TipBox-tip-box/)) return 'highlight';
  if (/quote-box/.test(style)) return 'quote';
  if (el.querySelector('iframe[src*="datawrapper"]')) return 'embed';
  if (hasClass(el, /Responsivetext_responsivetext/)) return 'prose';
  const img = el.querySelector('img[src]');
  const heading = el.querySelector('h2,h3');
  const link = el.querySelector('a[href]');
  if (img && heading && link) return 'cta'; // image+heading+link promo (e.g. guide CTA)
  if (img) return 'image';
  if (el.querySelector('iframe[src]')) return 'embed';
  return 'unknown';
}

/* ------------------------------- extractors ------------------------------- */

function extractHighlight(el) {
  const box = el.querySelector('.colored-box') || el.querySelector('[class*="TipBox-tip-box-content"]')
    || el.querySelector('[class*="TipBox-tip-box-body"]') || el;
  box.querySelectorAll('img.icon, style, br').forEach((n) => n.remove());
  const content = extractBlocks(box);
  if (!content.length) return null;
  return { type: 'block', name: 'highlight', variant: '', content };
}

function extractQuote(el) {
  const box = el.querySelector('.quote-box') || el;
  const nodes = [];
  const h = box.querySelector('h2,h3');
  if (h && h.textContent.trim()) nodes.push({ type: 'heading', level: 3, html: esc(cleanText(h.textContent)) });
  const ps = [...box.querySelectorAll('p')].map((p) => p.textContent.replace(/ /g, ' ').trim()).filter(Boolean);
  if (!ps.length) return nodes;
  const quote = ps[0];
  const paras = [esc(quote)];
  // attribution: one combined line ("- Name, Role, Company") or separate name/role paragraphs
  let name = '';
  let role = '';
  if (ps.length === 2) {
    const attrib = ps[1].replace(/^[\s\-–—]+/, '');
    const comma = attrib.indexOf(',');
    name = comma === -1 ? attrib : attrib.slice(0, comma).trim();
    role = comma === -1 ? '' : attrib.slice(comma + 1).trim();
  } else if (ps.length >= 3) {
    name = ps[1].replace(/^[\s\-–—]+/, '').trim();
    role = ps.slice(2).join(', ').trim();
  }
  if (name) paras.push(`<strong>${esc(name)}</strong>`);
  if (role) paras.push(esc(role));
  nodes.push({ type: 'block', name: 'testimonial', variant: '', paras });
  return nodes;
}

function extractImageOrVideo(el) {
  const link = el.querySelector('a[href]');
  const id = ytId(el.querySelector('img[src]')?.getAttribute('src') || link?.getAttribute('href') || '');
  if (id) {
    const img = el.querySelector('img[src]');
    return {
      type: 'video',
      href: `https://www.youtube.com/watch?v=${id}`,
      poster: img ? { src: img.getAttribute('src'), alt: img.getAttribute('alt') || 'video thumbnail' } : null,
    };
  }
  const img = [...el.querySelectorAll('img[src]')].find((i) => !i.getAttribute('src').startsWith('data:'));
  if (!img) return null;
  return { type: 'image', src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' };
}

function extractEmbed(el, warnings) {
  const iframe = el.querySelector('iframe[src]');
  if (!iframe) return null;
  const src = iframe.getAttribute('src');
  // datawrapper charts AND tables are authored as `embed` (DA convention); keep
  // the source URL verbatim (incl. its version segment) so it matches DA.
  if (!/^https?:\/\/datawrapper\.dwcdn\.net\//.test(src)) {
    warnings.push(`non-datawrapper iframe embed kept as-is: ${src}`);
  }
  return { type: 'block', name: 'embed', href: src };
}

function extractCta(el, warnings) {
  const img = el.querySelector('img[src]');
  const heading = el.querySelector('h2,h3')?.textContent.trim() || '';
  const imageSrc = img?.getAttribute('src') || '';
  const match = matchCta({ imageSrc, heading });
  if (match) return { type: 'block', name: 'fragment', href: mediaPromoUrl(match.id) };

  // fallback: faithful inline media-text
  const links = [...el.querySelectorAll('a[href]')];
  const ctaA = links.find((a) => a.querySelector('strong,em')) || links[links.length - 1];
  const ctaP = ctaA ? ctaA.closest('p') : null;
  const paras = [...el.querySelectorAll('p')]
    .filter((p) => p !== ctaP)
    .map((p) => cleanInlineHtml(p))
    .filter((h) => stripTags(h));
  const cta = ctaA
    ? { href: siteRel(ctaA.getAttribute('href')), label: ctaA.textContent.trim(), style: ctaA.querySelector('em') ? 'em' : 'strong' }
    : null;
  warnings.push(`CTA "${heading || (img && img.getAttribute('src'))}" not in media-promo catalog — emitted inline media-text`);
  return {
    type: 'block',
    name: 'media-text',
    variant: '',
    heading,
    paras,
    cta,
    image: img ? { src: imageSrc, alt: img.getAttribute('alt') || '' } : null,
  };
}

/* -------------------------------- metadata -------------------------------- */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** epoch ms -> "Month D, YYYY" (UTC, matching the DA pull). */
function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

const titleCaseWords = (s) => s.split(/[\s-]+/).filter(Boolean)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function pathParts(url) {
  const path = new URL(url, ERP_HOST).pathname.replace(/\/+$/, '');
  const segs = path.replace(/^\/blog\/?/, '').split('/').filter(Boolean);
  return { path, segs };
}

/** Synthesize the BreadcrumbList json-ld that DA carries (source has none). */
function buildJsonLd(url, h1) {
  const { path, segs } = pathParts(url);
  const canonical = `${ERP_HOST}${path}/`;
  const items = [
    { name: 'Home', item: 'https://www.intuit.com/' },
    { name: 'Intuit Enterprise Suite', item: `${ERP_HOST}/` },
    { name: 'Blog', item: `${ERP_HOST}/blog/` },
  ];
  let acc = `${ERP_HOST}/blog`;
  segs.forEach((seg, i) => {
    acc += `/${seg}`;
    const last = i === segs.length - 1;
    items.push({ name: last ? titleCaseWords(h1 ? seg : seg) : titleCaseWords(seg), item: `${acc}/` });
  });
  const itemListElement = items.map((it, i) => ({
    '@type': 'ListItem', position: i + 1, name: it.name, item: it.item,
  }));
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [{ '@type': 'BreadcrumbList', '@id': `${canonical}#breadcrumb`, itemListElement }],
  });
}

function extractMetadata(doc, md, url) {
  const { segs } = pathParts(url);
  const category = segs.length >= 2 ? segs[0] : (segs[0] || '');
  const template = /\/blog\/research\//.test(url) ? 'Research' : 'Blog Article';
  const authorEl = doc.querySelector('[class*="primaryAuthor"]');
  const tags = (md.categories || [])
    .filter((c) => c.categoryName !== 'Primary Category')
    .flatMap((c) => (c.concepts || []).map((x) => x.prefLabel))
    .filter(Boolean);
  const h1 = doc.querySelector('h1')?.textContent.trim() || '';
  const fields = {
    Title: (md.seo_og_title || md.seo_title || h1).replace(/\s*\|\s*Intuit\s*$/, ''),
    Description: md.seo_metaDescription || md.seo_og_desc || '',
    Image: md.seo_og_image || '',
    Author: authorEl?.textContent.trim() || 'Intuit',
    Category: category,
    Tags: tags.join(', '),
    Date: fmtDate(md.lastPublishedDate || md.createdDate),
    Template: template,
    'json-ld': buildJsonLd(url, h1),
  };
  if (!fields.Tags) delete fields.Tags;
  return fields;
}

/* --------------------------------- driver --------------------------------- */

function findBody(doc) {
  let body = null;
  let best = -1;
  doc.querySelectorAll('div').forEach((d) => {
    const n = [...d.children].filter((c) => /Responsivetext_responsivetext/.test(c.className || '')).length;
    if (n > best) { best = n; body = d; }
  });
  return best >= 2 ? body : null;
}

/**
 * Core extractor working on a live DOM `document` — shared by the Node CLI
 * (via extractPage) and the browser helix-importer-ui adapter (import.js).
 * @param {Document} doc source document
 * @param {string} url source URL (used for path/category/template/json-ld)
 * @returns {{path, metadata, h1, hero, sections, warnings, template}}
 */
export function extractPageFromDoc(doc, url) {
  const ndEl = doc.querySelector('#__NEXT_DATA__');
  const md = ndEl ? JSON.parse(ndEl.textContent).props.pageProps.metaData || {} : {};
  const warnings = [];

  const template = /\/blog\/research\//.test(url) ? 'Research' : 'Blog Article';
  const { path } = pathParts(url);

  const hero = doc.querySelector('[class*="QrcArticleHero"] img[src]')
    || doc.querySelector('h1 ~ picture img, h1 + * img');
  const h1 = doc.querySelector('h1')?.textContent.trim() || md.seo_og_title || '';

  const metadata = extractMetadata(doc, md, url);
  // video-led pages have no seo_og_image; fall back to the hero (video poster)
  if (!metadata.Image && hero) metadata.Image = hero.getAttribute('src');

  const body = findBody(doc);
  if (!body) throw new Error(`could not locate article body for ${url} (not an article layout?)`);

  const sections = [];
  let current = [];
  const flush = () => { if (current.length) { sections.push(current); current = []; } };

  [...body.children].forEach((child) => {
    if (/Spacer/.test(child.className || '')) return;
    const kind = classify(child);
    if (kind === 'cta') { flush(); sections.push([extractCta(child, warnings)]); return; }
    if (kind === 'unknown') {
      const label = child.className?.toString().split(' ')[0] || child.tagName;
      warnings.push(`skipped unrecognized block: ${label} (client-rendered or unsupported, e.g. SnackableCards/stat-band)`);
      return;
    }
    let nodes = [];
    if (kind === 'prose') nodes = extractBlocks(child);
    else if (kind === 'highlight') { const b = extractHighlight(child); if (b) nodes = [b]; }
    else if (kind === 'quote') nodes = extractQuote(child);
    else if (kind === 'image' || kind === 'video') { const n = extractImageOrVideo(child); if (n) nodes = [n]; }
    else if (kind === 'embed') { const b = extractEmbed(child, warnings); if (b) nodes = [b]; }
    nodes.forEach((n) => {
      if (n.type === 'heading' && n.level === 2) flush();
      current.push(n);
    });
  });
  flush();

  // trailing standard footer: Recommended for you + pricing disclaimer
  const category = metadata.Category;
  sections.push([
    { type: 'heading', level: 2, html: 'Recommended for you' },
    {
      type: 'block', name: 'blog-cards', category, limit: 3, exclude: 'current',
    },
  ]);
  sections.push([{ type: 'block', name: 'fragment', href: PRICING_DISCLAIMER, wrap: true }]);

  return {
    path,
    template,
    metadata,
    h1,
    hero: hero ? { src: hero.getAttribute('src'), alt: hero.getAttribute('alt') || '' } : null,
    sections,
    warnings,
  };
}

/**
 * Node entry point: parse an SSR HTML string with jsdom, then extract.
 * @param {string} html source SSR HTML
 * @param {string} url source URL
 */
export function extractPage(html, url) {
  return extractPageFromDoc(new JSDOM(html).window.document, url);
}
