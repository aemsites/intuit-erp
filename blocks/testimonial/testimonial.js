/**
 * testimonial — customer proof (index video, compare quote).
 * Section head (h2) authored as default content before the block.
 *
 * Default (compare) — one row, cells:
 *   1. quote-mark <img>   2. quote text   3. name   4. role   5. headshot <img>
 * Variant .video (index) — one row, cells:
 *   1. poster <img>   2. eyebrow   3. quote   4. attribution (may contain a link)
 * CSS: blocks/testimonial/testimonial.css
 */

function pic(cell) {
  if (!cell) return null;
  const p = cell.querySelector('picture, img');
  return p ? (p.closest('picture') || p) : null;
}

export default function decorate(block) {
  const isVideo = block.classList.contains('video');
  const row = block.querySelector(':scope > div');
  if (!row) return;
  const cells = [...row.children];

  if (isVideo) {
    const [posterCell, eyebrowCell, quoteCell, attrCell] = cells;
    const frame = document.createElement('div');
    frame.className = 'video-frame';
    const poster = pic(posterCell);
    if (poster) poster.classList.add('video-poster');
    const play = document.createElement('button');
    play.className = 'video-play';
    play.type = 'button';
    play.setAttribute('aria-label', 'Play video');
    play.textContent = '▶';
    const cap = document.createElement('div');
    cap.className = 'video-caption';
    cap.innerHTML = `
      <p class="video-eyebrow">${eyebrowCell ? eyebrowCell.textContent.trim() : ''}</p>
      <p class="video-quote">${quoteCell ? quoteCell.textContent.trim() : ''}</p>`;
    const attr = document.createElement('p');
    attr.className = 'video-attr';
    if (attrCell) attr.innerHTML = attrCell.innerHTML;
    cap.append(attr);
    if (poster) frame.append(poster);
    frame.append(play, cap);
    block.replaceChildren(frame);
    return;
  }

  const [markCell, quoteCell, nameCell, roleCell, mediaCell] = cells;
  const grid = document.createElement('div');
  grid.className = 'cmp-testi-grid';
  const card = document.createElement('div');
  card.className = 'cmp-quote-card';
  const mark = pic(markCell);
  if (mark) { mark.classList.add('cmp-quote-mark'); card.append(mark); }
  const quote = document.createElement('blockquote');
  quote.className = 'cmp-quote';
  if (quoteCell) quote.innerHTML = quoteCell.innerHTML;
  card.append(quote);
  const name = document.createElement('p');
  name.className = 'cmp-quote-name';
  name.textContent = nameCell ? nameCell.textContent.trim() : '';
  const role = document.createElement('p');
  role.className = 'cmp-quote-role';
  role.textContent = roleCell ? roleCell.textContent.trim() : '';
  card.append(name, role);
  grid.append(card);
  const media = document.createElement('div');
  media.className = 'cmp-testi-media';
  const headshot = pic(mediaCell);
  if (headshot) media.append(headshot);
  grid.append(media);
  block.replaceChildren(grid);
}
