/**
 * vertical-tabs — interactive left-nav / right-content tabs.
 * Distinct from the horizontal `tabs` block: nav sits in a left column,
 * matching panels in a right column (stacked on mobile).
 *
 * Row 0 = nav labels (one cell per item; optional leading <img> icon in the cell).
 * Rows 1..N = one panel per item, same order — cells: media <img> / heading /
 * body (list or paragraphs) / optional CTA link.
 *
 * Variants:
 *   (default/plain)  simple text nav
 *   .pill            nav items styled as rounded pills with icons
 *
 * Clicking a nav button, or using ArrowLeft/ArrowRight/Home/End while a nav
 * button has focus, switches the active tab + panel and moves focus (WAI-ARIA
 * tabs pattern — roving tabindex).
 * CSS: blocks/vertical-tabs/vertical-tabs.css
 */

function buildTab(cell, index) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vt-tab';
  btn.id = `vt-tab-${index}`;
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
  btn.tabIndex = index === 0 ? 0 : -1;

  const img = cell.querySelector('img');
  if (img) {
    img.className = 'vt-tab-icon';
    btn.append(img);
  }

  const label = document.createElement('span');
  label.className = 'vt-tab-label';
  label.textContent = cell.textContent.trim();
  btn.append(label);

  return btn;
}

function buildPanel(cells, index) {
  const panel = document.createElement('div');
  panel.className = index === 0 ? 'vt-panel is-active' : 'vt-panel';
  panel.id = `vt-panel-${index}`;
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', `vt-tab-${index}`);
  panel.tabIndex = 0;

  const [mediaCell, headingCell, bodyCell, ctaCell] = cells;

  const media = mediaCell ? mediaCell.querySelector('picture, img') : null;
  if (media) {
    const wrap = document.createElement('div');
    wrap.className = 'vt-media';
    wrap.append(media.closest('picture') || media);
    panel.append(wrap);
  }

  const copy = document.createElement('div');
  copy.className = 'vt-copy';
  if (headingCell && headingCell.textContent.trim()) {
    const heading = document.createElement('h3');
    heading.className = 'vt-heading';
    heading.textContent = headingCell.textContent.trim();
    copy.append(heading);
  }
  if (bodyCell && bodyCell.textContent.trim()) {
    const body = document.createElement('div');
    body.className = 'vt-body';
    body.innerHTML = bodyCell.innerHTML;
    copy.append(body);
  }
  const ctaLink = ctaCell ? ctaCell.querySelector('a') : null;
  if (ctaLink) {
    const cta = document.createElement('a');
    cta.className = 'vt-cta button';
    cta.href = ctaLink.getAttribute('href');
    cta.textContent = ctaLink.textContent.trim();
    copy.append(cta);
  }
  panel.append(copy);

  return panel;
}

function activate(tabs, panels, index) {
  tabs.forEach((tab, i) => {
    const active = i === index;
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.tabIndex = active ? 0 : -1;
  });
  panels.forEach((panel, i) => panel.classList.toggle('is-active', i === index));
}

export default function decorate(block) {
  const rows = [...block.children];
  const navRow = rows[0];
  const navCells = navRow ? [...navRow.children] : [];
  const panelRows = rows.slice(1).map((row) => [...row.children]);

  const tabs = navCells.map((cell, i) => buildTab(cell, i));
  const panels = panelRows.map((cells, i) => buildPanel(cells, i));

  tabs.forEach((tab, i) => {
    if (panels[i]) tab.setAttribute('aria-controls', panels[i].id);
  });

  const nav = document.createElement('div');
  nav.className = 'vt-nav';
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-orientation', 'vertical');
  nav.append(...tabs);

  const panelsWrap = document.createElement('div');
  panelsWrap.className = 'vt-panels';
  panelsWrap.append(...panels);

  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.vt-tab');
    if (!btn) return;
    const idx = tabs.indexOf(btn);
    if (idx === -1) return;
    activate(tabs, panels, idx);
  });

  nav.addEventListener('keydown', (e) => {
    const current = tabs.indexOf(document.activeElement);
    if (current === -1) return;
    let next = null;
    if (e.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    activate(tabs, panels, next);
    tabs[next].focus();
  });

  block.replaceChildren(nav, panelsWrap);
}
