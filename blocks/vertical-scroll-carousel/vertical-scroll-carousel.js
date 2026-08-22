/**
 * vertical-scroll-carousel — a click-driven "vertical tabs" story, matching
 * erp.intuit.com "Automate the routine…" (also construction; pricing "Why IES").
 *
 * A compact accordion sits on the left; a single shared media panel sits on the
 * right. Only the active item's body is expanded — its heading goes solid
 * (inactive ones are dimmed) and its card gets a border plus a blue leading bar
 * — and the shared media panel cross-fades to that item's media. There is no
 * scroll animation or pinning: the original is a static, click-operated tab set.
 *
 * Below 1024px the accordion and shared stage both collapse: every body is
 * expanded and each item's media renders inline beneath its own copy.
 *
 * Content model: each ROW = one item — cell0 = media (`<img>`/video link),
 * cell1 = heading, cell2 = body.
 *
 * Structure built: `.vsc-list` column of `.vsc-item` tabs (left) and ONE
 * `.vsc-stage` (right) holding every item's `.vsc-media`, absolutely stacked.
 * Each tab's heading is a `<button role="tab">`; the active tab AND its media
 * get `.is-active`. Both carry `--vsc-i` so mobile CSS can interleave them.
 *
 * `activate(list, index)` is a small pure helper — it only toggles `.is-active`
 * — so it is directly unit-testable. `decorate()` wires a click handler per tab
 * and works with no observers/timers at all.
 *
 * CSS: blocks/vertical-scroll-carousel/vertical-scroll-carousel.css
 */

import { MQ_DESKTOP_UP } from '../../scripts/breakpoints.js';

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

/**
 * Build one tab: a heading button (the clickable control) plus its always-visible
 * body. The button is wrapped in an `<h3>` so the item keeps its place in the
 * page's heading outline (matching upstream, which renders these as `<h3>`)
 * without losing the interactive tab control. Returns { item, heading }.
 */
function buildTab(headingCell, bodyCell, index) {
  const item = document.createElement('div');
  item.className = 'vsc-item';

  const heading = document.createElement('button');
  heading.type = 'button';
  heading.className = 'vsc-heading';
  heading.setAttribute('role', 'tab');
  heading.id = `vsc-tab-${index}`;
  heading.textContent = headingCell ? headingCell.textContent.trim() : '';

  const headingWrap = document.createElement('h3');
  headingWrap.className = 'vsc-heading-wrap';
  headingWrap.append(heading);
  item.append(headingWrap);

  if (bodyCell && bodyCell.textContent.trim()) {
    const body = document.createElement('div');
    body.className = 'vsc-body';
    [...bodyCell.childNodes].forEach((n) => body.append(n));
    item.append(body);
  }

  return { item, heading };
}

/**
 * Pure helper: mark only `elements[index]` as active. No event / DOM-observation
 * dependency, so it is safe to call directly in tests or from a click handler.
 * @param {Element[]} elements the elements to toggle
 * @param {number} index the index to activate
 */
export function activate(elements, index) {
  elements.forEach((el, i) => el.classList.toggle('is-active', i === index));
}

export default function decorate(block) {
  const rows = [...block.children];

  const list = document.createElement('div');
  list.className = 'vsc-list';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-orientation', 'vertical');

  const stage = document.createElement('div');
  stage.className = 'vsc-stage';

  const items = [];
  const headings = [];
  const medias = [];
  rows.forEach((row, index) => {
    const [mediaCell, headingCell, bodyCell] = [...row.children];

    const { item, heading } = buildTab(headingCell, bodyCell, index);
    // --vsc-i lets CSS interleave each item with its own media on mobile
    item.style.setProperty('--vsc-i', index);
    list.append(item);
    items.push(item);
    headings.push(heading);

    const media = buildMedia(mediaCell);
    media.style.setProperty('--vsc-i', index);
    stage.append(media);
    medias.push(media);
  });

  block.replaceChildren(list);
  // only render the shared media stage if at least one row provided media
  const hasMedia = medias.some((m) => m.childNodes.length);
  if (hasMedia) block.append(stage);

  if (!items.length) return;

  // below 1024px every media is on screen at once, so all videos keep playing;
  // above it they share one stage and only the visible one should run.
  const sharedStage = window.matchMedia(MQ_DESKTOP_UP);

  const setActive = (index) => {
    activate(items, index);
    activate(medias, index);
    headings.forEach((heading, i) => {
      heading.setAttribute('aria-selected', i === index ? 'true' : 'false');
      heading.setAttribute('aria-expanded', i === index ? 'true' : 'false');
    });
    medias.forEach((media, i) => {
      const video = media.querySelector('video');
      if (!video) return;
      try {
        if (i === index || !sharedStage.matches) {
          const played = video.play();
          if (played && typeof played.catch === 'function') played.catch(() => {});
        } else {
          video.pause();
        }
      } catch {
        // media playback not available (e.g. jsdom) — layout still works
      }
    });
  };

  // the whole card is the hit target on desktop; the heading button keeps it
  // keyboard-operable and clicks on it bubble up to here
  items.forEach((item, index) => {
    item.addEventListener('click', () => setActive(index));
  });

  sharedStage.addEventListener('change', () => {
    const current = items.findIndex((item) => item.classList.contains('is-active'));
    setActive(current < 0 ? 0 : current);
  });

  // first tab active by default
  setActive(0);
}
