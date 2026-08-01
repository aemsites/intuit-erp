/**
 * industry-tabs — tabs whose panel content is fetched from an external JSON
 * feed rather than authored in the block table. Homepage "The workflows your
 * industry actually runs on" section.
 *
 * Reuses the WAI-ARIA tabs interaction/markup pattern established by
 * `vertical-tabs` (role=tablist/tab/tabpanel, aria-selected, aria-controls,
 * roving tabindex, Arrow/Home/End keyboard, first tab active) but is built
 * independently — vertical-tabs decorates authored DOM rows, while this
 * block renders from fetched JSON data instead.
 *
 * Content model: the block cell holds a single link to the JSON source,
 * e.g. <a href="/path/to/IES_HP_INDUSTRY.json">...</a>.
 *
 * Expected item shape: { label, heading, body, image }
 *
 * `renderPanels(container, data)` is pure (no network) so it's directly
 * unit-testable; `decorate` isolates all fetch/network concerns and
 * degrades gracefully (renders nothing) on missing link, fetch failure, a
 * non-OK response, or empty/malformed data.
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

  const label = document.createElement('span');
  label.className = 'it-tab-label';
  label.textContent = item.label || '';
  btn.append(label);

  return btn;
}

function buildPanel(item, index) {
  const panel = document.createElement('div');
  panel.className = index === 0 ? 'it-panel is-active' : 'it-panel';
  panel.id = `it-panel-${index}`;
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', `it-tab-${index}`);
  panel.tabIndex = 0;

  if (item.image) {
    const wrap = document.createElement('div');
    wrap.className = 'it-media';
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = item.heading || item.label || '';
    img.loading = 'lazy';
    wrap.append(img);
    panel.append(wrap);
  }

  const copy = document.createElement('div');
  copy.className = 'it-copy';
  if (item.heading) {
    const heading = document.createElement('h3');
    heading.className = 'it-heading';
    heading.textContent = item.heading;
    copy.append(heading);
  }
  if (item.body) {
    const body = document.createElement('div');
    body.className = 'it-body';
    const p = document.createElement('p');
    p.textContent = item.body;
    body.append(p);
    copy.append(body);
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
  nav.setAttribute('aria-orientation', 'horizontal');
  nav.append(...tabs);

  const panelsWrap = document.createElement('div');
  panelsWrap.className = 'it-panels';
  panelsWrap.append(...panels);

  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.it-tab');
    if (!btn) return;
    const idx = tabs.indexOf(btn);
    if (idx === -1) return;
    activate(tabs, panels, idx);
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
  });

  container.append(nav, panelsWrap);
  return container;
}

function extractData(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.data)) return json.data;
  return [];
}

export default async function decorate(block) {
  const link = block.querySelector('a');
  const url = link ? link.getAttribute('href') : null;
  block.textContent = '';

  if (!url) return;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return;
    const json = await resp.json();
    renderPanels(block, extractData(json));
  } catch {
    // fetch failed (network error, bad JSON, etc.) — degrade gracefully,
    // leave the block empty rather than throwing
  }
}
