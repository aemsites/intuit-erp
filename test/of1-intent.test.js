import {
  describe, it, expect, beforeEach,
} from 'vitest';
import {
  stableSelector,
  sectionHeading,
  deriveInterests,
  deriveIntent,
  emptyProfile,
  mergeVisit,
  parseReferrer,
  classifySource,
  buildEntryContext,
  buildIntentContext,
  readProfile,
  getIntentProfile,
} from '../scripts/of1-intent.js';

// A tracked-visit factory with sensible defaults.
function visit(overrides = {}) {
  return {
    url: 'https://erp.intuit.com/',
    path: '/',
    title: 'Home',
    dwellTimeMs: 5000,
    maxScrollDepth: 0.5,
    clickTargets: [],
    focusAreas: [],
    visitedAt: 1000,
    ...overrides,
  };
}

describe('stableSelector', () => {
  it('prefers the id', () => {
    const el = document.createElement('button');
    el.id = 'buy-now';
    document.body.append(el);
    expect(stableSelector(el)).toBe('#buy-now');
  });

  it('falls back to a stable attribute', () => {
    const el = document.createElement('a');
    el.setAttribute('data-testid', 'cta');
    document.body.append(el);
    expect(stableSelector(el)).toBe('a[data-testid="cta"]');
  });

  it('builds an nth-of-type path among same-tag siblings', () => {
    document.body.innerHTML = '<ul><li>a</li><li id="target">b</li></ul>';
    const el = document.querySelector('#target');
    el.removeAttribute('id');
    expect(stableSelector(el)).toContain('li:nth-of-type(2)');
  });
});

describe('sectionHeading', () => {
  it('returns the nearest landmark heading, capped', () => {
    document.body.innerHTML = '<section><h2>Pricing plans</h2><a id="x">link</a></section>';
    expect(sectionHeading(document.querySelector('#x'))).toBe('Pricing plans');
  });

  it('returns empty string when there is no heading', () => {
    document.body.innerHTML = '<div><a id="y">link</a></div>';
    expect(sectionHeading(document.querySelector('#y'))).toBe('');
  });
});

describe('deriveInterests', () => {
  it('returns [] when no time was spent', () => {
    expect(deriveInterests([visit({ dwellTimeMs: 0 })])).toEqual([]);
  });

  it('scores by dwell + scroll + clicks and ranks descending', () => {
    const interests = deriveInterests([
      visit({
        url: 'https://x/a', path: '/a', title: 'A', dwellTimeMs: 60000, maxScrollDepth: 1, clickTargets: [{ selector: '#c', text: 'x', count: 5 }],
      }),
      visit({
        url: 'https://x/b', path: '/b', title: 'B', dwellTimeMs: 3000, maxScrollDepth: 0.1, clickTargets: [],
      }),
    ]);
    expect(interests.map((i) => i.topic)).toEqual(['A', 'B']);
    expect(interests[0].score).toBe(100); // saturates and clamps
    expect(interests[0].score).toBeGreaterThan(interests[1].score);
  });

  it('dedupes by topic keeping the best score', () => {
    const interests = deriveInterests([
      visit({ url: 'https://x/a1', title: 'A', dwellTimeMs: 6000, maxScrollDepth: 0.1 }),
      visit({ url: 'https://x/a2', title: 'A', dwellTimeMs: 60000, maxScrollDepth: 1 }),
    ]);
    expect(interests).toHaveLength(1);
    expect(interests[0].source).toBe('https://x/a2');
  });
});

describe('deriveIntent', () => {
  it('defaults to exploring with no signals', () => {
    const { topIntent } = deriveIntent([]);
    expect(topIntent).toBe('exploring');
  });

  it('infers purchase from pricing path + add-to-cart click', () => {
    const { topIntent } = deriveIntent([
      visit({
        path: '/pricing', title: 'Pricing', clickTargets: [{ selector: '#cta', text: 'Add to cart', count: 1 }],
      }),
    ]);
    expect(topIntent).toBe('purchase');
  });

  it('infers comparing from a /compare path', () => {
    const { topIntent } = deriveIntent([visit({ path: '/compare', title: 'Compare' })]);
    expect(topIntent).toBe('comparing');
  });

  it('exposes ranked intents with scores and labels', () => {
    const { intents } = deriveIntent([visit({ path: '/compare' })]);
    expect(intents).toHaveLength(6);
    expect(intents[0]).toMatchObject({ category: 'comparing', label: 'Comparing' });
  });
});

describe('mergeVisit', () => {
  it('appends a new url and recomputes interests + intent', () => {
    const profile = mergeVisit(emptyProfile('erp.intuit.com'), visit({ url: 'https://x/a', path: '/a', title: 'A' }));
    expect(profile.pageVisits).toHaveLength(1);
    expect(profile.totalTimeMs).toBe(5000);
    expect(profile.interests[0].topic).toBe('A');
    expect(profile.intentProfile.topIntent).toBeDefined();
  });

  it('accumulates dwell, maxes scroll, merges clicks, unions focus for the same url', () => {
    let profile = mergeVisit(emptyProfile('d'), visit({
      url: 'https://x/a', dwellTimeMs: 1000, maxScrollDepth: 0.3, clickTargets: [{ selector: '#a', text: 't', count: 1 }], focusAreas: ['H1'], visitedAt: 1,
    }));
    profile = mergeVisit(profile, visit({
      url: 'https://x/a', dwellTimeMs: 2000, maxScrollDepth: 0.7, clickTargets: [{ selector: '#a', text: 't', count: 2 }, { selector: '#b', text: 'u', count: 1 }], focusAreas: ['H2'], visitedAt: 2,
    }));
    expect(profile.pageVisits).toHaveLength(1);
    const [only] = profile.pageVisits;
    expect(only.dwellTimeMs).toBe(3000);
    expect(only.maxScrollDepth).toBe(0.7);
    expect(only.clickTargets.find((c) => c.selector === '#a').count).toBe(3);
    expect(only.focusAreas.sort()).toEqual(['H1', 'H2']);
  });

  it('replaces in place when visitedAt is unchanged (idempotent flush)', () => {
    let profile = mergeVisit(emptyProfile('d'), visit({ url: 'https://x/a', dwellTimeMs: 1000, visitedAt: 42 }));
    profile = mergeVisit(profile, visit({ url: 'https://x/a', dwellTimeMs: 4000, visitedAt: 42 }));
    expect(profile.pageVisits).toHaveLength(1);
    expect(profile.pageVisits[0].dwellTimeMs).toBe(4000);
  });
});

describe('parseReferrer / classifySource', () => {
  it('classifies an LLM referrer as ai', () => {
    const parsed = parseReferrer('https://chatgpt.com/', '', 'erp.intuit.com');
    expect(classifySource(parsed)).toEqual({ source: 'ai', label: 'ChatGPT' });
  });

  it('classifies a gclid as paid ads', () => {
    const parsed = parseReferrer('', '?gclid=abc', 'erp.intuit.com');
    expect(classifySource(parsed)).toEqual({ source: 'ads', label: 'Google Ads' });
  });

  it('classifies a google referrer as organic-search', () => {
    const parsed = parseReferrer('https://www.google.com/search', '', 'erp.intuit.com');
    expect(classifySource(parsed)).toEqual({ source: 'organic-search', label: 'Google (Organic)' });
  });

  it('classifies no referrer / no params as direct', () => {
    const parsed = parseReferrer('', '', 'erp.intuit.com');
    expect(classifySource(parsed).source).toBe('direct');
  });

  it('classifies an unknown external referrer as referral', () => {
    const parsed = parseReferrer('https://news.example.com/post', '', 'erp.intuit.com');
    expect(classifySource(parsed)).toEqual({ source: 'referral', label: 'news.example.com' });
  });

  it('buildEntryContext carries UTM params and llm context', () => {
    const ctx = buildEntryContext('https://chatgpt.com/', '?utm_source=x&llm_app_ctx=hello', 5, 'erp.intuit.com');
    expect(ctx.source).toBe('ai');
    expect(ctx.utmSource).toBe('x');
    expect(ctx.injectedContext).toBe('hello');
    expect(ctx.capturedAt).toBe(5);
  });
});

describe('buildIntentContext', () => {
  it('returns null without a profile', () => {
    expect(buildIntentContext(null)).toBeNull();
  });

  it('flattens the profile into decision-friendly fields', () => {
    const profile = {
      interests: [{ topic: 'ERP Migration' }, { topic: 'AI Agents' }],
      pageVisits: [{ path: '/migration' }, { path: '/ai' }],
      intentProfile: { topIntent: 'purchase' },
      entryContext: { source: 'ai' },
    };
    expect(buildIntentContext(profile)).toEqual({
      topInterests: ['ERP Migration', 'AI Agents'],
      topIntent: 'purchase',
      journeyStage: 'decision',
      pagesViewed: ['/migration', '/ai'],
      entrySource: 'ai',
    });
  });
});

describe('persistence', () => {
  beforeEach(() => window.localStorage.clear());

  it('reads null for an unknown domain', () => {
    expect(readProfile('nope.example.com')).toBeNull();
  });

  it('round-trips a written profile via the raw store', () => {
    window.localStorage.setItem('of1_behavior_profiles', JSON.stringify({ 'd.com': emptyProfile('d.com') }));
    expect(readProfile('d.com').domain).toBe('d.com');
    expect(getIntentProfile('d.com').domain).toBe('d.com');
  });
});
