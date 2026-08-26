import { describe, it, expect } from 'vitest';
import decorate, { buildVideoFrame, buildVideoSection } from '../blocks/testimonial/testimonial.js';

function cells(html) {
  const row = document.createElement('div');
  row.innerHTML = html;
  return [...row.children];
}

function rows(n) {
  const wrap = document.createElement('div');
  for (let i = 0; i < n; i += 1) {
    const r = document.createElement('div');
    r.innerHTML = `
      <div><img src="/p${i}.jpg" alt="Speaker ${i}"></div>
      <div>Eyebrow ${i}</div><div>Quote ${i}</div>
      <div>Name ${i} <a href="/s${i}">See their story</a></div>
      <div>https://www.youtube.com/watch?v=id${i}</div>`;
    wrap.append(r);
  }
  return [...wrap.children];
}

describe('buildVideoFrame', () => {
  it('builds a caption with eyebrow, quote and attribution link', () => {
    const frame = buildVideoFrame(cells(`
      <div><img src="/caleb.jpg"></div>
      <div>Professional Services</div>
      <div>Unified 9 entities and cut accounting time by 50%*</div>
      <div>Caleb McDaniels, CFO Rhodes Companies <a href="/blog/case-study/rhodes">See their story</a></div>
      <div>https://www.youtube.com/watch?v=gpHd4jd6dTk</div>`));
    expect(frame.classList.contains('video-frame')).toBe(true);
    expect(frame.querySelector('.video-eyebrow').textContent).toBe('Professional Services');
    expect(frame.querySelector('.video-quote').textContent).toContain('Unified 9 entities');
    expect(frame.querySelector('.video-attr a').getAttribute('href')).toBe('/blog/case-study/rhodes');
    expect(frame.querySelector('.video-play')).not.toBeNull();
  });

  it('uses an inline mp4 background when an mp4 cell is present, and renders a logo overlay', () => {
    const frame = buildVideoFrame(cells(`
      <div><img src="/caleb.jpg"></div>
      <div>Professional Services</div>
      <div>Q</div>
      <div>Caleb</div>
      <div>https://www.youtube.com/watch?v=gpHd4jd6dTk</div>
      <div><a href="https://erp.intuit.com/x/case-study-rhodes-cutdown-video-ies-us-en-sm.mp4">video</a></div>
      <div><img src="/rhodes-logo.png"></div>`));
    const bg = frame.querySelector('.video-bg');
    expect(bg.tagName).toBe('VIDEO');
    expect(bg.getAttribute('src')).toContain('case-study-rhodes-cutdown-video');
    expect(frame.querySelector('.video-logo')).not.toBeNull();
  });
});

describe('buildVideoSection (adaptive)', () => {
  it('returns a single frame with no switcher for one row', () => {
    const el = buildVideoSection(rows(1));
    expect(el.classList.contains('video-frame')).toBe(true);
    expect(el.querySelector('.video-thumbs')).toBeNull();
  });

  it('builds a thumbnail switcher with one tab per story for 3 rows, first active', () => {
    const el = buildVideoSection(rows(3));
    const thumbs = el.querySelectorAll('.video-thumb');
    const frames = el.querySelectorAll('.video-frame');
    expect(thumbs.length).toBe(3);
    expect(frames.length).toBe(3);
    expect(thumbs[0].getAttribute('aria-selected')).toBe('true');
    expect(frames[0].classList.contains('is-active')).toBe(true);
    expect(frames[1].classList.contains('is-active')).toBe(false);
    expect(el.querySelector('[role="tablist"]')).not.toBeNull();
    expect(thumbs[0].querySelector('img')).not.toBeNull();
  });

  it('clicking the third thumb activates the third frame', () => {
    const el = buildVideoSection(rows(3));
    const thumbs = el.querySelectorAll('.video-thumb');
    const frames = el.querySelectorAll('.video-frame');
    thumbs[2].click();
    expect(thumbs[2].getAttribute('aria-selected')).toBe('true');
    expect(frames[2].classList.contains('is-active')).toBe(true);
    expect(frames[0].classList.contains('is-active')).toBe(false);
    expect(thumbs[2].tabIndex).toBe(0);
    expect(thumbs[0].tabIndex).toBe(-1);
  });

  it('renders one shared info bar (avatar + text + thumbs) that updates on switch', () => {
    const el = buildVideoSection(rows(3));
    const bars = el.querySelectorAll('.video-caption');
    expect(bars.length).toBe(1);
    const bar = bars[0];
    // frames themselves carry no caption in switcher mode
    expect(el.querySelector('.video-frame .video-caption')).toBeNull();
    // bar holds the active story's details + the thumbs
    expect(bar.querySelector('.video-quote').textContent).toBe('Quote 0');
    expect(bar.querySelector('.video-avatar').getAttribute('src')).toBe('/p0.jpg');
    expect(bar.querySelector('.video-thumbs .video-thumb')).not.toBeNull();
    // switching updates the shared bar
    el.querySelectorAll('.video-thumb')[2].click();
    expect(bar.querySelector('.video-quote').textContent).toBe('Quote 2');
    expect(bar.querySelector('.video-avatar').getAttribute('src')).toBe('/p2.jpg');
  });
});

describe('.video heading promotion via decorate()', () => {
  function makeVideoBlock({ heading = '', headingTag = 'h3' } = {}) {
    const block = document.createElement('div');
    block.className = 'testimonial video block';
    block.innerHTML = `
      <div>
        <div><img src="/give-clean.jpg" alt="Give Clean customer story video"></div>
        <div>
          ${heading ? `<${headingTag}>${heading}</${headingTag}>` : ''}
          <p>"I've seen our people come alive with ownership."</p>
          <p>- Elaine Savell, Controller, Give Clean</p>
        </div>
      </div>`;
    return block;
  }

  it('promotes a leading heading from the first row instead of dropping it', () => {
    const block = makeVideoBlock({ heading: 'Intuit Enterprise Suite customers are saying' });
    decorate(block);
    const heading = block.querySelector('.testimonial-heading');
    expect(heading).not.toBeNull();
    expect(heading.tagName).toBe('H3');
    expect(heading.textContent).toBe('Intuit Enterprise Suite customers are saying');
    expect(block.firstElementChild).toBe(heading);
    // the rest of the frame still renders normally
    expect(block.querySelector('.video-frame')).not.toBeNull();
  });

  it('normalizes an authored h1/h2 heading down to h3', () => {
    const block = makeVideoBlock({ heading: 'Customers are saying', headingTag: 'h2' });
    decorate(block);
    expect(block.querySelector('.testimonial-heading').tagName).toBe('H3');
  });

  it('does not add a heading element when none is authored (no regression)', () => {
    const block = makeVideoBlock();
    decorate(block);
    expect(block.querySelector('.testimonial-heading')).toBeNull();
    expect(block.querySelector('.video-frame')).not.toBeNull();
  });
});
