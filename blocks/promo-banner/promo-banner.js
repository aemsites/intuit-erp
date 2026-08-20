/**
 * promo-banner — slim full-width announcement bar with a message and an
 * optional inline CTA link, plus an optional dismiss control.
 * Row 1 = message (with optional link). Row 2 (optional) = "dismissible".
 */
function isDismissible(cell) {
  return !!cell && /^dismissible$|^yes$/i.test(cell.textContent.trim());
}

export default function decorate(block) {
  const rows = [...block.children];
  const messageCell = rows[0]?.firstElementChild;
  const dismissible = isDismissible(rows[1]?.firstElementChild);

  const message = document.createElement('div');
  message.className = 'promo-banner-message';
  if (messageCell) {
    const p = messageCell.querySelector('p') || messageCell;
    [...p.childNodes].forEach((n) => message.append(n));
  }

  const link = message.querySelector('a');
  if (link) link.classList.add('promo-banner-cta');

  block.replaceChildren(message);

  if (dismissible) {
    const storageKey = `promo-banner-dismissed:${window.location.pathname}`;
    if (window.sessionStorage.getItem(storageKey) === 'true') {
      block.remove();
      return;
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'promo-banner-close';
    closeBtn.setAttribute('aria-label', 'Dismiss banner');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
      window.sessionStorage.setItem(storageKey, 'true');
      block.remove();
    });
    block.append(closeBtn);
  }
}
