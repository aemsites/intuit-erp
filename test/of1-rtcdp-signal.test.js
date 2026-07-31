import {
  describe, it, expect, vi,
} from 'vitest';
import {
  buildOf1SignalXdm,
  OF1_SIGNAL,
  requestOf1Profile,
  sendOf1Signal,
  OF1_SIGNAL as SIG,
} from '../scripts/of1-rtcdp-signal.js';

const page = { url: 'https://x.aem.page/construction', name: 'construction' };

describe('buildOf1SignalXdm (flat)', () => {
  it('flattens interests→topInterests, intent→topIntent, pages→pagesViewed', () => {
    const xdm = buildOf1SignalXdm({
      interests: [{ topic: 'QuickBooks Migration', score: 90, source: 'x' }, { topic: 'AI Finance Agents', score: 80, source: 'y' }],
      intentProfile: { intents: [], topIntent: 'purchase', topScore: 100, updatedAt: 1 },
      pageVisits: [{ path: '/migration/', title: 'M', dwellTimeMs: 10 }, { path: '/ai-agents/', title: 'A', dwellTimeMs: 5 }],
    }, page);

    expect(xdm.eventType).toBe('web.webpagedetails.pageViews');
    expect(xdm.web.webPageDetails.URL).toBe(page.url);
    expect(xdm.web.webPageDetails.name).toBe(page.name);

    const obj = xdm[OF1_SIGNAL.prefix][OF1_SIGNAL.object];
    expect(obj.topInterests).toEqual(['QuickBooks Migration', 'AI Finance Agents']);
    expect(obj.topIntent).toBe('purchase');
    expect(obj.pagesViewed).toEqual(['/migration/', '/ai-agents/']);
    expect(typeof obj.capturedAt).toBe('string');
  });

  it('caps interests at 5 and pages at 10', () => {
    const interests = Array.from({ length: 8 }, (_, i) => ({ topic: `t${i}`, score: 1, source: '' }));
    const pageVisits = Array.from({ length: 14 }, (_, i) => ({ path: `/p${i}`, title: '', dwellTimeMs: 1 }));
    const obj = buildOf1SignalXdm({ interests, intentProfile: null, pageVisits }, page)[OF1_SIGNAL.prefix][OF1_SIGNAL.object];
    expect(obj.topInterests).toHaveLength(5);
    expect(obj.pagesViewed).toHaveLength(10);
  });

  it('tolerates an empty/partial profile: empty arrays and empty topIntent', () => {
    const obj = buildOf1SignalXdm({}, page)[OF1_SIGNAL.prefix][OF1_SIGNAL.object];
    expect(obj.topInterests).toEqual([]);
    expect(obj.topIntent).toBe('');
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
    const outcome = await promise;
    expect(outcome).toEqual({ sent: true, result: {} });
    expect(sendEvent).toHaveBeenCalledTimes(1);
    const arg = sendEvent.mock.calls[0][0];
    expect(arg.xdm[SIG.prefix][SIG.object].topInterests).toEqual(['job costing']);
  });

  it('is a no-op (returns { sent: false, result: null }) when no profile arrives', async () => {
    const sendEvent = vi.fn();
    const outcome = await sendOf1Signal({ sendEvent, timeoutMs: 10 });
    expect(outcome).toEqual({ sent: false, result: null });
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('never throws if sendEvent rejects (fail-open)', async () => {
    const sendEvent = vi.fn().mockRejectedValue(new Error('edge down'));
    const promise = sendOf1Signal({ sendEvent, timeoutMs: 1000 });
    window.postMessage({ type: 'OF1_PERSONALIZE', payload: { interests: [] } }, '*');
    await expect(promise).resolves.toEqual({ sent: false, result: null });
  });
});
