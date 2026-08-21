/**
 * render-da.mjs — turn the intermediate block model (see extract.mjs) into the
 * canonical DA collapsed-table HTML that matches content/blog/** verbatim.
 *
 * Every emitter here was lifted from the freshly-pulled DA corpus. The block
 * form is div-class with `<p>`-wrapped cells; images are explicit two-source
 * `<picture>` elements (cross-origin images the pipeline does not optimize).
 *
 * Page model:
 *   { path, metadata: {label: value, ...}, h1: html, hero: {src, alt}|null,
 *     sections: Node[][] }   // sections AFTER section 0 (metadata+h1+hero)
 * Node kinds (type):
 *   heading {level, html} | paragraph {html} | list {ordered, items:[html]}
 *   | image {src, alt} | blockquote {html} | video {href, poster:{src,alt}|null}
 *   | raw {html}
 *   | block {name, ...}:
 *       highlight {variant, content: Node[]}
 *       media-text {variant, heading, paras:[html], cta:{href,label,style}|null, image:{src,alt}|null}
 *       fragment {href, wrap}
 *       embed {href}
 *       table {rows: string[][]}   // cell html
 *       testimonial {variant, paras:[html]}
 *       faq {items:[{q, answerHtml}]}
 *       cta-band {heading, paras:[html], cta:{href,label,style}}
 *       blog-cards {category, limit, exclude, extra:[[k,v]]}
 */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const cls = (name, variant) => (variant ? `${name} ${variant}` : name);

/** Explicit two-source picture, matching the DA/migration convention verbatim. */
export function picture({ src, alt = '' }) {
  return `<picture>`
    + `<source srcset="${src}">`
    + `<source srcset="${src}" media="(min-width: 600px)">`
    + `<img src="${src}" alt="${esc(alt)}" loading="lazy">`
    + `</picture>`;
}

function renderNode(n) {
  switch (n.type) {
    case 'heading': return `<h${n.level}>${n.html}</h${n.level}>`;
    case 'paragraph': return `<p>${n.html}</p>`;
    case 'blockquote': return `<blockquote>${n.html}</blockquote>`;
    case 'raw': return n.html;
    case 'list': {
      const tag = n.ordered ? 'ol' : 'ul';
      return `<${tag}>${n.items.map((i) => `<li>${i}</li>`).join('')}</${tag}>`;
    }
    case 'image': return picture(n);
    case 'video': {
      const poster = n.poster ? picture(n.poster)
        : `<img src="" alt="video thumbnail">`;
      return `<a href="${n.href}">${poster}</a>`;
    }
    case 'block': return renderBlock(n);
    default: return '';
  }
}

const button = (cta) => {
  if (!cta) return '';
  const inner = cta.style === 'em' ? `<em>${esc(cta.label)}</em>` : `<strong>${esc(cta.label)}</strong>`;
  return `<p><a href="${cta.href}">${inner}</a></p>`;
};

function renderBlock(b) {
  switch (b.name) {
    case 'highlight':
      return `<div class="${cls('highlight', b.variant)}"><div><div>`
        + b.content.map(renderNode).join('')
        + `</div></div></div>`;
    case 'fragment': {
      const anchor = `<a href="${b.href}">${b.href}</a>`;
      const cell = b.wrap ? `<p>${anchor}</p>` : anchor;
      return `<div class="fragment"><div><div>${cell}</div></div></div>`;
    }
    case 'embed':
      return `<div class="embed"><div><div><a href="${b.href}">${b.href}</a></div></div></div>`;
    case 'media-text': {
      const paras = (b.paras || []).map((p) => `<p>${p}</p>`).join('');
      const textCell = `<div>${b.heading ? `<h3>${b.heading}</h3>` : ''}${paras}${button(b.cta)}</div>`;
      const imgCell = b.image ? `<div>${picture(b.image)}</div>` : '';
      return `<div class="${cls('media-text', b.variant)}"><div>${textCell}${imgCell}</div></div>`;
    }
    case 'table': {
      const rows = b.rows.map((r) => `<div>${r.map((c) => `<div><p>${c}</p></div>`).join('')}</div>`).join('');
      return `<div class="table">${rows}</div>`;
    }
    case 'testimonial': {
      const paras = b.paras.map((p) => `<p>${p}</p>`).join('');
      return `<div class="${cls('testimonial', b.variant)}"><div><div>${paras}</div></div></div>`;
    }
    case 'faq': {
      const items = b.items.map((it) => `<div><div>${it.q}</div><div><p>${it.answerHtml}</p></div></div>`).join('');
      return `<div class="faq">${items}</div>`;
    }
    case 'cta-band': {
      const paras = (b.paras || []).map((p) => `<p>${p}</p>`).join('');
      return `<div class="cta-band"><div><div>${b.heading ? `<h3>${b.heading}</h3>` : ''}${paras}${button(b.cta)}</div></div></div>`;
    }
    case 'stat-band': {
      let rows;
      if (b.cards) {
        // image-card variant: each card = optional picture + caption paragraph
        rows = b.cards.map((c) => {
          const pic = c.image ? picture(c.image) : '';
          const cap = c.caption ? `<p>${esc(c.caption)}</p>` : '';
          return `<div><div>${pic}${cap}</div></div>`;
        }).join('');
      } else {
        rows = b.stats
          .map((s) => `<div><div><p><strong>${esc(s.number)}</strong></p><p>${esc(s.label)}</p></div></div>`)
          .join('');
      }
      return `<div class="${cls('stat-band', b.variant)}">${rows}</div>`;
    }
    case 'blog-cards': {
      const row = (k, v) => `<div><div><p>${k}</p></div><div><p>${v}</p></div></div>`;
      let rows = row('category', b.category) + row('limit', b.limit ?? 3) + row('exclude', b.exclude ?? 'current');
      (b.extra || []).forEach(([k, v]) => { rows += row(k, v); });
      return `<div class="${cls('blog-cards', b.variant)}">${rows}</div>`;
    }
    default: return '';
  }
}

/** metadata block from an ordered {label: value} map. */
export function renderMetadata(fields) {
  const rows = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<div><div><p>${esc(k)}</p></div><div><p>${esc(v)}</p></div></div>`)
    .join('');
  return `<div class="metadata">${rows}</div>`;
}

/** A single <main> section from its ordered nodes. */
const renderSection = (nodes) => `<div>${nodes.map(renderNode).join('')}</div>`;

/** The content that goes inside <main>: section 0 (metadata+h1+hero) + the rest. */
export function renderMainInner(page) {
  const section0 = `<div>${renderMetadata(page.metadata)}`
    + (page.h1 ? `<h1>${page.h1}</h1>` : '')
    + (page.hero ? renderNode(page.hero) : '')
    + `</div>`;
  return section0 + (page.sections || []).map(renderSection).join('');
}

/**
 * Full DA document string for a page model — byte-compatible skeleton with the
 * DA pull (leading blank line, empty header/footer, collapsed <main>).
 * @param {object} page
 * @returns {string}
 */
export function renderPage(page) {
  return `\n<body>\n  <header></header>\n  <main>${renderMainInner(page)}</main>\n  <footer></footer>\n</body>\n`;
}

export { renderNode, renderBlock };
