import { describe, it, expect } from 'vitest';
import { videoInfo, isVideoLink, posterFor } from '../blocks/video/video.js';

describe('videoInfo', () => {
  it('parses a YouTube watch URL', () => {
    const info = videoInfo('https://www.youtube.com/watch?v=CQf15U4a70Q');
    expect(info).toEqual({
      provider: 'youtube',
      id: 'CQf15U4a70Q',
      embedUrl: 'https://www.youtube.com/embed/CQf15U4a70Q?autoplay=1&rel=0',
    });
  });

  it('parses youtu.be, embed, shorts and nocookie forms', () => {
    expect(videoInfo('https://youtu.be/CQf15U4a70Q').id).toBe('CQf15U4a70Q');
    expect(videoInfo('https://www.youtube.com/embed/CQf15U4a70Q').id).toBe('CQf15U4a70Q');
    expect(videoInfo('https://www.youtube.com/shorts/CQf15U4a70Q').id).toBe('CQf15U4a70Q');
    expect(videoInfo('https://www.youtube-nocookie.com/embed/CQf15U4a70Q').id).toBe('CQf15U4a70Q');
  });

  it('parses a Vimeo URL', () => {
    const info = videoInfo('https://vimeo.com/76979871');
    expect(info.provider).toBe('vimeo');
    expect(info.id).toBe('76979871');
    expect(info.embedUrl).toBe('https://player.vimeo.com/video/76979871?autoplay=1');
  });

  it('returns null for non-video or empty URLs', () => {
    expect(videoInfo('https://erp.intuit.com/pricing')).toBeNull();
    expect(videoInfo('')).toBeNull();
    expect(videoInfo(undefined)).toBeNull();
  });
});

describe('isVideoLink', () => {
  it('is true only for supported hosts', () => {
    expect(isVideoLink('https://youtu.be/CQf15U4a70Q')).toBe(true);
    expect(isVideoLink('https://vimeo.com/76979871')).toBe(true);
    expect(isVideoLink('/blog/financials/cash-flow-analysis')).toBe(false);
  });
});

describe('posterFor', () => {
  it('prefers the authored image src', () => {
    const info = { provider: 'youtube', id: 'CQf15U4a70Q' };
    expect(posterFor(info, 'https://i.ytimg.com/vi/CQf15U4a70Q/sddefault.jpg'))
      .toBe('https://i.ytimg.com/vi/CQf15U4a70Q/sddefault.jpg');
  });

  it('derives a YouTube thumbnail when no image is authored', () => {
    expect(posterFor({ provider: 'youtube', id: 'CQf15U4a70Q' }))
      .toBe('https://i.ytimg.com/vi/CQf15U4a70Q/sddefault.jpg');
  });

  it('returns empty string for Vimeo with no authored image', () => {
    expect(posterFor({ provider: 'vimeo', id: '76979871' })).toBe('');
  });
});
