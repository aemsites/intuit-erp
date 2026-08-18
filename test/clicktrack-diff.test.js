import { describe, it, expect } from 'vitest';
import { payloadsFrom, diffCaptures } from '../scripts/diff/clicktrack-diff.mjs';

const block = (attrs) => `<div data-tracking="cta_block"><button ${attrs} data-tracking="button">`
  + '<span>Schedule a call</span></button></div>';
const FULL = 'data-object="content" data-ui-object="button" data-ui-object-detail="Schedule a call" data-ui-access-point=""';

describe('payloadsFrom', () => {
  it('computes a payload per trackable CTA', () => {
    const list = payloadsFrom(block(FULL));
    expect(list).toHaveLength(1);
    expect(list[0].payload.object).toBe('content');
    expect(list[0].payload.ui_access_point).toBe('cta_block');
  });
  it('skips untrackable elements (no object/wa-link)', () => {
    expect(payloadsFrom('<div data-tracking="cta_block"><a href="#">x</a></div>')).toHaveLength(0);
  });
});

describe('diffCaptures', () => {
  it('all matched, no diffs when ours reproduces prod', () => {
    const r = diffCaptures(payloadsFrom(block(FULL)), payloadsFrom(block(FULL)));
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].diffs).toEqual([]);
    expect(r.missing).toHaveLength(0);
    expect(r.extra).toHaveLength(0);
  });
  it('flags a drifted field (still matched by identity key)', () => {
    const b = payloadsFrom(block(FULL));
    const o = payloadsFrom(block(`${FULL} data-object-detail="changed"`));
    const r = diffCaptures(b, o);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].diffs.join()).toMatch(/object_detail/);
  });
  it('reports a CTA missing in ours', () => {
    expect(diffCaptures(payloadsFrom(block(FULL)), []).missing).toHaveLength(1);
  });
  it('reports an extra CTA in ours', () => {
    expect(diffCaptures([], payloadsFrom(block(FULL))).extra).toHaveLength(1);
  });
});
