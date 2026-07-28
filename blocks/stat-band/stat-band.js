/**
 * stat-band — band of stat figures (index carousel, pricing static grid,
 * case-study "Results at a glance" callout).
 *
 * Section head (h2/h3) is authored as default content before the block.
 * Block rows = one row per stat:
 *   default (index): number / description / company / segment — paged carousel
 *   .stat-band.dark (pricing "Data-backed performance"): number / description — static grid
 *   .stat-band.plain (research guide stat trios): number / description —
 *     the same static grid as .dark, but light bordered boxes on the page
 *     background instead of a navy band.
 *   .stat-band.glance (case study "Results at a glance"): number / description —
 *     rendered as a plain bulleted sentence per row ("{number} {description}"),
 *     matching erp.intuit.com's results box, not a number/caption grid.
 * An optional trailing paragraph (foot/disclaimer) is authored as default content.
 * CSS: blocks/stat-band/stat-band.css
 */

function txt(cell) { return cell ? cell.textContent.trim() : ''; }

function cardsPerView() {
  const w = window.innerWidth;
  if (w < 768) return 1;
  if (w < 1024) return 2;
  if (w < 1280) return 3;
  return 4;
}

function buildCarousel(block, track) {
  const viewport = document.createElement('div');
  viewport.className = 'stats-viewport';
  track.before(viewport);
  viewport.append(track);

  const dots = document.createElement('div');
  dots.className = 'stats-dots';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'stats-arrow prev';
  prevBtn.setAttribute('aria-label', 'Previous outcomes');
  prevBtn.textContent = '‹';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'stats-arrow next';
  nextBtn.setAttribute('aria-label', 'Next outcomes');
  nextBtn.textContent = '›';
  const nav = document.createElement('div');
  nav.className = 'stats-nav';
  nav.append(prevBtn, nextBtn);
  const controls = document.createElement('div');
  controls.className = 'stats-controls';
  controls.append(dots, nav);
  block.append(controls);

  const cards = [...track.children];
  let perView = cardsPerView();
  let totalGroups = Math.ceil(cards.length / perView);
  let current = 0;

  function updateDots() {
    [...dots.children].forEach((dot, i) => dot.classList.toggle('active', i === current));
  }

  function updateButtons() {
    prevBtn.disabled = current <= 0;
    nextBtn.disabled = current >= totalGroups - 1;
  }

  function applyTransform() {
    // One "page" (perView cards + gaps) always spans exactly the track's own
    // box width — that's what the .stat flex-basis calc() is built to do —
    // so translateX(-100%) per page is exact with no layout read needed
    // (measuring via getBoundingClientRect/getComputedStyle here was forcing
    // a synchronous reflow right after the DOM/style writes above it).
    track.style.transform = `translateX(-${current * 100}%)`;
  }

  function goTo(idx) {
    current = Math.max(0, Math.min(idx, totalGroups - 1));
    applyTransform();
    updateDots();
    updateButtons();
  }

  function buildDots() {
    dots.innerHTML = '';
    for (let i = 0; i < totalGroups; i += 1) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'dot';
      dot.setAttribute('aria-label', `Go to outcomes group ${i + 1} of ${totalGroups}`);
      dot.addEventListener('click', () => goTo(i));
      dots.append(dot);
    }
    updateDots();
  }

  function syncLayout() {
    const next = cardsPerView();
    if (next !== perView) {
      perView = next;
      block.style.setProperty('--cards-per-view', perView);
      totalGroups = Math.ceil(cards.length / perView);
      if (current > totalGroups - 1) current = totalGroups - 1;
      buildDots();
      updateButtons();
    }
    applyTransform();
  }

  block.style.setProperty('--cards-per-view', perView);
  prevBtn.addEventListener('click', () => goTo(current - 1));
  nextBtn.addEventListener('click', () => goTo(current + 1));
  window.addEventListener('resize', syncLayout);

  buildDots();
  updateButtons();
  requestAnimationFrame(applyTransform);
}

export default function decorate(block) {
  const rows = [...block.children];

  if (block.classList.contains('glance')) {
    const list = document.createElement('ul');
    list.className = 'glance-list';
    rows.forEach((row) => {
      const cells = [...row.children];
      if (!cells.length) return;
      const li = document.createElement('li');
      const num = document.createElement('strong');
      num.className = 'glance-num';
      num.textContent = txt(cells[0]);
      li.append(num);
      if (cells[1]) li.append(` ${txt(cells[1])}`);
      list.append(li);
    });
    block.replaceChildren(list);
    return;
  }

  const staticGrid = block.classList.contains('dark') || block.classList.contains('plain');
  const track = document.createElement('div');
  track.className = staticGrid ? 'stats-grid' : 'stats-track';

  rows.forEach((row) => {
    const cells = [...row.children];
    if (!cells.length) return;
    const stat = document.createElement('div');
    stat.className = 'stat';
    const num = document.createElement('div');
    num.className = 'stat-num';
    num.textContent = txt(cells[0]);
    stat.append(num);
    if (cells[1]) {
      const desc = document.createElement('p');
      desc.className = 'stat-desc';
      desc.innerHTML = cells[1].innerHTML;
      stat.append(desc);
    }
    if (cells[2] && txt(cells[2])) {
      const co = document.createElement('p');
      co.className = 'stat-co';
      co.textContent = txt(cells[2]);
      stat.append(co);
    }
    if (cells[3] && txt(cells[3])) {
      const seg = document.createElement('p');
      seg.className = 'stat-seg';
      seg.textContent = txt(cells[3]);
      stat.append(seg);
    }
    track.append(stat);
  });

  block.replaceChildren(track);

  if (!staticGrid) buildCarousel(block, track);
}
