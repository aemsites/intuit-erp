/**
 * industry-tabs — tabs whose panels are authored inline in the block.
 * Homepage "The workflows your industry actually runs on" section.
 *
 * Reuses the WAI-ARIA tabs interaction/markup pattern established by
 * `vertical-tabs` (role=tablist/tab/tabpanel, aria-selected, aria-controls,
 * roving tabindex, Arrow/Home/End keyboard, first tab active).
 *
 * Content model: each block row = one tab. Cell 1 is the tab (optional
 * `:icon-name:` + label text); cell 2 is the panel content — heading, body,
 * optional "Explore…" link, optional product image, and an optional customer
 * quote authored as `<blockquote>` + `<cite>` attribution.
 *
 * Item shape: { label, icon?, heading, body, image?, linkHref?, linkText?,
 * quote?, attribution? }
 *
 * `renderPanels(container, data)` is pure (no network) so it's directly
 * unit-testable; `decorate` parses the authored rows and renders them.
 *
 * CSS: blocks/industry-tabs/industry-tabs.css
 */

function buildTab(item, index) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'it-tab';
  btn.id = `it-tab-${index}`;
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
  btn.tabIndex = index === 0 ? 0 : -1;

  if (item.icon) btn.insertAdjacentHTML('afterbegin', item.icon);

  const label = document.createElement('span');
  label.className = 'it-tab-label';
  label.textContent = item.label || '';
  btn.append(label);

  // chevron — visible only in the mobile accordion layout (CSS-hidden on desktop)
  const chevron = document.createElement('span');
  chevron.className = 'it-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  btn.append(chevron);

  return btn;
}

function buildPanel(item, index) {
  const panel = document.createElement('div');
  panel.className = index === 0 ? 'it-panel is-active' : 'it-panel';
  panel.id = `it-panel-${index}`;
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', `it-tab-${index}`);
  panel.tabIndex = 0;

  // copy = heading beside body/link; the product image sits full-width below
  const copy = document.createElement('div');
  copy.className = 'it-copy';
  if (item.heading) {
    const heading = document.createElement('h3');
    heading.className = 'it-heading';
    heading.textContent = item.heading;
    copy.append(heading);
  }
  const copyBody = document.createElement('div');
  copyBody.className = 'it-copy-body';
  if (item.body) {
    const body = document.createElement('div');
    body.className = 'it-body';
    const p = document.createElement('p');
    p.textContent = item.body;
    body.append(p);
    copyBody.append(body);
  }
  if (item.linkHref) {
    const cta = document.createElement('p');
    cta.className = 'it-cta';
    const a = document.createElement('a');
    a.href = item.linkHref;
    a.textContent = item.linkText || 'Learn more';
    a.className = 'button secondary';
    cta.append(a);
    copyBody.append(cta);
  }
  copy.append(copyBody);
  panel.append(copy);

  if (item.image) {
    const wrap = document.createElement('div');
    wrap.className = 'it-media';
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = item.imageAlt || item.heading || item.label || '';
    img.loading = 'lazy';
    wrap.append(img);
    panel.append(wrap);
  }

  if (item.quote) {
    const fig = document.createElement('figure');
    fig.className = 'it-quote';
    const bq = document.createElement('blockquote');
    bq.textContent = item.quote;
    fig.append(bq);
    if (item.attribution) {
      const cite = document.createElement('cite');
      cite.textContent = item.attribution;
      fig.append(cite);
    }
    panel.append(fig);
  }

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

/**
 * Pure DOM builder — no fetch, no network. Given a container and an array
 * of { label, heading, body, image } items, builds the nav (tabs) + panels
 * with full ARIA wiring and the first tab/panel active.
 * @param {Element} container element to populate
 * @param {Array<{label:string,heading:string,body:string,image?:string}>} data
 * @returns {Element} the populated container
 */
export function renderPanels(container, data) {
  const items = Array.isArray(data) ? data : [];
  container.textContent = '';
  if (items.length === 0) return container;

  const tabs = items.map((item, i) => buildTab(item, i));
  const panels = items.map((item, i) => buildPanel(item, i));

  tabs.forEach((tab, i) => tab.setAttribute('aria-controls', panels[i].id));

  const nav = document.createElement('div');
  nav.className = 'it-nav';
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-orientation', 'vertical');
  // each tab is paired with its panel in an .it-item, so the panel can render
  // directly beneath its tab on mobile (accordion) while the desktop CSS lays
  // the tabs out as a left rail with the active panel in the right column.
  items.forEach((_, i) => {
    const itemEl = document.createElement('div');
    itemEl.className = 'it-item';
    itemEl.append(tabs[i], panels[i]);
    nav.append(itemEl);
  });

  // Desktop only: panels are absolutely positioned in the right column, so the
  // container needs a min-height matching the active panel or it collapses and
  // the panel bleeds into the next section. Re-measure on switch / resize /
  // image load. On mobile (panels in flow) clear it.
  function syncHeight() {
    const desktop = window.matchMedia && window.matchMedia('(min-width: 900px)').matches;
    if (!desktop) { container.style.minHeight = ''; return; }
    const active = panels.find((p) => p.classList.contains('is-active'));
    if (active) container.style.minHeight = `${active.offsetHeight}px`;
  }

  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.it-tab');
    if (!btn) return;
    const idx = tabs.indexOf(btn);
    if (idx === -1) return;
    activate(tabs, panels, idx);
    syncHeight();
  });

  nav.addEventListener('keydown', (e) => {
    const current = tabs.indexOf(document.activeElement);
    if (current === -1) return;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    activate(tabs, panels, next);
    tabs[next].focus();
    syncHeight();
  });

  container.append(nav);
  syncHeight();
  window.addEventListener('resize', syncHeight);
  container.querySelectorAll('.it-media img').forEach((img) => img.addEventListener('load', syncHeight));
  return container;
}

// Build the panel-data array from authored block rows (label cell + content
// cell). Rows with fewer than two cells are ignored.
function parseAuthored(block) {
  return [...block.children]
    .map((row) => [...row.children])
    .filter((cells) => cells.length >= 2)
    .map((cells) => {
      const labelCell = cells[0];
      // icon may be an EDS icon span (:name:) or an authored <img>
      const iconEl = labelCell.querySelector('.icon, img');
      // label = cell text minus any icon glyph; also strip a raw :token: so it
      // works whether or not EDS decorateIcons has run on the cell yet.
      const label = labelCell.textContent.replace(/:[a-z0-9-]+:/gi, '').trim();

      const content = cells[1];
      const headingEl = content.querySelector('h2, h3, h4');
      const linkEl = content.querySelector('a');
      const bodyEl = [...content.querySelectorAll('p')]
        .find((p) => !p.querySelector('a') && !p.closest('blockquote') && !p.closest('figure'));
      const img = content.querySelector('img');
      const quoteEl = content.querySelector('blockquote');
      const citeEl = content.querySelector('cite');
      return {
        label,
        icon: iconEl ? iconEl.outerHTML : undefined,
        heading: headingEl ? headingEl.textContent.trim() : '',
        body: bodyEl ? bodyEl.textContent.trim() : '',
        image: img ? img.getAttribute('src') : undefined,
        imageAlt: img ? (img.getAttribute('alt') || '') : undefined,
        linkHref: linkEl ? linkEl.getAttribute('href') : undefined,
        linkText: linkEl ? linkEl.textContent.trim() : undefined,
        quote: quoteEl ? quoteEl.textContent.trim() : undefined,
        attribution: citeEl ? citeEl.textContent.trim() : undefined,
      };
    });
}

export default function decorate(block) {
  const items = parseAuthored(block);
  block.textContent = '';
  renderPanels(block, items);
}
