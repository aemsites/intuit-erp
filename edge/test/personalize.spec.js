import { describe, it, expect } from 'vitest';
import { applyPersonalization } from '../src/personalize.js';

/**
 * Unit tests for the DOM-injection transform. The live personalization sources
 * (`de`, `ixp`) only ever emit `action: 'replace'` at `block`/`page` fidelity, so
 * the full action × fidelity matrix (above/below, section) is exercised here
 * directly rather than through the worker.
 */

/** A page with three authored slots: a hero, a block slot, and a section slot. */
const PAGE_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>
<header></header>
<main>
  <div>
    <div class="hero"><div>Hero</div></div>
  </div>
  <div>
    <div class="slot-1"><div>OLD BLOCK</div></div>
  </div>
  <div>
    <div class="slot-2"><div>SECTION CONTENT</div></div>
  </div>
</main>
<footer></footer>
</body></html>`;

/** An offer fragment: a single top-level <div> section wrapping one block. */
const OFFER_HTML = `<div>
  <div class="offer"><div>NEW OFFER</div></div>
</div>`;

/** Builds an entry with only the fields `applyPersonalization` reads. */
function entry(partial) {
  return {
    path: '/', fragment: '/fragments/pzn/x', location: 'slot-1', action: 'replace', fidelity: 'block', ...partial,
  };
}

describe('applyPersonalization', () => {
  it('replaces a block targeted by slot id (fidelity=block, action=replace)', () => {
    const html = applyPersonalization(PAGE_HTML, OFFER_HTML, entry());
    expect(html).not.toContain('OLD BLOCK');
    expect(html).toContain('class="offer"');
    expect(html).toContain('NEW OFFER');
    // other slots untouched
    expect(html).toContain('SECTION CONTENT');
    expect(html).toContain('class="hero"');
  });

  it('strips the offer\'s outer section wrapper for a block injection', () => {
    // The offer's own top-level <div> becomes the block content, not a nested
    // section wrapper, so the outer <div> is dropped.
    const html = applyPersonalization(PAGE_HTML, OFFER_HTML, entry());
    // The block that replaced slot-1 is the offer's inner block directly.
    expect(html).toContain('<div class="offer"><div>NEW OFFER</div></div>');
  });

  it('inserts above a slot (action=above), preserving the block', () => {
    const html = applyPersonalization(PAGE_HTML, OFFER_HTML, entry({ action: 'above' }));
    expect(html).toContain('OLD BLOCK'); // block preserved
    expect(html).toContain('NEW OFFER');
    expect(html.indexOf('NEW OFFER')).toBeLessThan(html.indexOf('OLD BLOCK'));
  });

  it('inserts below the enclosing section (fidelity=section, action=below)', () => {
    const html = applyPersonalization(
      PAGE_HTML,
      OFFER_HTML,
      entry({ location: 'slot-2', action: 'below', fidelity: 'section' }),
    );
    // original section content kept, offer inserted after it
    expect(html).toContain('SECTION CONTENT');
    expect(html).toContain('NEW OFFER');
    expect(html.indexOf('SECTION CONTENT')).toBeLessThan(html.indexOf('NEW OFFER'));
  });

  it('replaces the whole <main> for a page-level treatment (fidelity=page)', () => {
    const html = applyPersonalization(PAGE_HTML, OFFER_HTML, entry({ fidelity: 'page' }));
    expect(html).toContain('NEW OFFER');
    // everything that was inside <main> is gone
    expect(html).not.toContain('OLD BLOCK');
    expect(html).not.toContain('SECTION CONTENT');
    expect(html).not.toContain('Hero');
    // the <main> shell and out-of-main markup are preserved
    expect(html).toContain('<main>');
    expect(html).toContain('</main>');
    expect(html).toContain('<header></header>');
    expect(html).toContain('<footer></footer>');
  });

  it('returns the page unchanged when the slot is absent (passthrough)', () => {
    const html = applyPersonalization(PAGE_HTML, OFFER_HTML, entry({ location: 'slot-404' }));
    expect(html).toBe(PAGE_HTML);
  });
});
