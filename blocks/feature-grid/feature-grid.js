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
  const textCells = cells.filter(
    (c) => c !== ctaCell && !picCells.includes(c) && c.textContent.trim(),
  );
  const [tagCell, titleCell, bodyCell] = textCells;
  const tagText = tagCell ? tagCell.textContent.trim() : '';
  const titleText = titleCell ? titleCell.textContent.trim() : '';

  const card = document.createElement('div');
  card.className = 'feature-card';
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.setAttribute('aria-expanded', 'false');
  // upstream labels the card with "{tag}: {title}" so screen readers announce
  // what the control expands, not just the visible title
  const label = [tagText, titleText].filter(Boolean).join(': ');
  if (label) card.setAttribute('aria-label', label);

  const previewEl = previewPic?.closest('picture') || previewPic;
  const expandedEl = expandedPic?.closest('picture') || expandedPic;

  const preview = document.createElement('div');
  preview.className = 'feature-preview';
  if (previewEl) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'feature-img';
    imgWrap.append(previewEl);
    preview.append(imgWrap);
  }
  if (tagText) {
    const tag = document.createElement('span');
    tag.className = 'feature-tag';
    tag.textContent = tagText;
    preview.append(tag);
  }
  if (titleText) {
    const title = document.createElement('h3');
    title.className = 'feature-title';
    title.textContent = titleText;
    preview.append(title);
  }
  preview.setAttribute('aria-hidden', 'false');
  card.append(preview);

  const expanded = document.createElement('div');
  expanded.className = 'feature-expanded';
  // when only one image is authored it belongs to the preview, so the expanded
  // view goes without rather than stealing it and leaving an empty preview box
  if (expandedEl && expandedEl !== previewEl) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'feature-expanded-img';
    // upstream links the expanded visual to the card's story and opens it in a
    // new tab; the click must not also collapse the card
    if (ctaLink) {
      const imgLink = document.createElement('a');
      imgLink.href = ctaLink.getAttribute('href');
      imgLink.target = '_blank';
      imgLink.rel = 'noopener';
      imgLink.setAttribute('tabindex', '-1');
      imgLink.setAttribute('aria-hidden', 'true');
      imgLink.addEventListener('click', (e) => e.stopPropagation());
      imgLink.append(expandedEl);
      imgWrap.append(imgLink);
    } else {
      imgWrap.append(expandedEl);
    }
    expanded.append(imgWrap);
  }
  // tag/title/body/CTA share a wrapper so the 24px top gap and 40px bottom
  // padding apply to the block as a whole, as upstream's .wp-expanded-bottom-text
  const expandedText = document.createElement('div');
  expandedText.className = 'feature-expanded-text';
  if (tagText) {
    const tag = document.createElement('span');
    tag.className = 'feature-tag';
    tag.textContent = tagText;
    expandedText.append(tag);
  }
  if (titleText) {
    const title2 = document.createElement('h3');
    title2.className = 'feature-title';
    title2.textContent = titleText;
    expandedText.append(title2);
  }
  if (bodyCell) {
    const body = document.createElement('p');
    body.className = 'feature-body-text';
    body.textContent = bodyCell.textContent.trim();
    expandedText.append(body);
  }
  if (ctaLink) {
    const cta = document.createElement('a');
    cta.className = 'feature-cta';
    cta.href = ctaLink.getAttribute('href');
    cta.textContent = ctaLink.textContent.trim() || 'Find out more';
    cta.addEventListener('click', (e) => e.stopPropagation());
    expandedText.append(cta);
  }
  expanded.append(expandedText);
  expanded.setAttribute('aria-hidden', 'true');
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
  // only the visible half is exposed to assistive tech, matching upstream
  card.querySelector('.feature-preview')?.setAttribute('aria-hidden', expand ? 'true' : 'false');
  card.querySelector('.feature-expanded')?.setAttribute('aria-hidden', expand ? 'false' : 'true');
}

export default function decorate(block) {
  const rows = [...block.children];
  const cards = rows.map(buildCard);

  const grid = document.createElement('div');
  grid.className = 'feature-grid';

  // Rows are a fixed height while expanded (704px, as upstream) and the card clips
  // overflow, so the panel's trailing padding is cut off by design. Only when copy
  // wraps far enough to push the CTA against that edge does the row need the
  // taller 739px slot — upstream hardcodes this for its one long-copy row.
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

  // Width classes are set here rather than via :nth-child selectors so they stay
  // single-class — .feature-card.expanded must outrank them, as upstream's
  // .wp-w-528 loses to .wp-expandable-card.expanded.
  for (let i = 0; i < cards.length; i += 2) {
    const featureRow = document.createElement('div');
    featureRow.className = 'feature-row';
    const flip = (i / 2) % 2 === 1; // rows alternate 528/664 then 664/528
    cards[i].classList.add(flip ? 'fg-w-664' : 'fg-w-528');
    featureRow.append(cards[i]);
    if (cards[i + 1]) {
      cards[i + 1].classList.add(flip ? 'fg-w-528' : 'fg-w-664');
      featureRow.append(cards[i + 1]);
    }
    grid.append(featureRow);
  }

  block.replaceChildren(grid);
}
