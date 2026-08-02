/**
 * testimonial — customer proof (index video, compare quote).
 * Section head (h2) authored as default content before the block.
 *
 * Default (compare) — one row, cells:
 *   1. quote-mark <img>   2. quote text   3. name   4. role   5. headshot <img>
 * Variant .video (index) — one row, cells:
 *   1. poster <img>   2. eyebrow   3. quote   4. attribution (may contain a link)
 *   5. YouTube video id (optional — defaults to the Rhodes Companies story clip)
 * When a YouTube id is authored, the poster photo is shown as a static
 * background (no muted autoplay loop, since we only have a YouTube id, not
 * a cutdown mp4 for that story) and the play button opens that video.
 * Variant .card (migration rationale / account testimonials) — one or more
 * rows, each row a card with cells:
 *   1. photo <img>   2. quote   3. name   4. title (optional)
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

function buildCard(row) {
  const [photoCell, quoteCell, nameCell, titleCell] = [...row.children];
  const figure = document.createElement('figure');
  figure.className = 'testimonial-card';

  const media = pic(photoCell);
  if (media) {
    const img = media.tagName === 'IMG' ? media : media.querySelector('img');
    if (img) img.classList.add('testimonial-photo');
    figure.append(media);
  }

  const quote = document.createElement('blockquote');
  if (quoteCell) quote.innerHTML = quoteCell.innerHTML;
  figure.append(quote);

  const figcaption = document.createElement('figcaption');
  const name = nameCell ? nameCell.textContent.trim() : '';
  const title = titleCell ? titleCell.textContent.trim() : '';
  if (name) {
    const nameEl = document.createElement('p');
    nameEl.className = 'testimonial-name';
    nameEl.textContent = name;
    figcaption.append(nameEl);
  }
  if (title) {
    const titleEl = document.createElement('p');
    titleEl.className = 'testimonial-title';
    titleEl.textContent = title;
    figcaption.append(titleEl);
  }
  figure.append(figcaption);

  return figure;
}

// Parse a YouTube watch/short/embed URL into its id; '' if not a URL (a bare
// id authored directly is returned as-is by the caller's fallback).
function ytId(url) {
  if (!url) return '';
  const m = url.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  return m ? m[1] : '';
}

/**
 * Builds one video story frame from a row's positional cells:
 *   [poster img, eyebrow, quote, attribution (may hold a link),
 *    youtube (url or id), mp4 link (optional), logo img (optional)]
 * When an mp4 cell is present the frame shows that clip inline (muted loop)
 * as the background; otherwise an authored youtube shows the poster photo as
 * a static background, and the bare default falls back to the Rhodes clip.
 * The centered play button opens the full video (youtube) in a modal.
 * @param {Element[]} cells the row's cells
 * @param {{caption?:boolean}} [opts] when caption is false the in-frame
 *   caption is omitted (the switcher renders a shared caption bar instead)
 * @returns {HTMLDivElement} the `.video-frame`
 */
export function buildVideoFrame(cells, opts = {}) {
  const { caption = true } = opts;
  const [posterCell, eyebrowCell, quoteCell, attrCell, youtubeCell, mp4Cell, logoCell] = cells;
  const authoredYoutube = youtubeCell ? youtubeCell.textContent.trim() : '';
  const youtubeId = ytId(authoredYoutube) || authoredYoutube || STORY_YOUTUBE_ID;
  const mp4Link = mp4Cell ? mp4Cell.querySelector('a[href*=".mp4"]') : null;

  const frame = document.createElement('div');
  frame.className = 'video-frame';
  const posterImg = posterCell ? posterCell.querySelector('img') : null;

  let bg;
  if (mp4Link) {
    bg = document.createElement('video');
    bg.className = 'video-bg';
    bg.setAttribute('src', mp4Link.getAttribute('href'));
    if (posterImg) bg.poster = posterImg.currentSrc || posterImg.src;
    bg.muted = true;
    bg.loop = true;
    bg.autoplay = true;
    bg.playsInline = true;
    bg.setAttribute('aria-hidden', 'true');
  } else if (authoredYoutube) {
    // no cutdown mp4 for this story — show the poster photo as a static
    // background instead of faking a muted autoplay loop.
    bg = posterImg ? posterImg.cloneNode(true) : document.createElement('img');
    bg.className = 'video-bg';
    bg.setAttribute('aria-hidden', 'true');
  } else {
    bg = document.createElement('video');
    bg.className = 'video-bg';
    bg.src = STORY_VIDEO_SRC;
    if (posterImg) bg.poster = posterImg.currentSrc || posterImg.src;
    bg.muted = true;
    bg.loop = true;
    bg.autoplay = true;
    bg.playsInline = true;
    bg.setAttribute('aria-hidden', 'true');
  }

  const logoImg = logoCell ? logoCell.querySelector('img') : null;
  const play = document.createElement('button');
  play.className = 'video-play';
  play.type = 'button';
  play.setAttribute('aria-label', 'Play full video');
  play.textContent = '▶';
  play.addEventListener('click', () => openVideoModal(youtubeId));

  const parts = [];
  if (logoImg) { logoImg.classList.add('video-logo'); parts.push(logoImg); }
  parts.push(bg, play);
  if (caption) {
    const cap = document.createElement('div');
    cap.className = 'video-caption';
    cap.innerHTML = `
      <p class="video-eyebrow">${eyebrowCell ? eyebrowCell.textContent.trim() : ''}</p>
      <p class="video-quote">${quoteCell ? quoteCell.textContent.trim() : ''}</p>`;
    const attr = document.createElement('p');
    attr.className = 'video-attr';
    if (attrCell) attr.innerHTML = attrCell.innerHTML;
    cap.append(attr);
    parts.push(cap);
  }
  frame.append(...parts);
  if (bg.tagName === 'VIDEO') {
    // autoplay may be blocked or unimplemented (jsdom) — swallow either way
    try { const p = bg.play(); if (p && p.catch) p.catch(() => {}); } catch { /* noop */ }
  }
  return frame;
}

// Per-story caption data for the shared switcher info bar.
function storyData(cells) {
  const [posterCell, eyebrowCell, quoteCell, attrCell] = cells;
  const posterImg = posterCell ? posterCell.querySelector('img') : null;
  return {
    avatarSrc: posterImg ? (posterImg.currentSrc || posterImg.getAttribute('src')) : '',
    avatarAlt: posterImg ? (posterImg.getAttribute('alt') || '') : '',
    eyebrow: eyebrowCell ? eyebrowCell.textContent.trim() : '',
    quote: quoteCell ? quoteCell.textContent.trim() : '',
    attrHtml: attrCell ? attrCell.innerHTML : '',
  };
}

// The translucent, blurred bottom info bar shared by the switcher: active
// story avatar + eyebrow/quote/attribution, with the thumbnail tabs on the
// right. Content is (re)populated by fillCaption on switch.
function buildCaption() {
  const cap = document.createElement('div');
  cap.className = 'video-caption';
  cap.innerHTML = `
    <img class="video-avatar" alt="">
    <div class="video-caption-text">
      <p class="video-eyebrow"></p>
      <p class="video-quote"></p>
      <p class="video-attr"></p>
    </div>`;
  return cap;
}

function fillCaption(cap, d) {
  const avatar = cap.querySelector('.video-avatar');
  avatar.hidden = !d.avatarSrc;
  if (d.avatarSrc) { avatar.src = d.avatarSrc; avatar.alt = d.avatarAlt; }
  cap.querySelector('.video-eyebrow').textContent = d.eyebrow;
  cap.querySelector('.video-quote').textContent = d.quote;
  cap.querySelector('.video-attr').innerHTML = d.attrHtml;
}

function buildThumb(row, index, frameId) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'video-thumb';
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
  btn.setAttribute('aria-controls', frameId);
  btn.tabIndex = index === 0 ? 0 : -1;
  const src = row.querySelector('img');
  if (src) {
    const img = document.createElement('img');
    img.src = src.currentSrc || src.getAttribute('src');
    img.alt = src.getAttribute('alt') || '';
    btn.append(img);
  }
  return btn;
}

/**
 * Adaptive video-testimonial builder. One story row → a bare frame (in-frame
 * caption). Two or more rows → a `.video-switcher`: all frames stacked in a
 * `.video-stage` (only the active one shown) plus a shared translucent info
 * bar (`.video-caption`) holding the active story's avatar + eyebrow/quote/
 * attribution and the speaker-avatar thumbnail tabs that switch stories.
 * @param {Element[]} rows the block's `:scope > div` story rows
 * @returns {HTMLElement} a `.video-frame` (single) or `.video-switcher` (many)
 */
export function buildVideoSection(rows) {
  if (rows.length <= 1) return buildVideoFrame([...(rows[0]?.children || [])]);

  const stories = rows.map((r) => [...r.children]);
  const frames = stories.map((cells, i) => {
    const f = buildVideoFrame(cells, { caption: false });
    f.id = `video-story-${i}`;
    f.classList.toggle('is-active', i === 0);
    return f;
  });
  const stage = document.createElement('div');
  stage.className = 'video-stage';
  stage.append(...frames);

  const data = stories.map(storyData);
  const bar = buildCaption();
  fillCaption(bar, data[0]);

  const thumbs = rows.map((r, i) => buildThumb(r, i, frames[i].id));
  const thumbsWrap = document.createElement('div');
  thumbsWrap.className = 'video-thumbs';
  thumbsWrap.setAttribute('role', 'tablist');
  thumbsWrap.setAttribute('aria-label', 'Customer stories');
  thumbsWrap.append(...thumbs);
  bar.append(thumbsWrap);

  function activate(idx) {
    thumbs.forEach((t, i) => {
      t.setAttribute('aria-selected', i === idx ? 'true' : 'false');
      t.tabIndex = i === idx ? 0 : -1;
    });
    frames.forEach((f, i) => f.classList.toggle('is-active', i === idx));
    fillCaption(bar, data[idx]);
  }
  thumbsWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.video-thumb');
    if (btn) activate(thumbs.indexOf(btn));
  });
  thumbsWrap.addEventListener('keydown', (e) => {
    const cur = thumbs.indexOf(document.activeElement);
    if (cur === -1) return;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (cur + 1) % thumbs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (cur - 1 + thumbs.length) % thumbs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = thumbs.length - 1;
    if (next === null) return;
    e.preventDefault();
    activate(next);
    thumbs[next].focus();
  });

  const section = document.createElement('div');
  section.className = 'video-switcher';
  section.append(stage, bar);
  return section;
}

export default function decorate(block) {
  if (block.classList.contains('card')) {
    const figures = [...block.querySelectorAll(':scope > div')].map(buildCard);
    block.replaceChildren(...figures);
    return;
  }

  if (block.classList.contains('video')) {
    const rows = [...block.querySelectorAll(':scope > div')];
    if (!rows.length) return;
    block.replaceChildren(buildVideoSection(rows));
    return;
  }

  const row = block.querySelector(':scope > div');
  if (!row) return;
  const cells = [...row.children];

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
