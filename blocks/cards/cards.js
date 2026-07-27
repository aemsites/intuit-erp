/**
 * cards — generic card grid. Used by OF1-generated content (blocks/of1),
 * which emits plain `.cards > div` rows rather than authoring this block
 * directly. Kept structurally as-is (no ul/li wrap) to match the DOM
 * blocks/of1/of1.css already targets.
 * CSS: blocks/cards/cards.css (baseline) + blocks/of1/of1.css
 *      (.generated-section .cards, full styling)
 */
import { createOptimizedPicture } from '../../scripts/aem.js';

export default function decorate(block) {
  [...block.children].forEach((row) => {
    [...row.children].forEach((cell) => {
      const img = cell.querySelector('picture > img');
      if (img && cell.children.length === 1) {
        cell.classList.add('cards-card-image');
        const picture = img.closest('picture');
        picture.replaceWith(createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]));
      } else {
        cell.classList.add('cards-card-body');
      }
    });
  });
}
