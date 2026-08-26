/**
 * media-text — media + text split rows (index migration, pricing, accounting, erp-solutions).
 *
 * Section head (h2 + optional intro/eyebrow) is authored as default content.
 * Each block ROW = one unit. Cell 1 = text (eyebrow p / heading / body / cta),
 * cell 2 = media (<img> or arbitrary markup). Cell 2 may be omitted (text-only).
 *
 * A single row can also be flipped without a variant by authoring the media
 * cell before the text cell; that cue is ignored when .reverse is present so
 * the two don't compound (see the rowReverse comment below).
 *
 * Variants:
 *   (default)  text left, media right; multiple rows alternate media right→left
 *   .reverse   first row media LEFT (then alternates); also used for single media-left rows
 *   .cyan      pale-cyan band skin (pricing "Switch now and save")
 *   .agave     pale-blue band skin (ai-agents "From questions to clarity")
 *   .center    text-only, centered single column (pricing "Built for the way")
 *   .cards     2-up cards, media below text (index "migration path")
 *   .power     feature-list + media (erp-solutions "Powering complex …")
 *   .compare   2-up alternating-skin comparison cards, media pinned to the
 *              card bottom (erp-solutions "Move to a modern ERP" / solution-cards)
 *   NN-NN      column width split for the default/reverse rows, e.g. `(70-30)`
 *              gives the text column 70% and the media column 30%. Still
 *              stacks to a single column below 769px like the default split.
 * CSS: blocks/media-text/media-text.css
 */
import { buildBlock, loadBlock } from '../../scripts/aem.js';
import { videoInfo } from '../video/video-info.js';

const SPLIT_RE = /^(\d{1,3})-(\d{1,3})$/;

function buildCopy(textCell) {
  const copy = document.createElement('div');
  copy.className = 'media-copy';
  if (textCell) [...textCell.childNodes].forEach((n) => copy.append(n));
  const heading = copy.querySelector('h2, h3, h4');
  // eyebrow = a paragraph that precedes the heading and is not a button/link
  const eyebrowPs = [];
  [...copy.querySelectorAll('p')].forEach((p) => {
    if (p.classList.contains('button-wrapper')) return;
    if (p.querySelector('a')) return;
    // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask
    if (heading && (p.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      p.classList.add('eyebrow', 'media-eyebrow');
      eyebrowPs.push(p);
    } else {
      p.classList.add('media-body');
    }
  });
  // an eyebrow "paragraph" that is only an icon image (no text), immediately
  // followed by the capitalised title, is a source icon+title pair (e.g.
  // /accounting/business-forecasting) — pair them into one row so the icon
  // sits before the title instead of stacking above it. Anything else (no
  // icon, or an icon with no adjacent title) is left as plain eyebrow text.
  const iconP = eyebrowPs.find((p) => !p.textContent.trim() && p.querySelector('picture, img'));
  const titleP = iconP?.nextElementSibling;
  if (iconP && titleP?.classList.contains('media-eyebrow') && titleP.textContent.trim()) {
    const row = document.createElement('div');
    row.className = 'media-eyebrow-row';
    copy.insertBefore(row, iconP);
    iconP.classList.remove('eyebrow', 'media-eyebrow');
    iconP.classList.add('media-eyebrow-icon');
    row.append(iconP, titleP);
  }
  return copy;
}

export default function decorate(block) {
  const splitMatch = [...block.classList].map((c) => c.match(SPLIT_RE)).find(Boolean);
  if (splitMatch) block.style.setProperty('--split', `${splitMatch[1]}fr ${splitMatch[2]}fr`);

  const hasReverse = block.classList.contains('reverse');
  const isCards = block.classList.contains('cards');
  const isCompare = block.classList.contains('compare');
  const isPower = block.classList.contains('power');
  const isCenter = block.classList.contains('center');
  const rows = [...block.children];

  if (isCenter) {
    const copy = buildCopy(rows[0] && rows[0].firstElementChild);
    copy.classList.add('media-center');
    block.replaceChildren(copy);
    return;
  }

  if (isCompare) {
    const grid = document.createElement('div');
    grid.className = 'compare-grid';
    rows.forEach((row, i) => {
      const cells = [...row.children];
      const card = document.createElement('article');
      card.className = `compare-card ${i % 2 === 0 ? 'compare-blue' : 'compare-sand'}`;
      const copy = buildCopy(cells[0]);
      [...copy.children].forEach((el) => card.append(el));
      if (cells[1]) {
        const vis = document.createElement('div');
        vis.className = 'compare-visual';
        [...cells[1].childNodes].forEach((n) => vis.append(n));
        card.append(vis);
      }
      grid.append(card);
    });
    block.replaceChildren(grid);
    return;
  }

  if (isCards) {
    const grid = document.createElement('div');
    grid.className = 'mig-grid';
    rows.forEach((row) => {
      const cells = [...row.children];
      const card = document.createElement('article');
      card.className = 'mig-card';
      const copy = buildCopy(cells[0]);
      [...copy.children].forEach((el) => card.append(el));
      if (cells[1]) {
        const vis = document.createElement('div');
        vis.className = 'mig-visual';
        [...cells[1].childNodes].forEach((n) => vis.append(n));

        // detect a video-host link in the visual cell; if found, compose a
        // `video` block using the EDS buildBlock/loadBlock pipeline instead of
        // rendering a static poster link.  Non-video cards (step lists, plain
        // images on /index, /pricing, etc.) are completely untouched.
        const videoLink = vis.querySelector('a[href]');
        const info = videoLink ? videoInfo(videoLink.getAttribute('href')) : null;
        if (info) {
          // extract the authored poster img (if present) so the video block
          // can use the already-published thumbnail rather than the fallback
          const img = vis.querySelector('img');
          // build a video block: one row, one column containing [link, img]
          // (matches the structure that buildVideoAutoBlocks produces for
          // section-level video paragraphs — see scripts.js:204)
          const elems = [videoLink];
          if (img) elems.push(img);
          const videoBlock = buildBlock('video', { elems });
          // set blockName so loadBlock can resolve the JS/CSS paths;
          // skip decorateBlock() to avoid adding video-wrapper/-container
          // classes that would alter section background/padding via video.css
          videoBlock.dataset.blockName = 'video';
          vis.replaceChildren(videoBlock);
          // fire-and-forget: card grid renders synchronously; the video block
          // (poster + play button) fills in once loadBlock resolves
          loadBlock(videoBlock);
        } else {
          // normalise the "Migrating progression" step list (robust to class stripping)
          const list = vis.querySelector('ul');
          if (list) {
            list.classList.add('mig-steps');
            const head = vis.querySelector('p');
            if (head) head.classList.add('mig-visual-head');
            list.querySelectorAll('li').forEach((li) => {
              if (/^\s*✓/.test(li.textContent)) {
                li.classList.add('done');
                li.textContent = li.textContent.replace(/^\s*✓\s*/, '');
                const tick = document.createElement('span');
                tick.className = 'tick';
                tick.textContent = '✓';
                li.prepend(tick);
              }
            });
          }
        }
        card.append(vis);
      }
      grid.append(card);
    });
    block.replaceChildren(grid);
    return;
  }

  if (isPower) {
    const row = rows[0];
    const cells = [...row.children];
    const grid = document.createElement('div');
    grid.className = 'power-grid';
    const list = document.createElement('div');
    list.className = 'power-list';
    // group heading + following paragraph(s) into feature items
    const src = cells[0];
    let item = null;
    [...src.children].forEach((el) => {
      if (/^H[2-4]$/.test(el.tagName)) {
        item = document.createElement('article');
        item.className = 'power-item';
        if (!list.children.length) item.classList.add('featured');
        list.append(item);
      }
      if (item) item.append(el); else { item = document.createElement('article'); item.className = 'power-item'; item.append(el); list.append(item); }
    });
    grid.append(list);
    if (cells[1]) {
      const media = document.createElement('div');
      media.className = 'power-media';
      [...cells[1].childNodes].forEach((n) => media.append(n));
      grid.append(media);
    }
    block.replaceChildren(grid);
    return;
  }

  // default / reverse / cyan — media+text split rows
  const frag = document.createDocumentFragment();
  rows.forEach((row, i) => {
    const cells = [...row.children];
    // The text cell can carry its own small icon image (e.g. business-forecasting),
    // so "first cell with an image" is not a reliable way to find the media cell.
    // The heading is the unambiguous signal: whichever cell has it is the text
    // cell, and the media cell is the *other* one that has an image.
    const headingCell = cells.find((c) => c.querySelector('h2, h3, h4'));
    const mediaCell = headingCell
      ? cells.find((c) => c !== headingCell && c.querySelector('picture, img'))
      : cells.find((c) => c.querySelector('picture, img'));
    const textCell = headingCell || cells.find((c) => c !== mediaCell) || cells[0];
    const rowEl = document.createElement('div');
    rowEl.className = 'media-row';
    // Media-left is expressed two ways, and they must not compound:
    //  - the `.reverse` variant, which alternates sides down a multi-row block
    //  - authoring the media cell BEFORE the text cell in a single row
    // The authored-order cue is only consulted when `.reverse` is absent,
    // otherwise a row that is both (/events) would flip twice and land back on
    // the right.
    const mediaAuthoredFirst = !!mediaCell && cells.indexOf(mediaCell) < cells.indexOf(textCell);
    const rowReverse = hasReverse
      ? (i % 2 === 0)
      : (mediaAuthoredFirst || i % 2 === 1);
    if (rowReverse) rowEl.classList.add('row-reverse');
    rowEl.append(buildCopy(textCell));
    if (mediaCell) {
      const vis = document.createElement('div');
      vis.className = 'media-visual';
      [...mediaCell.childNodes].forEach((n) => vis.append(n));
      rowEl.append(vis);
    }
    frag.append(rowEl);
  });
  block.replaceChildren(frag);
}
