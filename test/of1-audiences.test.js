import { describe, it, expect } from 'vitest';
import { readAlloySegmentIds } from '../scripts/of1-rtcdp-signal.js';

describe('readAlloySegmentIds', () => {
  it('extracts deduped segment ids from destinations', () => {
    const result = {
      destinations: [
        { alias: 'aem', segments: [{ id: 'a', namespace: 'ups' }, { id: 'b', namespace: 'ups' }] },
      ],
    };
    expect(readAlloySegmentIds(result)).toEqual(['a', 'b']);
  });

  it('dedupes ids across destinations', () => {
    const result = {
      destinations: [{ segments: [{ id: 'a' }] }, { segments: [{ id: 'a' }, { id: 'c' }] }],
    };
    expect(readAlloySegmentIds(result)).toEqual(['a', 'c']);
  });

  it('returns [] for missing/empty/invalid input', () => {
    expect(readAlloySegmentIds(undefined)).toEqual([]);
    expect(readAlloySegmentIds({})).toEqual([]);
    expect(readAlloySegmentIds({ destinations: [] })).toEqual([]);
    expect(readAlloySegmentIds({ destinations: [{}] })).toEqual([]);
  });
});
