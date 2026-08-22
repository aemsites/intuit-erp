import { BP_TABLET, BP_DESKTOP } from '../../scripts/breakpoints.js';

const CITE_PREFIX = /^<cite>\s*/i;
const BLOCKISH = 'picture, img, h2, h3, h4, h5, h6, p, ul, ol, blockquote';

function flattenCell(cell) {
  if (!cell) return;
  for (let guard = 0; guard < 50; guard += 1) {
    const bad = [...cell.querySelectorAll('p')].find((p) => p.querySelector(BLOCKISH));
    if (!bad) break;
    bad.replaceWith(...bad.childNodes);
  }
}

function isLinkOnly(el) {
  if (el.tagName === 'A') return true;
  if (el.tagName !== 'P') return false;
  const links = el.querySelectorAll('a');
  return links.length === 1 && el.textContent.trim() === links[0].textContent.trim();
}

function extractLabel(cell) {
  const icon = cell ? cell.querySelector('.icon, img') : null;
  const label = cell ? cell.textContent.replace(/:[a-z0-9-]+:/gi, '').trim() : '';
  return { icon, label };
}

export function parseContent(cell) {
  flattenCell(cell);
  const nodes = cell ? [...cell.children] : [];

  const quote = nodes.find((el) => el.tagName === 'BLOCKQUOTE') || null;
  const citeParagraph = nodes.find((el) => el.tagName === 'P' && CITE_PREFIX.test(el.textContent.trim()));
  const citeEl = cell ? cell.querySelector('cite') : null;
  let attribution = null;
  if (citeEl) attribution = citeEl.textContent.trim();
  else if (citeParagraph) attribution = citeParagraph.textContent.trim().replace(CITE_PREFIX, '');

  const rest = nodes.filter((el) => el !== quote && el !== citeParagraph && el.tagName !== 'CITE');
  const heading = rest.find((el) => /^H[2-6]$/.test(el.tagName)) || null;
  const headingIndex = heading ? rest.indexOf(heading) : -1;

  let media = null;
  let eyebrow = null;
  let cta = null;
  const bodyNodes = [];

  rest.forEach((el, i) => {
    if (el === heading) return;
    const pic = el.matches('picture, img') ? el : el.querySelector('picture, img');
    if (pic && !media) { media = pic.closest('picture') || pic; return; }
    if (isLinkOnly(el)) {
      const link = el.tagName === 'A' ? el : el.querySelector('a');
      cta = { href: link.getAttribute('href'), text: link.textContent.trim() };
      return;
    }
    if (!el.textContent.trim()) return;
    if (el.tagName === 'P' && headingIndex !== -1 && i < headingIndex && !eyebrow) {
      eyebrow = el;
      return;
    }
    bodyNodes.push(el);
  });

  return {
    media, eyebrow, heading, bodyNodes, cta, quote, attribution,
  };
}

export function parseItems(block) {
  return [...block.children].map((row) => {
    const cells = [...row.children];
    return { ...extractLabel(cells[0]), ...parseContent(cells[1]) };
  });
}

function appendBody(container, bodyNodes, className) {
  bodyNodes.forEach((el) => {
    const node = el.cloneNode(true);
    node.classList.add(className);
    container.append(node);
  });
}

function buildHeading(item, tag, className) {
  const h = document.createElement(tag);
  h.className = className;
  h.innerHTML = item.heading.innerHTML;
  return h;
}

function buildEyebrow(item, className) {
  const p = document.createElement('p');
  p.className = className;
  p.innerHTML = item.eyebrow.innerHTML;
  return p;
}

function buildCta(item, className) {
  const a = document.createElement('a');
  a.className = className;
  a.href = item.cta.href;
  a.textContent = item.cta.text;
  return a;
}

function buildQuote(item, className) {
  const fig = document.createElement('figure');
  fig.className = className;
  const bq = document.createElement('blockquote');
  bq.innerHTML = item.quote.innerHTML;
  fig.append(bq);
  if (item.attribution) {
    const cite = document.createElement('cite');
    cite.textContent = item.attribution;
    fig.append(cite);
  }
  return fig;
}

function fillCopy(item, copy, cls) {
  if (item.eyebrow) copy.append(buildEyebrow(item, cls.eyebrow));
  if (item.heading) copy.append(buildHeading(item, cls.headingTag, cls.heading));
  appendBody(copy, item.bodyNodes, cls.body);
  if (item.cta) copy.append(buildCta(item, cls.cta));
  if (item.quote) copy.append(buildQuote(item, cls.quote));
}

/* ---- base (unclassed): horizontal tablist, crossfade + directional media slide -- */

const HORIZONTAL_CLASSES = {
  eyebrow: 'eyebrow', headingTag: 'h3', heading: 'tab-h3', body: 'tab-body', cta: 'tab-cta button', quote: 'tab-quote',
};

function buildHorizontalPanel(item, index) {
  const panel = document.createElement('div');
  panel.className = index === 0 ? 'tab-panel is-active' : 'tab-panel';
  panel.id = `tab-panel-${index}`;

  const media = document.createElement('div');
  media.className = 'tab-media';
  const mediaInner = document.createElement('div');
  mediaInner.className = 'tab-media-inner';
  if (item.media) mediaInner.append(item.media);
  media.append(mediaInner);

  const copy = document.createElement('div');
  copy.className = 'tab-copy';
  fillCopy(item, copy, HORIZONTAL_CLASSES);

  panel.append(media, copy);
  return panel;
}

function renderHorizontalTabs(block, items) {
  const panels = items.map(buildHorizontalPanel);

  const tablist = document.createElement('div');
  tablist.className = 'tabs';
  tablist.setAttribute('role', 'tablist');

  const tabButtons = items.map((item, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = i === 0 ? 'tab active' : 'tab';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    btn.setAttribute('aria-controls', panels[i].id);
    if (item.icon) {
      item.icon.classList.add('tab-icon');
      btn.append(item.icon);
    }
    btn.append(document.createTextNode(item.label));
    return btn;
  });
  tablist.append(...tabButtons);

  const panelWrap = document.createElement('div');
  panelWrap.className = 'tab-panel-wrap';
  panelWrap.append(...panels);

  const tabBar = document.createElement('div');
  tabBar.className = 'tab-bar';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'tab-nav tab-nav-prev';
  prevBtn.setAttribute('aria-label', 'Previous tab');
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'tab-nav tab-nav-next';
  nextBtn.setAttribute('aria-label', 'Next tab');
  tabBar.append(prevBtn, tablist, nextBtn);

  const activeIndex = () => tabButtons.findIndex((b) => b.classList.contains('active'));

  const updateArrows = () => {
    const max = tablist.scrollWidth - tablist.clientWidth - 1;
    tabBar.classList.toggle('tabs-fit', max <= 0);
    prevBtn.disabled = tablist.scrollLeft <= 0;
    nextBtn.disabled = tablist.scrollLeft >= max;
  };

  const select = (idx) => {
    tabButtons.forEach((b, i) => {
      b.classList.toggle('active', i === idx);
      b.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
    panels.forEach((p, i) => {
      p.classList.toggle('is-active', i === idx);
      p.classList.toggle('is-before', i < idx);
      p.classList.toggle('is-after', i > idx);
    });
    tabButtons[idx].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  };
  panels.forEach((p, i) => p.classList.toggle('is-after', i > 0));

  prevBtn.addEventListener('click', () => select(Math.max(0, activeIndex() - 1)));
  nextBtn.addEventListener('click', () => select(Math.min(tabButtons.length - 1, activeIndex() + 1)));
  tablist.addEventListener('scroll', updateArrows, { passive: true });
  window.addEventListener('resize', updateArrows);

  tablist.addEventListener('click', (e) => {
    const target = e.target.closest('.tab');
    if (!target) return;
    select(tabButtons.indexOf(target));
  });

  const syncHeight = () => {
    const heights = panels.map((p) => p.scrollHeight);
    panelWrap.style.height = `${Math.max(...heights, 0)}px`;
  };
  const refresh = () => {
    syncHeight();
    updateArrows();
  };
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(refresh);
    panels.forEach((p) => ro.observe(p));
    ro.observe(tablist);
  }
  panelWrap.querySelectorAll('img').forEach((img) => {
    if (img.complete) return;
    img.addEventListener('load', syncHeight, { once: true });
  });
  window.addEventListener('resize', syncHeight);

  block.replaceChildren(tabBar, panelWrap);
  refresh();
  requestAnimationFrame(refresh);
}

/* ---- .pill: vertical pill rail, true ARIA tablist ------------------------- */

const PILL_CLASSES = {
  heading: 'vt-heading', body: 'vt-body', cta: 'vt-cta button', quote: 'vt-quote', headingTag: 'h3', eyebrow: 'eyebrow',
};

function buildPillTab(item, index) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vt-tab';
  btn.id = `vt-tab-${index}`;
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
  btn.tabIndex = index === 0 ? 0 : -1;

  if (item.icon) {
    item.icon.className = 'vt-tab-icon';
    btn.append(item.icon);
  }

  const label = document.createElement('span');
  label.className = 'vt-tab-label';
  label.textContent = item.label;
  btn.append(label);

  const chevron = document.createElement('span');
  chevron.className = 'vt-tab-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  btn.append(chevron);

  return btn;
}

function buildPillPanel(item, index) {
  const panel = document.createElement('div');
  panel.className = index === 0 ? 'vt-panel is-active' : 'vt-panel';
  panel.id = `vt-panel-${index}`;
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', `vt-tab-${index}`);
  panel.tabIndex = 0;

  if (item.media) {
    const wrap = document.createElement('div');
    wrap.className = 'vt-media';
    wrap.append(item.media);
    panel.append(wrap);
  }

  const copy = document.createElement('div');
  copy.className = 'vt-copy';
  fillCopy(item, copy, PILL_CLASSES);
  panel.append(copy);
  return panel;
}

function renderPillTabs(block, items) {
  const tabs = items.map(buildPillTab);
  const panels = items.map(buildPillPanel);
  tabs.forEach((tab, i) => tab.setAttribute('aria-controls', panels[i].id));

  const nav = document.createElement('div');
  nav.className = 'vt-nav';
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-orientation', 'vertical');
  nav.append(...tabs);

  const panelsWrap = document.createElement('div');
  panelsWrap.className = 'vt-panels';
  panelsWrap.append(...panels);

  const activate = (index) => {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', i === index ? 'true' : 'false');
      tab.tabIndex = i === index ? 0 : -1;
    });
    panels.forEach((panel, i) => panel.classList.toggle('is-active', i === index));
  };

  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.vt-tab');
    if (!btn) return;
    const idx = tabs.indexOf(btn);
    if (idx !== -1) activate(idx);
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
    activate(next);
    tabs[next].focus();
  });

  block.replaceChildren(nav, panelsWrap);
}

/* ---- .vertical: disclosure accordion, shared media column ----------------- */

const VERTICAL_STACKED_QUERY = `(width < ${BP_TABLET}px)`;

function renderVerticalAccordion(block, items) {
  const acc = document.createElement('div');
  acc.className = 'vt-acc';

  const mediaCol = document.createElement('div');
  mediaCol.className = 'vt-media-col';

  const headers = [];
  const regions = [];
  const medias = [];

  items.forEach((item, i) => {
    const open = i === 0;

    const wrap = document.createElement('div');
    wrap.className = open ? 'vt-item is-open' : 'vt-item';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'vt-tab';
    header.id = `vt-acc-${i}`;
    header.setAttribute('aria-expanded', open ? 'true' : 'false');
    header.setAttribute('aria-controls', `vt-region-${i}`);
    if (item.icon) {
      item.icon.className = 'vt-tab-icon';
      header.append(item.icon);
    }
    const label = document.createElement('span');
    label.className = 'vt-tab-label';
    label.textContent = item.label;
    header.append(label);

    const region = document.createElement('div');
    region.className = 'vt-region';
    region.id = `vt-region-${i}`;
    region.setAttribute('role', 'region');
    region.setAttribute('aria-labelledby', `vt-acc-${i}`);
    region.hidden = !open;
    if (item.eyebrow) region.append(buildEyebrow(item, 'eyebrow'));
    appendBody(region, item.bodyNodes, 'vt-body');
    if (item.cta) region.append(buildCta(item, 'vt-cta button'));
    if (item.quote) region.append(buildQuote(item, 'vt-quote'));

    wrap.append(header, region);

    if (item.media) {
      const itemMedia = document.createElement('div');
      itemMedia.className = 'vt-item-media';
      itemMedia.append(item.media.cloneNode(true));
      region.append(itemMedia);
    }

    acc.append(wrap);

    const mw = document.createElement('div');
    mw.className = open ? 'vt-media is-active' : 'vt-media';
    if (item.media) mw.append(item.media);
    mediaCol.append(mw);

    headers.push(header);
    regions.push(region);
    medias.push(mw);
  });

  const wraps = [...acc.children];
  let openIndex = 0;

  const setOpen = (index) => {
    openIndex = index;
    wraps.forEach((w, i) => w.classList.toggle('is-open', i === index));
    headers.forEach((h, i) => h.setAttribute('aria-expanded', i === index ? 'true' : 'false'));
    regions.forEach((r, i) => { r.hidden = i !== index; });
    medias.forEach((m, i) => m.classList.toggle('is-active', i === index));
  };

  const mq = window.matchMedia(VERTICAL_STACKED_QUERY);

  const applyMode = () => {
    const stacked = mq.matches;
    acc.classList.toggle('is-stacked', stacked);
    if (stacked) {
      regions.forEach((r) => { r.hidden = false; });
      headers.forEach((h) => {
        h.removeAttribute('aria-expanded');
        h.removeAttribute('aria-controls');
        h.disabled = true;
      });
    } else {
      headers.forEach((h, i) => {
        h.setAttribute('aria-controls', regions[i].id);
        h.disabled = false;
      });
      setOpen(openIndex);
    }
  };

  applyMode();
  mq.addEventListener('change', applyMode);

  acc.addEventListener('click', (e) => {
    if (mq.matches) return;
    const header = e.target.closest('.vt-tab');
    if (!header) return;
    const idx = headers.indexOf(header);
    if (idx !== -1) setOpen(idx);
  });

  acc.addEventListener('keydown', (e) => {
    const current = headers.indexOf(document.activeElement);
    if (current === -1) return;
    let next = null;
    if (e.key === 'ArrowDown') next = (current + 1) % headers.length;
    else if (e.key === 'ArrowUp') next = (current - 1 + headers.length) % headers.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = headers.length - 1;
    if (next === null) return;
    e.preventDefault();
    headers[next].focus();
  });

  block.replaceChildren(acc, mediaCol);
}

/* ---- .navy: dark rail (desktop) / accordion (mobile), full panel per item -- */

const NAVY_DESKTOP_QUERY = `(min-width: ${BP_DESKTOP}px)`;

function buildNavyTab(item, index) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'it-tab';
  btn.id = `it-tab-${index}`;
  btn.setAttribute('aria-expanded', index === 0 ? 'true' : 'false');
  btn.tabIndex = index === 0 ? 0 : -1;

  if (item.icon) btn.append(item.icon);

  const label = document.createElement('span');
  label.className = 'it-tab-label';
  label.textContent = item.label;
  btn.append(label);

  const chevron = document.createElement('span');
  chevron.className = 'it-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  btn.append(chevron);

  return btn;
}

function buildNavyPanel(item, index) {
  const panel = document.createElement('div');
  panel.className = index === 0 ? 'it-panel is-active' : 'it-panel';
  panel.id = `it-panel-${index}`;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-labelledby', `it-tab-${index}`);

  const copy = document.createElement('div');
  copy.className = 'it-copy';
  if (item.eyebrow) copy.append(buildEyebrow(item, 'eyebrow'));
  if (item.heading) copy.append(buildHeading(item, 'h3', 'it-heading'));

  const copyBody = document.createElement('div');
  copyBody.className = 'it-copy-body';
  appendBody(copyBody, item.bodyNodes, 'it-body');
  if (item.cta) copyBody.append(buildCta(item, 'it-cta'));
  copy.append(copyBody);
  panel.append(copy);

  if (item.media) {
    const wrap = document.createElement('div');
    wrap.className = 'it-media';
    wrap.append(item.media);
    panel.append(wrap);
  }

  if (item.quote) panel.append(buildQuote(item, 'it-quote'));

  return panel;
}

const isNavyDesktop = () => !!(window.matchMedia && window.matchMedia(NAVY_DESKTOP_QUERY).matches);

function activateNavy(tabs, panels, index, focusIndex = index) {
  const roving = index === -1 ? focusIndex : index;
  tabs.forEach((tab, i) => {
    tab.setAttribute('aria-expanded', i === index ? 'true' : 'false');
    tab.tabIndex = i === roving ? 0 : -1;
  });
  panels.forEach((panel, i) => panel.classList.toggle('is-active', i === index));
}

function renderNavyTabs(block, items) {
  const tabs = items.map(buildNavyTab);
  const panels = items.map(buildNavyPanel);
  tabs.forEach((tab, i) => tab.setAttribute('aria-controls', panels[i].id));

  const nav = document.createElement('div');
  nav.className = 'it-nav';
  items.forEach((_, i) => {
    const itemEl = document.createElement('div');
    itemEl.className = 'it-item';
    itemEl.append(tabs[i], panels[i]);
    nav.append(itemEl);
  });

  function syncHeight() {
    if (!isNavyDesktop()) { block.style.minHeight = ''; return; }
    const active = panels.find((p) => p.classList.contains('is-active'));
    if (active) block.style.minHeight = `${active.offsetHeight}px`;
  }

  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.it-tab');
    if (!btn) return;
    const idx = tabs.indexOf(btn);
    if (idx === -1) return;
    const collapse = !isNavyDesktop() && btn.getAttribute('aria-expanded') === 'true';
    activateNavy(tabs, panels, collapse ? -1 : idx, idx);
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
    activateNavy(tabs, panels, next);
    tabs[next].focus();
    syncHeight();
  });

  block.replaceChildren(nav);
  syncHeight();
  window.addEventListener('resize', () => {
    if (isNavyDesktop() && !panels.some((p) => p.classList.contains('is-active'))) {
      const focused = tabs.findIndex((t) => t.tabIndex === 0);
      activateNavy(tabs, panels, focused === -1 ? 0 : focused);
    }
    syncHeight();
  });
  nav.querySelectorAll('.it-media img').forEach((img) => img.addEventListener('load', syncHeight));

  // Panel size can change after this first paint (block CSS still loading, web
  // fonts swapping, images decoding), which a one-off offsetHeight read misses.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(syncHeight);
    panels.forEach((p) => ro.observe(p));
  }
}

export default function decorate(block) {
  const items = parseItems(block);
  if (block.classList.contains('pill')) renderPillTabs(block, items);
  else if (block.classList.contains('vertical')) renderVerticalAccordion(block, items);
  else if (block.classList.contains('navy')) renderNavyTabs(block, items);
  else renderHorizontalTabs(block, items);
}
