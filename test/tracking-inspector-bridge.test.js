import {
  describe, expect, it, vi,
} from 'vitest';
import {
  TRACKING_INSPECTOR_REQUEST,
  TRACKING_INSPECTOR_RESPONSE,
  createTrackingInspectorClient,
  installTrackingInspectorBridge,
  isTrustedTrackingEditorOrigin,
  trackingProbeUrl,
  waitForTrackingDocument,
} from '../tools/plugins/tracking/bridge.js';

describe('tracking inspector probe transport', () => {
  it('loads the current document from a public preview when the extension is live', () => {
    expect(trackingProbeUrl({
      context: {
        org: 'aemsites',
        repo: 'intuit-erp',
        path: '/accounting/multi-entity/index',
      },
      ref: 'codex/tracking-inspector-sheet',
      location: {
        hostname: 'codex-tracking-inspector-sheet--intuit-erp--aemsites.aem.live',
        origin: 'https://codex-tracking-inspector-sheet--intuit-erp--aemsites.aem.live',
      },
    })).toBe(
      'https://codex-tracking-inspector-sheet--intuit-erp--aemsites.aem.page/accounting/multi-entity?tracking-editor=1&martech=off',
    );
  });

  it('accepts inventory only from the probe window it owns', async () => {
    const listeners = new Map();
    const probeWindow = { postMessage: vi.fn() };
    const otherWindow = { postMessage: vi.fn() };
    const hostWindow = {
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
      removeEventListener: vi.fn(),
    };
    const client = createTrackingInspectorClient({
      getTarget: () => probeWindow,
      hostWindow,
      targetOrigin: 'https://main--intuit-erp--aemsites.preview.da.live',
      retryMs: 1000,
      timeoutMs: 2000,
    });

    const result = client.collect([{ path: '*', id: 'footer:company' }]);
    const request = probeWindow.postMessage.mock.calls[0][0];
    listeners.get('message')({
      source: otherWindow,
      origin: 'https://main--intuit-erp--aemsites.preview.da.live',
      data: {
        type: TRACKING_INSPECTOR_RESPONSE,
        requestId: request.requestId,
        inventory: [{ id: 'wrong-window' }],
      },
    });
    listeners.get('message')({
      source: probeWindow,
      origin: 'https://main--intuit-erp--aemsites.preview.da.live',
      data: {
        type: TRACKING_INSPECTOR_RESPONSE,
        requestId: request.requestId,
        inventory: [{ id: 'footer:company' }],
      },
    });

    await expect(result).resolves.toEqual([{ id: 'footer:company' }]);
    expect(otherWindow.postMessage).not.toHaveBeenCalled();
    expect(probeWindow.postMessage).toHaveBeenCalledTimes(1);
    expect(hostWindow.removeEventListener).toHaveBeenCalled();
  });

  it('trusts only the matching project and ref extension origin', () => {
    const preview = 'main--intuit-erp--aemsites.preview.da.live';
    expect(isTrustedTrackingEditorOrigin(
      'https://main--intuit-erp--aemsites.aem.live', preview,
    )).toBe(true);
    expect(isTrustedTrackingEditorOrigin(
      'https://feature--intuit-erp--aemsites.aem.live', preview,
    )).toBe(false);
    expect(isTrustedTrackingEditorOrigin(
      'https://main--other-site--aemsites.aem.live', preview,
    )).toBe(false);
    expect(isTrustedTrackingEditorOrigin('https://evil.example', preview)).toBe(false);
  });

  it('returns inventory to an authorized probe owner', async () => {
    const listeners = new Map();
    const frameWindow = {
      location: { hostname: 'main--intuit-erp--aemsites.preview.da.live' },
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
      removeEventListener: vi.fn(),
    };
    const source = { postMessage: vi.fn() };
    const collect = vi.fn(async () => [{ id: 'page:contact', label: 'Contact us' }]);
    installTrackingInspectorBridge({ frameWindow, collect });

    await listeners.get('message')({
      source,
      origin: 'https://main--intuit-erp--aemsites.aem.live',
      data: { type: TRACKING_INSPECTOR_REQUEST, requestId: 'request-1', rows: [] },
    });

    expect(collect).toHaveBeenCalledWith([]);
    expect(source.postMessage).toHaveBeenCalledWith({
      type: TRACKING_INSPECTOR_RESPONSE,
      requestId: 'request-1',
      inventory: [{ id: 'page:contact', label: 'Contact us' }],
    }, 'https://main--intuit-erp--aemsites.aem.live');
  });

  it('ignores inventory requests from an unrelated origin', async () => {
    const listeners = new Map();
    const frameWindow = {
      location: { hostname: 'main--intuit-erp--aemsites.preview.da.live' },
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    };
    const source = { postMessage: vi.fn() };
    const collect = vi.fn();
    installTrackingInspectorBridge({ frameWindow, collect });

    await listeners.get('message')({
      source,
      origin: 'https://evil.example',
      data: { type: TRACKING_INSPECTOR_REQUEST, requestId: 'request-1', rows: [] },
    });

    expect(collect).not.toHaveBeenCalled();
    expect(source.postMessage).not.toHaveBeenCalled();
  });

  it('waits until asynchronous page decoration stops mutating the document', async () => {
    vi.useFakeTimers();
    let mutation;
    const disconnect = vi.fn();
    class Observer {
      constructor(callback) { mutation = callback; }

      observe() {}

      disconnect() { disconnect(); }
    }
    const ready = waitForTrackingDocument({ documentElement: {} }, {
      Observer,
      quietMs: 50,
      maxWaitMs: 200,
    });
    let settled = false;
    ready.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(40);
    expect(settled).toBe(false);
    mutation();
    await vi.advanceTimersByTimeAsync(40);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(10);

    expect(settled).toBe(true);
    expect(disconnect).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
