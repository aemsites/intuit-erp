/**
 * cards-video-gallery — a filterable grid of video cards, migrated from
 * erp.intuit.com/blog/videos/customer-testimonials/. Each authored card row is
 * a YouTube video link plus a body cell holding a category label (an
 * italic-only paragraph) and a title. The block:
 *   - embeds each video as a responsive YouTube iframe,
 *   - derives category filter tabs from the distinct labels present
 *     (All + each category), filtering the grid client-side, and
 *   - paginates the (filtered) cards into fixed-size pages with
 *     Previous / numbered / Next controls.
 *
 * Variant of the vanilla `cards` block (Block Collection). YouTube URL parsing
 * reuses the pure helpers in blocks/video/video-info.js.
 *
 * CSS: blocks/cards-video-gallery/cards-video-gallery.css
 */
import { createOptimizedPicture } from '../../scripts/aem.js';
import { videoInfo, posterFor } from '../video/video-info.js';

const PAGE_SIZE = 6;

/**
 * Builds a lightweight video facade: the poster thumbnail plus a play button.
 * The heavy YouTube/Vimeo iframe is only injected when the user clicks, which
 * avoids loading an iframe per card (faster, and dodges embed-config errors
 * when many players initialise at once).
 * @param {string} href the authored video URL
 * @param {string} title accessible label
 * @param {HTMLImageElement|null} [posterImg] the authored poster <img>, if any
 * @returns {HTMLElement|null} the facade wrapper, or null if unrecognized
 */
function buildEmbed(href, title, posterImg) {
  const info = videoInfo(href);
  if (!info) return null;

  const wrapper = document.createElement('div');
  wrapper.className = 'cards-video-gallery-embed';

  // Prefer the authored (imported) poster so the image ships as page content
  // and is served as an optimized responsive <picture>; fall back to the
  // provider thumbnail derived from the id.
  const posterSrc = (posterImg && posterImg.getAttribute('src')) || posterFor(info, '');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cards-video-gallery-play';
  button.setAttribute('aria-label', title ? `Play video: ${title}` : 'Play video');

  if (posterSrc) {
    const picture = createOptimizedPicture(posterSrc, title || '', false, [{ width: '750' }]);
    picture.classList.add('cards-video-gallery-poster');
    const img = picture.querySelector('img');
    // YouTube's hqdefault always exists; if an authored src 404s, fall back.
    if (info.provider === 'youtube' && img) {
      img.addEventListener('error', () => {
        const hq = `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`;
        if (!img.src.includes('/hqdefault.jpg')) img.src = hq;
      }, { once: true });
    }
    button.append(picture);
  }

  const icon = document.createElement('span');
  icon.className = 'cards-video-gallery-play-icon';
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);

  button.addEventListener('click', () => {
    const iframe = document.createElement('iframe');
    iframe.src = info.embedUrl; // autoplay on click
    iframe.title = title || 'Video';
    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen');
    iframe.setAttribute('allowfullscreen', '');
    wrapper.textContent = '';
    wrapper.append(iframe);
  });

  wrapper.append(button);
  return wrapper;
}

/**
 * Reads one authored card row into { category, title, link } and rebuilds it
 * as a decorated <li>.
 * @param {Element} row the authored block row
 * @returns {{ li: HTMLElement, category: string }}
 */
function decorateCard(row) {
  const li = document.createElement('li');
  li.className = 'cards-video-gallery-card';

  const link = row.querySelector('a[href]');
  const href = link ? link.getAttribute('href') : '';

  // body cell: italic-only paragraph = category label, heading = title
  const cells = [...row.children];
  const bodyCell = cells[cells.length - 1] || row;

  let category = '';
  const em = bodyCell.querySelector('em, i');
  if (em && em.textContent.trim()) category = em.textContent.trim();

  let title = '';
  const heading = bodyCell.querySelector('h1,h2,h3,h4,h5,h6');
  if (heading) title = heading.textContent.trim();
  else {
    const p = [...bodyCell.querySelectorAll('p')].find((n) => n !== (em && em.closest('p')));
    if (p) title = p.textContent.trim();
  }

  // optional authored poster image in the row (used in preference to the
  // provider's auto thumbnail when present)
  const posterImg = row.querySelector('img');

  const thumb = document.createElement('div');
  thumb.className = 'cards-video-gallery-card-image';
  const embed = buildEmbed(href, title, posterImg);
  if (embed) thumb.append(embed);
  else if (link) thumb.append(link);
  li.append(thumb);

  const body = document.createElement('div');
  body.className = 'cards-video-gallery-card-body';
  if (category) {
    const tag = document.createElement('span');
    tag.className = 'cards-video-gallery-category';
    tag.textContent = category;
    tag.dataset.category = category.toLowerCase();
    body.append(tag);
  }
  if (title) {
    const h = document.createElement('h3');
    h.className = 'cards-video-gallery-title';
    h.textContent = title;
    body.append(h);
  }
  li.append(body);

  li.dataset.category = category.toLowerCase();
  return { li, category };
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default function decorate(block) {
  const rows = [...block.children];
  const cards = rows.map(decorateCard);

  // distinct categories in authored order for the filter tabs
  const categories = [];
  cards.forEach(({ category }) => {
    if (category && !categories.includes(category)) categories.push(category);
  });

  const ul = document.createElement('ul');
  ul.className = 'cards-video-gallery-grid';
  cards.forEach(({ li }) => ul.append(li));

  // filter tabs (only when more than one category exists)
  let activeCategory = 'all';
  let currentPage = 1;
  const filterBar = document.createElement('div');
  filterBar.className = 'cards-video-gallery-filter-bar';
  const pagination = document.createElement('div');
  pagination.className = 'cards-video-gallery-pagination';

  function visibleCards() {
    return cards
      .map(({ li }) => li)
      .filter((li) => activeCategory === 'all' || li.dataset.category === activeCategory);
  }

  function render() {
    const visible = visibleCards();
    const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;

    cards.forEach(({ li }) => { li.hidden = true; });
    visible.slice(start, end).forEach((li) => { li.hidden = false; });

    // rebuild pagination
    pagination.textContent = '';
    if (totalPages > 1) {
      const mkBtn = (label, page, opts = {}) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cards-video-gallery-page-button';
        b.textContent = label;
        if (opts.active) b.classList.add('active');
        if (opts.disabled) {
          b.classList.add('disabled');
          b.disabled = true;
        } else {
          b.addEventListener('click', () => { currentPage = page; render(); });
        }
        return b;
      };
      pagination.append(mkBtn('Previous', currentPage - 1, { disabled: currentPage <= 1 }));
      for (let p = 1; p <= totalPages; p += 1) {
        pagination.append(mkBtn(`${p}`, p, { active: p === currentPage }));
      }
      pagination.append(mkBtn('Next', currentPage + 1, { disabled: currentPage >= totalPages }));
    }
  }

  if (categories.length > 1) {
    const mkTab = (label, value) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cards-video-gallery-filter-button';
      b.textContent = label;
      if (value === activeCategory) b.classList.add('active');
      b.addEventListener('click', () => {
        activeCategory = value;
        currentPage = 1;
        [...filterBar.children].forEach((c) => c.classList.toggle('active', c === b));
        render();
      });
      return b;
    };
    filterBar.append(mkTab('All', 'all'));
    categories.forEach((c) => filterBar.append(mkTab(c, c.toLowerCase())));
  }

  block.textContent = '';
  if (categories.length > 1) block.append(filterBar);
  block.append(ul);
  block.append(pagination);
  render();
}
