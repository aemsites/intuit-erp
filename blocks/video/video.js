/**
 * video — poster image + centered play button that opens the video in a
 * lightbox modal, matching the source erp.intuit.com in-article video
 * (poster + play → player) and the site's existing testimonial.video lightbox.
 *
 * Primary path is the autoblock: scripts.js buildVideoAutoBlocks() turns a
 * section-level paragraph that is only a link to a video host (YouTube/Vimeo),
 * optionally wrapping a poster <img>, into a `video` block. It can also be
 * authored explicitly (a block whose cell holds the video link).
 *
 * Pure helpers (videoInfo / isVideoLink / posterFor) live in ./video-info.js so
 * the eager-phase detector (scripts.js) can import isVideoLink without loading
 * this whole block; re-exported here for decorate() and the unit tests.
 *
 * CSS: blocks/video/video.css
 */

import { createOptimizedPicture } from '../../scripts/aem.js';
import { trackAs } from '../../scripts/tracking.js';
import { videoInfo, isVideoLink, posterFor } from './video-info.js';

// re-exported so the unit tests (and any external importer) keep resolving the
// pure helpers from this block, while decorate() below uses videoInfo/posterFor.
export { videoInfo, isVideoLink, posterFor };

/**
 * Builds an EDS-optimized poster <picture> (webp + width-matched srcset) served
 * by the site's media pipeline — posters are local `media_*` assets in
 * production. No width/height needed: `.video-preview` reserves the box via its
 * `aspect-ratio: 16/9` (see video.css), so there is no layout shift and the img
 * just fills that box with `object-fit: cover`. Mirrors cards.js.
 * @param {string} src poster image URL (a `./media_*` asset)
 * @param {string} alt
 * @returns {HTMLElement} the <picture> element
 */
function buildPoster(src, alt) {
  const picture = createOptimizedPicture(src, alt, false, [{ width: '750' }]);
  picture.querySelector('img').setAttribute('decoding', 'async');
  return picture;
}

/**
 * Opens the video in a dismissible lightbox modal (autoplay iframe).
 * @param {string} embedUrl provider embed URL
 * @param {string} [title] accessible iframe title
 */
function openVideoModal(embedUrl, title) {
  const overlay = document.createElement('div');
  overlay.className = 'video-modal-overlay';
  overlay.innerHTML = `
    <div class="video-modal">
      <button type="button" class="video-modal-close" aria-label="Close video">×</button>
      <div class="video-modal-frame">
        <iframe src="${embedUrl}" title="${title || 'Video'}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
      </div>
    </div>`;

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

/**
 * Block entry point.
 * @param {Element} block the video block element
 */
export default function decorate(block) {
  const link = block.querySelector('a[href]');
  const href = link ? link.getAttribute('href') : block.textContent.trim();
  // preserve the authored link label (e.g. "See how it works (2:02)") — the source
  // renders it as a caption beside the play control; the old block discarded it.
  const labelText = link ? link.textContent.trim() : '';
  const info = videoInfo(href);
  if (!info) return; // unrecognized host — leave the authored link untouched

  const authoredImg = block.querySelector('img');
  const alt = authoredImg ? (authoredImg.getAttribute('alt') || '') : '';
  const poster = posterFor(info, authoredImg && authoredImg.getAttribute('src'));

  const preview = document.createElement('div');
  preview.className = 'video-preview';
  preview.setAttribute('role', 'button');
  preview.setAttribute('tabindex', '0');
  preview.setAttribute('aria-label', alt ? `Play video: ${alt}` : 'Play video');

  if (poster) preview.append(buildPoster(poster, alt));
  const play = document.createElement('span');
  play.className = 'video-play';
  play.setAttribute('aria-hidden', 'true');
  preview.append(play);

  const open = () => openVideoModal(info.embedUrl, alt);
  preview.addEventListener('click', open);
  preview.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  const nodes = [preview];
  // render the authored label as a caption that also opens the video, unless the
  // link was a bare URL (autoblocked links with no meaningful text).
  if (labelText && labelText !== href && !/^https?:\/\//i.test(labelText)) {
    const caption = document.createElement('button');
    caption.type = 'button';
    caption.className = 'video-label';
    caption.textContent = labelText;
    caption.addEventListener('click', open);
    nodes.push(caption);
  }
  block.replaceChildren(...nodes);

  // Play control -> video:started / ui_object=video (a video LINK derives video:engaged).
  // Id off the video source (stable, per-video, authorable) since the control is a
  // text-less role=button: `video:<provider>-<id>`. Both the poster and the caption
  // open the same video, so they share the id. (Per-video wa-links are authored by
  // this id; the prod golden's play beacons carry no source, so those rows are
  // seeded/verified live, not from the golden.)
  // Trail segment `video` (prod's access point for a standalone video play control;
  // it emits `video` — prod's occasional video|video|video multi-stamp is its own
  // inconsistency, not reproduced). `key` defaults to the `video` name.
  trackAs('video', block, {
    object: 'video',
    action: 'started',
    uiObject: 'video',
    linkName: false,
    trackId: () => `video:${info.provider}-${info.id}`,
  });
}
