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

/** whitespace/punctuation-insensitive key for de-duping text across DOM shapes. */
const alnum = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

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

/**
 * For a content icon `<img>` (class="icon", an SVG), the EDS icon token name
 * derived from its filename; null for regular content images. The SVGs are
 * committed under `/icons/<name>.svg`, so emitting `:name:` renders them inline
 * at icon size instead of as a full-size image.
 */
function iconToken(img) {
  const cls = img.getAttribute('class') || '';
  const base = (img.getAttribute('src') || '').split('?')[0].split('/').pop() || '';
  if (!/(^|\s)icon(\s|$)/.test(cls) || !/\.svg$/i.test(base)) return null;
  return base.replace(/\.svg$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Clone `el`, strip Quill/wrapper cruft, keep semantic inline tags -> innerHTML. */
function cleanInlineHtml(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('style,script').forEach((n) => n.remove());
  // content icons (e.g. the "Quick answer" lightbulb/exclamation) -> inline
  // `:name:` tokens rendered small from /icons/<name>.svg, not a huge <img>.
  c.querySelectorAll('img').forEach((img) => {
    const name = iconToken(img);
    if (name) img.replaceWith(c.ownerDocument.createTextNode(` :${name}: `));
  });
  unwrapAll(c, 'span,font,u,left,small,label');
  c.querySelectorAll('*').forEach((n) => {
    if (n.tagName === 'A') {
      const href = siteRel(n.getAttribute('href') || '');
      [...n.attributes].forEach((a) => n.removeAttribute(a.name));
      if (href) n.setAttribute('href', href);
    } else if (n.tagName === 'IMG') {
      const src = n.getAttribute('src');
      const alt = n.getAttribute('alt') || '';
      const width = n.getAttribute('width');
      const height = n.getAttribute('height');
      [...n.attributes].forEach((a) => n.removeAttribute(a.name));
      if (src) n.setAttribute('src', src);
      n.setAttribute('alt', alt);
      // keep intrinsic dimensions so inline content icons render at their size
      if (width) n.setAttribute('width', width);
      if (height) n.setAttribute('height', height);
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
    } else if (['div', 'section', 'left', 'font', 'article', 'main', 'aside'].includes(tag)
      || tag.includes('<')) {
      // recurse into containers, including malformed Quill wrappers such as
      // `<left<p>` (parsed as tagName `left<p`) that would otherwise drop the
      // callout content nested inside them.
      if (el.querySelector('h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, table')) {
        extractBlocks(el, out);
      } else {
        // leaf container with only inline content (e.g. a callout's
        // `.icon-wrap > span`) — emit it as one paragraph so the text/icon isn't lost.
        const html = cleanInlineHtml(el);
        if (stripTags(html) || /<img/.test(html)) out.push({ type: 'paragraph', html });
      }
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

/** textContent with <style>/<script> removed — distinguishes real callouts from style-only injections. */
function textSansStyle(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('style,script').forEach((n) => n.remove());
  return c.textContent.replace(/\s+/g, ' ').trim();
}

function classify(el) {
  const style = styleText(el);
  if (hasClass(el, /core-block-container/)) return 'cta';
  // SnackableCards stat-band renders client-side (empty in SSR); its data lives
  // in __NEXT_DATA__ (see statBandFromBlocks). Checked before the empty-skip below.
  if (/snackable/i.test(el.className || '') || el.querySelector('[class*="Snackable" i]')) return 'statband';
  if (hasClass(el, /Separator/)) return 'skip'; // decorative rule (chrome)
  if (/quote-box/.test(style)) return 'quote';
  // MDS Quote component: the quote-mark is a decorative data-URI <img>, so this
  // MUST precede the `img => image` branch below or the quote is lost as an image.
  if (hasClass(el, /Quote_quoteContainer/)) return 'quote';
  if (el.querySelector('iframe[src*="datawrapper"]')) return 'embed';
  if (hasClass(el, /Responsivetext_responsivetext/)) return 'prose';
  // Highlight = any callout box painted the brand bright-cyan (#C2F5FF). The
  // source uses several class names for it (`.colored-box`, `.test-box`, …); key
  // off the colour so every variant maps to the `highlight` block, plus TipBox.
  if (/#c2f5ff/i.test(style) || /colored-box/.test(style) || hasClass(el, /TipBox-tip-box/)) return 'highlight';
  // generic source callout wrapper (`.root > .innerhtml`): decide by content
  if (hasClass(el, /(^|\s)root(\s|$)/) || el.querySelector(':scope > .innerhtml, :scope .innerhtml')) {
    if (el.querySelector('iframe[src]')) return 'embed';
    if (el.querySelector('img[src]')) return 'image';
    return textSansStyle(el) ? 'highlight' : 'skip'; // empty => style-only injection
  }
  const img = el.querySelector('img[src]');
  const heading = el.querySelector('h2,h3');
  const link = el.querySelector('a[href]');
  if (img && heading && link) return 'cta'; // image+heading+link promo (e.g. guide CTA)
  if (img) return 'image';
  if (el.querySelector('iframe[src]')) return 'embed';
  if (!textSansStyle(el)) return 'skip'; // empty/style-only
  return 'unknown';
}

/* ------------------------------- extractors ------------------------------- */

/** Locate the callout's content box. Prefer the element whose `<style>` rule
 *  paints it #C2F5FF (covers `.colored-box`, `.test-box`, and any other name),
 *  then fall back to the known TipBox containers. */
function highlightBox(el) {
  const m = styleText(el).match(/\.([A-Za-z0-9_-]+)\s*\{[^}]*background(?:-color)?\s*:\s*#c2f5ff/i);
  if (m) { const box = el.querySelector(`.${m[1]}`); if (box) return box; }
  return el.querySelector('.colored-box')
    || el.querySelector('[class*="TipBox-tip-box-content"]')
    || el.querySelector('[class*="TipBox-tip-box-body"]') || el;
}

/** Merge an icon-only paragraph (just `:name:` tokens) into the following
 *  paragraph so the icon sits inline with its text rather than on its own line. */
const ICON_ONLY = /^\s*(?::[a-z0-9-]+:\s*)+$/;
function mergeLeadingIcons(nodes) {
  const out = [];
  let pending = '';
  nodes.forEach((n) => {
    if (n.type === 'paragraph' && ICON_ONLY.test(n.html)) { pending += `${n.html.trim()} `; return; }
    if (pending && n.type === 'paragraph') { out.push({ type: 'paragraph', html: (pending + n.html).trim() }); pending = ''; return; }
    if (pending) { out.push({ type: 'paragraph', html: pending.trim() }); pending = ''; }
    out.push(n);
  });
  if (pending) out.push({ type: 'paragraph', html: pending.trim() });
  return out;
}

function extractHighlight(el) {
  const box = highlightBox(el);
  // strip only CSS/line-break cruft — images and icons are content (e.g. the
  // "Quick answer" lightbulb/exclamation graphics), so they are kept.
  box.querySelectorAll('style, br').forEach((n) => n.remove());
  const content = mergeLeadingIcons(extractBlocks(box));
  if (!content.length) return null;
  return { type: 'block', name: 'highlight', variant: '', content };
}

function extractQuote(el) {
  // MDS Quote component (Quote_quoteContainer): a large pull-quote on the source
  // (40px bold + block attribution line, verified on erp.intuit.com), so it maps
  // to a default-content <blockquote> — matching styles.css `blockquote p`/`cite`
  // — not the smaller `testimonial` block (which blog-template styles at 18px).
  // Body and attribution live in dedicated divs (no <p>/<h>); the quote-mark is a
  // decorative data-URI SVG and is dropped.
  const qtEl = el.querySelector('[class*="Quote_quoteText"]');
  if (qtEl) {
    const quote = cleanText(qtEl.textContent);
    if (!quote) return [];
    const attribEl = el.querySelector('[class*="Quote_authorDetails"]');
    const attrib = attribEl ? cleanText(attribEl.textContent).replace(/^[\s\-–—]+/, '') : '';
    const html = `<p>${esc(quote)}</p>${attrib ? `<cite>${esc(attrib)}</cite>` : ''}`;
    return [{ type: 'blockquote', html }];
  }
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

/* ------------------------------- stat-band -------------------------------- */

/** Depth-first find of the first `mds-components/snackable-cards-slider` block. */
function findSnackableSlider(blocks) {
  let found = null;
  (function walk(b) {
    if (found) return;
    if (Array.isArray(b)) { b.forEach(walk); return; }
    if (!b || typeof b !== 'object') return;
    if (b.blockName === 'mds-components/snackable-cards-slider') { found = b; return; }
    if (b.innerBlocks) walk(b.innerBlocks);
  }(blocks));
  return found;
}

/** First image URL in an MDS image object (desktop original preferred). */
function mdsImageUrl(image = {}) {
  const keys = ['mediaDesktopUrl', 'desktopOriginalMediaUrl', 'mediaDesktopThumbnail',
    'mobileOriginalMediaUrl', 'mediaMobileThumbnail'];
  for (const k of keys) {
    const v = image[k];
    if (typeof v === 'string' && /oidam|\.(jpe?g|png|webp|svg)/i.test(v)) return v;
  }
  const any = Object.values(image).find((v) => typeof v === 'string' && /oidam.*\.(jpe?g|png|webp)/i.test(v));
  return any || '';
}

/**
 * Build a `stat-band cards` block from the page's snackable-cards-slider — a
 * horizontal scroll of the source's stat graphics + captions. The card data
 * renders client-side (empty in SSR), so it's read from __NEXT_DATA__: each
 * card = image (mediaDesktopUrl, with the stat text as altText) + copy caption;
 * the lead title-card is an image-less text card. Returns a block node or null.
 */
function statBandFromBlocks(blocks) {
  const slider = findSnackableSlider(blocks);
  if (!slider) return null;
  const cards = [];
  (slider.innerBlocks || []).forEach((it) => {
    if (!/slider-item$/.test(it.blockName || '')) return;
    const p = it.props || {};
    const alt = (p.image?.altText || p.image?.alt || '').replace(/\s+/g, ' ').trim();
    const caption = typeof p.copy === 'string' ? p.copy.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const src = mdsImageUrl(p.image || {});
    if (p.cardType === 'title-card') cards.push({ image: null, caption: caption || alt });
    else if (src) cards.push({ image: { src, alt }, caption });
  });
  if (cards.length < 2) return null;
  return {
    type: 'block', name: 'stat-band', variant: 'cards', cards,
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

/** Wrappers that are page chrome, never article content. */
const CHROME_RE = /SocialMedia|TalkToSales|ArticleRightRail|ArticleRelated|right-rail|left-rail|AuthorBio|Breadcrumb|Navigation|Footer|EventsBar|events-bar/i;

/** A direct child that counts as an article content block (prose/image/CTA).
 *  Bare `.root` is intentionally not counted — it is usually a style/script
 *  injection (e.g. footer/search CSS) rather than real content. */
function isContentChild(el) {
  const c = (el.className || '').toString();
  if (CHROME_RE.test(c)) return false;
  if (/Responsivetext_responsivetext/.test(c)) return !!textSansStyle(el);
  if (/core-block-container/.test(c)) return true;
  if (/adaptive-img|Image_/.test(c)) return true;
  return !!el.querySelector(':scope > picture img[src]:not([src^="data:"]), :scope > img[src]:not([src^="data:"])');
}

/**
 * Locate the article body container. The standard layout keeps prose blocks as
 * flat siblings, so the container with the most direct `.Responsivetext`
 * children wins. Some layouts (e.g. `ask-the-expert`) scatter prose one block
 * per wrapper; there we scope to the article main region (so global nav/footer
 * chrome can't win) and pick the container with the most direct content blocks.
 */
function findBody(doc) {
  let body = null;
  let best = -1;
  doc.querySelectorAll('div').forEach((d) => {
    const n = [...d.children].filter((c) => /Responsivetext_responsivetext/.test(c.className || '')).length;
    if (n > best) { best = n; body = d; }
  });
  if (best >= 2) return body;
  const scope = doc.querySelector('[class*="ArticleComponent-main-content"]')
    || doc.querySelector('main') || doc.body;
  body = null;
  best = -1;
  scope.querySelectorAll('div').forEach((d) => {
    const n = [...d.children].filter(isContentChild).length;
    if (n > best) { best = n; body = d; }
  });
  return best >= 2 ? body : null;
}

/**
 * Page-specific footnote disclaimers that live *outside* the article body (some
 * ask-the-expert / product pages). Distinct from the generic pricing-disclaimer
 * fragment already appended to every article — identified by numeric footnote
 * markers (`[1]`) so the generic "Disclaimer: This content is for information
 * purposes only" boilerplate (covered by that fragment) is never duplicated.
 * @returns {Array|null} content nodes for a trailing disclaimers section, or null
 */
function extractDisclaimers(doc, body) {
  const rts = [...doc.querySelectorAll('[class*="Responsivetext_responsivetext"]')];
  for (const rt of rts) {
    if (body && body.contains(rt)) continue;
    const txt = textSansStyle(rt);
    if (/^disclaimers?\b/i.test(txt) && /\[\d+\]/.test(txt)) {
      const nodes = extractBlocks(rt);
      if (nodes.length) return nodes;
    }
  }
  return null;
}

/**
 * Highlight callout boxes (#C2F5FF) that live *outside* the extracted body — most
 * often a top-of-article "Key takeaways" summary that the source renders in its
 * own container above the prose. The main loop only walks the body, so these are
 * captured here: before-body boxes are prepended (top summary), after-body boxes
 * appended. De-duped against the body so responsive desktop/mobile twins that are
 * already captured are not emitted again.
 * @returns {{before: object[], after: object[]}}
 */
function extractOrphanHighlights(doc, body) {
  const before = [];
  const after = [];
  if (!body) return { before, after };
  const bodyText = alnum(body.textContent);
  const seen = new Set();
  doc.querySelectorAll('.colored-box, .test-box, [class*="TipBox-tip-box"]').forEach((box) => {
    if (body.contains(box)) return; // handled by the main loop
    if (box.closest('[class*="Footer" i], [class*="Nav" i], [class*="RightRail" i], [class*="Related" i], [class*="AuthorBio" i]')) return;
    const sig = alnum(textSansStyle(box)).slice(0, 60);
    if (sig.length < 12 || seen.has(sig) || bodyText.includes(sig)) return;
    seen.add(sig);
    const b = extractHighlight(box.closest('.root') || box);
    if (!b) return;
    // eslint-disable-next-line no-bitwise
    ((body.compareDocumentPosition(box) & 2) ? before : after).push(b);
  });
  return { before, after };
}

/**
 * A "Frequently Asked Questions" accordion (MDS RwAccordion/Accordion), rendered
 * client-side but with the Q/A text present in the SSR. Emitted as an `<h2>` +
 * `faq` block, matching the DA authoring (e.g.
 * /blog/product-update/what-is-intuit-enterprise-suite). Returns section nodes
 * or null.
 */
function extractFaq(doc) {
  const head = [...doc.querySelectorAll('h2, h3')]
    .find((h) => /frequently asked questions|\bfaqs?\b/i.test(h.textContent || ''));
  if (!head) return null;
  const accs = [...doc.querySelectorAll('[class*="ccordion_accordion__"]')];
  const acc = accs.find((a) => (head.compareDocumentPosition(a) & 4) !== 0) || accs[accs.length - 1];
  if (!acc) return null;
  const items = [];
  acc.querySelectorAll('[class*="AccordionItem_itemContainer"]').forEach((it) => {
    const q = it.querySelector('button, [class*="itemHeading"], h3, h4');
    const panel = it.querySelector('[class*="itemPanel"], [class*="panel"]');
    if (!q || !panel) return;
    const question = cleanText(q.textContent);
    const answer = extractBlocks(panel);
    if (question && answer.length) items.push({ q: esc(question), answer });
  });
  if (!items.length) return null;
  return [
    { type: 'heading', level: 2, html: esc(cleanText(head.textContent)) },
    { type: 'block', name: 'faq', items },
  ];
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
  const pp = ndEl ? JSON.parse(ndEl.textContent).props.pageProps : {};
  const md = pp.metaData || {};
  const blocks = pp.blocks || [];
  const warnings = [];

  const template = /\/blog\/research\//.test(url) ? 'Research' : 'Blog Article';
  const { path } = pathParts(url);

  const heroWrap = doc.querySelector('[class*="QrcArticleHero"]');
  const heroImg = heroWrap?.querySelector('img[src]')
    || doc.querySelector('h1 ~ picture img, h1 + * img');
  // ask-the-expert & other video-led articles use a YouTube poster as the hero;
  // emit it as a video (link + poster) so blog-template upgrades it to a player.
  const heroVid = ytId(heroImg?.getAttribute('src') || '')
    || ytId(heroWrap?.querySelector('a[href*="youtu" i]')?.getAttribute('href') || '');
  let hero = null;
  if (heroVid) {
    hero = {
      type: 'video',
      href: `https://www.youtube.com/watch?v=${heroVid}`,
      poster: heroImg
        ? { type: 'image', src: heroImg.getAttribute('src'), alt: heroImg.getAttribute('alt') || 'video thumbnail' }
        : null,
    };
  } else if (heroImg) {
    hero = { type: 'image', src: heroImg.getAttribute('src'), alt: heroImg.getAttribute('alt') || '' };
  }
  const h1 = doc.querySelector('h1')?.textContent.trim() || md.seo_og_title || '';

  const metadata = extractMetadata(doc, md, url);
  // video-led pages have no seo_og_image; fall back to the hero (video poster)
  if (!metadata.Image) {
    const heroSrc = hero?.type === 'video' ? hero.poster?.src : hero?.src;
    if (heroSrc) metadata.Image = heroSrc;
  }

  const body = findBody(doc);
  if (!body) throw new Error(`could not locate article body for ${url} (not an article layout?)`);

  const sections = [];
  let current = [];
  const flush = () => { if (current.length) { sections.push(current); current = []; } };

  [...body.children].forEach((child) => {
    if (/Spacer/.test(child.className || '')) return;
    const kind = classify(child);
    if (kind === 'skip') return; // chrome / style-only injection — no content lost
    if (kind === 'cta') { flush(); sections.push([extractCta(child, warnings)]); return; }
    if (kind === 'statband') {
      const b = statBandFromBlocks(blocks);
      if (b) { flush(); sections.push([b]); } else {
        warnings.push('stat-band (SnackableCards) present but no parseable figures in payload — author manually');
      }
      return;
    }
    if (kind === 'unknown') {
      warnings.push(`skipped unrecognized block: ${child.className?.toString().split(' ')[0] || child.tagName}`);
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

  // highlight callouts outside the body: prepend a top "Key takeaways" summary,
  // append any that trail the prose.
  const orphans = extractOrphanHighlights(doc, body);
  [...orphans.before].reverse().forEach((b) => sections.unshift([b]));
  orphans.after.forEach((b) => sections.push([b]));

  // FAQ accordion (rendered client-side, Q/A present in SSR) — a real content
  // section ahead of the trailing standard footer, matching the DA authoring.
  const faq = extractFaq(doc);
  if (faq) sections.push(faq);

  // page-specific footnote disclaimers (outside the body on some layouts) —
  // a real content section, kept ahead of the trailing standard footer.
  const disclaimers = extractDisclaimers(doc, body);
  if (disclaimers) sections.push(disclaimers);

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
    hero,
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
