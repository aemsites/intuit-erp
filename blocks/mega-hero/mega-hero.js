/**
 * mega-hero — two-column landing hero (Mega Firms landing page): eyebrow,
 * h1, lead paragraph and a primary CTA on the left, a single image on the right.
 *
 * Content model — one row, two cells:
 *   1. copy: eyebrow <p> (optional, must precede the heading), h1/h2, body
 *      paragraph(s), then a CTA paragraph (<strong><a>) — order is detected,
 *      not positional, so the eyebrow or CTA can be omitted
 *   2. media: an <img>/<picture> (optional)
 * The image is decorative on mobile (hidden below 768px, see CSS).
 * CSS: blocks/mega-hero/mega-hero.css
 */
export default function decorate(block) {
  const row = block.querySelector(':scope > div');
  if (!row) return;
  const [copyCell, mediaCell] = [...row.children];

  const copy = document.createElement('div');
  copy.className = 'mega-hero-copy';
  if (copyCell) [...copyCell.childNodes].forEach((n) => copy.append(n));

  const heading = copy.querySelector('h1, h2, h3');
  copy.querySelectorAll(':scope > p').forEach((p) => {
    if (!p.textContent.trim() && !p.querySelector('img, picture')) { p.remove(); return; }
    if (p.querySelector('a') && p.textContent.trim() === p.querySelector('a').textContent.trim()) {
      p.classList.add('mega-hero-cta');
      return;
    }
    // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask
    if (heading && (p.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      p.classList.add('mega-hero-eyebrow');
    } else {
      p.classList.add('mega-hero-body');
    }
  });
  if (heading) heading.classList.add('mega-hero-title');

  const media = document.createElement('div');
  media.className = 'mega-hero-media';
  const picture = mediaCell && mediaCell.querySelector('picture, img');
  if (picture) {
    const img = picture.tagName === 'IMG' ? picture : picture.querySelector('img');
    if (img) {
      img.loading = 'eager';
      img.fetchPriority = 'high';
    }
    media.append(picture);
  }

  block.textContent = '';
  block.append(copy);
  if (picture) block.append(media);
}
