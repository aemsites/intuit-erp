/**
 * side-by-side — gradient panel with copy on the left and a video poster on
 * the right (Mega Firms landing page "IAS" section; Figma "01 - Side by Side").
 *
 * Content model — one row, two cells:
 *   1. copy: optional logo (<span class="icon icon-…"> or small <img>), a
 *      heading (h2 preferred), body paragraph(s), optional CTA link
 *   2. media: an <img>/<picture> poster, plus an optional link to an .mp4 —
 *      when present, the poster becomes a play button that swaps in a native
 *      <video> on click (no third-party player, no autoplay before intent)
 * CSS: blocks/side-by-side/side-by-side.css
 */
function buildMedia(cell) {
  const media = document.createElement('div');
  media.className = 'sbs-media';
  if (!cell) return media;

  const picture = cell.querySelector('picture, img');
  const video = [...cell.querySelectorAll('a[href]')].find((a) => /\.(mp4|webm|m3u8)(\?|$)/i.test(a.href));

  if (!video) {
    if (picture) media.append(picture);
    return media;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sbs-play';
  const label = video.textContent.trim() || 'Play video';
  button.setAttribute('aria-label', label);
  if (picture) button.append(picture);
  button.insertAdjacentHTML('beforeend', `<span class="sbs-play-icon" aria-hidden="true">
    <svg viewBox="0 0 64 64" width="64" height="64" focusable="false"><circle cx="32" cy="32" r="32" fill="rgba(13,0,49,0.72)"/><path d="M26 20.5v23l18-11.5z" fill="#fff"/></svg>
  </span>`);
  button.addEventListener('click', () => {
    const el = document.createElement('video');
    el.src = video.href;
    el.controls = true;
    el.autoplay = true;
    el.playsInline = true;
    el.setAttribute('aria-label', label);
    const img = button.querySelector('img');
    if (img) el.poster = img.currentSrc || img.src;
    button.replaceWith(el);
    el.play().catch(() => {});
  });
  media.append(button);
  return media;
}

export default function decorate(block) {
  const row = block.querySelector(':scope > div');
  if (!row) return;
  const [copyCell, mediaCell] = [...row.children];

  const copy = document.createElement('div');
  copy.className = 'sbs-copy';
  if (copyCell) [...copyCell.childNodes].forEach((n) => copy.append(n));

  const logo = copy.querySelector('span.icon, img');
  if (logo) {
    const holder = logo.closest('p') || logo;
    holder.classList.add('sbs-logo');
  }
  const heading = copy.querySelector('h1, h2, h3');
  if (heading) heading.classList.add('sbs-title');
  copy.querySelectorAll(':scope > p').forEach((p) => {
    if (!p.textContent.trim() && !p.querySelector('img, span.icon')) { p.remove(); return; }
    if (!p.classList.contains('sbs-logo') && !p.classList.contains('button-wrapper')) p.classList.add('sbs-body');
  });

  block.textContent = '';
  block.append(copy, buildMedia(mediaCell));
}
