/**
 * vertical-tabs — interactive left-nav / right-content component.
 *
 * Two variants with DIFFERENT interaction models (each matches its source):
 *   (default/plain)  ACCORDION — nav items are headings; clicking one expands
 *                    its body inline inside a bordered card, and a shared media
 *                    panel on the right shows the active item's image. One item
 *                    is always open (disclosure pattern: aria-expanded + region).
 *   .pill            TABS — rounded pill nav on the left, a separate media +
 *                    heading + body + CTA panel on the right (WAI-ARIA tabs:
 *                    role=tablist/tab/tabpanel, roving tabindex, arrow keys).
 *
 * Authoring contract (row-per-tab — matches `tabs` and `industry-tabs`):
 *   Row N: cell 1 = nav label (optional leading <img>/<picture> icon + text),
 *          cell 2 = the item content, authored naturally.
 * The content cell holds ordinary default content, classified by element type:
 *   - picture / img          -> media
 *   - first heading (h2–h6)  -> heading (used by the pill panel; the accordion
 *                               uses the nav label as its heading instead)
 *   - a lone link paragraph  -> CTA button (a <p> whose only content is one <a>)
 *   - everything else        -> body copy (paragraphs, lists, … kept as-is)
 *
 * Legacy contract (deprecated — pre-existing authored pages):
 *   Row 0 = nav labels (one cell per item); Rows 1..N = one content block per
 *   item in the same order, cells: media / heading / body / optional CTA.
 *   Detected automatically and still rendered (with a console warning).
 *
 * CSS: blocks/vertical-tabs/vertical-tabs.css
 */

/** A <p> (or bare <a>) whose only meaningful content is a single link → CTA. */
function isLinkOnly(el) {
  if (!el) return false;
  if (el.tagName === 'A') return true;
  if (el.tagName !== 'P') return false;
  const links = el.querySelectorAll('a');
  return links.length === 1 && el.textContent.trim() === links[0].textContent.trim();
}

/** { icon, label } from a nav-label cell (icon is an optional leading image). */
function extractLabel(cell) {
  const icon = cell ? cell.querySelector('img') : null;
  return { icon, label: cell ? cell.textContent.trim() : '' };
}

/** Normalize a single authored content cell (new contract) into parts. */
function partsFromCell(cell) {
  let media = null;
  let heading = null;
  const bodyNodes = [];
  let cta = null;
  const nodes = cell ? [...cell.children] : [];
  nodes.forEach((el) => {
    const pic = el.matches('picture, img') ? el : el.querySelector('picture, img');
    if (pic && !media) {
      media = pic.closest('picture') || pic;
      return;
    }
    if (!heading && /^H[1-6]$/.test(el.tagName)) {
      heading = el.textContent.trim();
      return;
    }
    if (isLinkOnly(el)) {
      const link = el.tagName === 'A' ? el : el.querySelector('a');
      cta = { href: link.getAttribute('href'), text: link.textContent.trim() };
      return;
    }
    if (el.textContent.trim() || pic) bodyNodes.push(el.cloneNode(true));
  });
  return {
    media, heading, bodyNodes, cta,
  };
}

/** Normalize legacy per-item cells (media / heading / body / cta) into parts. */
function partsFromLegacyCells(cells) {
  const [mediaCell, headingCell, bodyCell, ctaCell] = cells;
  const m = mediaCell ? mediaCell.querySelector('picture, img') : null;
  const media = m ? (m.closest('picture') || m) : null;
  const headingText = headingCell ? headingCell.textContent.trim() : '';
  const heading = headingText || null;
  const bodyNodes = bodyCell ? [...bodyCell.children].map((n) => n.cloneNode(true)) : [];
  const link = ctaCell ? ctaCell.querySelector('a') : null;
  const cta = link ? { href: link.getAttribute('href'), text: link.textContent.trim() } : null;
  return {
    media, heading, bodyNodes, cta,
  };
}

/** A cell that carries real item content (heading / list / link / media+text). */
function looksLikePanel(cell) {
  if (!cell) return false;
  if (cell.querySelector('h1, h2, h3, h4, h5, h6, ul, ol, a')) return true;
  const media = cell.querySelector('picture, img');
  const text = [...cell.querySelectorAll('p')]
    .some((p) => p.textContent.trim() && !p.querySelector('img, picture'));
  return !!media && text;
}

/**
 * Legacy = first row is a pure nav row (its last cell is just a label, not a
 * content block) and its cell count matches the number of following rows.
 */
function isLegacyLayout(rows) {
  if (rows.length < 2) return false;
  const navCells = [...rows[0].children];
  if (navCells.length < 2 || navCells.length !== rows.length - 1) return false;
  return !looksLikePanel(navCells[navCells.length - 1]);
}

/** Parse the authored rows into a normalized item list (either contract). */
function parseItems(rows) {
  if (isLegacyLayout(rows)) {
    // eslint-disable-next-line no-console
    console.warn('vertical-tabs: legacy nav-row layout detected; re-author to the row-per-tab contract (label + content per row).');
    const navCells = rows[0] ? [...rows[0].children] : [];
    return navCells.map((cell, i) => ({
      ...extractLabel(cell),
      ...partsFromLegacyCells([...(rows[i + 1] ? rows[i + 1].children : [])]),
    }));
  }
  return rows.map((row) => ({
    ...extractLabel(row.children[0]),
    ...partsFromCell(row.children[1]),
  }));
}

/* ---- pill variant: WAI-ARIA tabs ------------------------------------------ */

function buildTab(item, index) {
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

  // trailing chevron — CSS reveals it only on the active pill.
  const chevron = document.createElement('span');
  chevron.className = 'vt-tab-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  btn.append(chevron);

  return btn;
}

function buildPanel(item, index) {
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
  if (item.heading) {
    const heading = document.createElement('h3');
    heading.className = 'vt-heading';
    heading.textContent = item.heading;
    copy.append(heading);
  }
  if (item.bodyNodes.length) {
    const body = document.createElement('div');
    body.className = 'vt-body';
    body.append(...item.bodyNodes);
    copy.append(body);
  }
  if (item.cta) {
    const cta = document.createElement('a');
    cta.className = 'vt-cta button';
    cta.href = item.cta.href;
    cta.textContent = item.cta.text;
    copy.append(cta);
  }
  panel.append(copy);
  return panel;
}

function renderTabs(block, items) {
  const tabs = items.map(buildTab);
  const panels = items.map(buildPanel);
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

/* ---- default variant: accordion (disclosure) ------------------------------ */

function renderAccordion(block, items) {
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
    if (item.bodyNodes.length) {
      const body = document.createElement('div');
      body.className = 'vt-body';
      body.append(...item.bodyNodes);
      region.append(body);
    }
    if (item.cta) {
      const cta = document.createElement('a');
      cta.className = 'vt-cta button';
      cta.href = item.cta.href;
      cta.textContent = item.cta.text;
      region.append(cta);
    }

    wrap.append(header, region);
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
  const setOpen = (index) => {
    wraps.forEach((w, i) => w.classList.toggle('is-open', i === index));
    headers.forEach((h, i) => h.setAttribute('aria-expanded', i === index ? 'true' : 'false'));
    regions.forEach((r, i) => { r.hidden = i !== index; });
    medias.forEach((m, i) => m.classList.toggle('is-active', i === index));
  };

  // one item is always open (tab-like): clicking a header opens it.
  acc.addEventListener('click', (e) => {
    const header = e.target.closest('.vt-tab');
    if (!header) return;
    const idx = headers.indexOf(header);
    if (idx !== -1) setOpen(idx);
  });

  // accordion keyboard: Up/Down/Home/End move focus between headers.
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

export default function decorate(block) {
  const items = parseItems([...block.children]);
  if (block.classList.contains('pill')) renderTabs(block, items);
  else renderAccordion(block, items);
}
