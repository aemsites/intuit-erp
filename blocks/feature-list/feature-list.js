import buildDotCarousel from '../../scripts/dot-carousel.js';

/**
 * feature-list — tinted panel of icon features in three columns (Mega Firms
 * landing page; Figma "03 - 3 Column Feature List (Web)"). Below 768px the
 * features become white cards in a dot carousel ("02 - Dot Carousel (Mobile)").
 *
 * Content model — one row per feature, a single flowing cell:
 *   an icon (<span class="icon icon-…"> or <img>), a heading (h3 preferred;
 *   a bold-only paragraph also works), then body paragraph(s).
 * The section heading is authored before the block (section-heading block or
 * default content).
 * CSS: blocks/feature-list/feature-list.css
 */
function buildItem(row) {
  const content = document.createElement('div');
  [...row.children].forEach((cell) => [...cell.childNodes].forEach((n) => content.append(n)));

  const item = document.createElement('div');
  item.className = 'feature-item';

  const icon = document.createElement('div');
  icon.className = 'feature-icon';
  const iconEl = content.querySelector('span.icon, picture, img');
  if (iconEl) {
    const holder = iconEl.closest('p') || iconEl;
    icon.append(iconEl);
    if (holder !== iconEl && !holder.textContent.trim()) holder.remove();
  }

  let heading = content.querySelector('h2, h3, h4');
  if (!heading) {
    const bold = [...content.querySelectorAll('p')].find((p) => {
      const strong = p.querySelector('strong');
      return strong && strong.textContent.trim() === p.textContent.trim();
    });
    if (bold) {
      heading = document.createElement('h3');
      heading.textContent = bold.textContent.trim();
      bold.replaceWith(heading);
    }
  }
  const title = document.createElement('h3');
  title.className = 'feature-title';
  if (heading) {
    title.innerHTML = heading.innerHTML;
    heading.remove();
  }

  const body = document.createElement('div');
  body.className = 'feature-body';
  content.querySelectorAll(':scope > p').forEach((p) => { if (!p.textContent.trim()) p.remove(); });
  [...content.childNodes].forEach((n) => body.append(n));

  item.append(icon, title, body);
  return item;
}

export default function decorate(block) {
  const items = [...block.children].map(buildItem);
  const track = document.createElement('div');
  track.className = 'feature-track';
  track.append(...items);
  block.textContent = '';
  block.append(track);
  buildDotCarousel(track, 'Features');
}
