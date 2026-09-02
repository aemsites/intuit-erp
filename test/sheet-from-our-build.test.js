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

  it('uses a reviewed replay identity when migrated copy and destination no longer match prod', () => {
    const payloadFile = 'payloads/professional-services-article.json';
    const golden = entry({
      page: '/professional-services',
      payloadFile,
      text: 'articles|ies_for_proservices_link',
      href: 'https://erp.intuit.com/',
      exp: {
        object: 'content', action: 'engaged', ui_object: 'link',
        ui_object_detail: 'articles|ies_for_proservices_link', ui_action: 'clicked',
        object_detail: 'articles|ies_for_proservices_link',
        'data-wa-link': 'articles-ies-for-proservices-link',
      },
    });
    const current = candidate({
      label: 'Intuit Enterprise Suite for professional service firms: Read more',
      href: 'https://quickbooks.intuit.com/r/enterprise/intuit-enterprise-suite-professional-service-business/',
      tid: 'cards:quickbooks-r-enterprise-intuit-enterprise-suite-professional-service-business',
      p: {
        object: 'content', action: 'interacted', ui_object: 'link',
        ui_object_detail: 'Read more', ui_action: 'clicked',
      },
    });
    const reviewedManifest = { scenarios: [{
      goldenRef: { payloadFile },
      locator: {
        status: 'proposed', strategy: 'data-track-id', value: current.tid,
      },
    }] };

    const result = generateSheetFromBuild(
      { entries: [golden] },
      { pages: { '/professional-services': [current] } },
      reviewedManifest,
    );

    expect(result.sheet.data).toEqual([{
      path: '/professional-services',
      id: current.tid,
      'object-detail': 'articles|ies_for_proservices_link',
      action: 'engaged',
      'ui-object-detail': 'articles|ies_for_proservices_link',
      'wa-link': 'articles-ies-for-proservices-link',
    }]);
    expect(result.report).toMatchObject({ reviewedMatches: 1, reviewedTargetAbsent: [] });
  });
});
