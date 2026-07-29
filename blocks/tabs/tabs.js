/**
 * tabs — feature explorer (accounting). Section head (h2) as default content.
 * Row 1: tab labels (one cell per label).
 * Rows 2+: one panel per label, same order — cells: media <img> / eyebrow / heading / body.
 *
 * Switching tabs crossfades panels (all stacked absolutely inside a
 * height-synced wrapper) instead of a hard show/hide — matches the fade
 * erp.intuit.com/accounting uses, so there's no layout jump and both the
 * outgoing and incoming panel are visible mid-transition.
 * CSS: blocks/tabs/tabs.css
 */
function pic(cell) {
  if (!cell) return null;
  const p = cell.querySelector('picture, img');
  return p ? (p.closest('picture') || p) : null;
}

function buildPanel(cells, index) {
  const panel = document.createElement('div');
  panel.className = index === 0 ? 'tab-panel is-active' : 'tab-panel';
  panel.id = `tab-panel-${index}`;

  const media = document.createElement('div');
  media.className = 'tab-media';
  const img = pic(cells[0]);
  if (img) media.append(img);

  const copy = document.createElement('div');
  copy.className = 'tab-copy';
  if (cells[1] && cells[1].textContent.trim()) {
    const eb = document.createElement('p');
    eb.className = 'eyebrow';
    eb.textContent = cells[1].textContent.trim();
    copy.append(eb);
  }
  if (cells[2]) {
    const h = document.createElement('h3');
    h.className = 'tab-h3';
    h.textContent = cells[2].textContent.trim();
    copy.append(h);
  }
  if (cells[3]) {
    const b = document.createElement('p');
    b.className = 'tab-body';
    b.innerHTML = cells[3].innerHTML;
    copy.append(b);
  }

  panel.append(media, copy);
  return panel;
}

export default function decorate(block) {
  const rows = [...block.children];
  const labelRow = rows[0];
  const panels = rows.slice(1).map((row, i) => buildPanel([...row.children], i));

  const tablist = document.createElement('div');
  tablist.className = 'tabs';
  tablist.setAttribute('role', 'tablist');
  [...(labelRow ? labelRow.children : [])].forEach((cell, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = i === 0 ? 'tab active' : 'tab';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    if (panels[i]) btn.setAttribute('aria-controls', panels[i].id);
    btn.textContent = cell.textContent.trim();
    tablist.append(btn);
  });

  const panelWrap = document.createElement('div');
  panelWrap.className = 'tab-panel-wrap';
  panelWrap.append(...panels);

  // Panels are position:absolute (so outgoing/incoming can overlap during the
  // fade) which takes them out of flow, so the wrapper's height is synced
  // from JS to the tallest panel — otherwise it would collapse to 0.
  const syncHeight = () => {
    const heights = panels.map((p) => p.scrollHeight);
    panelWrap.style.height = `${Math.max(...heights, 0)}px`;
  };
  panelWrap.querySelectorAll('img').forEach((img) => {
    if (img.complete) return;
    img.addEventListener('load', syncHeight, { once: true });
  });
  window.addEventListener('resize', syncHeight);

  tablist.addEventListener('click', (e) => {
    const target = e.target.closest('.tab');
    if (!target) return;
    const idx = [...tablist.children].indexOf(target);
    [...tablist.children].forEach((b, i) => {
      b.classList.toggle('active', i === idx);
      b.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
    panels.forEach((p, i) => p.classList.toggle('is-active', i === idx));
  });

  block.replaceChildren(tablist, panelWrap);
  syncHeight();
}
