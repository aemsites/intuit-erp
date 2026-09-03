import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {
  resolveMartechWorkerMode,
  workerVendorForUrl,
  installMartechWorkerExperiment,
} from '../scripts/martech-worker.js';

function resetExperiment() {
  window.__martechWorkerController?.disconnect();
  document.head.innerHTML = '';
  delete window.__martechWorkerExperiment;
  delete window.partytown;
}

beforeEach(resetExperiment);
afterEach(resetExperiment);

describe('resolveMartechWorkerMode', () => {
  it('enables only the two explicit experiment modes', () => {
    expect(resolveMartechWorkerMode('?martech-worker=segment')).toBe('segment');
    expect(resolveMartechWorkerMode('?martech-worker=all')).toBe('all');
    expect(resolveMartechWorkerMode('?martech-worker=off')).toBeNull();
    expect(resolveMartechWorkerMode('')).toBeNull();
  });
});

describe('workerVendorForUrl', () => {
  it('moves the complete Segment sender chain but leaves its DOM bootstrap on main', () => {
    const segmentUrls = [
      'https://uxfabric.intuitcdn.net/analytics/202605291754/track-event-lib.min.js',
      'https://uxfabric.intuitcdn.net/analytics/202605291754/ajs-destination.min.js',
      'https://uxfabric.intuitcdn.net/analytics/202605291754/schemaFilter.min.js',
      'https://uxfabric.intuitcdn.net/analytics/202605291754/visitorapi.min.js',
      'https://segment.intuitcdn.net/next-integrations/actions/3962/chunk.js',
    ];

    segmentUrls.forEach((url) => {
      expect(workerVendorForUrl(url, 'segment')).toBe('segment');
      expect(workerVendorForUrl(url, 'all')).toBe('segment');
    });
    expect(workerVendorForUrl(
      'https://uxfabric.intuitcdn.net/analytics/prod/track-event-lib-init.min.js',
      'segment',
    )).toBeNull();
    expect(workerVendorForUrl(
      'https://uxfabric.intuitcdn.net/@cloud-monitoring/prod/o11y-rum-web.min.js',
      'segment',
    )).toBeNull();
  });

  it('adds Google, Meta, and Demandbase in all mode', () => {
    expect(workerVendorForUrl(
      'https://www.googletagmanager.com/gtag/js?id=DC-1996823',
      'segment',
    )).toBeNull();
    expect(workerVendorForUrl(
      'https://www.googletagmanager.com/gtag/js?id=DC-1996823',
      'all',
    )).toBe('google');
    expect(workerVendorForUrl('https://connect.facebook.net/en_US/fbevents.js', 'all'))
      .toBe('meta');
    expect(workerVendorForUrl('https://scripts.demandbase.com/site.min.js', 'all'))
      .toBe('demandbase');
  });
});

describe('installMartechWorkerExperiment', () => {
  it('changes matching scripts before native insertion and leaves every nonmatch untouched', () => {
    const nativeAppendChild = Node.prototype.appendChild;
    const inserted = [];
    vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function appendChild(node) {
      inserted.push({ src: node.src, type: node.type });
      return nativeAppendChild.call(this, node);
    });

    const controller = installMartechWorkerExperiment({ mode: 'all' });
    const segment = document.createElement('script');
    segment.src = 'https://uxfabric.intuitcdn.net/analytics/202605291754/track-event-lib.min.js';
    segment.type = 'text/javascript';
    document.head.appendChild(segment);
    const google = document.createElement('script');
    google.src = 'https://www.googletagmanager.com/gtag/js?id=DC-1996823';
    document.head.insertBefore(google, segment);
    const meta = document.createElement('script');
    meta.src = 'https://connect.facebook.net/en_US/fbevents.js';
    meta.type = 'text/javascript';
    document.head.appendChild(meta);
    const livePerson = document.createElement('script');
    livePerson.src = 'https://lptag.liveperson.net/tag/tag.js?site=19175958';
    livePerson.type = 'text/javascript';
    document.head.appendChild(livePerson);

    expect(inserted.find(({ src }) => src.includes('track-event-lib.min.js'))?.type)
      .toBe('text/partytown');
    expect(google.type).toBe('text/partytown');
    expect(meta.type).toBe('text/partytown');
    expect(livePerson.type).toBe('text/javascript');
    expect(segment.dataset.martechWorker).toBe('segment');
    expect(google.dataset.martechWorker).toBe('google');
    expect(meta.dataset.martechWorker).toBe('meta');
    const metaBootstrap = document.querySelector('[data-martech-worker-bootstrap="meta"]');
    expect(metaBootstrap?.type).toBe('text/partytown');
    expect(meta.previousElementSibling).toBe(metaBootstrap);
    expect(metaBootstrap?.textContent).toContain('root.fbq = fbq');
    expect(controller.state.diverted).toEqual([
      expect.objectContaining({ vendor: 'segment' }),
      expect.objectContaining({ vendor: 'google' }),
      expect.objectContaining({ vendor: 'meta' }),
    ]);

    controller.disconnect();
  });

  it('bridges Partytown completion back to a dynamic script load callback', async () => {
    const controller = installMartechWorkerExperiment({ mode: 'segment' });
    const onload = vi.fn();
    const script = document.createElement('script');
    script.src = 'https://uxfabric.intuitcdn.net/analytics/202605291754/track-event-lib.min.js';
    script.addEventListener('load', onload);
    document.head.appendChild(script);
    expect(controller.state.diverted[0].status).toBe('queued');

    // Partytown changes the type to this value only after worker evaluation completes. Tealium's
    // original main-thread script listener otherwise never receives a native load event.
    script.type = 'text/partytown-x';
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(onload).toHaveBeenCalledTimes(1);
    expect(controller.state.diverted[0].status).toBe('complete');

    script.dataset.unrelated = 'change';
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(onload).toHaveBeenCalledTimes(1);
    controller.disconnect();
  });

  it('configures one same-origin runtime with mode-specific bridges and diagnostics', () => {
    const segment = installMartechWorkerExperiment({ mode: 'segment' });
    expect(installMartechWorkerExperiment({ mode: 'segment' })).toBe(segment);
    expect(document.querySelectorAll('#martech-worker-runtime')).toHaveLength(1);
    expect(document.getElementById('martech-worker-runtime').src)
      .toBe('http://localhost:3000/scripts/~partytown/partytown.js');
    expect(window.partytown).toEqual(expect.objectContaining({
      lib: '/scripts/~partytown/',
      nonce: 'aem',
      fallbackTimeout: 0,
      mainWindowAccessors: expect.arrayContaining(['intuit', 'appVars', 'mktg_datalayer']),
    }));
    expect(window.partytown.forward).not.toContain('dataLayer.push');
    segment.disconnect();

    const all = installMartechWorkerExperiment({ mode: 'all' });
    expect(window.partytown.forward).toContain('dataLayer.push');
    expect(window.partytown.forward).toContain('fbq');
    expect(all.state.requiredCorsOverrides).toEqual([
      expect.objectContaining({ hostname: 'connect.facebook.net' }),
      expect.objectContaining({ hostname: 'scripts.demandbase.com' }),
      expect.objectContaining({ hostname: 'tag-logger.demandbase.com' }),
    ]);
  });
});
