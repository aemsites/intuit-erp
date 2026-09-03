import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import decorate, {
  filterEntries, cardEl, categoryLabel, distinctValues,
} from '../blocks/blog-cards/blog-cards.js';
import { initTracking, resetTrackingState, stampInteraction } from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

const data = [
  {
    path: '/blog/financials/a', title: 'A', category: 'financials', date: '2026-02-01', author: 'abigail-sims', image: '/a.jpg', description: 'da', tags: 'automation, ai',
  },
  {
    path: '/blog/erp/b', title: 'B', category: 'erp', date: '2026-03-01', author: 'bob-wang', image: '/b.jpg', description: 'db', tags: 'automation',
  },
  {
    path: '/blog/financials/c', title: 'C', category: 'financials', date: '2026-01-01', author: 'abigail-sims', image: '/c.jpg', description: 'dc', tags: 'multi-entity',
  },
];

// The two shapes the live feed carries in `hero-video-url` (an /embed/ URL and a
// watch?v= one); both must resolve to a play badge + lightbox.
const videoEntry = {
  path: '/blog/case-study/hfmm-legacy-group-growth',
  title: 'HFMM legacy group growth',
  category: 'case-study',
  date: '2026-02-15',
  image: '/hfmm.jpg',
  'hero-video-url': 'https://www.youtube.com/embed/Wk8JSGDOvx8?autoplay=1&showinfo=0&rel=0&enablejsapi=1',
};

const watchVideoEntry = {
  path: '/blog/product-update/summer-2026-release-notes',
  title: 'Summer 2026 release notes',
  category: 'product-update',
  date: '2026-02-10',
  'hero-video-url': 'https://www.youtube.com/watch?v=asJBXQnNFyo',
};

describe('filterEntries', () => {
  it('filters by category and sorts by date desc', () => {
    const out = filterEntries(data, { category: 'financials' });
    expect(out.map((e) => e.title)).toEqual(['A', 'C']);
  });
  it('filters by author and respects limit', () => {
    const out = filterEntries(data, { author: 'abigail-sims', limit: 1 });
    expect(out.length).toBe(1);
    expect(out[0].title).toBe('A');
  });
  it('excludes the current path (for recommended grids)', () => {
    const out = filterEntries(data, { category: 'financials', excludePath: '/blog/financials/a' });
    expect(out.map((e) => e.title)).toEqual(['C']);
  });
  it('excludes the current path despite a trailing-slash mismatch', () => {
    // post-folderization the live pathname carries a trailing slash; the feed/author value may not
    const slashedExclude = filterEntries(data, { category: 'financials', excludePath: '/blog/financials/a/' });
    expect(slashedExclude.map((e) => e.title)).toEqual(['C']);
    const slashedFeed = data.map((e) => ({ ...e, path: `${e.path}/` }));
    const out = filterEntries(slashedFeed, { category: 'financials', excludePath: '/blog/financials/a' });
    expect(out.map((e) => e.title)).toEqual(['C']);
  });
  it('excludes listing pages by their template metadata, not their path', () => {
    const mixed = [
      { path: '/blog', title: 'Blog | Intuit Enterprise Suite', template: 'Blog Home', date: '2026-04-01' },
      { path: '/blog/erp', title: 'ERP | Enterprise | Intuit', template: 'Category', date: '2026-04-01' },
      { path: '/blog/search', title: 'Search', template: 'Search', date: '2026-04-01' },
      ...data,
    ];
    const out = filterEntries(mixed);
    expect(out.map((e) => e.path)).toEqual([
      '/blog/erp/b', '/blog/financials/a', '/blog/financials/c',
    ]);
  });
  it('matches listing templates case-insensitively', () => {
    const out = filterEntries([
      { path: '/blog', title: 'Home', template: 'BLOG HOME' },
      { path: '/blog/erp/b', title: 'B', template: 'Blog Article', date: '2026-03-01' },
    ]);
    expect(out.map((e) => e.title)).toEqual(['B']);
  });
  it('keeps content pages regardless of path depth (case studies live at /blog/case-study/*)', () => {
    // Case-study rows are real articles; only the /blog/case-study index is a listing.
    const out = filterEntries([
      { path: '/blog/case-study', title: 'Customer success stories', template: 'Category', date: '2026-04-01' },
      { path: '/blog/case-study/sparq-partners', title: 'Sparq', template: 'Case Study', date: '2026-03-01' },
    ]);
    expect(out.map((e) => e.path)).toEqual(['/blog/case-study/sparq-partners']);
  });
  it('accepts multiple categories (comma-separated) and merges newest-first', () => {
    const out = filterEntries(data, { category: 'erp, financials' });
    expect(out.map((e) => e.title)).toEqual(['B', 'A', 'C']);
  });
  it('accepts multiple categories as an array', () => {
    const out = filterEntries(data, { category: ['financials', 'erp'], limit: 2 });
    expect(out.map((e) => e.title)).toEqual(['B', 'A']);
  });
  it('filters by tags, matching any of the entry\'s own comma-separated tags', () => {
    const out = filterEntries(data, { tags: 'automation' });
    expect(out.map((e) => e.title)).toEqual(['B', 'A']);
  });
  it('accepts multiple requested tags (OR)', () => {
    const out = filterEntries(data, { tags: 'ai, multi-entity' });
    expect(out.map((e) => e.title)).toEqual(['A', 'C']);
  });
  it('matches tags case-insensitively (real feed data uses ["Automation"], not ["automation"])', () => {
    const mixed = [
      { path: '/blog/operations/x', title: 'X', date: '2026-01-01', tags: ['Automation'] },
    ];
    expect(filterEntries(mixed, { tags: 'automation' }).map((e) => e.title)).toEqual(['X']);
  });
  it('treats a post\'s own folder as an implicit tag (home posts need no explicit tag)', () => {
    // A page filtering `tags: financials` lists /blog/financials/* without those posts
    // carrying a redundant "financials" tag, plus any cross-folder post tagged financials.
    const mixed = [
      { path: '/blog/financials/home', title: 'Home', date: '2026-03-01' },
      { path: '/blog/hr/cross', title: 'Cross', date: '2026-02-01', tags: 'financials' },
      { path: '/blog/erp/other', title: 'Other', date: '2026-01-01', tags: 'automation' },
    ];
    expect(filterEntries(mixed, { tags: 'financials' }).map((e) => e.title)).toEqual(['Home', 'Cross']);
  });
  it('folder-as-tag matches across hyphen vs. space (slug folders)', () => {
    const mixed = [
      { path: '/blog/project-cost-estimation/x', title: 'X', date: '2026-01-01' },
    ];
    expect(filterEntries(mixed, { tags: 'project-cost-estimation' }).map((e) => e.title)).toEqual(['X']);
  });
  it('matches tags across hyphen vs. space — tags are phrases, not slugs', () => {
    const mixed = [
      { path: '/blog/financials/y', title: 'Y', date: '2026-01-01', tags: ['Funding and ownership'] },
    ];
    expect(filterEntries(mixed, { tags: 'funding-and-ownership' }).map((e) => e.title)).toEqual(['Y']);
  });
  it('filters by template (case-insensitively) — one blog index for every collection', () => {
    const mixed = [
      { path: '/blog/erp/b', title: 'Article', template: 'Blog Article', date: '2026-03-01' },
      { path: '/blog/case-study/x', title: 'Case', template: 'Case Study', date: '2026-02-01' },
      { path: '/blog/research/y', title: 'Research', template: 'Research', date: '2026-01-01' },
    ];
    expect(filterEntries(mixed, { template: 'case study' }).map((e) => e.title)).toEqual(['Case']);
    expect(filterEntries(mixed, { template: 'Case Study, Research' }).map((e) => e.title))
      .toEqual(['Case', 'Research']);
  });
});

describe('categoryLabel', () => {
  it('prefers the entry\'s own category', () => {
    expect(categoryLabel(data[0])).toBe('financials');
  });
  it('falls back to the path segment for indices with no category column', () => {
    // /blog/case-study/query-index.json rows carry no `category`
    expect(categoryLabel({ path: '/blog/case-study/sparq-partners' })).toBe('case study');
  });
  it('renders hyphenated slugs as words (CSS uppercases them)', () => {
    expect(categoryLabel({ category: 'product-update' })).toBe('product update');
  });
  it('returns empty for listing pages, which have no category segment', () => {
    expect(categoryLabel({ path: '/blog/erp' })).toBe('');
    expect(categoryLabel({})).toBe('');
  });
});

describe('cardEl', () => {
  it('builds an anchor card with title, image and link', () => {
    const el = cardEl(data[0]);
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/blog/financials/a');
    const img = el.querySelector('img');
    expect(img.getAttribute('src')).toContain('/a.jpg');
    expect(img.getAttribute('src')).toContain('width=400');
    expect(el.textContent).toContain('A');
  });
  it('renders category, title and date in the source card\'s order', () => {
    const el = cardEl(data[0]);
    const body = [...el.querySelector('.blog-card-body').children].map((c) => c.className);
    expect(body).toEqual(['blog-card-category', 'blog-card-title', 'blog-card-date']);
  });
  it('omits the category for an entry with no category to show', () => {
    const el = cardEl({ path: '/blog/erp', title: 'Listing' });
    expect(el.querySelector('.blog-card-category')).toBeNull();
  });
  it('is not featured by default (no featured class, smaller image request)', () => {
    const el = cardEl(data[0]);
    expect(el.className).not.toContain('featured');
    expect(el.querySelector('img').getAttribute('src')).toContain('width=400');
  });
  it('renders a featured card with the featured class and a larger image request', () => {
    const el = cardEl(data[0], true);
    expect(el.classList.contains('featured')).toBe(true);
    expect(el.querySelector('img').getAttribute('src')).toContain('width=750');
  });
  it('leaves a card with no hero-video-url untouched (no badge, no video class)', () => {
    const el = cardEl(data[0]);
    expect(el.classList.contains('has-video')).toBe(false);
    expect(el.querySelector('.blog-card-play')).toBeNull();
    expect(el.querySelector('.blog-card-image').getAttribute('role')).toBeNull();
    expect(el.querySelector('.blog-card-link')).toBeNull();
  });
  it('marks a hero-video post with .has-video and a play badge on the thumbnail', () => {
    const el = cardEl(videoEntry);
    expect(el.classList.contains('has-video')).toBe(true);
    const play = el.querySelector('.blog-card-image .blog-card-play');
    expect(play).not.toBeNull();
    expect(play.getAttribute('aria-hidden')).toBe('true');
  });
  it('makes the thumbnail the play control and keeps the article link on the body', () => {
    const el = cardEl(videoEntry);
    // the control must be a SIBLING of the link — a focusable control inside an <a>
    // is invalid markup and unreachable by keyboard
    expect(el.tagName).toBe('DIV');
    expect(el.getAttribute('href')).toBeNull();
    const imageWrap = el.querySelector('.blog-card-image');
    expect(imageWrap.getAttribute('role')).toBe('button');
    expect(imageWrap.getAttribute('tabindex')).toBe('0');
    expect(imageWrap.getAttribute('aria-label')).toBe('Play video: HFMM legacy group growth');
    const link = el.querySelector('.blog-card-content-slot > a.blog-card-link');
    expect(link.getAttribute('href')).toBe('/blog/case-study/hfmm-legacy-group-growth');
    expect(link.querySelector('.blog-card-body .blog-card-title').textContent)
      .toBe('HFMM legacy group growth');
    expect(imageWrap.querySelector('a')).toBeNull();
  });
  it('falls back to the provider thumbnail when a video post has no authored image', () => {
    const el = cardEl(watchVideoEntry);
    expect(el.classList.contains('has-video')).toBe(true);
    expect(el.querySelector('img').getAttribute('src')).toContain('i.ytimg.com/vi/asJBXQnNFyo');
  });
  it('keeps the authored image as the poster when there is one', () => {
    const el = cardEl(videoEntry);
    expect(el.querySelector('img').getAttribute('src')).toContain('/hfmm.jpg');
  });
});

describe('distinctValues', () => {
  it('returns sorted, deduped, non-empty values for a field', () => {
    expect(distinctValues(data, 'category')).toEqual(['erp', 'financials']);
  });
  it('returns an empty array when no entry has the field', () => {
    expect(distinctValues(data, 'industry')).toEqual([]);
  });
});

// --- video lightbox -------------------------------------------------------
// The play control is a real DOM control, so these mount the card and drive it
// the way a user does (pointer + keyboard), then assert the overlay's lifecycle.

function mountCard(entry) {
  document.body.innerHTML = '';
  const card = cardEl(entry);
  document.body.append(card);
  return card;
}

function currentOverlay() {
  return document.querySelector('.blog-card-video-overlay');
}

function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function press(el, key) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
}

describe('cardEl — video lightbox', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('opens the player on a pointer click anywhere on the poster', () => {
    const card = mountCard(videoEntry);
    click(card.querySelector('.blog-card-image img'));
    const iframe = currentOverlay().querySelector('.blog-card-video-frame iframe');
    expect(iframe.getAttribute('src')).toContain('https://www.youtube.com/embed/Wk8JSGDOvx8');
    expect(iframe.getAttribute('src')).toContain('autoplay=1');
    expect(iframe.getAttribute('src')).toContain('modestbranding=1');
    expect(iframe.getAttribute('src')).toContain('enablejsapi=1');
    expect(iframe.getAttribute('title')).toBe('HFMM legacy group growth');
  });

  it('plays a watch?v= hero URL from the same feed column', () => {
    const card = mountCard(watchVideoEntry);
    click(card.querySelector('.blog-card-image'));
    expect(currentOverlay().querySelector('iframe').getAttribute('src'))
      .toContain('https://www.youtube.com/embed/asJBXQnNFyo');
  });

  it('opens on Enter and on Space, and Space does not scroll the listing', () => {
    const card = mountCard(videoEntry);
    const imageWrap = card.querySelector('.blog-card-image');
    const enter = press(imageWrap, 'Enter');
    expect(currentOverlay()).not.toBeNull();
    expect(enter.defaultPrevented).toBe(true);
    currentOverlay().remove();
    const space = press(imageWrap, ' ');
    expect(currentOverlay()).not.toBeNull();
    expect(space.defaultPrevented).toBe(true);
  });

  it('ignores other keys on the play control', () => {
    const card = mountCard(videoEntry);
    press(card.querySelector('.blog-card-image'), 'ArrowDown');
    expect(currentOverlay()).toBeNull();
  });

  it('never stacks two overlays', () => {
    const card = mountCard(videoEntry);
    const imageWrap = card.querySelector('.blog-card-image');
    click(imageWrap);
    click(imageWrap);
    expect(document.querySelectorAll('.blog-card-video-overlay').length).toBe(1);
  });

  it('dismisses on the close button, the backdrop and Escape — but not on the frame', () => {
    const card = mountCard(videoEntry);
    const imageWrap = card.querySelector('.blog-card-image');

    click(imageWrap);
    click(currentOverlay().querySelector('.blog-card-video-close'));
    expect(currentOverlay()).toBeNull();

    click(imageWrap);
    click(currentOverlay().querySelector('.blog-card-video-frame'));
    expect(currentOverlay()).not.toBeNull();
    click(currentOverlay());
    expect(currentOverlay()).toBeNull();

    click(imageWrap);
    press(currentOverlay(), 'Escape');
    expect(currentOverlay()).toBeNull();
  });

  it('removes its document keydown listener and restores focus to the opener', () => {
    const card = mountCard(videoEntry);
    const imageWrap = card.querySelector('.blog-card-image');
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');

    imageWrap.focus();
    expect(document.activeElement).toBe(imageWrap);
    press(imageWrap, 'Enter');
    const keydownCall = added.mock.calls.find(([type]) => type === 'keydown');
    expect(keydownCall).toBeDefined();
    // focus moves into the modal so the dialog is operable by keyboard
    expect(document.activeElement.className).toBe('blog-card-video-close');

    press(document.activeElement, 'Escape');
    expect(currentOverlay()).toBeNull();
    expect(removed).toHaveBeenCalledWith('keydown', keydownCall[1]);
    expect(document.activeElement).toBe(imageWrap);
  });
});

// --- click tracking -------------------------------------------------------
// Prod reports a listing play as video/started, not the generic content/interacted
// a thumbnail derives. The poster is deliberately NOT an alsoTrack part: payload
// derivers only run for a resolved CTA, so the click must climb to the role=button
// wrapper (see blogCardPayload + the narrowed alsoTrack selector).

let indexSeq = 0;

async function mountBlock(rows) {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  resetTrackingState();
  global.fetch = vi.fn(async (url) => ({
    ok: String(url).includes('query-index.json'),
    json: async () => ({ data: rows }),
  }));
  indexSeq += 1; // content-index caches per path — a fresh source per mount
  const main = document.createElement('main');
  const block = document.createElement('div');
  block.className = 'blog-cards block';
  block.setAttribute('data-block-name', 'blog-cards');
  block.innerHTML = `<div><div>source</div><div>/test/blog-cards-${indexSeq}/query-index.json</div></div>`;
  main.append(block);
  document.body.append(main);
  await decorate(block);
  initTracking(document);
  return block;
}

const VIDEO_PAYLOAD = {
  object: 'video',
  action: 'started',
  ui_object: 'video',
  ui_object_detail: '',
  ui_action: 'clicked',
};

describe('blog-cards — video play tracking', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState(); });

  it('leaves the video poster out of the alsoTrack parts (derivers skip parts)', async () => {
    const block = await mountBlock([videoEntry, data[0]]);
    const videoImg = block.querySelector('.blog-card.has-video .blog-card-image img');
    const plainImg = block.querySelector('.blog-card:not(.has-video) .blog-card-image img');
    expect(videoImg.getAttribute('data-track-as')).toBeNull();
    expect(plainImg.getAttribute('data-track-as')).toBe('button');
    // the card body stays a part on both card shapes
    expect(block.querySelectorAll('.blog-card-body[data-track-as="button"]').length).toBe(2);
  });

  it('a pointer click on the poster stamps video/started on the play control', async () => {
    const block = await mountBlock([videoEntry, data[0]]);
    const imageWrap = block.querySelector('.blog-card.has-video .blog-card-image');
    const posterImg = imageWrap.querySelector('img');
    stampInteraction({ target: posterImg });
    expect(posterImg.getAttribute('data-object')).toBeNull(); // resolved to the wrapper
    expect(computeTrackingPayload(posterImg)).toMatchObject(VIDEO_PAYLOAD);
    expect(computeTrackingPayload(posterImg).event).toBe('video:started');
  });

  it('keyboard activation on the wrapper stamps the same payload', async () => {
    const block = await mountBlock([videoEntry, data[0]]);
    const imageWrap = block.querySelector('.blog-card.has-video .blog-card-image');
    stampInteraction({ target: imageWrap });
    const payload = computeTrackingPayload(imageWrap);
    expect(payload).toMatchObject(VIDEO_PAYLOAD);
    expect(payload.event).toBe('video:started');
    expect(imageWrap.getAttribute('data-ui-object-detail')).toBe('');
  });

  it('an ordinary card thumbnail keeps its generic image beacon', async () => {
    const block = await mountBlock([videoEntry, data[0]]);
    const plainImg = block.querySelector('.blog-card:not(.has-video) .blog-card-image img');
    stampInteraction({ target: plainImg });
    const payload = computeTrackingPayload(plainImg);
    expect(payload.object).toBe('content');
    expect(payload.action).toBe('interacted');
    expect(payload.ui_object).toBe('button');
    expect(payload.ui_object_detail).toBe('A');
    expect(payload.event).toBe('content:interacted');
  });
});
