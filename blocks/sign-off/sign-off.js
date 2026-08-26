/**
 * sign-off — closing CTA panel: a rounded navy card holding a centered
 * statement and up to two buttons (compare "15 minutes to verify the fit").
 *
 * Content model: a single cell of rich content —
 *   a heading, body paragraph(s), and one paragraph carrying the CTA links.
 * Author both CTAs in the SAME paragraph so decorateButtons marks it
 * `.buttons-multi` and they sit side by side; `<strong>` = primary (white),
 * `<em>` = secondary (outlined).
 *
 * Distinct from cta-band: that block is either a 1:2 stat/card split or its
 * `.simple` light band, neither of which is this centered navy panel.
 * CSS: blocks/sign-off/sign-off.css
 */
import { bindScheduleLinks } from '../form/form.js';

export default function decorate(block) {
  const cell = block.querySelector(':scope > div > div');

  const panel = document.createElement('div');
  panel.className = 'sign-off-panel';
  if (cell) panel.append(...cell.childNodes);

  // Body copy is centered on a narrower measure than the heading, so wrap the
  // non-heading, non-button paragraphs rather than constraining the panel.
  [...panel.children].forEach((el) => {
    if (el.tagName === 'P' && !el.classList.contains('button-wrapper')) {
      el.classList.add('sign-off-lede');
    }
  });

  block.replaceChildren(panel);

  // "Schedule a call" opens the shared scheduling modal, as it does in hero
  // and cta-band.
  bindScheduleLinks(panel);
}
