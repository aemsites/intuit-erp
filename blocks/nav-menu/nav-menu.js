/**
 * nav-menu — authorable primary nav, one row per top-level item, under
 * content/nav.html. Parsed here into the exact nav-item/flyout DOM that
 * blocks/header/header.js's CSS and flyout wiring already expect, so no
 * header changes are needed when this markup is dropped into `.nav-main`.
 *
 * Row shape (cell 1, cell 2):
 *   - Direct link:  cell 1 = <a href="...">Label</a>, cell 2 empty.
 *                   Wrap the link in <strong> for the accent "acct-link"
 *                   style (used today for "For accounting firms").
 *   - Flyout menu:  cell 1 = plain text label (the button/caret trigger).
 *                   cell 2 = one or more column groups: an optional
 *                   paragraph heading followed by a <ul> of <li><a> links.
 *                   A link's <li> may include trailing text after the <a>
 *                   (e.g. "<a>Label</a> — description") for the flyout-desc.
 *
 * Links are internal (no target, no is-internal styling opt-out) unless
 * the href is absolute (http/https), which opens in a new tab — the same
 * rule content-index-driven blocks (event-cards) use for ctaUrl.
 */

function isExternal(href) {
  return /^https?:\/\//.test(href);
}

function parseLinkItem(li) {
  const a = li.querySelector('a');
  if (!a) return null;
  const href = a.getAttribute('href');
  const text = a.textContent.trim();
  const clone = li.cloneNode(true);
  clone.querySelector('a').remove();
  const desc = clone.textContent.replace(/^[\s—–-]+/, '').trim();
  return {
    text, href, desc: desc || undefined,
  };
}

function flyoutLinkHTML(l) {
  const external = isExternal(l.href);
  const cls = `flyout-link${external ? '' : ' is-internal'}`;
  const tgt = external ? ' target="_blank" rel="noopener"' : '';
  const desc = l.desc ? `<span class="flyout-desc">${l.desc}</span>` : '';
  return `<a class="${cls}" href="${l.href}"${tgt}><span class="flyout-label">${l.text}</span>${desc}</a>`;
}

function navLinkHTML(a) {
  const href = a.getAttribute('href');
  const external = isExternal(href);
  const cls = a.closest('strong') ? 'acct-link' : 'nav-link';
  const tgt = external ? ' target="_blank" rel="noopener"' : '';
  return `<a class="${cls}" href="${href}"${tgt}>${a.textContent.trim()}</a>`;
}

function parseColumns(menuCell) {
  const cols = [];
  let current = null;
  [...menuCell.children].forEach((el) => {
    if (el.matches('ul')) {
      if (!current) {
        current = { heading: '', links: [] };
        cols.push(current);
      }
      [...el.children].forEach((li) => {
        const link = parseLinkItem(li);
        if (link) current.links.push(link);
      });
    } else {
      const heading = el.textContent.trim();
      if (heading) {
        current = { heading, links: [] };
        cols.push(current);
      }
    }
  });
  return cols;
}

function menuItemHTML(label, menuCell, idx) {
  const id = `flyout-${idx}`;
  const cols = parseColumns(menuCell);
  const colsHTML = cols.map((c) => `
        <div class="flyout-col">
          ${c.heading ? `<p class="flyout-heading">${c.heading}</p>` : ''}
          ${c.links.map(flyoutLinkHTML).join('')}
        </div>`).join('');
  // Wide (4+ column) flyouts like Resources are too wide to stay anchored
  // under their own trigger button without running off the right edge of
  // the viewport — flyout-wide repositions them relative to the whole nav
  // row instead (see header.css), giving them the full row's width to grow
  // into leftward.
  const wideCls = cols.length > 3 ? ' flyout-wide' : '';
  return `
      <div class="nav-item">
        <button type="button" aria-expanded="false" aria-controls="${id}">${label}<i class="caret"></i></button>
        <div class="flyout${wideCls}" id="${id}" hidden><div class="flyout-inner">${colsHTML}</div></div>
      </div>`;
}

export default function decorate(block) {
  const rows = [...block.children];
  const html = rows.map((row, idx) => {
    const [labelCell, menuCell] = row.children;
    if (!labelCell) return '';
    const link = labelCell.querySelector('a');
    const hasMenu = menuCell && menuCell.querySelector('ul');
    if (link && !hasMenu) return navLinkHTML(link);
    return menuItemHTML(labelCell.textContent.trim(), menuCell || document.createElement('div'), idx);
  }).join('');
  block.innerHTML = html;
}
