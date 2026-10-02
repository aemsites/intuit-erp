/**
 * bento-cards — tinted feature cards (Figma: ACQ-4698 "Workflows carried
 * over" section). Desktop: a 3-column bento grid. Below 768px: a horizontal
 * scroll-snap carousel (one card per view, next card peeking) with dot
 * indicators. Section eyebrow + h2 are authored as default content before
 * the block.
 *
 * Rows: one row per card, up to 3 cells:
 *   1. content — optional icon (an image or :icon-name:), a heading as the
 *      card title, then body paragraph(s)
 *   2. visual (optional) — one image. A card with a visual spans 2 of the 3
 *      grid columns ("wide"); without one it spans 1 ("narrow")
 *   3. theme (optional) — pepper | orange | blue | blueberry. When omitted,
 *      themes cycle in that order so the default 4-card layout matches the
 *      design without authors picking colours.
 * CSS: blocks/bento-cards/bento-cards.css
 */

const THEMES = ['pepper', 'orange', 'blue', 'blueberry'];

function isIconNode(node) {
  if (node.tagName === 'PICTURE' || node.tagName === 'IMG') return true;
  if (node.tagName !== 'P') return false;
  return node.children.length === 1
    && (node.children[0].tagName === 'PICTURE' || node.children[0].classList?.contains('icon'))
    && !node.textContent.trim();
}

function buildCard(row, index) {
  const [contentCell, visualCell, themeCell] = [...row.children];
  const authored = themeCell?.textContent.trim().toLowerCase();
  const theme = THEMES.includes(authored) ? authored : THEMES[index % THEMES.length];
  const visual = visualCell?.querySelector('picture, img');

  const card = document.createElement('div');
  card.className = `bento-card bento-card-${theme}`;
  card.classList.add(visual ? 'wide' : 'narrow');

  const body = document.createElement('div');
  body.className = 'bento-card-body';

  if (contentCell) {
    const nodes = [...contentCell.children];
    const iconNode = nodes.find(isIconNode);
    if (iconNode) {
      const icon = document.createElement('div');
      icon.className = 'bento-card-icon';
      icon.append(iconNode.tagName === 'P' ? iconNode.firstElementChild : iconNode);
      iconNode.remove();
      body.append(icon);
    }
    const copy = document.createElement('div');
    copy.className = 'bento-card-copy';
    copy.append(...contentCell.children);
    body.append(copy);
  }
  card.append(body);

  if (visual) {
    const panel = document.createElement('div');
    panel.className = 'bento-card-visual';
    panel.append(visual);
    const img = panel.querySelector('img');
    if (img) {
      img.loading = 'lazy';
      if (!img.alt) img.alt = '';
    }
    card.append(panel);
  }

  return card;
}

function buildDots(track, cards) {
  const dots = document.createElement('div');
  dots.className = 'bento-dots';
  dots.setAttribute('role', 'tablist');
  dots.setAttribute('aria-label', 'Choose a card');

  const buttons = cards.map((card, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'bento-dot';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `Go to card ${i + 1} of ${cards.length}`);
    dot.addEventListener('click', () => {
      card.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    });
    return dot;
  });
  dots.append(...buttons);

  const setActive = (index) => {
    buttons.forEach((dot, i) => {
      const active = i === index;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  };
  setActive(0);

  // the card covering the most of the viewport is the active one
  if ('IntersectionObserver' in window) {
    const ratios = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => ratios.set(e.target, e.intersectionRatio));
      let best = 0;
      let bestRatio = -1;
      cards.forEach((card, i) => {
        const r = ratios.get(card) ?? 0;
        if (r > bestRatio) { bestRatio = r; best = i; }
      });
      setActive(best);
    }, { root: track, threshold: [0.25, 0.5, 0.75, 1] });
    cards.forEach((card) => io.observe(card));
  }

  return dots;
}

export default function decorate(block) {
  const cards = [...block.children].map(buildCard);
  cards.forEach((card, i) => {
    card.setAttribute('aria-roledescription', 'slide');
    card.setAttribute('aria-label', `Card ${i + 1} of ${cards.length}`);
  });

  const track = document.createElement('div');
  track.className = 'bento-track';
  track.append(...cards);

  block.replaceChildren(track, buildDots(track, cards));
}
