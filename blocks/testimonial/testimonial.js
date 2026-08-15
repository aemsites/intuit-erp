/**
 * testimonial — customer proof (index video, compare quote).
 * Section head (h2) authored as default content before the block.
 *
 * Default (compare) — 1-2 cells:
 *   1. content (required) — quote paragraph(s), a bold-only line for the
 *      name, then plain role paragraph(s)
 *   2. headshot <img> (optional)
 * The quote-mark glyph is decorative and lives in CSS, not authored content.
 *
 * Variant .card (migration rationale / account testimonials) — one or more
 * rows, each row a card with 1-2 cells:
 *   1. photo <img> (optional)   2. content (quote, bold name, plain title)
 *
 * Variant .video (index) — one or more rows, each row 1-2 cells:
 *   1. media — poster <img>, optionally a second image (customer logo)
 *   2. content (required) — an optional italic-only eyebrow line, quote
 *      paragraph(s), an attribution paragraph (may hold a trailing link to
 *      the case study), and the mp4/YouTube video source(s), each authored
 *      as its own link or bare URL/id, detected by pattern rather than
 *      position. Falls back to the Rhodes Companies story clip when no
 *      video source is authored at all.
 *
 * Variant .video-split (professional-services) — copy left, video right on a
 * tinted band. One row, 3 cells:
 *   1. media — poster <img> plus a trailing caption line
 *   2. content — a heading tag and body paragraph(s)
 *   3. video URL/id (isolated — a config-shaped value, not prose)
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

// Parse a YouTube watch/short/embed URL into its id; '' if not a URL (a bare
// id authored directly is returned as-is by the caller's fallback).
function ytId(url) {
  if (!url) return '';
  const m = url.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  return m ? m[1] : '';
}

// quote (+ optional name/role) flowing cell, shared by the default and .card
// variants: name is the bold-only line; everything before it is the quote,
// everything after is the role/title.
function parseQuote(cell) {
  let name = '';
  const quoteParas = [];
  const roleParas = [];
  if (cell) {
    [...cell.children].forEach((node) => {
      if (node.tagName !== 'P') return;
      const text = node.textContent.trim();
      if (!text) return;
      const only = node.children.length === 1 ? node.children[0] : null;
      if (!name && only?.tagName === 'STRONG' && text === only.textContent.trim()) {
        name = text;
        return;
      }
      (name ? roleParas : quoteParas).push(node);
    });
  }
  return { quoteParas, name, roleParas };
}

function buildCard(row) {
  const [photoCell, contentCell] = [...row.children];
  const figure = document.createElement('figure');
  figure.className = 'testimonial-card';

  const media = pic(photoCell);
  if (media) {
    const img = media.tagName === 'IMG' ? media : media.querySelector('img');
    if (img) img.classList.add('testimonial-photo');
    figure.append(media);
  }

  const { quoteParas, name, roleParas } = parseQuote(contentCell);
  const quote = document.createElement('blockquote');
  quoteParas.forEach((p) => {
    const q = document.createElement('p');
    q.innerHTML = p.innerHTML;
    quote.append(q);
  });
  figure.append(quote);

  const figcaption = document.createElement('figcaption');
  if (name) {
    const nameEl = document.createElement('p');
    nameEl.className = 'testimonial-name';
    nameEl.textContent = name;
    figcaption.append(nameEl);
  }
  const title = roleParas.map((p) => p.textContent.trim()).filter(Boolean).join(', ');
  if (title) {
    const titleEl = document.createElement('p');
    titleEl.className = 'testimonial-title';
    titleEl.textContent = title;
    figcaption.append(titleEl);
  }
  figure.append(figcaption);

  return figure;
}

// flowing content cell for .video: optional italic-only eyebrow, quote
// paragraph(s), an attribution paragraph (holds a link but isn't link-only),
// and the mp4/YouTube source(s) — each its own link or bare URL/id,
// detected by pattern rather than position.
function parseVideoContent(cell) {
  let eyebrow = '';
  let attribution = null;
  let mp4Href = '';
  let youtubeRaw = '';
  const quoteParas = [];
  if (cell) {
    [...cell.children].forEach((node) => {
      if (node.tagName !== 'P') return;
      const text = node.textContent.trim();
      if (!text) return;
      const only = node.children.length === 1 ? node.children[0] : null;
      if (!eyebrow && only?.tagName === 'EM' && text === only.textContent.trim()) {
        eyebrow = text;
        return;
      }
      if (only?.tagName === 'A' && text === only.textContent.trim()) {
        const href = only.getAttribute('href') || '';
        if (/\.mp4(?:$|\?)/i.test(href)) { mp4Href = href; return; }
        youtubeRaw = href;
        return;
      }
      // a bare YouTube URL, or just its bare id, authored as its own line
      if (!youtubeRaw && !node.querySelector('a')
        && (/youtube|youtu\.be/i.test(text) || /^[\w-]{6,}$/.test(text))) {
        youtubeRaw = text;
        return;
      }
      if (node.querySelector('a')) { attribution = node; return; }
      quoteParas.push(node);
    });
  }
  return {
    eyebrow, quoteParas, attribution, mp4Href, youtubeRaw,
  };
}

/**
 * Builds one video story frame from a row's [media, content] cells.
 * When an mp4 source is authored the frame shows that clip inline (muted
 * loop) as the background; otherwise an authored YouTube shows the poster
 * photo as a static background, and no authored source at all falls back to
 * the Rhodes clip. The centered play button opens the full video in a modal.
 * @param {Element[]} cells the row's cells
 * @param {{caption?:boolean}} [opts] when caption is false the in-frame
 *   caption is omitted (the switcher renders a shared caption bar instead)
 * @returns {HTMLDivElement} the `.video-frame`
 */
export function buildVideoFrame(cells, opts = {}) {
  const { caption = true } = opts;
  const [mediaCell, contentCell] = cells;
  const imgs = mediaCell ? [...mediaCell.querySelectorAll('img')] : [];
  const posterImg = imgs[0];
  const logoImg = imgs[1];
  const logoEl = logoImg ? (logoImg.closest('picture') || logoImg) : null;

  const {
    eyebrow, quoteParas, attribution, mp4Href, youtubeRaw,
  } = parseVideoContent(contentCell);
  const youtubeId = ytId(youtubeRaw) || youtubeRaw || STORY_YOUTUBE_ID;

  const frame = document.createElement('div');
  frame.className = 'video-frame';

  let bg;
  if (mp4Href) {
    bg = document.createElement('video');
    bg.className = 'video-bg';
    bg.setAttribute('src', mp4Href);
    if (posterImg) bg.poster = posterImg.currentSrc || posterImg.src;
    bg.muted = true;
    bg.loop = true;
    bg.autoplay = true;
    bg.playsInline = true;
    bg.setAttribute('aria-hidden', 'true');
  } else if (youtubeRaw) {
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

  const play = document.createElement('button');
  play.className = 'video-play';
  play.type = 'button';
  play.setAttribute('aria-label', 'Play full video');
  play.textContent = '▶';
  play.addEventListener('click', () => openVideoModal(youtubeId));

  const parts = [];
  if (logoEl) { logoEl.classList.add('video-logo'); parts.push(logoEl); }
  parts.push(bg, play);
  if (caption) {
    const cap = document.createElement('div');
    cap.className = 'video-caption';
    const eb = document.createElement('p');
    eb.className = 'video-eyebrow';
    eb.textContent = eyebrow;
    const q = document.createElement('p');
    q.className = 'video-quote';
    q.textContent = quoteParas.map((p) => p.textContent.trim()).join(' ');
    cap.append(eb, q);
    const attr = document.createElement('p');
    attr.className = 'video-attr';
    if (attribution) attr.innerHTML = attribution.innerHTML;
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
  const [mediaCell, contentCell] = cells;
  const posterEl = mediaCell ? mediaCell.querySelector('img') : null;
  const { eyebrow, quoteParas, attribution } = parseVideoContent(contentCell);
  return {
    avatarSrc: posterEl ? (posterEl.currentSrc || posterEl.getAttribute('src')) : '',
    avatarAlt: posterEl ? (posterEl.getAttribute('alt') || '') : '',
    eyebrow,
    quote: quoteParas.map((p) => p.textContent.trim()).join(' '),
    attrHtml: attribution ? attribution.innerHTML : '',
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

/**
 * Variant .video-split (professional-services) — copy left, video right on a
 * tinted band. Cells: 1. media (poster <img> + trailing caption line)
 * 2. content (heading tag + body) 3. video URL/id (isolated).
 */
function buildVideoSplit(cells) {
  const [mediaCell, contentCell, urlCell] = cells;

  const grid = document.createElement('div');
  grid.className = 'split-grid';

  const copy = document.createElement('div');
  copy.className = 'split-copy';
  const heading = contentCell ? contentCell.querySelector('h1, h2, h3, h4') : null;
  if (heading) {
    const h = document.createElement('h2');
    h.className = 'split-title';
    h.innerHTML = heading.innerHTML;
    copy.append(h);
  }
  if (contentCell) {
    contentCell.querySelectorAll('p').forEach((p) => {
      if (!p.textContent.trim()) return;
      const body = document.createElement('p');
      body.className = 'split-body';
      body.innerHTML = p.innerHTML;
      copy.append(body);
    });
  }

  const media = document.createElement('div');
  media.className = 'split-media';
  const poster = pic(mediaCell);
  if (poster) media.append(poster);
  if (mediaCell) {
    const withoutMedia = mediaCell.cloneNode(true);
    withoutMedia.querySelector('picture, img')?.remove();
    const captionText = withoutMedia.textContent.trim();
    if (captionText) {
      const cap = document.createElement('p');
      cap.className = 'split-caption';
      cap.textContent = captionText;
      media.append(cap);
    }
  }

  const authored = urlCell ? (urlCell.querySelector('a')?.getAttribute('href') || urlCell.textContent.trim()) : '';
  // a bare id is authorable directly, as in .video; anything else ytId can't read
  // is a misconfiguration — say so rather than render a poster that can't be played
  const youtubeId = ytId(authored) || (/^[\w-]{6,}$/.test(authored) ? authored : '');
  if (authored && !youtubeId) {
    // eslint-disable-next-line no-console
    console.warn('testimonial.video-split: not a YouTube URL or id, no play button:', authored);
  }
  if (youtubeId) {
    const play = document.createElement('button');
    play.className = 'split-play';
    play.type = 'button';
    play.setAttribute('aria-label', 'Play full video');
    play.textContent = '▶';
    play.addEventListener('click', () => openVideoModal(youtubeId));
    media.append(play);
  }

  grid.append(copy, media);
  return grid;
}

export default function decorate(block) {
  if (block.classList.contains('card')) {
    const figures = [...block.querySelectorAll(':scope > div')].map(buildCard);
    block.replaceChildren(...figures);
    return;
  }

  if (block.classList.contains('video-split')) {
    const row = block.querySelector(':scope > div');
    if (!row) return;
    block.replaceChildren(buildVideoSplit([...row.children]));
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
  const [contentCell, mediaCell] = [...row.children];

  const { quoteParas, name, roleParas } = parseQuote(contentCell);
  const grid = document.createElement('div');
  grid.className = 'cmp-testi-grid';
  const card = document.createElement('div');
  card.className = 'cmp-quote-card';
  const quote = document.createElement('blockquote');
  quote.className = 'cmp-quote';
  quoteParas.forEach((p) => {
    const q = document.createElement('p');
    q.innerHTML = p.innerHTML;
    quote.append(q);
  });
  card.append(quote);
  const nameEl = document.createElement('p');
  nameEl.className = 'cmp-quote-name';
  nameEl.textContent = name;
  const role = document.createElement('p');
  role.className = 'cmp-quote-role';
  role.textContent = roleParas.map((p) => p.textContent.trim()).filter(Boolean).join(', ');
  card.append(nameEl, role);
  grid.append(card);
  const media = document.createElement('div');
  media.className = 'cmp-testi-media';
  const headshot = pic(mediaCell);
  if (headshot) media.append(headshot);
  grid.append(media);
  block.replaceChildren(grid);
}
