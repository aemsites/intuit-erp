/**
 * Download Cards
 * Renders a vertical card (large image, category label, title) from authored content.
 *
 * Authored structure (one row per card):
 *   | image | link |
 *
 * Category label is derived from the link path segment (e.g. /blog/research/… → "Research").
 */

function categoryFromPath(href) {
  try {
    const parts = new URL(href, window.location.origin).pathname.split('/').filter(Boolean);
    // /blog/<category>/<slug> — take segment after "blog"
    const idx = parts.indexOf('blog');
    const seg = idx >= 0 ? parts[idx + 1] : parts[1];
    return seg ? seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '';
  } catch {
    return '';
  }
}

export default function decorate(block) {
  const rows = [...block.querySelectorAll(':scope > div')];

  block.innerHTML = '';

  rows.forEach((row) => {
    const [imgCell, linkCell] = [...row.children];
    if (!imgCell || !linkCell) return;

    const picture = imgCell.querySelector('picture') || imgCell;
    const anchor = linkCell.querySelector('a');
    if (!anchor) return;

    const category = categoryFromPath(anchor.href);

    const a = document.createElement('a');
    a.href = anchor.href;
    a.className = 'download-cards-card';

    const imgWrap = document.createElement('div');
    imgWrap.className = 'download-cards-image';
    imgWrap.append(picture);

    const body = document.createElement('div');
    body.className = 'download-cards-body';

    if (category) {
      const label = document.createElement('span');
      label.className = 'download-cards-label';
      label.textContent = category;
      body.append(label);
    }

    const title = document.createElement('span');
    title.className = 'download-cards-title';
    title.textContent = anchor.textContent;
    body.append(title);

    a.append(imgWrap, body);
    block.append(a);
  });
}
