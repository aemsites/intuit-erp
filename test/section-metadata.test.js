import {
  describe, it, expect, beforeEach,
} from 'vitest';
import decorateSectionMetadata, { AUTHORED_TAG_KEYS } from '../scripts/personalization/section-metadata.js';

// Builds a `.section-metadata` block in the authored div-class form the pipeline serves:
// <div class="section-metadata"><div><div>key</div><div>value</div></div>...</div>
const meta = (rows) => `<div class="section-metadata">${rows
  .map(([k, v]) => `<div><div>${k}</div><div>${v}</div></div>`)
  .join('')}</div>`;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('decorateSectionMetadata', () => {
  it('lifts a whole-section `pzn` row to data-pzn and removes the consumed block', () => {
    document.body.innerHTML = `<main><div><h2>Offer</h2>${meta([['pzn', 'pzn-offer-slot']])}</div></main>`;
    const main = document.querySelector('main');
    const section = main.querySelector(':scope > div');
    decorateSectionMetadata(main);
    expect(section.dataset.pzn).toBe('pzn-offer-slot');
    expect(main.querySelectorAll('.section-metadata').length).toBe(0);
  });

  it('lifts block-scoped `pzn` + `pzn-block` to data-pzn + data-pzn-block (camelCased)', () => {
    document.body.innerHTML = `<main><div><div class="pzn-hero"><div>hero</div></div>${meta([
      ['pzn', 'pzn-hero-slot'], ['pzn-block', 'pzn-hero'],
    ])}</div></main>`;
    const main = document.querySelector('main');
    const section = main.querySelector(':scope > div');
    decorateSectionMetadata(main);
    expect(section.dataset.pzn).toBe('pzn-hero-slot');
    expect(section.dataset.pznBlock).toBe('pzn-hero');
    expect(section.querySelector('.pzn-hero')).not.toBeNull(); // block itself untouched
  });

  it('lifts an `exp` row to data-exp', () => {
    document.body.innerHTML = `<main><div><h2>Hero</h2>${meta([['exp', 'ixp-hero-test']])}</div></main>`;
    const main = document.querySelector('main');
    decorateSectionMetadata(main);
    expect(main.querySelector(':scope > div').dataset.exp).toBe('ixp-hero-test');
  });

  it('lifts both `pzn` and `exp` on the same section (the IXP-wins case is resolved downstream)', () => {
    document.body.innerHTML = `<main><div><p>x</p>${meta([
      ['pzn', 'pzn-offer-slot'], ['exp', 'ixp-hero-test'],
    ])}</div></main>`;
    const section = document.querySelector('main > div');
    decorateSectionMetadata(document.querySelector('main'));
    expect(section.dataset.pzn).toBe('pzn-offer-slot');
    expect(section.dataset.exp).toBe('ixp-hero-test');
  });

  it('leaves a block with no pzn/exp key untouched — section background', () => {
    document.body.innerHTML = `<main><div><h2>Styled</h2>${meta([['background', '#f3f1f8']])}</div></main>`;
    const main = document.querySelector('main');
    const section = main.querySelector(':scope > div');
    decorateSectionMetadata(main);
    expect(section.dataset.background).toBeUndefined(); // not our key — not lifted
    expect(main.querySelectorAll('.section-metadata').length).toBe(1); // block NOT removed
  });

  it("leaves the plugin's native `Experiment` block untouched (experiment-loader still detects it)", () => {
    document.body.innerHTML = `<main><div>${meta([['Experiment', '385944']])}</div></main>`;
    const main = document.querySelector('main');
    decorateSectionMetadata(main);
    expect(main.querySelector(':scope > div').dataset.exp).toBeUndefined();
    expect(main.querySelectorAll('.section-metadata').length).toBe(1);
  });

  it('processes multiple tagged sections and targets each block to its own section', () => {
    document.body.innerHTML = `<main>
      <div><h2>A</h2>${meta([['pzn', 'slot-a']])}</div>
      <div><h2>B</h2>${meta([['exp', 'exp-b']])}</div>
    </main>`;
    const main = document.querySelector('main');
    const [a, b] = main.querySelectorAll(':scope > div');
    decorateSectionMetadata(main);
    expect(a.dataset.pzn).toBe('slot-a');
    expect(a.dataset.exp).toBeUndefined();
    expect(b.dataset.exp).toBe('exp-b');
    expect(b.dataset.pzn).toBeUndefined();
    expect(main.querySelectorAll('.section-metadata').length).toBe(0);
  });

  it('is a no-op on a page with no .section-metadata blocks', () => {
    document.body.innerHTML = '<main><div><h2>Plain</h2></div></main>';
    const main = document.querySelector('main');
    expect(() => decorateSectionMetadata(main)).not.toThrow();
    expect(main.querySelector(':scope > div').dataset.pzn).toBeUndefined();
  });

  it('does not throw when called without a main', () => {
    expect(() => decorateSectionMetadata(null)).not.toThrow();
  });

  it('scopes only pzn/exp keys — AUTHORED_TAG_KEYS is the exact contract', () => {
    expect(AUTHORED_TAG_KEYS).toEqual([
      'pzn', 'pzn-block', 'pzn-variants', 'exp', 'exp-block', 'exp-variants',
    ]);
  });
});
