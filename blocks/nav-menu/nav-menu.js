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
  // .flyout-back is mobile-only (see header.css) — the drill-down "Back"
  // control that returns to the top-level list; header.js's wireFlyouts
  // wires its click regardless of which module produced this markup.
  // .flyout-title mirrors header.js's own navItemHTML: the drill-down
  // panel's mobile-only page-title heading repeating the trigger's label,
  // since that trigger itself has slid off-screen by the time the panel is
  // showing (issue #78).
  return `
      <div class="nav-item">
        <button type="button" aria-expanded="false" aria-controls="${id}">${label}<i class="caret"></i></button>
        <div class="flyout" id="${id}" aria-hidden="true"><button type="button" class="flyout-back"><i class="flyout-back-icon"></i>Back</button><h2 class="flyout-title">${label}</h2><div class="flyout-inner">${colsHTML}</div></div>
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
