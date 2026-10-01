import {
  describe, it, expect, vi,
} from 'vitest';
import decorateLinkTargets from '../scripts/link-target.js';

vi.mock('../scripts/aem.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getMetadata: vi.fn((name) => (name === 'hide-contact-widget' ? 'yes' : '')),
    loadFooter: vi.fn(),
    loadHeader: vi.fn(),
    loadSections: vi.fn(),
  };
});

vi.mock('../scripts/experience.js', () => ({
  applyEagerLayers: vi.fn(),
  applyPageExperience: vi.fn().mockResolvedValue(false),
}));

vi.mock('../plugins/tealium-martech/src/index.js', () => ({
  default: class TealiumMartech {
    eager() {}

    lazy() {}
  },
  parseTealiumLoadPhase: vi.fn(),
  parseTealiumTagUids: vi.fn(),
}));

vi.mock('../scripts/ecs-enrich.js', () => ({
  default: vi.fn(),
}));

import { decorateExternalLinks } from '../scripts/scripts.js';

describe('author-controlled link targets', () => {
  it('supports both targets and preserves queries and existing fragments', () => {
    const main = document.createElement('main');
    main.innerHTML = `
      <a href="/account?plan=pro#details#target=_blank" rel="nofollow">New tab</a>
      <a href="https://partner.example/help#support#target=_self" target="_blank">Same tab</a>`;

    decorateLinkTargets(main);

    const [newTab, sameTab] = main.querySelectorAll('a');
    expect(newTab.getAttribute('href')).toBe('/account?plan=pro#details');
    expect(newTab.target).toBe('_blank');
    expect(newTab.relList.contains('nofollow')).toBe(true);
    expect(newTab.relList.contains('noopener')).toBe(true);
    expect(sameTab.getAttribute('href')).toBe('https://partner.example/help#support');
    expect(sameTab.target).toBe('_self');
  });

  it('keeps current behavior for unmarked links and ignores unsupported markers', () => {
    const main = document.createElement('main');
    main.innerHTML = `
      <a href="https://partner.example/page">External</a>
      <a href="/internal">Internal</a>
      <a href="/page#target=_parent">Unsupported</a>`;

    decorateLinkTargets(main);

    const [external, internal, unsupported] = main.querySelectorAll('a');
    expect(external.hasAttribute('target')).toBe(false);
    expect(internal.hasAttribute('target')).toBe(false);
    expect(unsupported.getAttribute('href')).toBe('/page#target=_parent');
    expect(unsupported.hasAttribute('target')).toBe(false);
  });

  it('opens unmarked off-site links but leaves same-host links in the current tab', () => {
    const main = document.createElement('main');
    main.innerHTML = `
      <a href="https://partner.example/page">External</a>
      <a href="${window.location.origin}/internal">Same host</a>`;

    decorateExternalLinks(main);

    const [external, sameHost] = main.querySelectorAll('a');
    expect(external.target).toBe('_blank');
    expect(external.relList.contains('noopener')).toBe(true);
    expect(sameHost.hasAttribute('target')).toBe(false);
    expect(sameHost.hasAttribute('rel')).toBe(false);
  });
});
