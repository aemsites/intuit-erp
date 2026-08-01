/**
 * logo-grid — integrations/customer logo grid.
 * Transforms authored rows of logos into a responsive grid (ul > li structure).
 * Content model: rows where each row contains an img (or link as last cell).
 */

export default async function decorate(block) {
  const ul = document.createElement('ul');
  ul.className = 'logo-grid-list';

  [...block.children].forEach((row) => {
    const li = document.createElement('li');
    const cell = row.querySelector('div');

    if (cell) {
      const img = cell.querySelector('img, picture > img');
      if (img) {
        // Clone and append the image (or picture if exists)
        const imgOrPicture = img.closest('picture') || img;
        li.appendChild(imgOrPicture.cloneNode(true));
      } else {
        // Handle text link as last cell
        const link = cell.querySelector('a');
        if (link) {
          li.appendChild(link.cloneNode(true));
        }
      }
    }

    ul.appendChild(li);
  });

  block.innerHTML = '';
  block.appendChild(ul);
}
