import {
  describe, it, expect, beforeEach,
} from 'vitest';
// Real-render wiring guard for the blog-template article share row (.blog-share). The
// customer golden (regular blog articles) reports these under qrc_article_hero|social_media;
// the widget carries a self-contained trail (qrc_article_hero on the row, social_media on the
// .blog-share-links span) so it survives the mobile/desktop relocation. Mirrors the trackAs
// wiring in buildBlogTemplate.
import { initTracking, resetTrackingState, stampInteraction, trackAs } from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

const { buildBlogTemplate, buildShare } = await import('../blocks/blog-template/blog-template.js');

function makeWiredShare() {
  window.hlx = window.hlx || { codeBasePath: '' };
  const share = buildShare();
  trackAs('qrc_article_hero', share, { key: 'case-study-header', linkName: false, items: { '.blog-share-links': 'social_media' } });
  return share;
}

describe('blog-template share row — click tracking', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState(); });

  it('buildShare wraps the links in .blog-share-links (needed for the nested trail)', () => {
    const share = makeWiredShare();
    const wrap = share.querySelector('.blog-share-links');
    expect(wrap).not.toBeNull();
    expect(wrap.querySelectorAll('a.blog-share-link').length).toBeGreaterThanOrEqual(4);
  });

  it('share links resolve to qrc_article_hero|social_media (matches prod)', () => {
    const main = document.createElement('main');
    const share = makeWiredShare();
    main.append(share); document.body.append(main);
    initTracking(document);
    const link = share.querySelector('.blog-share-links a');
    stampInteraction({ target: link });
    expect(computeTrackingPayload(link).ui_access_point).toBe('qrc_article_hero|social_media');
  });

  it('article byline links resolve to qrc_article_hero (matches prod)', () => {
    window.hlx = { codeBasePath: '' };
    window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
    document.head.innerHTML = '<meta name="author" content="Abigail Sims">';
    const main = document.createElement('main');
    main.innerHTML = `
      <div><h1>Automation in construction</h1><p><img src="hero.jpg" alt=""></p></div>
      <div><h2>First section</h2></div>
      <div><h2>Second section</h2></div>
    `;
    document.body.append(main);

    buildBlogTemplate(main);
    initTracking(document);
    const byline = main.querySelector('.blog-byline-author a');
    stampInteraction({ target: byline });

    expect(computeTrackingPayload(byline).ui_access_point).toBe('qrc_article_hero');
  });
});
