import { describe, it, expect } from 'vitest';
import { parseKeyValues, normalizeRow, indexRows } from '../scripts/tracking.js';

describe('parseKeyValues', () => {
  it('parses newline-separated k=v pairs', () => {
    expect(parseKeyValues('link_name=button-x\ncampaign=spring')).toEqual({
      link_name: 'button-x', campaign: 'spring',
    });
  });
  it('parses semicolon-separated pairs and trims', () => {
    expect(parseKeyValues(' a = 1 ; b = 2 ')).toEqual({ a: '1', b: '2' });
  });
  it('keeps `=` inside the value', () => {
    expect(parseKeyValues('u=a=b')).toEqual({ u: 'a=b' });
  });
  it('skips malformed segments and blanks', () => {
    expect(parseKeyValues('noequals\n=novalue\n\nok=1')).toEqual({ ok: '1' });
    expect(parseKeyValues('')).toEqual({});
    expect(parseKeyValues(undefined)).toEqual({});
  });
});

describe('normalizeRow', () => {
  it('drops blank cells so the row defers to derived values', () => {
    const cfg = normalizeRow({
      key: 'k', object: 'content', 'object-detail': '', 'ui-object': '  ', 'wa-link': 'ies:demo',
    });
    expect(cfg).toEqual({ object: 'content', 'wa-link': 'ies:demo' });
  });
  it('parses custom-properties and survey to maps', () => {
    const cfg = normalizeRow({
      key: 'k', 'custom-properties': 'campaign=x', survey: 'survey-name=nps',
    });
    expect(cfg['custom-properties']).toEqual({ campaign: 'x' });
    expect(cfg.survey).toEqual({ 'survey-name': 'nps' });
  });
});

describe('indexRows (unique keys)', () => {
  it('maps each unique key to its row (duplicate key -> last wins)', () => {
    const byKey = indexRows([
      { key: 'hero-1', object: 'a' },
      { key: 'hero-2', object: 'b' },
      { key: 'solo', object: 'x' },
      { key: 'hero-1', object: 'dup' },
    ]);
    expect(byKey.get('hero-1').object).toBe('dup');
    expect(byKey.get('hero-2').object).toBe('b');
    expect(byKey.get('solo').object).toBe('x');
    expect(byKey.size).toBe(3);
  });
  it('skips rows without a key and handles empty input', () => {
    expect(indexRows([{ object: 'x' }]).size).toBe(0);
    expect(indexRows(undefined).size).toBe(0);
  });
  it('composes path + key into the internal composite (per-page body)', () => {
    const byKey = indexRows([
      { path: '/accounting/multi-entity', key: 'faq-3', 'object-detail': 'faq|question_3' },
      { path: '/pricing/', key: 'cta-1', 'wa-link': 'z' }, // trailing slash normalized
    ]);
    expect(byKey.get('/accounting/multi-entity|faq-3')['object-detail']).toBe('faq|question_3');
    expect(byKey.get('/pricing|cta-1')['wa-link']).toBe('z');
  });
  it('treats * or blank path as site-wide (bare key)', () => {
    const byKey = indexRows([
      { path: '*', key: 'nav-1', 'wa-link': 'a' },
      { path: '', key: 'footer-1', 'wa-link': 'b' },
    ]);
    expect(byKey.get('nav-1')['wa-link']).toBe('a');
    expect(byKey.get('footer-1')['wa-link']).toBe('b');
  });
  it('drops residue-less rows (only a key, everything else blank)', () => {
    const byKey = indexRows([
      { path: '/x', key: 'page-1' }, // no residue -> no-op
      { path: '/x', key: 'page-2', 'wa-link': 'keep' },
    ]);
    expect(byKey.has('/x|page-1')).toBe(false);
    expect(byKey.get('/x|page-2')['wa-link']).toBe('keep');
    expect(byKey.size).toBe(1);
  });
});
