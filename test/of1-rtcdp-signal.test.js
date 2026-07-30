import { describe, it, expect, vi } from 'vitest';
import {
  buildOf1SignalXdm,
  OF1_SIGNAL,
  requestOf1Profile,
  sendOf1Signal,
  OF1_SIGNAL as SIG,
} from '../scripts/of1-rtcdp-signal.js';

const page = { url: 'https://x.aem.page/construction', name: 'construction' };

describe('buildOf1SignalXdm', () => {
  it('maps interests, intent, and pages under the tenant-namespaced object', () => {
    const xdm = buildOf1SignalXdm({
      interests: [{ topic: 'job costing', score: 82 }, { topic: 'construction', score: 70 }],
      intentProfile: { type: 'research', journeyStage: 'consideration' },
      pageVisits: ['/construction', '/blog/construction-case-study'],
    }, page);

    expect(xdm.eventType).toBe('web.webpagedetails.pageViews');
    expect(xdm.web.webPageDetails.URL).toBe(page.url);
    expect(xdm.web.webPageDetails.name).toBe(page.name);

    const obj = xdm[OF1_SIGNAL.prefix][OF1_SIGNAL.object];
    expect(obj.interests).toEqual([
      { topic: 'job costing', score: 82 },
      { topic: 'construction', score: 70 },
    ]);
    expect(obj.intent).toEqual({ type: 'research', journeyStage: 'consideration' });
    expect(obj.pagesViewed).toEqual(['/construction', '/blog/construction-case-study']);
    expect(typeof obj.capturedAt).toBe('string');
  });

  it('tolerates an empty/partial profile without throwing', () => {
    const xdm = buildOf1SignalXdm({}, page);
    const obj = xdm[OF1_SIGNAL.prefix][OF1_SIGNAL.object];
    expect(obj.interests).toEqual([]);
    expect(obj.intent).toBeNull();
    expect(obj.pagesViewed).toEqual([]);
  });
});

describe('requestOf1Profile', () => {
  it('resolves the payload when the extension replies', async () => {
    const promise = requestOf1Profile(1000);
    // simulate the extension responding to OF1_REQUEST_PROFILE
    window.postMessage({ type: 'OF1_PERSONALIZE', payload: { interests: [{ topic: 'x', score: 1 }] } }, '*');
    const payload = await promise;
    expect(payload.interests).toEqual([{ topic: 'x', score: 1 }]);
  });

  it('resolves null on timeout when no reply arrives', async () => {
    const payload = await requestOf1Profile(10);
    expect(payload).toBeNull();
  });
});

describe('sendOf1Signal', () => {
  it('sends a mapped event when a profile is available', async () => {
    const sendEvent = vi.fn().mockResolvedValue({});
    const promise = sendOf1Signal({ sendEvent, timeoutMs: 1000 });
    window.postMessage({ type: 'OF1_PERSONALIZE', payload: { interests: [{ topic: 'job costing', score: 9 }] } }, '*');
    const sent = await promise;
    expect(sent).toBe(true);
    expect(sendEvent).toHaveBeenCalledTimes(1);
    const arg = sendEvent.mock.calls[0][0];
    expect(arg.xdm[SIG.prefix][SIG.object].interests).toEqual([{ topic: 'job costing', score: 9 }]);
  });

  it('is a no-op (returns false) when no profile arrives', async () => {
    const sendEvent = vi.fn();
    const sent = await sendOf1Signal({ sendEvent, timeoutMs: 10 });
    expect(sent).toBe(false);
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('never throws if sendEvent rejects (fail-open)', async () => {
    const sendEvent = vi.fn().mockRejectedValue(new Error('edge down'));
    const promise = sendOf1Signal({ sendEvent, timeoutMs: 1000 });
    window.postMessage({ type: 'OF1_PERSONALIZE', payload: { interests: [] } }, '*');
    await expect(promise).resolves.toBe(false);
  });
});
