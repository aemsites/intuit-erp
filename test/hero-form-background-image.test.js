import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';

// hero.js -> fragment.js -> scripts.js, which self-invokes loadPage() at import
// time; stub it so importing hero.js in isolation stays inert.
vi.mock('../scripts/scripts.js', () => ({ decorateMain: vi.fn() }));

const { default: decorate } = await import('../blocks/hero/hero.js');

const IMG = 'https://stage.example.com/oa/media_hero.jpg?width=750&format=jpg&optimize=medium';

// A form hero: row 1 is the fragment path, row 2 is the (empty) copy cell —
// mirrors /oa/, where the desktop composite lives only as the section background.
function makeFormHero({ background, copyInner = '' } = {}) {
  const section = document.createElement('div');
  section.className = 'section hero-container';
  if (background !== undefined) section.dataset.background = background;

  const block = document.createElement('div');
  block.className = 'hero form block';
  block.innerHTML = `
    <div><div>/fragments/oa-schedule-call</div></div>
    <div><div>${copyInner}</div></div>
  `;
  section.append(block);
  document.body.append(section);
  return block;
}

describe('hero (form) — background-image → copy image derivation', () => {
  beforeEach(() => {
    // leadCard() calls loadFragment() -> fetch; a failed fetch resolves to a
    // graceful "couldn't load" message rather than throwing.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('derives a contained copy image from an image section-background when the copy is empty', async () => {
    const block = makeFormHero({ background: IMG });
    await decorate(block);

    const copy = block.querySelector('.hero-copy');
    const picture = copy.querySelector('picture');
    expect(picture, 'a <picture> is derived into the copy cell').not.toBeNull();
    // built from the background's pathname (host/query stripped), via createOptimizedPicture
    expect(picture.outerHTML).toContain('/oa/media_hero.jpg');
    expect(picture.querySelector('img')).not.toBeNull();
  });

  it('does not derive an image when the section background is a gradient/colour', async () => {
    const block = makeFormHero({ background: 'conic-gradient(from 103deg at 28% 120%, #fff, #000)' });
    await decorate(block);

    const copy = block.querySelector('.hero-copy');
    expect(copy.querySelector('picture, img')).toBeNull();
  });

  it('does not derive when the section has no background at all', async () => {
    const block = makeFormHero();
    await decorate(block);

    const copy = block.querySelector('.hero-copy');
    expect(copy.querySelector('picture, img')).toBeNull();
  });

  it('keeps an authored copy image and does not add a derived duplicate', async () => {
    const block = makeFormHero({
      background: IMG,
      copyInner: '<picture><img src="/oa/authored.jpg" alt="authored"></picture>',
    });
    await decorate(block);

    const copy = block.querySelector('.hero-copy');
    const imgs = copy.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toContain('/oa/authored.jpg');
  });
});
