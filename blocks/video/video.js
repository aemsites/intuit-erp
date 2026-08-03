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

import { videoInfo, isVideoLink, posterFor } from './video-info.js';

// re-exported so the unit tests (and any external importer) keep resolving the
// pure helpers from this block, while decorate() below uses videoInfo/posterFor.
export { videoInfo, isVideoLink, posterFor };

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

  if (poster) {
    const img = document.createElement('img');
    img.src = poster;
    img.alt = alt;
    img.loading = 'lazy';
    preview.append(img);
  }
  const play = document.createElement('span');
  play.className = 'video-play';
  play.setAttribute('aria-hidden', 'true');
  preview.append(play);

  const open = () => openVideoModal(info.embedUrl, alt);
  preview.addEventListener('click', open);
  preview.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  block.replaceChildren(preview);
}
