function isExternal(href) {
  return /^https?:\/\//.test(href);
}

function navLinkHTML(a) {
  const href = a.getAttribute('href');
  const cls = a.closest('strong') ? 'acct-link' : 'nav-link';
  const tgt = isExternal(href) ? ' target="_blank" rel="noopener"' : '';
  return `<a class="${cls}" href="${href}"${tgt}>${a.textContent.trim()}</a>`;
}

function flyoutLinkHTML(l) {
  const external = isExternal(l.href);
  const cls = `flyout-link${external ? '' : ' is-internal'}`;
  const tgt = external ? ' target="_blank" rel="noopener"' : '';
  const desc = l.desc ? `<span class="flyout-desc">${l.desc}</span>` : '';
  return `<a class="${cls}" href="${l.href}"${tgt}><span class="flyout-label">${l.text}</span>${desc}</a>`;
}

function parseLeafLink(li) {
  const a = li.querySelector('a');
  if (!a) return null;
  const clone = li.cloneNode(true);
  clone.querySelector('a').remove();
  const desc = clone.textContent.replace(/^[\s—–-]+/, '').trim();
  return { text: a.textContent.trim(), href: a.getAttribute('href'), desc: desc || undefined };
}

function parseColumn(li) {
  const heading = li.querySelector(':scope > p')?.textContent.trim() || '';
  const links = [...(li.querySelector(':scope > ul')?.children || [])].map(parseLeafLink).filter(Boolean);
  return { heading, links };
}

function parseColumns(ul) {
  const items = [...ul.children];
  if (items.some((li) => li.querySelector(':scope > ul'))) return items.map(parseColumn);
  return [{ heading: '', links: items.map(parseLeafLink).filter(Boolean) }];
}

function menuItemHTML(label, columns, idx) {
  const simple = columns.length === 1 && !columns[0].heading;
  const id = `flyout-${idx}`;
  const colsHTML = columns.map((c) => `
        <div class="flyout-col">
          ${c.heading ? `<p class="flyout-heading">${c.heading}</p>` : ''}
          ${c.links.map(flyoutLinkHTML).join('')}
        </div>`).join('');
  const titleId = `${id}-title`;
  return `
      <div class="nav-item${simple ? ' nav-item-simple' : ''}">
        <button type="button" aria-expanded="false" aria-controls="${id}">${label}<i class="caret"></i></button>
        <div class="flyout" id="${id}" aria-hidden="true" aria-labelledby="${titleId}"><button type="button" class="flyout-back"><i class="flyout-back-icon"></i>Back</button><p class="flyout-title" id="${titleId}">${label}</p><div class="flyout-inner">${colsHTML}</div></div>
      </div>`;
}

function findMenuRow(block) {
  return [...block.children].find((row) => row.children[1]?.querySelector(':scope > ul > li > ul'));
}

export default function decorate(block) {
  const menuCell = findMenuRow(block)?.children[1];
  const ul = menuCell?.querySelector(':scope > ul');
  if (!ul) return;
  const html = [...ul.children].map((li, idx) => {
    const a = li.querySelector(':scope > a, :scope > p > a');
    const nestedUl = li.querySelector(':scope > ul');
    if (a && !nestedUl) return navLinkHTML(a);
    const label = li.querySelector(':scope > p')?.textContent.trim() || '';
    return menuItemHTML(label, nestedUl ? parseColumns(nestedUl) : [], idx);
  }).join('');
  menuCell.innerHTML = html;
}
