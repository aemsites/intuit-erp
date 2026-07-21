/**
 * stat-band — band of stat figures (index carousel, pricing static grid).
 *
 * Section head (h2) is authored as default content before the block.
 * Block rows = one row per stat:
 *   default (index): number / description / company / segment — paged carousel
 *   .stat-band.dark (pricing "Data-backed performance"): number / description — static grid
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

  function applyTransform() {
    const card = cards[0];
    if (!card) return;
    const cardWidth = card.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || '0') || 0;
    const step = (cardWidth + gap) * perView;
    track.style.transform = `translateX(-${current * step}px)`;
  }

  function goTo(idx) {
    current = Math.max(0, Math.min(idx, totalGroups - 1));
    applyTransform();
    updateDots();
    updateButtons();
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
  const dark = block.classList.contains('dark');
  const rows = [...block.children];

  const track = document.createElement('div');
  track.className = dark ? 'stats-grid' : 'stats-track';

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

  if (!dark) buildCarousel(block, track);
}
