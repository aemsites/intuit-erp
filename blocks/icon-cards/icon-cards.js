/**
 * icon-cards — bordered cards with a utility icon (Mega Firms landing page).
 *
 * Content model — one row per card, a single flowing cell:
 *   an icon (<span class="icon icon-…"> or <img>), a heading (h3 preferred,
 *   h2–h4 accepted; a bold-only paragraph also works), then body paragraph(s).
 *
 * Variants:
 *   (default)  Figma "04 - Small Card (Web)": icon left of the title, 305px
 *              cards in a centered row. Below 768px the same cards render as
 *              the Figma "00 - Accordion Bundle" — the title row toggles the
 *              body (one card can be open at a time).
 *   .stacked   Figma "00 - Card Bundle (Web)": icon in a 64px circle above a
 *              centered 20/28 title, three equal columns; plain stacked cards
 *              on mobile (no accordion).
 * CSS: blocks/icon-cards/icon-cards.css
 */
function buildCard(row, index, accordion) {
  const content = document.createElement('div');
  [...row.children].forEach((cell) => [...cell.childNodes].forEach((n) => content.append(n)));

  const card = document.createElement('div');
  card.className = 'icon-card';

  const iconEl = content.querySelector('span.icon, picture, img');
  const icon = document.createElement('div');
  icon.className = 'icon-card-icon';
  if (iconEl) {
    const holder = iconEl.closest('p') || iconEl;
    icon.append(iconEl);
    if (holder !== iconEl && !holder.textContent.trim()) holder.remove();
  }

  let heading = content.querySelector('h2, h3, h4');
  if (!heading) {
    const bold = [...content.querySelectorAll('p')].find((p) => {
      const strong = p.querySelector('strong');
      return strong && strong.textContent.trim() === p.textContent.trim();
    });
    if (bold) {
      heading = document.createElement('h3');
      heading.textContent = bold.textContent.trim();
      bold.replaceWith(heading);
    }
  }

  const title = document.createElement('h3');
  title.className = 'icon-card-title';
  const panel = document.createElement('div');
  panel.className = 'icon-card-panel';
  panel.id = `icon-card-panel-${index}`;

  if (heading) {
    if (accordion) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'icon-card-toggle';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', panel.id);
      toggle.innerHTML = heading.innerHTML;
      title.append(toggle);
    } else {
      title.innerHTML = heading.innerHTML;
    }
    heading.remove();
  }

  content.querySelectorAll(':scope > p').forEach((p) => {
    if (!p.textContent.trim()) p.remove();
  });
  [...content.childNodes].forEach((n) => panel.append(n));

  card.append(icon, title, panel);
  return card;
}

export default function decorate(block) {
  const accordion = !block.classList.contains('stacked');
  const cards = [...block.children].map((row, i) => buildCard(row, i, accordion));
  block.textContent = '';
  block.append(...cards);

  if (!accordion) return;

  const toggles = [...block.querySelectorAll('.icon-card-toggle')];
  toggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggles.forEach((t) => {
        t.setAttribute('aria-expanded', 'false');
        t.closest('.icon-card').classList.remove('is-open');
      });
      if (!open) {
        toggle.setAttribute('aria-expanded', 'true');
        toggle.closest('.icon-card').classList.add('is-open');
      }
    });
  });
}
