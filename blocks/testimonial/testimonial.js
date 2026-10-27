/**
 * testimonial — customer proof (index video, compare quote).
 * Section head (h2) is normally authored as default content before the
 * block. If instead a heading (h1-h4) is authored as the first element of
 * the default/compare or .video variant's content cell, it's promoted and
 * rendered above the block rather than being dropped.
 *
 * Default (compare) — 1-2 cells:
 *   1. content (required) — an optional leading heading, quote paragraph(s),
 *      a bold-only line for the name, then plain role paragraph(s)
 *   2. headshot <img> (optional)
 * The quote-mark glyph is decorative and lives in CSS, not authored content.
 *
 * Variant .card (migration rationale / account testimonials) — one or more
 * rows, each row a card with 1-2 cells:
 *   1. photo <img> (optional)   2. content (quote, bold name, plain title)
 *   .card.feature (Figma ACQ-4698 "An accountant's perspective") — one row,
 *   photo left on a Superblue band, copy right. Same cells; additionally an
 *   italic-only line renders as the eyebrow, the first plain paragraph after
 *   the bold name is the role, and any further paragraphs are a footnote.
 *   .card.feature.ies — IES retheme, same rows. An optional first row with a
 *   single heading cell becomes the section title; 2+ cards render as a carousel.
 *
 * Variant .story (Figma ACQ-4698 "Desktop migration story") — one or more
 * rows, each a dark Blueberry card: copy left, media tile right. 2-3 cells:
 *   1. content — an optional italic-only eyebrow, a heading (h2-h4), quote
 *      paragraph(s), a bold-only name line, a plain role line, and an
 *      optional bold link paragraph that becomes the CTA button
 *   2. media — one image: the DAM "feature" asset, which already carries the
 *      Superblue tile, inset photo and customer logo
 *   3. disclaimer (optional) — legal copy as a band across the card foot
 *   2+ rows render as a carousel (same controls as .card.carousel).
 *   .story.video-cta — video CTAs open in a modal.
 *
 * Variant .video (index) — one or more rows, each row 1-2 cells:
 *   1. media — poster <img>, optionally a second image (customer logo)
 *   2. content (required) — an optional leading heading (first row only),
 *      an optional italic-only eyebrow line, quote paragraph(s), an
 *      attribution paragraph (may hold a trailing link to the case study),
 *      and the mp4/YouTube video source(s), each authored as its own link
 *      or bare URL/id, detected by pattern rather than position. Falls back
 *      to the Rhodes Companies story clip when no video source is authored
 *      at all.
 *   .video.ies — IES retheme; an optional first row with a single heading
 *   cell becomes the section title.
 *
 * Variant .video-split (professional-services) — copy left, video right on a
 * tinted band. One row, 3 cells:
 *   1. media — poster <img> plus a trailing caption line
 *   2. content — a heading tag and body paragraph(s)
 *   3. video URL/id (isolated — a config-shaped value, not prose)
 * CSS: blocks/testimonial/testimonial.css
 */

import { trackAs } from '../../scripts/tracking.js';
import { openVideoModal } from '../../scripts/scripts.js';
import { videoInfo } from '../video/video-info.js';

function pic(cell) {
  if (!cell) return null;
  const p = cell.querySelector('picture, img');
  return p ? (p.closest('picture') || p) : null;
}

// Preserves the authored heading level (h1-h6) to maintain document hierarchy.
function extractHeading(cell) {
  const first = cell?.firstElementChild;
  if (!first || !/^H[1-6]$/.test(first.tagName)) return null;
  const tag = first.tagName.toLowerCase();
  first.remove();
  const h = document.createElement(tag);
  h.className = 'testimonial-heading';
  h.innerHTML = first.innerHTML;
  return h;
}

// .ies: a leading one-cell heading row becomes the section title
function takeHeadingRow(rows) {
  const cells = rows[0] ? [...rows[0].children] : [];
  if (cells.length !== 1 || pic(cells[0])) return null;
  const src = cells[0].querySelector('h1, h2, h3, h4, h5, h6');
  if (!src) return null;
  rows.shift();
  const h = document.createElement('h2');
  h.className = 'testimonial-heading';
  h.innerHTML = src.innerHTML;
  return h;
}

// Rhodes Companies customer story — same cutdown clip + YouTube id erp.intuit.com plays.
const STORY_VIDEO_SRC = 'https://erp.intuit.com/oidam/intuit/erp/en_us/web/motion-and-video/case-study-rhodes-cutdown-video-ies-us-en-sm.mp4';
const STORY_YOUTUBE_ID = 'gpHd4jd6dTk';

// Build the autoplay embed URL for a bare YouTube id, then hand off to the
// shared modal opener (scripts.js).
const playVideo = (videoId) => openVideoModal(`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`, 'Customer story video');

const VIDEO_PLAY_MARGIN = '200px 0px';

// autoplay may be blocked or unimplemented (jsdom) — swallow either way
function safePlay(video) {
  try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch { /* noop */ }
}

// Plays only the active clip while `root` is near the viewport; returns a re-sync fn.
function autoplayInView(root, activeVideo) {
  let inView = !window.IntersectionObserver;
  const sync = () => {
    const active = activeVideo();
    root.querySelectorAll('video.video-bg').forEach((v) => {
      if (inView && v === active) safePlay(v);
      else if (!v.paused) v.pause();
    });
  };
  if (window.IntersectionObserver) {
    new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    }, { rootMargin: VIDEO_PLAY_MARGIN }).observe(root);
  }
  sync();
  return sync;
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
  let cite = '';
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
      // an italic-only line is the citation (the .simple variant renders it as <cite>)
      if (!cite && only?.tagName === 'EM' && text === only.textContent.trim()) {
        cite = text;
        return;
      }
      (name ? roleParas : quoteParas).push(node);
    });
  }
  return {
    quoteParas, name, roleParas, cite,
  };
}

function buildCard(row, { feature = false } = {}) {
  const [photoCell, contentCell] = [...row.children];
  const figure = document.createElement('figure');
  figure.className = 'testimonial-card';

  const media = pic(photoCell);
  if (media) {
    const img = media.tagName === 'IMG' ? media : media.querySelector('img');
    if (img) img.classList.add('testimonial-photo');
    figure.append(media);
  }

  const {
    quoteParas, name, roleParas, cite,
  } = parseQuote(contentCell);
  if (feature && cite) {
    const eyebrow = document.createElement('p');
    eyebrow.className = 'testimonial-eyebrow';
    eyebrow.textContent = cite;
    figure.append(eyebrow);
  }
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
  // .feature keeps only the first role line as the title; the rest is a footnote
  const titleParas = feature ? roleParas.slice(0, 1) : roleParas;
  const title = titleParas.map((p) => p.textContent.trim()).filter(Boolean).join(', ');
  if (title) {
    const titleEl = document.createElement('p');
    titleEl.className = 'testimonial-title';
    titleEl.textContent = title;
    figcaption.append(titleEl);
  }
  figure.append(figcaption);

  if (feature && roleParas.length > 1) {
    const note = document.createElement('p');
    note.className = 'testimonial-footnote';
    note.innerHTML = roleParas.slice(1).map((p) => p.innerHTML).join('<br>');
    figure.append(note);
  }

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
 * @param {{caption?:boolean, autoplay?:boolean}} [opts] when caption is false the
 *   in-frame caption is omitted (the switcher renders a shared caption bar instead);
 *   autoplay false leaves playback to the caller
 * @returns {HTMLDivElement} the `.video-frame`
 */
export function buildVideoFrame(cells, opts = {}) {
  const { caption = true, autoplay = true } = opts;
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
    bg.preload = 'none';
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
    bg.preload = 'none';
    bg.playsInline = true;
    bg.setAttribute('aria-hidden', 'true');
  }

  const play = document.createElement('button');
  play.className = 'video-play';
  play.type = 'button';
  play.setAttribute('aria-label', 'Play full video');
  play.textContent = '▶';
  play.addEventListener('click', () => playVideo(youtubeId));

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
  if (autoplay && bg.tagName === 'VIDEO') autoplayInView(frame, () => bg);
  return frame;
}

function attributionHtml(attribution) {
  if (!attribution) return '';
  const p = attribution.cloneNode(true);
  const lead = p.firstChild;
  if (lead?.nodeType !== Node.TEXT_NODE) return p.innerHTML;
  const text = lead.textContent;
  const comma = text.indexOf(',');
  if (comma === -1 || !text.slice(0, comma).trim()) return p.innerHTML;
  const name = document.createElement('span');
  name.className = 'video-name';
  name.textContent = text.slice(0, comma).trim();
  const role = document.createElement('span');
  role.className = 'video-role';
  role.textContent = text.slice(comma + 1).trim();
  lead.replaceWith(name, ', ', role, ' ');
  return p.innerHTML;
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
    attrHtml: attributionHtml(attribution),
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
 * @param {{ies?:boolean}} [opts] ies: hide the active thumb, add dots and swipe
 * @returns {HTMLElement} a `.video-frame`, `.video-switcher` or `.video-carousel`
 */
export function buildVideoSection(rows, opts = {}) {
  const { ies = false } = opts;
  if (rows.length <= 1) return buildVideoFrame([...(rows[0]?.children || [])]);

  const stories = rows.map((r) => [...r.children]);
  const frames = stories.map((cells, i) => {
    const f = buildVideoFrame(cells, { caption: false, autoplay: false });
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

  const dots = ies ? rows.map((r, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'video-dot';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-controls', frames[i].id);
    dot.setAttribute('aria-label', `Show customer story ${i + 1} of ${rows.length}`);
    return dot;
  }) : [];

  let current = 0;
  let syncPlayback = () => {};
  function activate(idx) {
    current = idx;
    const focusable = ies ? thumbs.findIndex((t, i) => i !== idx) : idx;
    thumbs.forEach((t, i) => {
      t.setAttribute('aria-selected', i === idx ? 'true' : 'false');
      t.tabIndex = i === focusable ? 0 : -1;
      if (ies) t.hidden = i === idx;
    });
    dots.forEach((d, i) => {
      d.classList.toggle('is-active', i === idx);
      d.setAttribute('aria-selected', i === idx ? 'true' : 'false');
      d.tabIndex = i === idx ? 0 : -1;
    });
    frames.forEach((f, i) => f.classList.toggle('is-active', i === idx));
    fillCaption(bar, data[idx]);
    syncPlayback();
  }
  thumbsWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.video-thumb');
    if (!btn) return;
    const hadFocus = btn === document.activeElement;
    activate(thumbs.indexOf(btn));
    if (ies && hadFocus) thumbs.find((t) => !t.hidden)?.focus();
  });
  thumbsWrap.addEventListener('keydown', (e) => {
    const visible = thumbs.filter((t) => !t.hidden);
    const cur = visible.indexOf(document.activeElement);
    if (cur === -1) return;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (cur + 1) % visible.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (cur - 1 + visible.length) % visible.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = visible.length - 1;
    if (next === null) return;
    e.preventDefault();
    if (ies) {
      visible.forEach((t, i) => { t.tabIndex = i === next ? 0 : -1; });
      visible[next].focus();
      return;
    }
    activate(thumbs.indexOf(visible[next]));
    visible[next].focus();
  });

  const section = document.createElement('div');
  section.className = 'video-switcher';
  section.append(stage, bar);
  syncPlayback = autoplayInView(stage, () => frames[current].querySelector('video.video-bg'));
  if (!ies) {
    activate(0);
    return section;
  }

  const dotsWrap = document.createElement('div');
  dotsWrap.className = 'video-dots';
  dotsWrap.setAttribute('role', 'tablist');
  dotsWrap.setAttribute('aria-label', 'Customer stories');
  dotsWrap.append(...dots);
  dots.forEach((d, i) => d.addEventListener('click', () => activate(i)));
  dotsWrap.addEventListener('keydown', (e) => {
    let next = null;
    if (e.key === 'ArrowRight') next = (current + 1) % dots.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + dots.length) % dots.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = dots.length - 1;
    if (next === null) return;
    e.preventDefault();
    activate(next);
    dots[next].focus();
  });

  let startX = null;
  stage.addEventListener('pointerdown', (e) => { startX = e.clientX; });
  stage.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) <= 40) return;
    activate((current + (dx < 0 ? 1 : -1) + frames.length) % frames.length);
  });
  stage.addEventListener('pointercancel', () => { startX = null; });

  activate(0);
  const carousel = document.createElement('div');
  carousel.className = 'video-carousel';
  carousel.append(section, dotsWrap);
  return carousel;
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
  const heading = contentCell ? contentCell.querySelector('h1, h2, h3, h4, h5, h6') : null;
  if (heading) {
    const tag = heading.tagName.toLowerCase();
    const h = document.createElement(tag);
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
    play.addEventListener('click', () => playVideo(youtubeId));
    media.append(play);
  }

  grid.append(copy, media);
  return grid;
}

/**
 * Wraps card figures into a one-at-a-time carousel with dot pagination + prev/
 * next arrows and horizontal swipe, matching production's single-view
 * testimonial slider. Opt-in via the `.carousel` variant on a `.testimonial.card`
 * block; a single card renders as-is with no controls.
 * @param {HTMLElement[]} figures the `.testimonial-card` elements
 * @returns {HTMLElement} the carousel wrapper
 */
function buildCardCarousel(figures) {
  const wrap = document.createElement('div');
  wrap.className = 'testimonial-carousel';

  const viewport = document.createElement('div');
  viewport.className = 'testimonial-carousel-viewport';
  const track = document.createElement('div');
  track.className = 'testimonial-carousel-track';
  track.append(...figures);
  viewport.append(track);
  wrap.append(viewport);

  if (figures.length <= 1) return wrap;

  // carousel semantics for screen readers (mirrors blocks/carousel)
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-roledescription', 'carousel');
  wrap.setAttribute('aria-label', 'Customer testimonials');
  figures.forEach((f, i) => {
    f.setAttribute('role', 'group');
    f.setAttribute('aria-roledescription', 'slide');
    f.setAttribute('aria-label', `${i + 1} of ${figures.length}`);
  });

  const nav = document.createElement('div');
  nav.className = 'testimonial-carousel-nav';

  const dotsWrap = document.createElement('div');
  dotsWrap.className = 'testimonial-dots';
  dotsWrap.setAttribute('role', 'tablist');
  dotsWrap.setAttribute('aria-label', 'Customer testimonials');

  let index = 0;
  const dots = figures.map((fig, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'testimonial-dot';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `Show testimonial ${i + 1} of ${figures.length}`);
    return dot;
  });
  dotsWrap.append(...dots);

  // icon path is codeBasePath-prefixed — EDS isn't guaranteed to be root-served
  const iconBase = `${window.hlx?.codeBasePath || ''}/icons`;
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'testimonial-arrow testimonial-prev';
  prev.setAttribute('aria-label', 'Previous testimonial');
  prev.style.setProperty('--tc-chevron', `url("${iconBase}/chevron-left.svg")`);

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'testimonial-arrow testimonial-next';
  next.setAttribute('aria-label', 'Next testimonial');
  next.style.setProperty('--tc-chevron', `url("${iconBase}/chevron-right.svg")`);

  nav.append(dotsWrap, prev, next);
  wrap.append(nav);

  const go = (i) => {
    index = Math.max(0, Math.min(i, figures.length - 1));
    track.style.transform = `translateX(-${index * 100}%)`;
    dots.forEach((d, di) => {
      d.classList.toggle('is-active', di === index);
      d.setAttribute('aria-selected', di === index ? 'true' : 'false');
      d.tabIndex = di === index ? 0 : -1;
    });
    figures.forEach((f, fi) => { f.inert = fi !== index; });
    prev.disabled = index === 0;
    next.disabled = index === figures.length - 1;
  };

  dots.forEach((d, i) => d.addEventListener('click', () => go(i)));
  prev.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index + 1));
  dotsWrap.addEventListener('keydown', (e) => {
    let target = null;
    if (e.key === 'ArrowRight') target = index + 1;
    else if (e.key === 'ArrowLeft') target = index - 1;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = figures.length - 1;
    if (target === null) return;
    e.preventDefault();
    go(target);
    dots[index].focus();
  });

  // horizontal swipe
  let startX = null;
  viewport.addEventListener('pointerdown', (e) => { startX = e.clientX; });
  viewport.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
    startX = null;
  });
  // an interrupted gesture (scroll/back-nav hijack) fires pointercancel, not
  // pointerup — reset so a later tap doesn't compute dx against a stale startX
  viewport.addEventListener('pointercancel', () => { startX = null; });

  go(0);
  return wrap;
}

// .story.video-cta: video CTAs open in the modal instead of navigating
function toVideoButton(a) {
  const info = videoInfo(a.getAttribute('href'));
  if (!info) return a;
  const btn = document.createElement('button');
  btn.type = 'button';
  [...a.attributes].forEach((attr) => {
    if (!['href', 'target', 'rel'].includes(attr.name)) btn.setAttribute(attr.name, attr.value);
  });
  btn.textContent = a.textContent.trim();
  btn.setAttribute('data-video-src', a.getAttribute('href'));
  btn.addEventListener('click', () => openVideoModal(info.embedUrl, btn.textContent));
  return btn;
}

function buildStory(row, { videoModal = false } = {}) {
  const [contentCell, mediaCell, noteCell] = [...row.children];
  const figure = document.createElement('figure');
  figure.className = 'testimonial-card story-card';

  const copy = document.createElement('div');
  copy.className = 'story-copy';

  // peel off the parts parseQuote doesn't model, then let it handle the rest
  let eyebrowText = '';
  let headingEl = null;
  let ctaLink = null;
  if (contentCell) {
    [...contentCell.children].forEach((node) => {
      if (!headingEl && /^H[1-6]$/.test(node.tagName)) {
        const tag = node.tagName.toLowerCase();
        headingEl = document.createElement(tag);
        headingEl.className = 'story-title';
        headingEl.innerHTML = node.innerHTML;
        node.remove();
        return;
      }
      if (node.tagName !== 'P') return;
      const only = node.children.length === 1 ? node.children[0] : null;
      const text = node.textContent.trim();
      if (!eyebrowText && only?.tagName === 'EM' && text === only.textContent.trim()) {
        eyebrowText = text;
        node.remove();
        return;
      }
      // CTA: an authored bold link, already decorated by scripts.js decorateButtons
      if (!ctaLink && node.classList.contains('button-wrapper') && only?.tagName === 'A') {
        ctaLink = only;
        node.remove();
      }
    });
  }

  if (eyebrowText) {
    const eb = document.createElement('p');
    eb.className = 'story-eyebrow';
    eb.textContent = eyebrowText;
    copy.append(eb);
  }
  if (headingEl) copy.append(headingEl);

  const { quoteParas, name, roleParas } = parseQuote(contentCell);
  const quote = document.createElement('blockquote');
  quote.className = 'story-quote';
  quoteParas.forEach((p) => {
    const q = document.createElement('p');
    q.innerHTML = p.innerHTML;
    quote.append(q);
  });
  copy.append(quote);

  const figcaption = document.createElement('figcaption');
  figcaption.className = 'story-attr';
  if (name) {
    const n = document.createElement('span');
    n.className = 'testimonial-name';
    n.textContent = name;
    figcaption.append(n);
  }
  const role = roleParas.map((p) => p.textContent.trim()).filter(Boolean).join(', ');
  if (role) {
    const r = document.createElement('span');
    r.className = 'testimonial-title';
    r.textContent = role;
    figcaption.append(r);
  }
  if (figcaption.childElementCount) copy.append(figcaption);

  if (ctaLink) {
    const wrap = document.createElement('p');
    wrap.className = 'button-wrapper';
    wrap.append(videoModal ? toVideoButton(ctaLink) : ctaLink);
    copy.append(wrap);
  }
  figure.append(copy);

  const media = pic(mediaCell);
  if (media) {
    const img = media.tagName === 'IMG' ? media : media.querySelector('img');
    img.classList.add('testimonial-photo');
    img.loading = 'lazy';
    const tile = document.createElement('div');
    tile.className = 'story-media';
    tile.append(media);
    figure.append(tile);
  }

  if (noteCell && noteCell.textContent.trim()) {
    const note = document.createElement('p');
    note.className = 'story-disclaimer';
    const paras = [...noteCell.querySelectorAll('p')];
    note.innerHTML = paras.length
      ? paras.map((p) => p.innerHTML).join('<br>')
      : noteCell.innerHTML;
    figure.append(note);
  }

  return figure;
}

export default function decorate(block) {
  // Customer proof -> rw_testimonial trail; each story card/frame is an
  // rw_testimonial_item slot (the carousel dots stay at the block level). link_name off.
  const track = () => trackAs('rw_testimonial', block, {
    key: 'testimonial',
    linkName: false,
    items: { '.testimonial-card, .video-frame': 'rw_testimonial_item' },
  });
  if (block.classList.contains('card')) {
    const feature = block.classList.contains('feature');
    const ies = block.classList.contains('ies');
    const rows = [...block.querySelectorAll(':scope > div')];
    const heading = ies ? takeHeadingRow(rows) : null;
    const figures = rows.map((row) => buildCard(row, { feature }));
    const carousel = block.classList.contains('carousel') || (ies && figures.length > 1);
    const body = carousel ? [buildCardCarousel(figures)] : figures;
    block.replaceChildren(...(heading ? [heading] : []), ...body);
    track();
    return;
  }

  if (block.classList.contains('story')) {
    const rows = [...block.querySelectorAll(':scope > div')];
    if (!rows.length) return;
    const videoModal = block.classList.contains('video-cta');
    const figures = rows.map((row) => buildStory(row, { videoModal }));
    block.replaceChildren(figures.length > 1 ? buildCardCarousel(figures) : figures[0]);
    track();
    return;
  }

  if (block.classList.contains('video-split')) {
    const row = block.querySelector(':scope > div');
    if (!row) return;
    block.replaceChildren(buildVideoSplit([...row.children]));
    track();
    return;
  }

  if (block.classList.contains('video')) {
    const rows = [...block.querySelectorAll(':scope > div')];
    // .video.ies: an optional first row with a single heading cell becomes the section title
    const titleRow = block.classList.contains('ies') ? takeHeadingRow(rows) : null;
    if (!rows.length) return;
    const heading = titleRow || extractHeading(rows[0].children[1]);
    const section = buildVideoSection(rows, { ies: block.classList.contains('ies') });
    block.replaceChildren(...(heading ? [heading] : []), section);
    track();
    return;
  }

  const row = block.querySelector(':scope > div');
  if (!row) return;
  const [contentCell, mediaCell] = [...row.children];
  const heading = extractHeading(contentCell);

  const {
    quoteParas, name, roleParas, cite,
  } = parseQuote(contentCell);
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
  if (cite) {
    const citeEl = document.createElement('cite');
    citeEl.className = 'cmp-quote-cite';
    citeEl.textContent = cite;
    card.append(citeEl);
  }
  grid.append(card);
  const media = document.createElement('div');
  media.className = 'cmp-testi-media';
  const headshot = pic(mediaCell);
  if (headshot) media.append(headshot);
  grid.append(media);
  block.replaceChildren(...(heading ? [heading] : []), grid);
  track();
}
