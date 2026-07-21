/**
 * logo-strip — dark band, an infinite scrolling marquee of customer logos (index).
 * Authoring: one cell holding all logo <img>s (or one row per logo).
 * Behavior lifted from erp.intuit.com's #ies-slider marquee: duplicate the logo
 * set until it's wider than the viewport, clone that set once more for a
 * seamless loop, then animate by the measured pixel distance at a constant speed.
 * CSS: blocks/logo-strip/logo-strip.css
 */

const SPEED_PX_PER_SEC = 40;

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
  const viewportWidth = viewport.getBoundingClientRect().width;
  const widestLogo = originalItems.reduce((max, el) => Math.max(max, el.getBoundingClientRect().width), 0);
  const target = viewportWidth + widestLogo;

  let guard = 0;
  while (setA.getBoundingClientRect().width < target && guard < 20) {
    originalItems.forEach((el) => setA.append(el.cloneNode(true)));
    guard += 1;
  }

  const distance = setB.offsetLeft - setA.offsetLeft;
  if (distance > 0) {
    track.style.setProperty('--logostrip-distance', `-${distance}px`);
    track.style.animationDuration = `${distance / SPEED_PX_PER_SEC}s`;
    block.classList.add('is-ready');
  }
}

export default function decorate(block) {
  const imgs = [...block.querySelectorAll('picture, img')];
  const logos = imgs.map((img) => img.closest('picture') || img);

  const viewport = document.createElement('div');
  viewport.className = 'logostrip-viewport';
  const track = document.createElement('div');
  track.className = 'logostrip-track';
  const setA = document.createElement('div');
  setA.className = 'logostrip-set';
  logos.forEach((logo) => setA.append(logo));
  const setB = setA.cloneNode(true);
  setB.classList.add('clone');
  setB.setAttribute('aria-hidden', 'true');

  track.append(setA, setB);
  viewport.append(track);
  block.replaceChildren(viewport);

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
}
