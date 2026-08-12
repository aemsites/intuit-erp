/**
 * tabs — feature explorer (accounting).
 *
 * DA / authoring contract (row-per-tab, matches the standard tabs block):
 *   Row N: cell 1 = tab label, cell 2 = the panel's content authored naturally.
 * The panel cell holds ordinary default content, classified by element type:
 *   - picture / img            -> media (shown on one side)
 *   - first heading (h2–h4)    -> panel heading
 *   - paragraph before heading -> eyebrow (small all-caps kicker)
 *   - paragraph(s) after       -> body copy
 * Label and its panel live in the same row, so authors can freely reorder,
 * add, or remove tabs without the two drifting out of sync.
 *
 * Note: the rendered (markdown) route wraps a picture-plus-text cell inside a
 * single <p>, producing invalid <p><picture>…<h3>…</p> nesting. flattenCell()
 * unwraps those so the picture, eyebrow, heading and body are flat siblings
 * regardless of which route delivered the markup.
 *
 * Switching tabs crossfades panels (all stacked absolutely inside a
 * height-synced wrapper) to match the fade erp.intuit.com/accounting uses,
 * so there's no layout jump and both panels are visible mid-transition.
 * CSS: blocks/tabs/tabs.css
 */

const BLOCKISH = 'picture, img, h2, h3, h4, h5, h6, p';

/** Unwrap <p> elements that (invalidly) contain block-level children. */
function flattenCell(cell) {
  if (!cell) return;
  for (let guard = 0; guard < 50; guard += 1) {
    const bad = [...cell.querySelectorAll('p')].find((p) => p.querySelector(BLOCKISH));
    if (!bad) break;
    bad.replaceWith(...bad.childNodes);
  }
}

function buildPanel(contentCell, index) {
  const panel = document.createElement('div');
  panel.className = index === 0 ? 'tab-panel is-active' : 'tab-panel';
  panel.id = `tab-panel-${index}`;

  const media = document.createElement('div');
  media.className = 'tab-media';
  // The picture lives inside a full-width inner wrapper so it can be parked
  // fully off to one side (translateX) and slide back in — .tab-media itself
  // clips it (overflow:hidden). See setPanelStates() in decorate().
  const mediaInner = document.createElement('div');
  mediaInner.className = 'tab-media-inner';
  media.append(mediaInner);
  const copy = document.createElement('div');
  copy.className = 'tab-copy';

  flattenCell(contentCell);
  const nodes = contentCell ? [...contentCell.children] : [];
  const headingEl = nodes.find((el) => /^H[2-4]$/.test(el.tagName));
  const headingIndex = headingEl ? nodes.indexOf(headingEl) : -1;

  nodes.forEach((el, i) => {
    const pic = el.matches('picture, img') ? el : el.querySelector('picture, img');
    if (pic) {
      mediaInner.append(pic.closest('picture') || pic);
      return;
    }
    if (el === headingEl) {
      const h = document.createElement('h3');
      h.className = 'tab-h3';
      h.innerHTML = el.innerHTML;
      copy.append(h);
      return;
    }
    if (!el.textContent.trim()) return;
    // Non-paragraph body content (lists, etc.) is kept as its own element so
    // its structure survives; only bare text / <p> becomes a classed paragraph.
    if (el.tagName !== 'P') {
      const node = el.cloneNode(true);
      node.classList.add('tab-body');
      copy.append(node);
      return;
    }
    const p = document.createElement('p');
    // A paragraph before the heading is the eyebrow kicker; after it, body copy.
    const isEyebrow = headingIndex !== -1 && i < headingIndex;
    p.className = isEyebrow ? 'eyebrow' : 'tab-body';
    p.innerHTML = el.innerHTML;
    copy.append(p);
  });

  panel.append(media, copy);
  return panel;
}

export default function decorate(block) {
  const rows = [...block.children];
  const panels = [];

  const tablist = document.createElement('div');
  tablist.className = 'tabs';
  tablist.setAttribute('role', 'tablist');

  rows.forEach((row, i) => {
    const cells = [...row.children];
    const label = cells[0] ? cells[0].textContent.trim() : '';
    const panel = buildPanel(cells[1], i);
    panels.push(panel);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = i === 0 ? 'tab active' : 'tab';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    btn.setAttribute('aria-controls', panel.id);
    btn.textContent = label;
    tablist.append(btn);
  });

  const panelWrap = document.createElement('div');
  panelWrap.className = 'tab-panel-wrap';
  panelWrap.append(...panels);

  // Mobile carousel arrows: the source flanks the horizontally-scrollable tab
  // strip with prev/next buttons (disabled at the ends). CSS hides them on
  // desktop where all tabs fit and the strip doesn't scroll.
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

  const tabButtons = [...tablist.children];
  const activeIndex = () => tabButtons.findIndex((b) => b.classList.contains('active'));

  // Toggle the prev/next disabled state from the strip's scroll position.
  // The arrows are only useful when the strip overflows (tabs can be 1..many);
  // when everything fits, hide them via .tabs-fit so we don't show dead controls.
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
    // Park each panel's media relative to the newly-selected tab: panels to the
    // left of it sit left (is-before), panels to the right sit right (is-after).
    // Because parking is by *relative* position, the incoming panel always
    // enters from the side matching the direction of travel (and the outgoing
    // one leaves the opposite way) — the directional slide the source uses.
    panels.forEach((p, i) => {
      p.classList.toggle('is-active', i === idx);
      p.classList.toggle('is-before', i < idx);
      p.classList.toggle('is-after', i > idx);
    });
    tabButtons[idx].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  };
  // Initial parking (tab 0 active → every other panel waits off to the right)
  // without the smooth scrollIntoView that select() would trigger on load.
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

  // Panels are position:absolute (so outgoing/incoming can overlap during the
  // fade) which takes them out of flow, so the wrapper's height is synced
  // from JS to the tallest panel — otherwise it would collapse to 0.
  const syncHeight = () => {
    const heights = panels.map((p) => p.scrollHeight);
    panelWrap.style.height = `${Math.max(...heights, 0)}px`;
  };
  const refresh = () => {
    syncHeight();
    updateArrows();
  };
  // Re-measure whenever a panel's content reflows (fonts, image decode, resize).
  // A ResizeObserver is more reliable than image load events, which don't fire
  // for already-cached images (img.complete === true before we can listen).
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
  // Panels start at scrollHeight 0 until first layout; measure again next frame.
  requestAnimationFrame(refresh);
}
