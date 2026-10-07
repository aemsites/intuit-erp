import buildDotCarousel from '../../scripts/dot-carousel.js';

/**
 * case-study-cards — customer proof cards on a wintermint band (Mega Firms
 * landing page "Success stories"; Figma "Testimonial" → "04 - Small Card").
 * Below 768px the cards become a dot carousel ("02 - Dot Carousel (Mobile)").
 *
 * Content model — one row per card, two cells:
 *   1. photo (<img>/<picture>)
 *   2. copy, flowing: an optional eyebrow <p> before the heading, the firm
 *      name as a heading (h3 preferred), the person's name/role <p>, the
 *      quote paragraph(s), and a trailing link-only <p> as the CTA
 *      (e.g. <a href="…">Download case study &gt;</a>).
 * The section heading is authored before the block (section-heading block).
 * CSS: blocks/case-study-cards/case-study-cards.css
 */
function buildCard(row) {
  const [mediaCell, copyCell] = [...row.children];
  const card = document.createElement('article');
  card.className = 'case-card';

  const media = document.createElement('div');
  media.className = 'case-card-media';
  const picture = mediaCell && mediaCell.querySelector('picture, img');
  if (picture) media.append(picture);

  const copy = document.createElement('div');
  copy.className = 'case-card-copy';
  if (copyCell) [...copyCell.childNodes].forEach((n) => copy.append(n));

  const heading = copy.querySelector('h2, h3, h4');
  if (heading) heading.classList.add('case-card-firm');

  let roleSeen = false;
  const quote = document.createElement('div');
  quote.className = 'case-card-quote';
  const paras = [...copy.querySelectorAll(':scope > p')];
  paras.forEach((p) => {
    if (!p.textContent.trim()) { p.remove(); return; }
    const link = p.querySelector('a');
    if (link && p.textContent.trim() === link.textContent.trim()) {
      p.classList.add('case-card-cta');
      link.classList.add('case-card-link');
      return;
    }
    // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask
    if (heading && (p.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      p.classList.add('case-card-eyebrow');
      return;
    }
    if (heading && !roleSeen) {
      p.classList.add('case-card-role');
      roleSeen = true;
      return;
    }
    quote.append(p);
  });

  const header = document.createElement('div');
  header.className = 'case-card-header';
  copy.querySelectorAll('.case-card-eyebrow, .case-card-firm, .case-card-role').forEach((el) => header.append(el));

  const cta = copy.querySelector('.case-card-cta');
  copy.textContent = '';
  copy.append(header);
  if (quote.childElementCount) copy.append(quote);
  if (cta) copy.append(cta);

  card.append(media, copy);
  return card;
}

export default function decorate(block) {
  const cards = [...block.children].map(buildCard);
  const track = document.createElement('div');
  track.className = 'case-track';
  track.append(...cards);
  block.textContent = '';
  block.append(track);
  buildDotCarousel(track, 'Success stories');
}
