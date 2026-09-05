import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import decorateOneMind, { resolveOneMindLoadPhase } from '../widgets/pzn/onemind/onemind.js';

afterEach(() => {
  window.dispatchEvent(new Event('aem:delayed'));
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '';
  document.documentElement.classList.remove('onemind-active', 'onemind-ready');
  document.head.querySelectorAll('script[src*="launcher.1mind.com"]').forEach((script) => script.remove());
  if (window.hlx) delete window.hlx.delayed;
  vi.restoreAllMocks();
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
    expect(document.documentElement.classList.contains('onemind-active')).toBe(false);

    window.dispatchEvent(new Event('aem:delayed'));
    window.dispatchEvent(new Event('aem:delayed'));

    const scripts = document.querySelectorAll('script[src*="launcher.1mind.com"]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe('https://launcher.1mind.com/deployment-5kxc4fwh8k');
    expect(document.documentElement.classList.contains('onemind-active')).toBe(true);
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

describe('OneMind launcher stability', () => {
  it('activates the eager sizing hook before appending the vendor launcher', async () => {
    const widget = document.createElement('div');
    widget.dataset.variant = 'b';
    const appendChild = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      if (node.matches?.('script[src*="launcher.1mind.com"]')) {
        expect(document.documentElement.classList.contains('onemind-active')).toBe(true);
      }
      return appendChild(node);
    });

    await decorateOneMind(widget);

    expect(document.head.querySelector('script[src$="deployment-5kxc4fwh8k"]')).toBeTruthy();
  });

  it('reveals the launcher only after its iframe reports the settled collapsed state', async () => {
    const widget = document.createElement('div');
    const iframe = document.createElement('iframe');
    iframe.id = 'onemind-iframe';
    iframe.src = 'https://deployment-6dfht8qjmt.1mind.com/';
    document.body.append(iframe);

    await decorateOneMind(widget);
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://deployment-6dfht8qjmt.1mind.com',
      source: iframe.contentWindow,
      data: {
        type: '1MIND_WIDGET_COLLAPSE',
        payload: {
          state: '1mind_widget_collapsed',
          width: '214px',
          height: '90px',
        },
      },
    }));

    expect(document.documentElement.classList.contains('onemind-ready')).toBe(true);
  });

  it('ignores ready messages that do not come from the launcher iframe', async () => {
    const widget = document.createElement('div');
    const iframe = document.createElement('iframe');
    iframe.id = 'onemind-iframe';
    iframe.src = 'https://deployment-6dfht8qjmt.1mind.com/';
    document.body.append(iframe);

    await decorateOneMind(widget);
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://untrusted.example',
      source: iframe.contentWindow,
      data: {
        type: '1MIND_WIDGET_COLLAPSE',
        payload: { state: '1mind_widget_collapsed' },
      },
    }));

    expect(document.documentElement.classList.contains('onemind-ready')).toBe(false);
  });
});
