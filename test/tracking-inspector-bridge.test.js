import {
  describe, expect, it, vi,
} from 'vitest';
import {
  TRACKING_INSPECTOR_REQUEST,
  TRACKING_INSPECTOR_RESPONSE,
  createTrackingInspectorClient,
  installTrackingInspectorBridge,
  isTrustedTrackingEditorOrigin,
  trackingPreviewUrl,
} from '../tools/plugins/tracking/bridge.js';

describe('tracking inspector cross-origin bridge', () => {
  it('loads the rendered document from the matching authenticated DA preview origin', () => {
    expect(trackingPreviewUrl('/accounting/multi-entity/index', {
      context: { org: 'aemsites', repo: 'intuit-erp' },
      ref: 'main',
      location: { hostname: 'main--intuit-erp--aemsites.aem.live', origin: 'https://main--intuit-erp--aemsites.aem.live' },
    })).toBe(
      'https://main--intuit-erp--aemsites.preview.da.live/accounting/multi-entity/index?tracking-editor=1&martech=off',
    );
  });

  it('keeps local development on the same origin', () => {
    expect(trackingPreviewUrl('/accounting', {
      context: { org: 'aemsites', repo: 'intuit-erp' },
      ref: 'main',
      location: { hostname: 'localhost', origin: 'http://localhost:3000' },
    })).toBe('http://localhost:3000/accounting?tracking-editor=1&martech=off');
  });

  it('trusts only the matching project and ref editor origin', () => {
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

  it('returns a serializable inventory to an authorized parent', () => {
    const listeners = new Map();
    const frameWindow = {
      location: { hostname: 'main--intuit-erp--aemsites.preview.da.live' },
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    };
    const source = { postMessage: vi.fn() };
    const collect = vi.fn(() => [{ id: 'page:contact', label: 'Contact us' }]);
    installTrackingInspectorBridge({ frameWindow, collect });

    listeners.get('message')({
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

  it('ignores inventory requests from an unrelated origin', () => {
    const listeners = new Map();
    const frameWindow = {
      location: { hostname: 'main--intuit-erp--aemsites.preview.da.live' },
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    };
    const source = { postMessage: vi.fn() };
    const collect = vi.fn();
    installTrackingInspectorBridge({ frameWindow, collect });

    listeners.get('message')({
      source,
      origin: 'https://evil.example',
      data: { type: TRACKING_INSPECTOR_REQUEST, requestId: 'request-1', rows: [] },
    });

    expect(collect).not.toHaveBeenCalled();
    expect(source.postMessage).not.toHaveBeenCalled();
  });

  it('collects inventory through postMessage without reading the frame DOM', async () => {
    const listeners = new Map();
    const contentWindow = { postMessage: vi.fn() };
    const frame = { contentWindow };
    const hostWindow = {
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
      removeEventListener: vi.fn(),
    };
    const client = createTrackingInspectorClient({
      frame,
      hostWindow,
      targetOrigin: 'https://main--intuit-erp--aemsites.preview.da.live',
      retryMs: 1000,
      timeoutMs: 2000,
    });

    const result = client.collect([{ path: '*', id: 'footer:company' }]);
    const request = contentWindow.postMessage.mock.calls[0][0];
    listeners.get('message')({
      source: contentWindow,
      origin: 'https://main--intuit-erp--aemsites.preview.da.live',
      data: {
        type: TRACKING_INSPECTOR_RESPONSE,
        requestId: request.requestId,
        inventory: [{ id: 'footer:company' }],
      },
    });

    await expect(result).resolves.toEqual([{ id: 'footer:company' }]);
    expect(contentWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: TRACKING_INSPECTOR_REQUEST,
      rows: [{ path: '*', id: 'footer:company' }],
    }), 'https://main--intuit-erp--aemsites.preview.da.live');
    expect(hostWindow.removeEventListener).toHaveBeenCalled();
  });
});
