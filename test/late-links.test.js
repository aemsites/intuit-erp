import {
  describe, it, expect, vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({ bindScheduleLinks: vi.fn() }));

vi.mock('../scripts/aem.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getMetadata: vi.fn((name) => (name === 'hide-contact-widget' ? 'yes' : '')),
    loadFooter: vi.fn(() => Promise.resolve()),
    loadHeader: vi.fn(() => Promise.resolve()),
    loadSection: vi.fn(() => Promise.resolve()),
    // A below-the-fold section that never finishes loading must not hold up the swapped hero.
    loadSections: vi.fn(() => new Promise(() => {})),
  };
});

// Swaps the first section after the page has rendered, the way a slow personalization decision
// lands on a real page.
vi.mock('../scripts/experience.js', () => ({
  applyEagerLayers: vi.fn(),
  applyPageExperience: vi.fn(async () => {
    window.hlx = { ...window.hlx, experienceResponse: {} };
    return false;
  }),
  applyLazyExperience: vi.fn(async (doc, onApplied) => {
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    const hero = doc.querySelector('main .section');
    hero.innerHTML = '<p><a href="#schedule">Schedule a call</a> '
      + '<a href="https://partner.example/demo#target=_self">Demo</a></p>';
    onApplied(hero);
  }),
}));

vi.mock('../scripts/schedule-modal.js', () => ({ bindScheduleLinks: mocks.bindScheduleLinks }));

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

describe('late personalization swaps', () => {
  it('decorates links in a swapped hero while other sections are still loading', async () => {
    document.body.innerHTML = '<header></header><main><div><p>Default hero</p></div></main><footer></footer>';
    await import('../scripts/scripts.js');

    const hero = document.querySelector('main .section');
    await vi.waitFor(() => expect(hero.querySelector('a[href^="https://partner"]')?.target).toBe('_self'));
    expect(hero.querySelector('a[href^="https://partner"]').getAttribute('href'))
      .toBe('https://partner.example/demo');
    await vi.waitFor(() => expect(mocks.bindScheduleLinks).toHaveBeenCalledWith(hero));
  });
});
