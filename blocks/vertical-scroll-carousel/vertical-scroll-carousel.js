/**
 * vertical-scroll-carousel — scroll-animated stack where each item's media
 * (image or video) is revealed/highlighted as its row scrolls through view
 * (construction "Built for how construction actually works"; pricing "Why IES").
 *
 * Content model: each ROW = one item — cell0 = media (`<img>`/video link),
 * cell1 = heading, cell2 = body.
 *
 * Structure built: `.vsc-item` per row, each with `.vsc-copy` (heading+body,
 * left) and `.vsc-media` (right). The media column is pinned via CSS
 * `position: sticky` at >=900px (see vertical-scroll-carousel.css) so no JS
 * layout math is required.
 *
 * `activate(items, index)` is a small pure helper — it only toggles
 * `.is-active` on the given `.vsc-item` elements — so it is directly
 * unit-testable without a real IntersectionObserver. An IntersectionObserver
 * calls it as items scroll through the viewport; jsdom has no IO, so all IO
 * usage is guarded behind `typeof IntersectionObserver !== 'undefined'` and
 * decorate() still builds a fully usable (unobserved, first-item-active)
 * stacked list when it is absent.
 *
 * CSS: blocks/vertical-scroll-carousel/vertical-scroll-carousel.css
 */

const VIDEO_EXT_RE = /\.(mp4|webm|ogg)(\?.*)?$/i;

function buildMedia(cell) {
  const media = document.createElement('div');
  media.className = 'vsc-media';
  if (!cell) return media;

  const picture = cell.querySelector('picture');
  const img = cell.querySelector('img');
  const videoLink = [...cell.querySelectorAll('a')]
    .find((a) => VIDEO_EXT_RE.test(a.getAttribute('href') || ''));

  if (picture) {
    media.append(picture);
  } else if (img) {
    media.append(img);
  } else if (videoLink) {
    const video = document.createElement('video');
    video.className = 'vsc-video';
    video.src = videoLink.getAttribute('href');
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('aria-hidden', 'true');
    media.append(video);
  } else {
    [...cell.childNodes].forEach((n) => media.append(n));
  }
  return media;
}

function buildCopy(headingCell, bodyCell) {
  const copy = document.createElement('div');
  copy.className = 'vsc-copy';

  const headingText = headingCell ? headingCell.textContent.trim() : '';
  if (headingText) {
    const heading = document.createElement('h3');
    heading.className = 'vsc-heading';
    heading.textContent = headingText;
    copy.append(heading);
  }

  if (bodyCell && bodyCell.textContent.trim()) {
    const body = document.createElement('div');
    body.className = 'vsc-body';
    [...bodyCell.childNodes].forEach((n) => body.append(n));
    copy.append(body);
  }

  return copy;
}

/**
 * Pure helper: mark only `items[index]` as active. No IO / DOM-observation
 * dependency, so it is safe to call directly in tests or from an
 * IntersectionObserver callback.
 * @param {Element[]} items the `.vsc-item` elements
 * @param {number} index the index to activate
 */
export function activate(items, index) {
  items.forEach((item, i) => item.classList.toggle('is-active', i === index));
}

export default function decorate(block) {
  const rows = [...block.children];

  const items = rows.map((row) => {
    const [mediaCell, headingCell, bodyCell] = [...row.children];
    const item = document.createElement('div');
    item.className = 'vsc-item';
    item.append(buildCopy(headingCell, bodyCell), buildMedia(mediaCell));
    return item;
  });

  block.replaceChildren(...items);
  if (!items.length) return;

  // Sensible default so the block is fully usable with no JS/IO at all.
  activate(items, 0);

  if (typeof IntersectionObserver !== 'undefined') {
    const observer = new IntersectionObserver((entries) => {
      const mostVisible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!mostVisible) return;
      const index = items.indexOf(mostVisible.target);
      if (index !== -1) activate(items, index);
    }, {
      threshold: [0.25, 0.5, 0.75],
      rootMargin: '-35% 0px -35% 0px',
    });
    items.forEach((item) => observer.observe(item));
  }
}
