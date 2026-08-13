/**
 * logo-band — row of partner/customer logos, two layouts:
 *   default   responsive static grid
 *   .marquee  infinite scrolling band (dark, desaturated), behavior lifted
 *             from erp.intuit.com's #ies-slider: duplicate the logo set until
 *             it's wider than the viewport, clone that set once more for a
 *             seamless loop, then animate by the measured pixel distance.
 * Authoring: any number of logo images anywhere in the block (any row/cell
 * layout), in any order; a trailing text link is also supported.
 * CSS: blocks/logo-band/logo-band.css
 */

const SPEED_PX_PER_SEC = 40;

function collectItems(block) {
  const seen = new Set();
  const items = [];
  block.querySelectorAll('img, a').forEach((el) => {
    if (el.tagName === 'A') {
      if (el.querySelector('img, picture')) return;
      items.push(el);
      return;
    }
    const node = el.closest('picture') || el;
    if (seen.has(node)) return;
    seen.add(node);
    items.push(node);
  });
  return items;
}

function buildGrid(items) {
  const ul = document.createElement('ul');
  ul.className = 'logoband-list';
  items.forEach((item) => {
    const li = document.createElement('li');
    li.append(item);
    ul.append(li);
  });
  return ul;
}

function waitForImages(imgs) {
  return Promise.all(imgs.map((img) => (img.complete
    ? Promise.resolve()
    : new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    }))));
}

function measure(block, viewport, track, setA, setB) {
  const originalItems = [...setA.children].filter((el) => !el.classList.contains('clone'));
  // All geometry reads happen up front, before any DOM writes below — reading
  // setA's width again after each append (as a while-loop condition) would
  // force a synchronous layout recalc on every single iteration (forced
  // reflow); computing the clone count once from a single read avoids that.
  const viewportWidth = viewport.getBoundingClientRect().width;
  const widestItem = originalItems.reduce(
    (max, el) => Math.max(max, el.getBoundingClientRect().width),
    0,
  );
  const originalSetWidth = setA.getBoundingClientRect().width;
  const target = viewportWidth + widestItem;

  if (originalSetWidth > 0) {
    const setsNeeded = Math.min(20, Math.ceil(target / originalSetWidth));
    for (let i = 1; i < setsNeeded; i += 1) {
      originalItems.forEach((el) => setA.append(el.cloneNode(true)));
    }
  }

  const distance = setB.offsetLeft - setA.offsetLeft;
  if (distance > 0) {
    track.style.setProperty('--logoband-distance', `-${distance}px`);
    track.style.animationDuration = `${distance / SPEED_PX_PER_SEC}s`;
    block.classList.add('is-ready');
  }
}

function buildMarquee(block, items) {
  const viewport = document.createElement('div');
  viewport.className = 'logoband-viewport';
  const track = document.createElement('div');
  track.className = 'logoband-track';
  const setA = document.createElement('div');
  setA.className = 'logoband-set';
  items.forEach((item) => setA.append(item));
  const setB = setA.cloneNode(true);
  setB.classList.add('clone');
  setB.setAttribute('aria-hidden', 'true');

  track.append(setA, setB);
  viewport.append(track);

  waitForImages([...setA.querySelectorAll('img')]).then(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      measure(block, viewport, track, setA, setB);
      let resizeTimer;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => measure(block, viewport, track, setA, setB), 200);
      });
    }));
  });

  return viewport;
}

export default function decorate(block) {
  const items = collectItems(block);
  const built = block.classList.contains('marquee')
    ? buildMarquee(block, items)
    : buildGrid(items);
  block.replaceChildren(built);
}
