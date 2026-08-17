import {
  describe, it, expect, afterEach,
} from 'vitest';
import {
  resolveIvid, buildPznAttributes, buildBatchBody, ixpParams,
} from '../scripts/personalization/attributes.js';

afterEach(() => {
  window.history.replaceState({}, '', '/');
  document.head.innerHTML = '';
  document.cookie = 'ivid=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

function setMeta(name, content) {
  const m = document.createElement('meta');
  m.setAttribute('name', name);
  m.setAttribute('content', content);
  document.head.appendChild(m);
}

describe('resolveIvid', () => {
  it('prefers a page ?ivid= override', () => {
    window.history.replaceState({}, '', '/page?ivid=qa123');
    document.cookie = 'ivid=cookie-abc';
    expect(resolveIvid()).toBe('qa123');
  });

  it('falls back to the ivid cookie when there is no ?ivid=', () => {
    document.cookie = 'ivid=cookie-abc';
    expect(resolveIvid()).toBe('cookie-abc');
  });

  it('is undefined when neither is present', () => {
    expect(resolveIvid()).toBeUndefined();
  });
});

describe('buildPznAttributes', () => {
  it('sends the browser-derivable fields and no IP/geo', () => {
    const attrs = buildPznAttributes('/some/path');
    expect(attrs).toMatchObject({
      permalink: '/some/path',
      deviceType: 'Desktop',
      newVisitor: true,
    });
    expect(typeof attrs.locale).toBe('string');
    // IP/geo is Akamai's job — never sent from the browser.
    ['country_code', 'region_code', 'latitude', 'longitude', 'ipAddress'].forEach((k) => {
      expect(attrs).not.toHaveProperty(k);
    });
  });

  it('defaults the permalink to the current path', () => {
    window.history.replaceState({}, '', '/current');
    expect(buildPznAttributes().permalink).toBe('/current');
  });

  it('includes ivid only when resolvable', () => {
    expect(buildPznAttributes('/x')).not.toHaveProperty('ivid');
    document.cookie = 'ivid=abc';
    expect(buildPznAttributes('/x').ivid).toBe('abc');
  });

  it('includes casId from page metadata (cas-id or page-cas-id)', () => {
    expect(buildPznAttributes('/x')).not.toHaveProperty('casId');
    setMeta('cas-id', '1223344');
    expect(buildPznAttributes('/x').casId).toBe('1223344');
  });

  it('honors a ?locale= override', () => {
    window.history.replaceState({}, '', '/x?locale=fr-FR');
    expect(buildPznAttributes('/x').locale).toBe('fr-FR');
  });
});

describe('buildBatchBody', () => {
  it('builds one batchItem per placement plus a shared attributes object', () => {
    const body = buildBatchBody(['alpha', 'beta'], '/p');
    expect(body.batchItems).toEqual([
      {
        placement: 'alpha', experience: 'marketing', numberOfRecommendations: 1, recommendationMetadata: true,
      },
      {
        placement: 'beta', experience: 'marketing', numberOfRecommendations: 1, recommendationMetadata: true,
      },
    ]);
    expect(body.attributes).toMatchObject({ permalink: '/p', newVisitor: true });
  });
});

describe('ixpParams', () => {
  it('uses experimentId for a numeric id and label otherwise', () => {
    expect(ixpParams('385944')).toBe('experimentId=385944');
    expect(ixpParams('Homepage_Hero')).toBe('label=Homepage_Hero');
  });

  it('appends ivid when resolvable', () => {
    document.cookie = 'ivid=abc';
    const params = new URLSearchParams(ixpParams('385944'));
    expect(params.get('experimentId')).toBe('385944');
    expect(params.get('ivid')).toBe('abc');
  });
});
