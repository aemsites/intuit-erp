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

// Rhodes Companies customer story — same cutdown clip + YouTube id erp.intuit.com plays.
const STORY_VIDEO_SRC = 'https://erp.intuit.com/oidam/intuit/erp/en_us/web/motion-and-video/case-study-rhodes-cutdown-video-ies-us-en-sm.mp4';
const STORY_YOUTUBE_ID = 'gpHd4jd6dTk';

function openVideoModal(videoId) {
  const overlay = document.createElement('div');
  overlay.className = 'video-modal-overlay';
  overlay.innerHTML = `
    <div class="video-modal">
      <button type="button" class="video-modal-close" aria-label="Close video">×</button>
      <div class="video-modal-frame">
        <iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0" title="Customer story video" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
      </div>
    </div>`;
  // close/onKey are mutually referential hoisted function declarations; one direction
  // will always textually precede the other's declaration, so this is safe, not a bug.
  function close() {
    overlay.remove();
    // eslint-disable-next-line no-use-before-define
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.video-modal-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
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
    const posterImg = posterCell ? posterCell.querySelector('img') : null;
    const bg = document.createElement('video');
    bg.className = 'video-bg';
    bg.src = STORY_VIDEO_SRC;
    if (posterImg) bg.poster = posterImg.currentSrc || posterImg.src;
    bg.muted = true;
    bg.loop = true;
    bg.autoplay = true;
    bg.playsInline = true;
    bg.setAttribute('aria-hidden', 'true');
    const play = document.createElement('button');
    play.className = 'video-play';
    play.type = 'button';
    play.setAttribute('aria-label', 'Play full video');
    play.textContent = '▶';
    play.addEventListener('click', () => openVideoModal(STORY_YOUTUBE_ID));
    const cap = document.createElement('div');
    cap.className = 'video-caption';
    cap.innerHTML = `
      <p class="video-eyebrow">${eyebrowCell ? eyebrowCell.textContent.trim() : ''}</p>
      <p class="video-quote">${quoteCell ? quoteCell.textContent.trim() : ''}</p>`;
    const attr = document.createElement('p');
    attr.className = 'video-attr';
    if (attrCell) attr.innerHTML = attrCell.innerHTML;
    cap.append(attr);
    frame.append(bg, play, cap);
    block.replaceChildren(frame);
    bg.play().catch(() => {});
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
