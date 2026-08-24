/**
 * quick-links — "Industries" style link card, reproducing erp.intuit.com's
 * QuickLinks component exactly:
 *   - desktop (>=768px): a rounded card, title on the left, links laid out in a
 *     horizontal wrapping row; the toggle is hidden and the list is always shown.
 *   - mobile (<768px): a compact card showing the title + a chevron; the list is
 *     collapsed and expands when the card (or chevron) is tapped.
 *
 * Authored structure (2 rows, 1 column):
 *   Row 1 — the title label (e.g. "Industries")
 *   Row 2 — an unordered list of links
 *
 * CSS: blocks/quick-links/quick-links.css
 */

import { trackAs } from '../../scripts/tracking.js';
import { MQ_TABLET_UP } from '../../scripts/breakpoints.js';

// production chevron (viewBox/path copied verbatim)
const CHEVRON = '<svg width="31" height="15" viewBox="0 0 31 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M2 2L12.7254 12.3282C14.2744 13.8198 16.7256 13.8198 18.2746 12.3282L29 2" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const DESKTOP = window.matchMedia(MQ_TABLET_UP);

// unique suffix per block so multiple quick-links on one page don't collide
let instance = 0;

export default function decorate(block) {
  instance += 1;
  const list = block.querySelector('ul');

  // First non-list row holds the title label. Authors may bold it or wrap it in
  // inline code, so take the plain text and drop the wrappers.
  let titleText = '';
  [...block.children].forEach((row) => {
    if (!row.querySelector('ul')) {
      const text = row.textContent.trim();
      if (text) titleText = text;
    }
  });

  block.textContent = '';

  const title = document.createElement('p');
  title.className = 'quick-links-title';
  title.textContent = titleText;

  const toggle = document.createElement('button');
  toggle.className = 'quick-links-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', `Toggle ${titleText || 'quick links'}`);
  toggle.innerHTML = CHEVRON;

  block.append(title, toggle);

  if (list) {
    list.className = 'quick-links-list';
    list.id = list.id || `quick-links-list-${instance}`;
    toggle.setAttribute('aria-controls', list.id);
    block.append(list);
  }

  // Collapse/expand on mobile only. A single listener on the block lets a tap
  // anywhere on the card toggle it (button clicks bubble up too), while taps on
  // the links themselves still navigate. Desktop keeps the list always visible.
  block.addEventListener('click', (e) => {
    if (DESKTOP.matches || e.target.closest('a')) return;
    const expanded = block.classList.toggle('quick-links-expanded');
    toggle.setAttribute('aria-expanded', String(expanded));
  });

  // Industry links -> quick_links trail; skip the mobile expand toggle.
  trackAs('quick_links', block, { key: 'quick_links', skip: '.quick-links-toggle' });
}
