import { describe, it, expect } from 'vitest';
import { assignmentToPznEntry } from '../src/ixp/resolve.js';

const ROUTE = { location: 'slot-1', fidelity: 'block' };

/** The redirect payload key the real IXP API carries the variation path under. */
const VARIATION_KEY = 'intuit.com.integration.variation.html';

/** Builds an assignment with only the fields the consumer reads set. */
function assignment(partial) {
  return {
    experimentId: 385944,
    experimentType: 'REPLACE_WEB_CONTENT',
    label: '',
    payload: '',
    assetLocation: null,
    control: false,
    ...partial,
  };
}

describe('assignmentToPznEntry', () => {
  it('maps REDIRECT + the variation.html key to a page-level replace', () => {
    const entry = assignmentToPznEntry(
      assignment({
        experimentType: 'REDIRECT',
        payload: JSON.stringify({ [VARIATION_KEY]: '/x-variant' }),
      }),
      ROUTE,
      '/x',
    );
    expect(entry).toEqual({
      path: '/x', fragment: '/x-variant', location: 'slot-1', action: 'replace', fidelity: 'page',
    });
  });

  it('maps REPLACE_WEB_CONTENT + assetLocation to a block replace at the route slot', () => {
    const entry = assignmentToPznEntry(
      assignment({ experimentType: 'REPLACE_WEB_CONTENT', assetLocation: '/fragments/pzn/automation' }),
      ROUTE,
      '/x',
    );
    expect(entry).toEqual({
      path: '/x',
      fragment: '/fragments/pzn/automation',
      location: 'slot-1',
      action: 'replace',
      fidelity: 'block',
    });
  });

  it('returns null for the control arm (baseline)', () => {
    expect(assignmentToPznEntry(assignment({ control: true }), ROUTE, '/x')).toBeNull();
  });

  it('returns null for a DEFAULT (no-treatment) type', () => {
    expect(assignmentToPznEntry(assignment({ experimentType: 'DEFAULT' }), ROUTE, '/x')).toBeNull();
  });

  it('returns null for REDIRECT without the variation key', () => {
    const entry = assignmentToPznEntry(
      assignment({ experimentType: 'REDIRECT', payload: JSON.stringify({ other: '/x' }) }),
      ROUTE,
      '/x',
    );
    expect(entry).toBeNull();
  });

  it('returns null for REPLACE_WEB_CONTENT without an assetLocation', () => {
    expect(assignmentToPznEntry(assignment({ assetLocation: null }), ROUTE, '/x')).toBeNull();
  });
});
