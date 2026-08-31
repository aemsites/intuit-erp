import { describe, expect, it } from 'vitest';
import { generateSheetFromBuild } from '../scripts/diff/sheet-from-our-build.mjs';

const entry = (overrides = {}) => ({
  nonCta: false,
  page: '/erp-solutions',
  key: 'cta',
  text: 'Find out more',
  href: '',
  exp: {
    object: 'content', action: 'interacted', ui_object: 'button', ui_object_detail: 'Find out more',
    ui_action: 'clicked', ui_access_point: 'cta_block', 'data-wa-link': 'hero-schedule-call',
  },
  ...overrides,
});

const candidate = (overrides = {}) => ({
  label: 'Find out more',
  href: '',
  tid: 'hero:find-out-more',
  p: {
    object: 'content', action: 'interacted', ui_object: 'button', ui_object_detail: 'Find out more',
    ui_action: 'clicked', ui_access_point: 'hero',
  },
  ...overrides,
});

describe('sheet from our build', () => {
  it('keys authorable residue by the Stage runtime id', () => {
    const result = generateSheetFromBuild(
      { entries: [entry()] },
      { pages: { '/erp-solutions': [candidate()] } },
    );
    expect(result.sheet.data).toEqual([{
      path: '/erp-solutions', id: 'hero:find-out-more', 'wa-link': 'hero-schedule-call',
    }]);
    expect(result.report).toMatchObject({ emitted: 1, idRemapped: 1, ambiguous: [] });
  });

  it('reports accepted access-point-only differences without authoring residue', () => {
    const source = entry({ exp: { ...entry().exp, 'data-wa-link': '' } });
    const result = generateSheetFromBuild(
      { entries: [source] },
      { pages: { '/erp-solutions': [candidate()] } },
    );
    expect(result.sheet.data).toEqual([]);
    expect(result.report.acceptedUiAccessPointOnly).toHaveLength(1);
  });

  it('refuses duplicate identity matches instead of using DOM order', () => {
    const result = generateSheetFromBuild(
      { entries: [entry()] },
      { pages: { '/erp-solutions': [
        candidate({ tid: 'hero:find-out-more' }),
        candidate({ tid: 'cards:find-out-more' }),
      ] } },
    );
    expect(result.sheet.data).toEqual([]);
    expect(result.report.ambiguous).toEqual([{
      page: '/erp-solutions',
      goldenTrackId: 'cta:find-out-more',
      candidateTrackIds: ['hero:find-out-more', 'cards:find-out-more'],
    }]);
  });
});
