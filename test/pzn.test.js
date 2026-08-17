import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

vi.mock('../scripts/personalization/decision.js', () => ({
  fetchDecision: vi.fn(),
  applyFragment: vi.fn().mockResolvedValue(true),
}));

// eslint-disable-next-line import/first
import { collectSlots, runPersonalization } from '../scripts/pzn.js';
// eslint-disable-next-line import/first
import { fetchDecision, applyFragment } from '../scripts/personalization/decision.js';
// eslint-disable-next-line import/first
import { resetAnalytics } from '../scripts/personalization/analytics.js';

beforeEach(() => {
  resetAnalytics();
  delete window.appVars;
  // restoreMocks wipes the factory's mockResolvedValue before each test; re-arm the
  // applied-successfully default so applyFragment resolves like production.
  applyFragment.mockResolvedValue(true);
  // Run the idle-deferred analytics flush synchronously for deterministic asserts.
  window.requestIdleCallback = (cb) => { cb(); return 0; };
});
afterEach(() => {
  vi.clearAllMocks();
  delete window.requestIdleCallback;
  resetAnalytics();
  delete window.appVars;
});

function main(html) {
  const m = document.createElement('main');
  m.innerHTML = html;
  return m;
}

// A raw batch response entry keyed <experience>_<placement>_<locale>. `placement`
// is echoed (case may differ from the slot); recommendations nest under
// `.recommendation[]` and the EDS fragment path is copyData.pznblock (real shape).
function batch(placement, pznblock, extra = {}) {
  return {
    [`ttcom_${placement}_en_US`]: {
      data: {
        recommendations: {
          recommendation: [{
            id: `rec-${placement}`, accessPoint: placement, copyData: { pznblock, contentId: '1223344' }, ...extra,
          }],
        },
      },
      placement,
      experience: 'ttcom',
      status: 200,
    },
  };
}

describe('collectSlots', () => {
  it('finds data-pzn sections and reads the placement verbatim; whole-section target', () => {
    const m = main('<div data-pzn="sbsegQbmRetail"><p>base</p></div><div class="hero"></div>');
    const slots = collectSlots(m);
    expect(slots).toHaveLength(1);
    expect(slots[0].placement).toBe('sbsegQbmRetail');
    expect(slots[0].el).toBe(m.querySelector('[data-pzn]'));
  });

  it('scopes to the named block when data-pzn-block is set', () => {
    const m = main('<div data-pzn="x" data-pzn-block="cards"><div class="cards" data-block-name="cards"></div><div class="hero" data-block-name="hero"></div></div>');
    const slots = collectSlots(m);
    expect(slots).toHaveLength(1);
    expect(slots[0].el).toBe(m.querySelector('[data-block-name="cards"]'));
  });

  it('matches the root section itself', () => {
    const m = main('<div data-pzn="alpha"></div>');
    const section = m.querySelector('[data-pzn]');
    const slots = collectSlots(section);
    expect(slots).toHaveLength(1);
    expect(slots[0].el).toBe(section);
  });

  it('excludes the skipped section', () => {
    const m = main('<div data-pzn="alpha"></div><div data-pzn="beta"></div>');
    const first = m.querySelector('[data-pzn]');
    const slots = collectSlots(m, first);
    expect(slots.map((s) => s.placement)).toEqual(['beta']);
  });

  it('drops a block-scoped tag whose block is not found', () => {
    const m = main('<div data-pzn="x" data-pzn-block="missing"><div class="hero" data-block-name="hero"></div></div>');
    expect(collectSlots(m)).toEqual([]);
  });

  it('returns [] when there are no data-pzn sections', () => {
    expect(collectSlots(main('<div class="hero"></div>'))).toEqual([]);
  });
});

describe('runPersonalization', () => {
  it('batches all placements into one /api/pzn call and swaps each matched slot', async () => {
    const m = main('<div data-pzn="alpha"></div><div data-pzn="beta"></div>');
    // Response echoes ALPHA (upper), slot is alpha → matched case-insensitively.
    fetchDecision.mockResolvedValue(batch('ALPHA', '/fragments/pzn/a'));
    await runPersonalization(m);

    expect(fetchDecision).toHaveBeenCalledTimes(1);
    const [source, opts] = fetchDecision.mock.calls[0];
    expect(source).toBe('pzn');
    expect(opts.method).toBe('POST');
    expect(opts.body.slots).toEqual([{ placement: 'alpha' }, { placement: 'beta' }]);

    expect(applyFragment).toHaveBeenCalledTimes(1);
    expect(applyFragment.mock.calls[0][0]).toBe(m.querySelector('[data-pzn="alpha"]'));
    expect(applyFragment.mock.calls[0][1]).toBe('/fragments/pzn/a');
  });

  it('publishes the pzn analytics record onto window.appVars', async () => {
    const m = main('<div data-pzn="alpha"></div>');
    fetchDecision.mockResolvedValue(batch('ALPHA', '/fragments/pzn/a'));
    await runPersonalization(m);

    const records = window.appVars.pznRecDetailsArr;
    expect(Array.isArray(records)).toBe(true);
    expect(records).toEqual([expect.objectContaining({
      personalization_placement: 'ALPHA',
      personalization_id: 'rec-ALPHA',
      personalization_action: 'im',
      personalization_workflow: 'marketing',
      content_id: '1223344',
      externalContentIdentifier: '1223344',
    })]);
    expect(window.appVars.pznPageRecDetailsArr).toEqual([]);
  });

  it('applies a block-scoped decision to the named block, not the section', async () => {
    const m = main('<div data-pzn="alpha" data-pzn-block="cards"><div class="cards" data-block-name="cards"></div></div>');
    fetchDecision.mockResolvedValue(batch('alpha', '/fragments/pzn/a'));
    await runPersonalization(m);
    expect(applyFragment).toHaveBeenCalledWith(m.querySelector('[data-block-name="cards"]'), '/fragments/pzn/a');
  });

  it('applies a decision to every section sharing the same placement', async () => {
    const m = main('<div data-pzn="alpha"></div><div data-pzn="alpha"></div>');
    fetchDecision.mockResolvedValue(batch('alpha', '/fragments/pzn/a'));
    await runPersonalization(m);
    expect(fetchDecision.mock.calls[0][1].body.slots).toEqual([{ placement: 'alpha' }]);
    expect(applyFragment).toHaveBeenCalledTimes(2);
  });

  it('does nothing when there are no slots (no api call)', async () => {
    await runPersonalization(main('<div class="hero"></div>'));
    expect(fetchDecision).not.toHaveBeenCalled();
  });

  it('leaves the baseline when the api returns null / empty', async () => {
    fetchDecision.mockResolvedValue(null);
    await runPersonalization(main('<div data-pzn="alpha"></div>'));
    expect(applyFragment).not.toHaveBeenCalled();

    fetchDecision.mockResolvedValue({});
    await runPersonalization(main('<div data-pzn="alpha"></div>'));
    expect(applyFragment).not.toHaveBeenCalled();
  });

  it('honors { skip } to exclude a section', async () => {
    const m = main('<div data-pzn="alpha"></div><div data-pzn="beta"></div>');
    const first = m.querySelector('[data-pzn]');
    fetchDecision.mockResolvedValue({});
    await runPersonalization(m, { skip: first });
    expect(fetchDecision.mock.calls[0][1].body.slots).toEqual([{ placement: 'beta' }]);
  });

  // The block-level click channel: the applied slot carries the offer identity as the
  // data-* attributes the SBSEG click tracker walks ancestors for.
  describe('click-channel stamping', () => {
    it('stamps data-pzn-placement and data-pzn-id (from the response, not the config) on the applied slot', async () => {
      const m = main('<div data-pzn="alpha"></div>');
      // Slot config is `alpha`; the response echoes `ALPHA` — the stamp uses the
      // response value, matching the analytics record's personalization_placement.
      fetchDecision.mockResolvedValue(batch('ALPHA', '/fragments/pzn/a'));
      await runPersonalization(m);
      const el = m.querySelector('[data-pzn="alpha"]');
      expect(el.getAttribute('data-pzn-placement')).toBe('ALPHA');
      expect(el.getAttribute('data-pzn-id')).toBe('rec-ALPHA');
    });

    it('stamps the experiment identity when the offer carries one', async () => {
      const m = main('<div data-pzn="alpha"></div>');
      fetchDecision.mockResolvedValue(batch('alpha', '/fragments/pzn/a', {
        experimentId: 385944, experimentVersion: 7, treatmentId: 39927,
      }));
      await runPersonalization(m);
      const el = m.querySelector('[data-pzn="alpha"]');
      expect(el.getAttribute('data-experiment-id')).toBe('385944');
      expect(el.getAttribute('data-experiment-version')).toBe('7');
      expect(el.getAttribute('data-treatment-id')).toBe('39927');
    });

    it('omits the experiment attributes when the offer has none', async () => {
      const m = main('<div data-pzn="alpha"></div>');
      fetchDecision.mockResolvedValue(batch('alpha', '/fragments/pzn/a'));
      await runPersonalization(m);
      const el = m.querySelector('[data-pzn="alpha"]');
      expect(el.hasAttribute('data-experiment-id')).toBe(false);
      expect(el.hasAttribute('data-experiment-version')).toBe(false);
      expect(el.hasAttribute('data-treatment-id')).toBe(false);
    });

    it('stamps the named block, not the section, for a block-scoped slot', async () => {
      const m = main('<div data-pzn="alpha" data-pzn-block="cards"><div class="cards" data-block-name="cards"></div></div>');
      fetchDecision.mockResolvedValue(batch('alpha', '/fragments/pzn/a'));
      await runPersonalization(m);
      const block = m.querySelector('[data-block-name="cards"]');
      expect(block.getAttribute('data-pzn-placement')).toBe('alpha');
      expect(block.getAttribute('data-pzn-id')).toBe('rec-alpha');
      expect(m.querySelector('[data-pzn]').hasAttribute('data-pzn-placement')).toBe(false);
    });

    it('stamps every slot sharing the placement', async () => {
      const m = main('<div data-pzn="alpha"></div><div data-pzn="alpha"></div>');
      fetchDecision.mockResolvedValue(batch('alpha', '/fragments/pzn/a'));
      await runPersonalization(m);
      const els = [...m.querySelectorAll('[data-pzn="alpha"]')];
      expect(els).toHaveLength(2);
      els.forEach((el) => expect(el.getAttribute('data-pzn-id')).toBe('rec-alpha'));
    });

    it('does not stamp when the swap does not land (applyFragment returns false)', async () => {
      const m = main('<div data-pzn="alpha"></div>');
      fetchDecision.mockResolvedValue(batch('alpha', '/fragments/pzn/a'));
      applyFragment.mockResolvedValueOnce(false);
      await runPersonalization(m);
      expect(m.querySelector('[data-pzn="alpha"]').hasAttribute('data-pzn-placement')).toBe(false);
    });
  });
});
