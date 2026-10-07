/**
 * award-band — G2 proof strip (Mega Firms landing page): a 5-star rating with
 * its review link, then a row of award badges.
 *
 * Content model — up to two rows:
 *   1. rating: a paragraph with the numeric score (e.g. "4.4") and a paragraph
 *      with the review link (e.g. <a href="…">(4.4/5 | 276 reviews on G2)*</a>).
 *      The score drives the star fill (full/half/empty); only the link is
 *      rendered as text.
 *   2. badges: any number of icons (<span class="icon icon-g2-…">) or images.
 * The band is hidden below 768px, matching the mobile design.
 * CSS: blocks/award-band/award-band.css
 */
const STAR_PATH = 'M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.6l-6 3.3 1.3-6.7-5-4.7 6.8-.8z';

function star(fill) {
  const id = `award-star-${Math.random().toString(36).slice(2, 8)}`;
  const pct = Math.round(Math.max(0, Math.min(1, fill)) * 100);
  return `<svg class="award-star" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
    <defs><linearGradient id="${id}"><stop offset="${pct}%" stop-color="#eda700"/><stop offset="${pct}%" stop-color="#e0e4e8"/></linearGradient></defs>
    <path d="${STAR_PATH}" fill="url(#${id})"/>
  </svg>`;
}

export default function decorate(block) {
  const [ratingRow, badgeRow] = [...block.children];

  const rating = document.createElement('div');
  rating.className = 'award-rating';
  if (ratingRow) {
    const link = ratingRow.querySelector('a');
    const scoreText = [...ratingRow.querySelectorAll('p')]
      .map((p) => p.textContent.trim())
      .find((t) => /^\d+(\.\d+)?$/.test(t));
    const score = Number.parseFloat(scoreText || (link ? link.textContent : '') || '0') || 0;

    const stars = document.createElement('span');
    stars.className = 'award-stars';
    stars.setAttribute('role', 'img');
    stars.setAttribute('aria-label', `${score} out of 5 stars`);
    stars.innerHTML = [1, 2, 3, 4, 5].map((i) => star(score - (i - 1))).join('');
    rating.append(stars);

    if (link) {
      link.className = 'award-link';
      rating.append(link);
    }
  }

  const badges = document.createElement('div');
  badges.className = 'award-badges';
  if (badgeRow) {
    badgeRow.querySelectorAll('span.icon, picture, img').forEach((el) => {
      if (el.closest('picture') && el.tagName === 'IMG') return;
      badges.append(el);
    });
  }

  block.textContent = '';
  if (rating.childElementCount) block.append(rating);
  if (badges.childElementCount) block.append(badges);
}
