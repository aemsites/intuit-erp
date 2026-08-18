import { describe, it, expect } from 'vitest';
import { parseKeyValues, normalizeRow, indexRows } from '../scripts/tracking/sheet.js';

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
  it('parses custom-properties and survey to maps, coerces cta', () => {
    const cfg = normalizeRow({
      key: 'k', cta: '2', 'custom-properties': 'campaign=x', survey: 'survey-name=nps',
    });
    expect(cfg['custom-properties']).toEqual({ campaign: 'x' });
    expect(cfg.survey).toEqual({ 'survey-name': 'nps' });
    expect(cfg.cta).toBe(2);
  });
  it('omits cta when not a number', () => {
    expect(normalizeRow({ key: 'k' }).cta).toBeUndefined();
  });
});

describe('indexRows', () => {
  it('groups rows by key and orders by cta (blank cta last)', () => {
    const byKey = indexRows([
      { key: 'multi', cta: '2', object: 'b' },
      { key: 'multi', object: 'z' },
      { key: 'multi', cta: '1', object: 'a' },
      { key: 'solo', object: 'x' },
    ]);
    expect(byKey.get('multi').map((r) => r.object)).toEqual(['a', 'b', 'z']);
    expect(byKey.get('solo')).toHaveLength(1);
  });
  it('skips rows without a key and handles empty input', () => {
    expect(indexRows([{ object: 'x' }]).size).toBe(0);
    expect(indexRows(undefined).size).toBe(0);
  });
});
