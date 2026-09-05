import {
  afterEach, describe, expect, it,
} from 'vitest';
import decorateOneMind, { resolveOneMindLoadPhase } from '../widgets/pzn/onemind/onemind.js';

afterEach(() => {
  window.dispatchEvent(new Event('aem:delayed'));
  window.history.replaceState({}, '', '/');
  document.head.querySelectorAll('script[src*="launcher.1mind.com"]').forEach((script) => script.remove());
  if (window.hlx) delete window.hlx.delayed;
});

describe('OneMind load phase', () => {
  it('defaults to lazy and accepts delayed/off diagnostic overrides', () => {
    expect(resolveOneMindLoadPhase(new URLSearchParams())).toBe('lazy');
    expect(resolveOneMindLoadPhase(new URLSearchParams('onemind=lazy'))).toBe('lazy');
    expect(resolveOneMindLoadPhase(new URLSearchParams('onemind=delayed'))).toBe('delayed');
    expect(resolveOneMindLoadPhase(new URLSearchParams('onemind=off'))).toBe('off');
    expect(resolveOneMindLoadPhase(new URLSearchParams('onemind=other'))).toBe('lazy');
  });

  it('waits for the shared EDS delayed signal and injects the launcher once', async () => {
    window.history.replaceState({}, '', '/?onemind=delayed');
    const widget = document.createElement('div');
    widget.dataset.variant = 'b';

    await decorateOneMind(widget);
    expect(document.querySelector('script[src*="launcher.1mind.com"]')).toBeNull();

    window.dispatchEvent(new Event('aem:delayed'));
    window.dispatchEvent(new Event('aem:delayed'));

    const scripts = document.querySelectorAll('script[src*="launcher.1mind.com"]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe('https://launcher.1mind.com/deployment-5kxc4fwh8k');
  });

  it('preserves immediate loading by default and keeps off disabled after delayed', async () => {
    const widget = document.createElement('div');
    await decorateOneMind(widget);
    expect(document.querySelectorAll('script[src*="launcher.1mind.com"]')).toHaveLength(1);

    document.querySelector('script[src*="launcher.1mind.com"]').remove();
    window.history.replaceState({}, '', '/?onemind=off');
    await decorateOneMind(widget);
    window.dispatchEvent(new Event('aem:delayed'));
    expect(document.querySelector('script[src*="launcher.1mind.com"]')).toBeNull();
  });
});
