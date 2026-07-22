/**
 * feature-grid — expandable "bento" cards (index), matching erp.intuit.com's
 * #wp-custom-section click-to-expand cards.
 * Section head (h2) authored as default content before the block.
 *
 * Rows: one row per card, cells in order:
 *   1. preview image
 *   2. expanded image (optional — falls back to the preview image if omitted)
 *   3. tag/label text (e.g. "CLOSE MANAGEMENT")
 *   4. title text
 *   5. expanded body paragraph
 *   6. CTA link, e.g. <a href="/accounting">Find out more</a>
 *
 * Cards are paired two-per-row (1&2, 3&4, ...); clicking a card expands it to
 * fill the row and shrinks its row-partner to a title-only sliver, closing
 * any other expanded card first. The CTA navigates on click without also
 * toggling the card.
 * CSS: blocks/feature-grid/feature-grid.css
 */
function buildCard(row) {
  const cells = [...row.children];
  const picCells = cells.filter((c) => c.querySelector('picture, img'));
  const previewPic = picCells[0]?.querySelector('picture, img');
  const expandedPic = (picCells[1] || picCells[0])?.querySelector('picture, img');
  const ctaCell = cells.find((c) => c.querySelector('a'));
  const ctaLink = ctaCell?.querySelector('a');
  const textCells = cells.filter((c) => c !== ctaCell && !picCells.includes(c) && c.textContent.trim());
  const [tagCell, titleCell, bodyCell] = textCells;
  const tagText = tagCell ? tagCell.textContent.trim() : '';
  const titleText = titleCell ? titleCell.textContent.trim() : '';

  const card = document.createElement('div');
  card.className = 'feature-card';
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.setAttribute('aria-expanded', 'false');

  const preview = document.createElement('div');
  preview.className = 'feature-preview';
  if (previewPic) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'feature-img';
    imgWrap.append(previewPic.closest('picture') || previewPic);
    preview.append(imgWrap);
  }
  if (tagText) {
    const tag = document.createElement('span');
    tag.className = 'feature-tag';
    tag.textContent = tagText;
    preview.append(tag);
  }
  const title = document.createElement('h3');
  title.className = 'feature-title';
  title.textContent = titleText;
  preview.append(title);
  card.append(preview);

  const expanded = document.createElement('div');
  expanded.className = 'feature-expanded';
  if (expandedPic) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'feature-expanded-img';
    imgWrap.append(expandedPic.closest('picture') || expandedPic);
    expanded.append(imgWrap);
  }
  if (tagText) {
    const tag = document.createElement('span');
    tag.className = 'feature-tag';
    tag.textContent = tagText;
    expanded.append(tag);
  }
  const title2 = document.createElement('h3');
  title2.className = 'feature-title';
  title2.textContent = titleText;
  expanded.append(title2);
  if (bodyCell) {
    const body = document.createElement('p');
    body.className = 'feature-body-text';
    body.textContent = bodyCell.textContent.trim();
    expanded.append(body);
  }
  if (ctaLink) {
    const cta = document.createElement('a');
    cta.className = 'feature-cta';
    cta.href = ctaLink.getAttribute('href');
    cta.textContent = ctaLink.textContent.trim() || 'Find out more';
    cta.addEventListener('click', (e) => e.stopPropagation());
    expanded.append(cta);
  }
  card.append(expanded);

  const toggleIcon = document.createElement('span');
  toggleIcon.className = 'feature-toggle';
  toggleIcon.setAttribute('aria-hidden', 'true');
  toggleIcon.textContent = '+';
  card.append(toggleIcon);

  return card;
}

function setExpanded(card, expand) {
  card.classList.toggle('expanded', expand);
  card.setAttribute('aria-expanded', expand ? 'true' : 'false');
}

export default function decorate(block) {
  const rows = [...block.children];
  const cards = rows.map(buildCard);

  const grid = document.createElement('div');
  grid.className = 'feature-grid';

  const toggle = (card) => {
    const current = grid.querySelector('.feature-card.expanded');
    if (current && current !== card) setExpanded(current, false);
    setExpanded(card, !card.classList.contains('expanded'));
  };

  cards.forEach((card) => {
    card.addEventListener('click', () => toggle(card));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle(card);
      }
    });
  });

  for (let i = 0; i < cards.length; i += 2) {
    const featureRow = document.createElement('div');
    featureRow.className = 'feature-row';
    featureRow.append(cards[i]);
    if (cards[i + 1]) featureRow.append(cards[i + 1]);
    grid.append(featureRow);
  }

  block.replaceChildren(grid);
}
