import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

// createOptimizedPicture pulls in the full aem.js; stub it to a bare img,
// mirroring the real function's eager -> loading attribute behavior so tests
// can assert on it.
vi.mock('../scripts/aem.js', () => ({
  createOptimizedPicture: (src, alt, eager) => {
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.loading = eager ? 'eager' : 'lazy';
    return img;
  },
}));

/**
 * Mirrors the real /events/query-index.json shape: date/time/location/speakers
 * are each optional, and the index also picks up the /events listing page itself
 * as a row with every field empty.
 */
const entries = [
  {
    path: '/events/later',
    title: 'Later event',
    type: 'Live event',
    description: 'Happens later.',
    date: '2026-10-26',
    time: '',
    location: 'ARIA Resort, Las Vegas',
    speakers: '',
    image: '/img/later.jpg',
    ctaLabel: 'Register',
    ctaUrl: 'https://example.com/later',
    status: 'upcoming',
  },
  {
    path: '/events/sooner',
    title: 'Sooner event',
    type: 'Live webinar',
    description: 'Happens sooner.',
    date: '2026-07-29',
    time: '11AM PT | 2PM ET',
    location: '',
    speakers: 'Marsha Morales, Co-Founder',
    image: '/img/sooner.jpg',
    ctaLabel: 'Register',
    ctaUrl: 'https://example.com/sooner',
    status: 'upcoming',
  },
  {
    path: '/events/replay',
    title: 'Recorded webinar',
    type: 'Webinar',
    description: 'Watch anytime.',
    date: '',
    time: '',
    location: '',
    speakers: 'Laura Davidsen, Senior Partner',
    image: '',
    ctaLabel: 'Watch now',
    ctaUrl: 'https://example.com/replay',
    status: 'on-demand',
  },
  // the /events listing page — matches the index's /events/* glob
  {
    path: '/events',
    title: '',
    type: '',
    description: '',
    date: '',
    time: '',
    location: '',
    speakers: '',
    image: '',
    ctaLabel: '',
    ctaUrl: '',
    status: '',
  },
];

vi.mock('../scripts/content-index.js', () => ({
  loadIndex: vi.fn(async () => entries),
  formatDate: (v) => (v === '2026-10-26' ? 'October 26, 2026' : v),
}));

const loadBlock = async () => (await import('../blocks/event-cards/event-cards.js')).default;

function make(variant) {
  const block = document.createElement('div');
  block.className = `event-cards ${variant} block`;
  return block;
}

describe('event-cards', () => {
  beforeEach(() => { window.innerWidth = 1440; });

  it('renders only the events matching the bucket', async () => {
    const decorate = await loadBlock();
    const upcoming = make('upcoming');
    await decorate(upcoming);
    const titles = [...upcoming.querySelectorAll('.event-card h3')].map((h) => h.textContent);
    expect(titles).toEqual(['Sooner event', 'Later event']);

    const onDemand = make('on-demand');
    await decorate(onDemand);
    expect([...onDemand.querySelectorAll('.event-card h3')].map((h) => h.textContent))
      .toEqual(['Recorded webinar']);
  });

  // issue #518: previously every card image was always lazy-loaded,
  // including the first — the LCP candidate on pages where this block is
  // the first content on the page (e.g. /events).
  it('eager-loads only the first card of the instance attached to the page', async () => {
    const decorate = await loadBlock();
    const upcoming = make('upcoming');
    document.body.append(upcoming);
    try {
      await decorate(upcoming);
      const imgs = [...upcoming.querySelectorAll('.event-card img')];
      expect(imgs[0].loading).toBe('eager');
      expect(imgs.slice(1).every((img) => img.loading === 'lazy')).toBe(true);
    } finally {
      upcoming.remove();
    }
  });

  it('skips untitled index rows such as the /events listing page', async () => {
    const decorate = await loadBlock();
    const block = make('upcoming');
    await decorate(block);
    // the empty row defaults to "upcoming" but must not become a blank card
    expect(block.querySelectorAll('.event-card').length).toBe(2);
    expect([...block.querySelectorAll('.event-card h3')].every((h) => h.textContent.trim()))
      .toBe(true);
  });

  it('sorts upcoming events soonest first', async () => {
    const decorate = await loadBlock();
    const block = make('upcoming');
    await decorate(block);
    expect([...block.querySelectorAll('.event-card h3')].map((h) => h.textContent))
      .toEqual(['Sooner event', 'Later event']);
  });

  it('renders only the authored detail fields, as labelled rows', async () => {
    const decorate = await loadBlock();
    const block = make('upcoming');
    await decorate(block);
    const card = [...block.querySelectorAll('.event-card')]
      .find((c) => c.querySelector('h3').textContent === 'Later event');
    const rows = [...card.querySelectorAll('.event-card-detail')].map((p) => p.textContent);
    // no Time or Speaker row: this event authored neither
    expect(rows).toEqual(['Date: October 26, 2026', 'Location: ARIA Resort, Las Vegas']);
    expect(card.querySelector('.event-card-detail strong').textContent).toBe('Date');
  });

  it('omits the details block and the image when neither is authored', async () => {
    const decorate = await loadBlock();
    const block = make('on-demand');
    await decorate(block);
    const card = block.querySelector('.event-card');
    expect(card.querySelector('img')).toBeNull();
    const rows = [...card.querySelectorAll('.event-card-detail')].map((p) => p.textContent);
    expect(rows).toEqual(['Speaker: Laura Davidsen, Senior Partner']);
  });

  it('renders the type as an eyebrow and the CTA as an external-safe link', async () => {
    const decorate = await loadBlock();
    const block = make('upcoming');
    await decorate(block);
    const card = block.querySelector('.event-card');
    expect(card.querySelector('.event-card-type').textContent).toBe('Live webinar');
    const cta = card.querySelector('a.button');
    expect(cta.href).toBe('https://example.com/sooner');
    expect(cta.target).toBe('_blank');
    expect(cta.rel).toBe('noopener');
  });

  it('escapes authored text rather than injecting it as markup', async () => {
    const decorate = await loadBlock();
    const block = make('on-demand');
    entries[2].title = '<img src=x onerror="window.__xss=1">';
    await decorate(block);
    expect(window.__xss).toBeUndefined();
    expect(block.querySelector('.event-card h3 img')).toBeNull();
    entries[2].title = 'Recorded webinar';
  });
});
