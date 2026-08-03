/**
 * Pure video-URL detection helpers, split out from video.js so callers that
 * only need to *detect* a video link — e.g. scripts.js buildVideoAutoBlocks(),
 * which runs in the eager phase on every page — don't have to pull the whole
 * video block (player, lightbox modal, its CSS) onto the critical path.
 * video.js re-exports these for its own use and for the unit tests.
 */

const YOUTUBE = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/;
const VIMEO = /vimeo\.com\/(?:video\/)?(\d+)/;

/**
 * Parses a video URL into provider + id + an autoplay embed URL.
 * @param {string} url the video href
 * @returns {{provider:string,id:string,embedUrl:string}|null} null if unrecognized
 */
export function videoInfo(url) {
  if (!url || typeof url !== 'string') return null;
  const yt = url.match(YOUTUBE);
  if (yt) {
    return {
      provider: 'youtube',
      id: yt[1],
      embedUrl: `https://www.youtube.com/embed/${yt[1]}?autoplay=1&rel=0`,
    };
  }
  const vimeo = url.match(VIMEO);
  if (vimeo) {
    return {
      provider: 'vimeo',
      id: vimeo[1],
      embedUrl: `https://player.vimeo.com/video/${vimeo[1]}?autoplay=1`,
    };
  }
  return null;
}

/**
 * True when href points at a supported video host.
 * @param {string} href
 * @returns {boolean}
 */
export function isVideoLink(href) {
  return videoInfo(href) !== null;
}

/**
 * Resolves the poster image: the authored one if present, else the YouTube
 * thumbnail derived from the id (Vimeo has no id-only thumbnail URL).
 * @param {{provider:string,id:string}|null} info
 * @param {string} [authoredSrc]
 * @returns {string} poster URL ('' if none available)
 */
export function posterFor(info, authoredSrc) {
  if (authoredSrc) return authoredSrc;
  if (info && info.provider === 'youtube') return `https://i.ytimg.com/vi/${info.id}/sddefault.jpg`;
  return '';
}
