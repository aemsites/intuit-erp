/**
 * tabs — feature explorer (accounting). Section head (h2) as default content.
 * Row 1: tab labels (one cell per label).
 * Row 2: active panel — cells: media <img> / eyebrow / heading / body.
 * First tab active; clicking a tab marks it selected. CSS: blocks/tabs/tabs.css
 */
function pic(cell) {
  if (!cell) return null;
  const p = cell.querySelector('picture, img');
  return p ? (p.closest('picture') || p) : null;
}

export default function decorate(block) {
  const rows = [...block.children];
  const labelRow = rows[0];
  const panelRow = rows[1];

  const tablist = document.createElement('div');
  tablist.className = 'tabs';
  tablist.setAttribute('role', 'tablist');
  [...(labelRow ? labelRow.children : [])].forEach((cell, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = i === 0 ? 'tab active' : 'tab';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    btn.textContent = cell.textContent.trim();
    tablist.append(btn);
  });
  tablist.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    tablist.querySelectorAll('.tab').forEach((b) => {
      b.classList.toggle('active', b === t);
      b.setAttribute('aria-selected', b === t ? 'true' : 'false');
    });
  });

  const panel = document.createElement('div');
  panel.className = 'tab-panel';
  const cells = [...(panelRow ? panelRow.children : [])];
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

  block.replaceChildren(tablist, panel);
}
