/**
 * feature-grid — expandable "bento" cards (index), matching erp.intuit.com's
 * #wp-custom-section click-to-expand cards.
 * Section head (h2) authored as default content before the block.
 *
 * Rows: one row per card, 2 cells:
 *   1. media — one image, or two (first = card face, second = revealed on
 *      expand; a single image is used for both)
 *   2. content — flowing: an optional bold-only line as the tag/eyebrow
 *      (e.g. "CLOSE MANAGEMENT"), a heading as the title, body paragraph(s),
 *      and an optional trailing link-only line as the CTA
 *      (e.g. <a href="/accounting">Find out more</a>)
 *
 * Cards are paired two-per-row (1&2, 3&4, ...); clicking a card expands it to
 * fill the row and shrinks its row-partner to a title-only sliver, closing
 * any other expanded card first. The CTA navigates on click without also
 * toggling the card.
 * CSS: blocks/feature-grid/feature-grid.css
 */
function parseContent(cell) {
  let title = null;
  let tagText = '';
  let ctaLink = null;
  const bodyParagraphs = [];

  [...cell.children].forEach((node) => {
    if (/^H[1-6]$/.test(node.tagName)) {
      if (!title) title = node;
      return;
    }
    if (node.tagName !== 'P') return;
    const text = node.textContent.trim();
    if (!text) return;
    const only = node.children.length === 1 ? node.children[0] : null;
    if (only?.tagName === 'A' && text === only.textContent.trim()) {
      ctaLink = only;
      return;
    }
    if (!title && !tagText && only?.tagName === 'EM' && text === only.textContent.trim()) {
      tagText = text;
      return;
    }
    bodyParagraphs.push(node);
  });

  return {
    title, tagText, bodyParagraphs, ctaLink,
  };
}

function buildCard(row) {
  const [mediaCell, contentCell] = [...row.children];
  const pics = mediaCell
    ? [...mediaCell.querySelectorAll('img')].map((img) => img.closest('picture') || img)
    : [];
  const previewPic = pics[0];
  const expandedPic = pics[1] || pics[0];
  const {
    title: titleEl, tagText, bodyParagraphs, ctaLink,
  } = contentCell ? parseContent(contentCell) : {
    title: null, tagText: '', bodyParagraphs: [], ctaLink: null,
  };
  const titleText = titleEl ? titleEl.textContent.trim() : '';

  const card = document.createElement('div');
  card.className = 'feature-card';
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.setAttribute('aria-expanded', 'false');
  // No aria-label override: the visible tag + title text (below) already IS
  // the accessible name via content, and duplicating it in an aria-label with
  // different punctuation (a ": " the rendered text doesn't have) makes the
  // computed name no longer contain the visible text verbatim (WCAG 2.5.3).

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
  bodyParagraphs.forEach((p) => {
    const body = document.createElement('p');
    body.className = 'feature-body-text';
    body.innerHTML = p.innerHTML;
    expandedText.append(body);
  });
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
