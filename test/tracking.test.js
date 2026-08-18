import { describe, it, expect } from 'vitest';
import {
  slug, uiObject, blockAccessPoint, deriveBaseline,
} from '../scripts/tracking.js';

describe('slug', () => {
  it('slugifies a visible label to lowercase hyphenated', () => {
    expect(slug('Schedule a call')).toBe('schedule-a-call');
  });
  it('collapses runs of non-alphanumerics and trims edges', () => {
    expect(slug('  Get   Started! ')).toBe('get-started');
  });
  it('is empty for empty/undefined input', () => {
    expect(slug('')).toBe('');
    expect(slug(undefined)).toBe('');
  });
});

describe('uiObject', () => {
  it('reports button for a <button>', () => {
    expect(uiObject('BUTTON', false)).toBe('button');
  });
  it('reports button for a styled anchor, link for a plain anchor', () => {
    expect(uiObject('A', true)).toBe('button');
    expect(uiObject('A', false)).toBe('link');
  });
});

describe('blockAccessPoint', () => {
  it('defaults from the block name with a _block suffix', () => {
    expect(blockAccessPoint('cta')).toBe('cta_block');
  });
  it('normalizes hyphens to underscores (trail convention)', () => {
    expect(blockAccessPoint('rw-cards')).toBe('rw_cards_block');
  });
  it('is empty when there is no block name', () => {
    expect(blockAccessPoint('')).toBe('');
  });
});

describe('deriveBaseline', () => {
  it('derives the full identity baseline for a styled CTA button', () => {
    const b = deriveBaseline({
      tagName: 'A', label: 'Schedule a call', blockName: 'cta', isButtonStyled: true,
    });
    expect(b.object).toBe('content');
    expect(b['ui-object']).toBe('button');
    expect(b['ui-object-detail']).toBe('Schedule a call');
    expect(b['ui-action']).toBe('clicked');
    expect(b.action).toBe('interacted');
    expect(b.anchor).toBe('button');
    expect(b['access-point']).toBe('cta_block');
    expect(b['custom-properties']).toEqual({ link_name: 'button-schedule-a-call' });
  });

  it('matches the live erp.intuit.com cta_block button (parity anchor)', () => {
    // CLICK-TRACKING.md worked example #2/#3: <button> "Schedule a call" in cta block.
    const b = deriveBaseline({ tagName: 'BUTTON', label: 'Schedule a call', blockName: 'cta' });
    expect(b['ui-object']).toBe('button');
    expect(b['ui-object-detail']).toBe('Schedule a call');
    expect(b['custom-properties'].link_name).toBe('button-schedule-a-call');
    expect(b['access-point']).toBe('cta_block');
  });

  it('omits link_name when the CTA has no label', () => {
    const b = deriveBaseline({ tagName: 'A', label: '', blockName: 'cta' });
    expect(b['custom-properties']).toEqual({});
  });
});
