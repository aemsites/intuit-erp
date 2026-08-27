import {
  describe, it, expect, beforeEach,
} from 'vitest';
// Real-render wiring guard for the case-study article header: the share row nests under
// the qrc_article_hero copy root (-> qrc_article_hero|social_media, matching the customer
// golden), while eyebrow/byline stay flat qrc_article_hero.
import { initTracking, resetTrackingState, stampInteraction } from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

const { default: decorate } = await import('../blocks/case-study-header/case-study-header.js');

function makeHeader() {
  const block = document.createElement('div');
  block.className = 'case-study-header block';
  block.setAttribute('data-block-name', 'case-study-header');
  // eyebrow (p before h1) + heading + byline (p after h1, with a link)
  block.innerHTML = '<div><div>'
    + '<p>Case study</p><h1>Aprio + Intuit Enterprise Suite</h1>'
    + '<p>By <a href="/authors/jane">Jane Doe</a></p>'
    + '</div></div>';
  return block;
}

function setup() {
  document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState();
  const main = document.createElement('main');
  const block = makeHeader();
  main.append(block); document.body.append(main);
  decorate(block);
  initTracking(document);
  return block;
}

describe('case-study-header — click tracking', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState(); });

  it('share links nest under the hero → qrc_article_hero|social_media (prod)', () => {
    const block = setup();
    const share = block.querySelector('.case-study-share a');
    expect(share).not.toBeNull();
    stampInteraction({ target: share });
    expect(computeTrackingPayload(share).ui_access_point).toBe('qrc_article_hero|social_media');
  });

  it('byline links stay flat → qrc_article_hero', () => {
    const block = setup();
    const byline = block.querySelector('.case-study-byline a, .case-study-copy a:not(.case-study-share a)');
    expect(byline).not.toBeNull();
    stampInteraction({ target: byline });
    expect(computeTrackingPayload(byline).ui_access_point).toBe('qrc_article_hero');
  });
});
