import { describe, it, expect } from 'vitest';
import {
  payloadsFrom, diffCaptures, perClickOf,
} from '../scripts/diff/clicktrack-diff.mjs';

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

describe('simulate — Option B JIT-stamp on the OURS side (clean at rest)', () => {
  const OURS = '<main><div class="cta block tracking-demo" data-block-name="cta">'
    + '<p class="button-wrapper"><a class="button" href="#">Schedule a call</a></p></div></main>';

  it('finds nothing at rest but derives a payload once JIT-simulated', () => {
    expect(payloadsFrom(OURS)).toHaveLength(0); // Option B stamps nothing until interaction
    const list = payloadsFrom(OURS, { simulate: true });
    expect(list).toHaveLength(1);
    expect(list[0].payload.event).toBe('content:interacted');
    expect(list[0].payload.ui_object).toBe('button');
    expect(list[0].payload.ui_object_detail).toBe('Schedule a call');
    expect(list[0].payload.ui_access_point).toBe('cta_block');
    expect(list[0].payload.link_name).toBe('button-schedule-a-call');
  });

  it('forceTrackAll derives even outside a tracking- block', () => {
    const html = '<main><div class="hero block"><p><a class="button" href="#">Go</a></p></div></main>';
    expect(payloadsFrom(html, { simulate: true })).toHaveLength(0); // not opted in
    expect(payloadsFrom(html, { simulate: true, forceTrackAll: true })).toHaveLength(1);
  });
});

describe('perClickOf', () => {
  it('extracts the diffable per-click fields from a Segment envelope, excluding context', () => {
    const env = {
      event: 'content:engaged',
      properties: {
        object: 'content', action: 'engaged', ui_object: 'link',
        experiment_ids: '1:2:3', site_section: 'cmo|mktg|corp', org: 'cmo',
      },
    };
    const pc = perClickOf(env);
    expect(pc.event).toBe('content:engaged');
    expect(pc.object).toBe('content');
    expect(pc.ui_object).toBe('link');
    expect(pc.experiment_ids).toBeUndefined(); // context inherited, not diffed
    expect(pc.site_section).toBeUndefined();
    expect(pc.org).toBeUndefined();
  });
});
