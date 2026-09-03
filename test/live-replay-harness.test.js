import {
  describe, it, expect, vi,
} from 'vitest';
import {
  existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createLineageRegistry,
  installReplayPageHook,
  validateCdpEndpoint,
  validateQualification,
} from '../scripts/diff/live-replay-harness.mjs';
import {
  activationEvidence, assertCanonicalScenarioPath, assertCleanReuseState, assertPreflight, assertRuntimeHashes, createRunJournal, createTargetGuard, deriveAllowlist, goldenScenario,
  browserPreflight, clickReplayTarget, executeSetupSteps, hashUrl, interactionSequence,
  launchArguments, portAvailable, purgeEvidence, qualificationLocator, qualificationLocatorCss,
  selectDedicatedOriginPage, selectDedicatedPage, validateLineageQualification,
  waitForUniqueQualificationLocator,
  shouldAbortReplayNavigation,
} from '../scripts/diff/live-replay-runner.mjs';

const scenario = {
  scenarioId: 'customer-workforce-faq-third-party-apps',
  page: '/workforce-automation',
};

const trackerEvent = (messageId, extra = {}) => ({
  event: 'content:interacted',
  type: 'track',
  messageId,
  anonymousId: 'raw-visitor-id',
  properties: {
    object: 'content',
    ui_object_detail: 'Do you integrate with third-party apps?',
    page_cas_id: '/workforce-automation',
    url: 'https://stage.erp.intuit.com/workforce-automation?private=1#secret',
    url_clean: 'stage.erp.intuit.com/workforce-automation?private=1#secret',
    url_host_name: 'stage.erp.intuit.com',
    unknown_customer_value: 'do not export me',
    safe_object: { name: 'safe', nested: { email: 'private@example.com' } },
    ivid: 'raw-intuit-visitor-id',
    ...extra,
  },
  context: { page: { path: '/workforce-automation' } },
  integrations: { 'Adobe Analytics': { marketingCloudVisitorId: 'raw-ecid' } },
});

const allowlist = {
  envelope: ['event', 'type'],
  properties: ['object', 'ui_object_detail', 'page_cas_id', 'url', 'url_clean', 'url_host_name', 'safe_object'],
  context: [],
  integrations: [],
  metadata: [],
};

const shapeOnly = {
  envelope: ['messageId', 'anonymousId'],
  properties: ['ivid'],
  context: ['page'],
  integrations: ['Adobe Analytics'],
  metadata: [],
};

function fakeScope({ transportPolicy = 'observe' } = {}) {
  const sent = [];
  const documentListeners = {};
  const scopeListeners = {};
  const analytics = {
    _dispatch(event) { return Promise.resolve(event); },
  };
  const webAnalytics = {
    async track(payload) {
      const event = trackerEvent(payload.messageId, payload.properties);
      await analytics._dispatch(event);
      const endpoint = 'https://eventbus.intuit.com/v2/segment/intuit-general-clickstream/b';
      const body = JSON.stringify({ batch: [event] });
      if (scope.__testTransport === 'beacon') scope.navigator.sendBeacon(endpoint, body);
      else if (scope.__testTransport === 'xhr') {
        const xhr = new scope.XMLHttpRequest();
        xhr.open('POST', endpoint);
        xhr.send(body);
      } else await scope.fetch(endpoint, { method: 'POST', body });
      return 'sent-to-segment';
    },
  };
  const scope = {
    location: {
      origin: 'https://stage.erp.intuit.com',
      pathname: '/workforce-automation',
    },
    crypto: globalThis.crypto,
    setInterval,
    clearInterval,
    addEventListener: vi.fn((type, listener, capture) => {
      scopeListeners[`${type}:${capture ? 'capture' : 'bubble'}`] = listener;
    }),
    removeEventListener: vi.fn((type, listener, capture) => {
      delete scopeListeners[`${type}:${capture ? 'capture' : 'bubble'}`];
    }),
    document: {
      addEventListener: vi.fn((type, listener, capture) => {
        documentListeners[`${type}:${capture ? 'capture' : 'bubble'}`] = listener;
      }),
      removeEventListener: vi.fn((type, listener, capture) => {
        delete documentListeners[`${type}:${capture ? 'capture' : 'bubble'}`];
      }),
    },
    fetch: vi.fn(async (url, options) => {
      sent.push({ url, body: options?.body });
      return { ok: true, status: 200 };
    }),
    navigator: {
      sendBeacon(url, body) {
        sent.push({ transport: 'beacon', url, body });
        return true;
      },
    },
    intuit: { tracking: { ecs: { analytics, webAnalytics } } },
  };
  scope.XMLHttpRequest = class XMLHttpRequest {
    open(method, url) {
      this.method = method;
      this.url = url;
    }

    send(body) {
      sent.push({ transport: 'xhr', url: this.url, body });
    }
  };
  return {
    scope, sent, transportPolicy, documentListeners, scopeListeners,
    dispatchClick: (callback) => {
      scopeListeners['click:capture']?.({ target: null });
      return callback();
    },
  };
}

describe('live replay harness contracts', () => {
  it('selects the qualification golden entry only through its explicit fixture reference', () => {
    const entry = { page: scenario.page, payloadFile: 'payloads/111.json', fullPayload: trackerEvent('golden') };
    expect(goldenScenario({ entries: [entry] }, {
      page: scenario.page,
      goldenRef: { payloadFile: 'payloads/111.json' },
    })).toBe(entry);
    expect(() => goldenScenario({ entries: [entry, { ...entry }] }, {
      page: scenario.page,
      goldenRef: { payloadFile: 'payloads/111.json' },
    })).toThrow(/resolved 2/i);
  });

  it('refuses an unreviewed scenario file even when the scenario ID could be copied', () => {
    expect(assertCanonicalScenarioPath('scripts/diff/fixtures/clicktrack-qualification-scenario.json'))
      .toEqual(expect.stringContaining('clicktrack-qualification-scenario.json'));
    expect(() => assertCanonicalScenarioPath('/tmp/copied-scenario.json')).toThrow(/reviewed canonical/i);

    const directory = mkdtempSync(join(tmpdir(), 'reviewed-scenarios-'));
    try {
      const generated = join(directory, 'scenario-customer-reviewed.json');
      writeFileSync(generated, '{}');
      expect(assertCanonicalScenarioPath(generated, {
        scenarioRoot: directory,
        manifestContentHash: `sha256:${'a'.repeat(64)}`,
        goldenMappingHash: `sha256:${'b'.repeat(64)}`,
      })).toBe(generated);
      expect(() => assertCanonicalScenarioPath(join(directory, '../scenario-customer-escape.json'), {
        scenarioRoot: directory,
        manifestContentHash: `sha256:${'a'.repeat(64)}`,
        goldenMappingHash: `sha256:${'b'.repeat(64)}`,
      })).toThrow(/reviewed canonical/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('derives the exact evidence allowlist from the customer golden envelope', () => {
    const result = deriveAllowlist(trackerEvent('golden'));
    expect(result.allowlist.envelope).toEqual(expect.arrayContaining(['event', 'type']));
    expect(result.allowlist.envelope).not.toContain('messageId');
    expect(result.allowlist.properties).toContain('page_cas_id');
    expect(result.shapeOnly.envelope).toEqual(expect.arrayContaining(['messageId', 'anonymousId']));
    expect(result.shapeOnly.context).toContain('page');
  });

  it('refuses browser preflight before any click when auth, consent, tracker, or origin is wrong', () => {
    const ready = {
      origin: 'https://stage.erp.intuit.com',
      pathname: '/workforce-automation',
      authenticated: true,
      consentState: 'resolved',
      utagReady: true,
      trackerReady: true,
      enqueueReady: true,
      trackableCount: 1,
    };
    expect(() => assertPreflight(ready, ready.origin, ready.pathname)).not.toThrow();
    expect(() => assertPreflight({ ...ready, consentState: 'unresolved', trackerReady: false }, ready.origin, ready.pathname)).toThrow(/consent, webAnalytics\.track/);
    expect(() => assertPreflight({ ...ready, origin: 'https://erp.intuit.com' }, ready.origin, ready.pathname)).toThrow(/stage-origin/);
  });

  it('requires every load-bearing and same-origin runtime hash before a click', () => {
    const origin = 'https://stage.erp.intuit.com';
    const scriptUrls = [
      `${origin}/scripts/scripts.js`,
      'https://tags.tiqcdn.com/utag/intuit/ies-erp/prod/utag.js',
      'https://uxfabric.intuitcdn.net/analytics/202605291754/track-event-lib.min.js',
      'https://uxfabric.intuitcdn.net/analytics/prod/track-event-lib-init.min.js',
    ];
    const blockModule = `${origin}/blocks/faq/faq.js`;
    const preflight = { scriptUrls, sameOriginScriptUrls: [scriptUrls[0], blockModule] };
    const hash = `sha256:${'a'.repeat(64)}`;
    const hashes = Object.fromEntries([
      `${origin}/scripts/scripts.js`, `${origin}/scripts/tracking.js`,
      `${origin}/scripts/ecs-enrich.js`, `${origin}/tracking.json`, blockModule, ...scriptUrls,
    ].map((url) => [url, hash]));
    expect(() => assertRuntimeHashes(preflight, hashes, origin)).not.toThrow();
    delete hashes[`${origin}/tracking.json`];
    expect(() => assertRuntimeHashes(preflight, hashes, origin)).toThrow(/missing runtime hashes/i);
  });

  it('bounds document and runtime-asset evidence fetches before any click', async () => {
    const never = () => new Promise(() => {});
    await expect(browserPreflight({ evaluate: never }, 'https://stage.erp.intuit.com', 5))
      .rejects.toThrow(/document preflight timed out after 5ms/i);
    await expect(hashUrl('https://stage.erp.intuit.com/scripts/tracking.js', {
      fetchImpl: never,
      timeoutMs: 5,
    })).rejects.toThrow(/asset hash fetch timed out after 5ms/i);
    await expect(hashUrl('https://stage.erp.intuit.com/scripts/tracking.js', {
      fetchImpl: async () => ({ ok: true, arrayBuffer: never }),
      timeoutMs: 5,
    })).rejects.toThrow(/asset hash fetch timed out after 5ms/i);
  });

  it('prohibits host-side request evidence while allowing top-frame navigation containment', () => {
    const source = readFileSync('scripts/diff/live-replay-runner.mjs', 'utf8');
    expect(source).not.toMatch(/\.on\(\s*['"]request|(?:Network|Fetch)\.enable/);
    expect(source).not.toMatch(/page\.goto\(`\$\{options\.origin\}\$\{scenario\.page\}`/);
    const containment = source.indexOf("await routedPage.route('**/*', navigationRoute)");
    const disconnect = source.indexOf('await browser.close();', containment);
    expect(source.indexOf("await routedPage.unroute('**/*', navigationRoute)", containment)).toBeGreaterThan(disconnect);
    const page = { mainFrame: () => 'main-frame' };
    expect(shouldAbortReplayNavigation({ isNavigationRequest: () => true, frame: () => 'main-frame' }, page)).toBe(true);
    expect(shouldAbortReplayNavigation({ isNavigationRequest: () => false, frame: () => 'main-frame' }, page)).toBe(false);
    expect(shouldAbortReplayNavigation({ isNavigationRequest: () => true, frame: () => 'iframe' }, page)).toBe(false);
  });

  it('pre-cancels link clicks without rewriting href metadata', async () => {
    const locator = { evaluate: vi.fn(), click: vi.fn() };
    await clickReplayTarget(locator, { locator: { role: 'link' }, interaction: { preventNavigation: true } }, {});
    expect(locator.evaluate).toHaveBeenCalledOnce();
    expect(locator.click).not.toHaveBeenCalled();

    await clickReplayTarget(locator, { locator: { role: 'button' }, interaction: { preventNavigation: true } }, {});
    expect(locator.click).toHaveBeenCalledOnce();
  });

  it('normalizes Tealium and vendor activation evidence for page provenance', () => {
    const scriptUrls = [
      'https://tags.tiqcdn.com/utag/intuit/ies-erp/prod/utag.js',
      'https://tags.tiqcdn.com/utag/intuit/ies-erp/prod/utag.14.js',
      'https://uxfabric.intuitcdn.net/analytics/prod/track-event-lib.min.js',
      'https://uxfabric.intuitcdn.net/analytics/prod/track-event-lib-init.min.js',
    ];
    expect(activationEvidence({ scriptUrls }, {
      evidence: { serialized: [{ requestUrl: 'https://eventbus.intuit.com/v2/segment/intuit-general-clickstream/t' }] },
    })).toEqual({
      tealiumTagUids: ['14'],
      resources: scriptUrls.filter((url) => /(?:utag\.js|track-event-lib(?:-init)?\.min\.js)$/.test(url)).sort(),
      vendorCalls: ['eventbus:intuit-general-clickstream'],
    });
  });

  it('builds a loopback-only dedicated Chrome launch and rejects the everyday profile', () => {
    const args = launchArguments({
      port: 9229,
      profileDir: '/tmp/intuit-erp-clicktrack-profile',
      origin: 'https://stage.erp.intuit.com',
    });
    expect(args).toContain('--remote-debugging-address=127.0.0.1');
    expect(args).toContain('--remote-debugging-port=9229');
    expect(args).toContain('--user-data-dir=/tmp/intuit-erp-clicktrack-profile');
    expect(() => launchArguments({
      port: 9229,
      profileDir: `${process.env.HOME}/Library/Application Support/Google/Chrome`,
      origin: 'https://stage.erp.intuit.com',
    })).toThrow(/everyday Chrome profile/i);
    expect(() => launchArguments({
      port: 9229,
      profileDir: '/tmp/intuit-erp-clicktrack-profile',
      origin: 'https://example.com',
    })).toThrow(/exact stage origin/i);
  });

  it('requires exactly one bound stage target and continuously poisons target violations', () => {
    const page = { url: () => 'https://stage.erp.intuit.com/workforce-automation' };
    const navigated = { url: () => 'https://stage.erp.intuit.com/' };
    expect(selectDedicatedPage([page], 'https://stage.erp.intuit.com', '/workforce-automation')).toBe(page);
    expect(selectDedicatedOriginPage([navigated], 'https://stage.erp.intuit.com')).toBe(navigated);
    expect(() => selectDedicatedOriginPage([{ url: () => 'https://erp.intuit.com/' }], 'https://stage.erp.intuit.com')).toThrow(/bound target/i);
    expect(() => selectDedicatedPage([page, { url: () => 'about:blank' }], 'https://stage.erp.intuit.com', '/workforce-automation')).toThrow(/exactly one target/i);
    expect(() => selectDedicatedPage([{ url: () => 'https://erp.intuit.com/workforce-automation' }], 'https://stage.erp.intuit.com', '/workforce-automation')).toThrow(/bound target/i);
    const guard = createTargetGuard(page, 'https://stage.erp.intuit.com');
    guard.observePage({ url: () => 'https://stage.erp.intuit.com/popup' });
    expect(() => guard.assert()).toThrow(/unexpected target/i);
    const navigationGuard = createTargetGuard(page, 'https://stage.erp.intuit.com');
    navigationGuard.observeNavigation('https://erp.intuit.com/workforce-automation?code=secret#state');
    expect(() => navigationGuard.assert()).toThrow(/cross-origin/i);
    expect(navigationGuard.snapshot().join(' ')).not.toMatch(/secret|state|\?/);
  });

  it('builds an exact visible data-track-id locator without treating the id as CSS', () => {
    expect(qualificationLocatorCss({ trackId: 'faq:question[one]"two' }))
      .toBe('[data-track-id="faq:question[one]\\"two"]:visible');
    expect(qualificationLocatorCss({ role: 'button' })).toBeNull();
  });

  it('intersects a tracking id with its reviewed role and accessible name', () => {
    const combined = {};
    const tracked = { and: vi.fn().mockReturnValue(combined) };
    const semantic = {};
    const page = {
      locator: vi.fn().mockReturnValue(tracked),
      getByRole: vi.fn().mockReturnValue(semantic),
    };
    const locator = { trackId: 'video:youtube', role: 'button', name: 'See how it works', exact: true };
    expect(qualificationLocator(page, locator)).toBe(combined);
    expect(tracked.and).toHaveBeenCalledWith(semantic);
  });

  it('scopes a semantic locator to its reviewed page region', () => {
    const semantic = {};
    const region = { getByRole: vi.fn().mockReturnValue(semantic) };
    const page = { locator: vi.fn().mockReturnValue(region) };
    expect(qualificationLocator(page, {
      region: 'main', role: 'link', name: 'Intuit Enterprise Suite', exact: true,
    })).toBe(semantic);
    expect(page.locator).toHaveBeenCalledWith('main');
  });

  it('matches normalized same-origin hrefs against relative authored attributes', () => {
    const combined = {};
    const constrained = { and: vi.fn().mockReturnValue(combined) };
    const semantic = {};
    const region = {
      getByRole: vi.fn().mockReturnValue(semantic),
      locator: vi.fn().mockReturnValue(constrained),
    };
    const page = { locator: vi.fn().mockReturnValue(region) };

    expect(qualificationLocator(page, {
      region: 'main', tag: 'A', role: 'link', name: 'Schedule a call', exact: true,
      href: 'https://stage.erp.intuit.com/',
    })).toBe(combined);
    expect(region.locator).toHaveBeenCalledWith(
      ':is(a[href="https://stage.erp.intuit.com/"],a[href="/"],a[href="#"])',
    );
  });

  it('allows reviewed external links to add volatile query parameters', () => {
    const combined = {};
    const constrained = { and: vi.fn().mockReturnValue(combined) };
    const semantic = {};
    const region = {
      getByRole: vi.fn().mockReturnValue(semantic),
      locator: vi.fn().mockReturnValue(constrained),
    };
    const page = { locator: vi.fn().mockReturnValue(region) };

    expect(qualificationLocator(page, {
      region: 'main', tag: 'A', role: 'link', name: 'Register', exact: true,
      href: 'https://www.intuit.com/intuitconnect/',
    })).toBe(combined);
    expect(region.locator).toHaveBeenCalledWith(
      ':is(a[href="https://www.intuit.com/intuitconnect/"],a[href^="https://www.intuit.com/intuitconnect/?"])',
    );
  });

  it('locates native summary controls without assuming an ARIA button role', () => {
    const filtered = {};
    const summaries = { filter: vi.fn().mockReturnValue(filtered) };
    const block = { locator: vi.fn().mockReturnValue(summaries) };
    const main = { locator: vi.fn().mockReturnValue(block) };
    const page = { locator: vi.fn().mockReturnValue(main) };
    expect(qualificationLocator(page, {
      region: 'main', tag: 'SUMMARY', role: 'button', name: 'Important pricing details',
      block: 'disclosure', exact: true,
    })).toBe(filtered);
    expect(page.locator).toHaveBeenCalledWith('main');
    expect(main.locator).toHaveBeenCalledWith('.disclosure.block');
    expect(block.locator).toHaveBeenCalledWith('summary');
    expect(summaries.filter).toHaveBeenCalledWith({
      hasText: /^\s*Important\s+pricing\s+details\s*$/u,
    });
  });

  it('uses reviewed widget constraints and refuses order-only occurrences', () => {
    const second = {};
    const semantic = { nth: vi.fn().mockReturnValue(second) };
    const widget = { getByRole: vi.fn().mockReturnValue(semantic) };
    const page = { locator: vi.fn().mockReturnValue(widget) };
    expect(qualificationLocator(page, {
      region: 'widget', role: 'link', name: 'Visit support page', exact: true,
      occurrence: 2, occurrenceEvidence: { stableConstraint: 'reviewed duplicate controls' },
    })).toBe(second);
    expect(page.locator).toHaveBeenCalledWith('#contact-us');
    expect(semantic.nth).toHaveBeenCalledWith(1);
    expect(() => qualificationLocator(page, {
      region: 'widget', role: 'link', name: 'Visit support page', exact: true, occurrence: 2,
    })).toThrow(/stable occurrence evidence/i);
  });

  it('opens setup UI before resolving the scoped replay target', async () => {
    const opener = { count: vi.fn().mockResolvedValue(1), click: vi.fn().mockResolvedValue() };
    const target = { waitFor: vi.fn().mockResolvedValue() };
    const page = { waitForTimeout: vi.fn() };
    const locate = vi.fn().mockReturnValueOnce(opener).mockReturnValueOnce(target);
    await executeSetupSteps(page, [{
      type: 'click',
      locator: { trackId: 'talk-to-sales:talk-to-sales', role: 'button', name: 'Talk to sales' },
      expect: {
        state: 'visible',
        locator: { trackId: 'talk-to-sales:schedule-a-call', role: 'button', name: 'Schedule a call' },
      },
    }], { locate });
    expect(opener.click).toHaveBeenCalledOnce();
    expect(target.waitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 8000 });
  });

  it('uses three interactions only for the one-time lineage proof and one for scenario capture', () => {
    expect(interactionSequence('proof').filter(({ type }) => type === 'click')).toHaveLength(3);
    expect(interactionSequence('capture')).toEqual([
      { type: 'activate' }, { type: 'click' }, { type: 'wait-linked' }, { type: 'deactivate' },
    ]);
  });

  it('binds a reusable lineage proof to the same deployment, browser target, and manifest', () => {
    const binding = {
      origin: 'https://stage.erp.intuit.com', profileId: 'profile', chromeVersion: '151',
      mode: 'dedicated', harnessVersion: '0.2.0', consentState: 'resolved',
      targetId: 'target', authorizationRef: 'Adobe Migration Test', lineagePolicyVersion: 'message-id-v1',
      runtimeHashes: { tracking: 'sha256:tracking' },
      sourceHashes: { 'live-replay-runner.mjs': 'sha256:runner', 'clicktrack-qualification-scenario.json': 'sha256:capture' },
      completeGoldenManifest: { contentHash: 'sha256:manifest', mappingHash: 'sha256:mapping' },
    };
    const proof = { qualification: {
      ...binding,
      lineageMode: 'proof',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sourceHashes: { ...binding.sourceHashes, 'clicktrack-qualification-scenario.json': 'sha256:proof' },
    } };
    expect(validateLineageQualification(proof, binding, Buffer.from('proof'))).toMatchObject({
      artifactSha256: expect.stringMatching(/^sha256:/), targetId: 'target', lineagePolicyVersion: 'message-id-v1',
    });
    proof.qualification.targetId = 'other';
    expect(() => validateLineageQualification(proof, binding, Buffer.from('proof')))
      .toThrow(/lineage qualification binding/i);
    proof.qualification.targetId = binding.targetId;
    ['mode', 'harnessVersion', 'consentState'].forEach((key) => {
      const changed = { ...binding, [key]: `${binding[key]}-changed` };
      expect(() => validateLineageQualification(proof, changed, Buffer.from('proof')))
        .toThrow(/lineage qualification binding/i);
    });
  });

  it('waits for a replay target to stabilize to exactly one element', async () => {
    const locator = { count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(2).mockResolvedValueOnce(1) };
    const page = { waitForTimeout: vi.fn().mockResolvedValue() };
    await expect(waitForUniqueQualificationLocator(page, locator, 500, 250)).resolves.toBe(locator);
    expect(locator.count).toHaveBeenCalledTimes(3);
    expect(page.waitForTimeout).toHaveBeenCalledTimes(2);
  });

  it('still refuses a locator that remains ambiguous', async () => {
    const locator = { count: vi.fn().mockResolvedValue(2) };
    const page = { waitForTimeout: vi.fn().mockResolvedValue() };
    await expect(waitForUniqueQualificationLocator(page, locator, 500, 250))
      .rejects.toThrow('scenario locator resolved 2 elements');
  });

  it('refuses target reuse when a lease marker, callback, or wrapper survived disconnect', () => {
    const clean = {
      targetId: 'target-1',
      expectedTargetMarker: 'marker-1',
      replayAbsent: true,
      targetMarkerAbsent: true,
      wrappedFunctions: [],
      cleanupAttestation: {
        targetMarker: 'marker-1', restored: true, cleared: { lineage: 0, evidence: 0 },
      },
    };
    expect(() => assertCleanReuseState(clean, 'target-1')).not.toThrow();
    expect(() => assertCleanReuseState({ ...clean, wrappedFunctions: ['fetch'] }, 'target-1')).toThrow(/cleanup/i);
    expect(() => assertCleanReuseState(clean, 'target-2')).toThrow(/target identity/i);
  });

  it('refuses a debugging port already owned by another local service', async () => {
    const fakeServer = (outcome) => () => {
      const listeners = {};
      return {
        once(event, handler) {
          listeners[event] = handler;
          return this;
        },
        listen() {
          listeners[outcome]();
        },
        close(handler) {
          handler();
        },
      };
    };
    expect(await portAvailable(9229, fakeServer('error'))).toBe(false);
    expect(await portAvailable(9339, fakeServer('listening'))).toBe(true);
  });

  it('keeps a resumable refusal journal across attempts', () => {
    const options = {
      origin: 'https://stage.erp.intuit.com',
      transport: 'observe',
      authorizationRef: 'customer-approved parity exercise 2026-08-29',
    };
    const first = createRunJournal(options, scenario);
    const second = createRunJournal(options, scenario, first);
    expect(first).toMatchObject({
      status: 'in-progress',
      attempt: 1,
      resume: { nextScenarioId: scenario.scenarioId, canResume: true },
    });
    expect(second.attempt).toBe(2);
    expect(second.previousRunId).toBe(first.runId);
  });

  it('purges only expired harness artifacts under the evidence directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'live-replay-purge-'));
    try {
      const expired = join(directory, 'live-replay-expired.json');
      const current = join(directory, 'live-replay-current.json');
      const unrelated = join(directory, 'customer-golden.json');
      [expired, current, unrelated].forEach((path) => writeFileSync(path, '{}'));
      const old = new Date('2026-07-01T00:00:00Z');
      utimesSync(expired, old, old);
      const deleted = purgeEvidence(directory, {
        now: Date.parse('2026-08-29T00:00:00Z'),
        retentionDays: 30,
      });
      expect(deleted).toEqual([expired]);
      expect(existsSync(expired)).toBe(false);
      expect(existsSync(current)).toBe(true);
      expect(existsSync(unrelated)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('accepts loopback-only CDP endpoints and rejects remote or credentialed endpoints', () => {
    expect(validateCdpEndpoint('http://127.0.0.1:9229')).toEqual('http://127.0.0.1:9229');
    expect(validateCdpEndpoint('http://localhost:9229/')).toEqual('http://localhost:9229');
    expect(() => validateCdpEndpoint('http://192.168.1.2:9229')).toThrow(/loopback/i);
    expect(() => validateCdpEndpoint('http://user:pass@localhost:9229')).toThrow(/credentials/i);
    expect(() => validateCdpEndpoint('https://localhost:9229')).toThrow(/http/i);
  });

  it('refuses stale, missing, or changed qualification bindings', () => {
    const now = Date.parse('2026-08-29T20:00:00.000Z');
    const binding = {
      qualifiedAt: '2026-08-29T19:00:00.000Z',
      expiresAt: '2026-08-30T19:00:00.000Z',
      mode: 'dedicated',
      profileId: 'intuit-erp-clicktrack',
      chromeVersion: '140.0.7339.0',
      harnessVersion: '0.2.0',
      lineagePolicyVersion: 'message-id-v1',
      origin: 'https://stage.erp.intuit.com',
      consentState: 'resolved',
      authorizationRef: 'customer-approved parity exercise 2026-08-29',
      runtimeHashes: { tracker: 'sha256:abc' },
      sourceHashes: { harness: 'sha256:def' },
      scenarioId: scenario.scenarioId,
      scenarioDefinitionHash: 'sha256:def',
    };
    expect(validateQualification(binding, { ...binding }, now)).toEqual(binding);
    expect(() => validateQualification(binding, { ...binding, chromeVersion: '141.0' }, now)).toThrow(/chromeVersion/);
    expect(() => validateQualification(binding, { ...binding }, Date.parse('2026-08-31T00:00:00Z'))).toThrow(/expired/i);
    expect(() => validateQualification({ ...binding, authorizationRef: '' }, binding, now)).toThrow(/authorization/i);
  });

  it('links a serialization only through its tracker-generated messageId', () => {
    const lineage = createLineageRegistry();
    lineage.begin(scenario);
    lineage.observeDispatch(trackerEvent('ajs-next-current'));
    lineage.end();

    expect(lineage.observeSerialized(trackerEvent('ajs-next-stale')).status).toBe('unlinked');
    expect(lineage.observeSerialized(trackerEvent('ajs-next-current'))).toMatchObject({
      status: 'linked',
      scenarioId: scenario.scenarioId,
      messageId: 'ajs-next-current',
    });
  });

  it('poisons duplicate IDs in the standalone lineage contract', () => {
    const lineage = createLineageRegistry();
    lineage.begin(scenario);
    expect(lineage.observeDispatch(trackerEvent('duplicate')).status).toBe('enqueued');
    expect(lineage.observeDispatch(trackerEvent('duplicate')).status).toBe('ambiguous');
    expect(lineage.observeSerialized(trackerEvent('duplicate'))).toMatchObject({
      status: 'ambiguous', reason: 'duplicate-message-id',
    });
  });

  it('captures one observed click, rejects a business-identical stale event, and sanitizes before snapshot', async () => {
    const { scope, sent, dispatchClick } = fakeScope();
    const hook = await installReplayPageHook({
      origin: 'https://stage.erp.intuit.com',
      transportPolicy: 'observe',
      observeAuthorizationRef: 'customer-approved parity exercise 2026-08-29',
      targetMarker: 'test-target',
      allowlist,
      shapeOnly,
      leaseMs: 1000,
      heartbeatMs: 100,
    }, scope);

    await scope.fetch('https://eventbus.intuit.com/v2/segment/intuit-general-clickstream/b', {
      method: 'POST',
      body: JSON.stringify({ batch: [trackerEvent('ajs-next-stale')] }),
    });
    hook.activate(scenario);
    await dispatchClick(() => scope.intuit.tracking.ecs.webAnalytics.track({
      messageId: 'ajs-next-current', properties: trackerEvent('x').properties,
    }));
    hook.deactivate();
    const evidence = await hook.snapshot();

    expect(sent).toHaveLength(2);
    expect(evidence.serialized.map((entry) => entry.status).sort()).toEqual(['linked', 'unlinked']);
    const linked = evidence.serialized.find((entry) => entry.status === 'linked');
    expect(linked).toMatchObject({
      scenarioId: scenario.scenarioId,
      messageId: { redacted: true, type: 'string', length: 16 },
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain('do not export me');
    expect(serialized).not.toContain('private=1');
    expect(serialized).not.toContain('#secret');
    expect(serialized).not.toContain('raw-visitor-id');
    expect(serialized).not.toContain('raw-intuit-visitor-id');
    expect(serialized).not.toContain('raw-ecid');
    expect(serialized).not.toContain('private@example.com');
    expect(linked.payload.messageId).toBe('STR:16');
    expect(linked.payload.anonymousId).toBe('STR:14');
    expect(linked.payload.properties.ivid).toBe('STR:21');
    expect(linked.payload.integrations['Adobe Analytics']).toEqual({
      marketingCloudVisitorId: 'STR:8',
    });
    expect(linked.payload.properties.url).toBe('https://stage.erp.intuit.com/workforce-automation');
    expect(linked.payload.properties.url_clean).toBe('stage.erp.intuit.com/workforce-automation');
    expect(linked.payload.properties.url_host_name).toBe('stage.erp.intuit.com');
    expect(linked.payload.properties.safe_object.nested.email).toMatchObject({ redacted: true });
    expect(linked.payload.properties.unknown_customer_value).toMatchObject({
      redacted: true,
      type: 'string',
      length: 16,
    });
    expect(linked.payload.properties.unknown_customer_value.hmac).toMatch(/^[0-9a-f]{64}$/);
    await hook.teardown('test-complete');
  });

  it('poisons duplicate messageId lineage instead of linking the first dispatch', async () => {
    const { scope, dispatchClick } = fakeScope();
    const hook = await installReplayPageHook({
      origin: 'https://stage.erp.intuit.com',
      transportPolicy: 'observe',
      observeAuthorizationRef: 'customer-approved parity exercise 2026-08-29',
      targetMarker: 'test-target',
      allowlist,
      shapeOnly,
      leaseMs: 1000,
      heartbeatMs: 100,
    }, scope);
    hook.activate(scenario);
    await dispatchClick(() => scope.intuit.tracking.ecs.webAnalytics.track({
      messageId: 'duplicate-message-id', properties: trackerEvent('x').properties,
    }));
    await dispatchClick(() => scope.intuit.tracking.ecs.webAnalytics.track({
      messageId: 'duplicate-message-id', properties: trackerEvent('x').properties,
    }));
    const evidence = await hook.snapshot();
    expect(evidence.dispatches.map(({ status }) => status)).toEqual(['ambiguous', 'ambiguous']);
    expect(evidence.serialized.every((entry) => entry.status === 'ambiguous'
      && entry.reason === 'duplicate-message-id')).toBe(true);
    await hook.teardown('test-complete');
  });

  it('keeps a pre-scenario transport unlinked when it arrives during the active window', async () => {
    const { scope, dispatchClick } = fakeScope();
    const hook = await installReplayPageHook({
      origin: 'https://stage.erp.intuit.com',
      transportPolicy: 'observe',
      observeAuthorizationRef: 'customer-approved parity exercise 2026-08-29',
      targetMarker: 'test-target',
      qualificationMode: true,
      allowlist,
      shapeOnly,
      leaseMs: 1000,
      heartbeatMs: 100,
    }, scope);
    hook.holdNextTransport();
    const stale = scope.intuit.tracking.ecs.webAnalytics.track({
      messageId: 'ajs-next-stale', properties: trackerEvent('x').properties,
    });
    await vi.waitFor(() => expect(hook.hasHeldTransport()).toBe(true));
    hook.activate(scenario);
    await hook.releaseHeldTransport();
    await stale;
    await dispatchClick(() => scope.intuit.tracking.ecs.webAnalytics.track({
      messageId: 'ajs-next-current', properties: trackerEvent('x').properties,
    }));
    const evidence = await hook.snapshot();
    expect(evidence.serialized.map(({ status }) => status).sort()).toEqual(['linked', 'unlinked']);
    expect(evidence.serialized.find(({ status }) => status === 'unlinked')).toMatchObject({
      scenarioId: null,
      activeScenarioIdAtSerialization: scenario.scenarioId,
      reason: 'no-invocation-lineage',
    });
    await hook.teardown('test-complete');
  });

  it('links only tracker invocations caused by the active click dispatch', async () => {
    const { scope, dispatchClick } = fakeScope();
    const hook = await installReplayPageHook({
      origin: 'https://stage.erp.intuit.com',
      transportPolicy: 'observe',
      observeAuthorizationRef: 'customer-approved parity exercise 2026-08-29',
      targetMarker: 'test-target',
      allowlist,
      shapeOnly,
      leaseMs: 1000,
      heartbeatMs: 100,
    }, scope);
    hook.activate(scenario);
    await scope.intuit.tracking.ecs.webAnalytics.track({
      messageId: 'background-chat',
      properties: { ...trackerEvent('x').properties, object: 'chat', action: 'viewed' },
    });
    await dispatchClick(() => scope.intuit.tracking.ecs.webAnalytics.track({
      messageId: 'clicked-control', properties: trackerEvent('x').properties,
    }));
    const evidence = await hook.snapshot();
    expect(evidence.serialized.map(({ status }) => status)).toEqual(['unlinked', 'linked']);
    expect(evidence.serialized[1]).toMatchObject({
      scenarioId: scenario.scenarioId,
      invocationId: `${scenario.scenarioId}:1`,
    });
    await hook.teardown('test-complete');
  });

  it('links click microtasks but excludes tracker calls from the next browser task', async () => {
    const { scope, dispatchClick } = fakeScope();
    const hook = await installReplayPageHook({
      origin: 'https://stage.erp.intuit.com',
      transportPolicy: 'observe',
      observeAuthorizationRef: 'customer-approved parity exercise 2026-08-29',
      targetMarker: 'test-target',
      allowlist,
      shapeOnly,
      leaseMs: 1000,
      heartbeatMs: 100,
    }, scope);
    hook.activate(scenario);
    await dispatchClick(async () => {
      await Promise.resolve();
      return scope.intuit.tracking.ecs.webAnalytics.track({
        messageId: 'clicked-microtask', properties: trackerEvent('x').properties,
      });
    });
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    await scope.intuit.tracking.ecs.webAnalytics.track({
      messageId: 'next-task-chat',
      properties: { ...trackerEvent('x').properties, object: 'chat', action: 'viewed' },
    });
    const evidence = await hook.snapshot();
    expect(evidence.serialized.map(({ status }) => status)).toEqual(['linked', 'unlinked']);
    await hook.teardown('test-complete');
  });

  it('prevents link navigation before activation only during the qualification proof window', async () => {
    const { scope, documentListeners } = fakeScope();
    const hook = await installReplayPageHook({
      origin: 'https://stage.erp.intuit.com',
      transportPolicy: 'observe',
      observeAuthorizationRef: 'customer-approved parity exercise 2026-08-29',
      targetMarker: 'test-target',
      qualificationMode: true,
      preventNavigation: true,
      allowlist,
      shapeOnly,
      leaseMs: 1000,
      heartbeatMs: 100,
    }, scope);
    const preventDefault = vi.fn();
    const anchor = { matches: (selector) => selector.includes('a[href]') };
    documentListeners['click:capture']({ target: { closest: () => anchor }, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    await hook.teardown('test-complete');
  });

  it.each(['beacon', 'xhr'])('captures and restores the %s eventbus transport', async (transport) => {
    const { scope, sent, dispatchClick } = fakeScope();
    const originalBeacon = scope.navigator.sendBeacon;
    const originalOpen = scope.XMLHttpRequest.prototype.open;
    const originalSend = scope.XMLHttpRequest.prototype.send;
    const hook = await installReplayPageHook({
      origin: 'https://stage.erp.intuit.com',
      transportPolicy: 'observe',
      observeAuthorizationRef: 'customer-approved parity exercise 2026-08-29',
      targetMarker: 'test-target',
      allowlist,
      shapeOnly,
      leaseMs: 1000,
      heartbeatMs: 100,
    }, scope);
    hook.activate(scenario);
    scope.__testTransport = transport;
    await dispatchClick(() => scope.intuit.tracking.ecs.webAnalytics.track({
      messageId: `ajs-next-${transport}`, properties: trackerEvent('x').properties,
    }));
    const evidence = await hook.snapshot();
    expect(evidence.serialized[0].status).toBe('linked');
    expect(sent.some((entry) => entry.transport === transport)).toBe(true);
    await hook.teardown('test-complete');
    expect(scope.navigator.sendBeacon).toBe(originalBeacon);
    expect(scope.XMLHttpRequest.prototype.open).toBe(originalOpen);
    expect(scope.XMLHttpRequest.prototype.send).toBe(originalSend);
  });

  it('replays deterministic approved fields across independent runs', async () => {
    const captureOnce = async (targetMarker) => {
      const { scope, dispatchClick } = fakeScope();
      const hook = await installReplayPageHook({
        origin: 'https://stage.erp.intuit.com',
        transportPolicy: 'observe',
        observeAuthorizationRef: 'customer-approved parity exercise 2026-08-29',
        targetMarker,
        allowlist,
        shapeOnly,
        leaseMs: 1000,
        heartbeatMs: 100,
      }, scope);
      hook.activate(scenario);
      await dispatchClick(() => scope.intuit.tracking.ecs.webAnalytics.track({
        messageId: 'per-visit-id', properties: trackerEvent('x').properties,
      }));
      const payload = (await hook.snapshot()).serialized[0].payload;
      await hook.teardown('test-complete');
      return Object.fromEntries(['object', 'ui_object_detail', 'page_cas_id', 'url', 'url_clean', 'url_host_name']
        .map((key) => [key, payload.properties[key]]));
    };
    expect(await captureOnce('target-a')).toEqual(await captureOnce('target-b'));
  });

  it('does not deliver abort-mode analytics and refuses abort without separate authorization', async () => {
    const first = fakeScope({ transportPolicy: 'abort' });
    await expect(installReplayPageHook({
      origin: 'https://stage.erp.intuit.com',
      transportPolicy: 'abort',
      targetMarker: 'test-target',
      allowlist,
      shapeOnly,
    }, first.scope)).rejects.toThrow(/abort authorization/i);

    const second = fakeScope({ transportPolicy: 'abort' });
    const hook = await installReplayPageHook({
      origin: 'https://stage.erp.intuit.com',
      transportPolicy: 'abort',
      abortAuthorizationRef: 'customer-approved abort 2026-08-29',
      targetMarker: 'test-target',
      allowlist,
      shapeOnly,
      leaseMs: 1000,
      heartbeatMs: 100,
    }, second.scope);
    hook.activate(scenario);
    await second.dispatchClick(() => second.scope.intuit.tracking.ecs.webAnalytics.track({
      messageId: 'ajs-next-abort', properties: trackerEvent('x').properties,
    }));
    second.scope.__testTransport = 'beacon';
    await second.dispatchClick(() => second.scope.intuit.tracking.ecs.webAnalytics.track({
      messageId: 'ajs-next-abort-beacon', properties: trackerEvent('x').properties,
    }));
    second.scope.__testTransport = 'xhr';
    await second.dispatchClick(() => second.scope.intuit.tracking.ecs.webAnalytics.track({
      messageId: 'ajs-next-abort-xhr', properties: trackerEvent('x').properties,
    }));
    expect(second.sent).toHaveLength(0);
    expect((await hook.snapshot()).serialized.every((entry) => entry.status === 'linked')).toBe(true);
    await hook.teardown('test-complete');
  });

  it('restores every wrapper after an abrupt controller heartbeat loss', async () => {
    vi.useFakeTimers();
    try {
      const { scope } = fakeScope();
      const originalTrack = scope.intuit.tracking.ecs.webAnalytics.track;
      const originalDispatch = scope.intuit.tracking.ecs.analytics._dispatch;
      const originalFetch = scope.fetch;
      const hook = await installReplayPageHook({
        origin: 'https://stage.erp.intuit.com',
        transportPolicy: 'observe',
        observeAuthorizationRef: 'customer-approved parity exercise 2026-08-29',
        targetMarker: 'test-target',
        allowlist,
        shapeOnly,
        leaseMs: 50,
        heartbeatMs: 10,
      }, scope);
      hook.activate(scenario);
      await vi.advanceTimersByTimeAsync(75);
      expect(scope.intuit.tracking.ecs.webAnalytics.track).toBe(originalTrack);
      expect(scope.intuit.tracking.ecs.analytics._dispatch).toBe(originalDispatch);
      expect(scope.fetch).toBe(originalFetch);
      expect((await hook.snapshot()).active).toBe(false);
      expect(hook.cleanupState()).toMatchObject({
        installed: false,
        byMessageId: 0,
        ambiguousMessageIds: 0,
        invocations: 0,
        dispatches: 0,
        serialized: 0,
        pendingSanitizers: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores and clears synchronously even when a held original fetch stalls', async () => {
    const { scope } = fakeScope();
    let releaseFetch;
    scope.fetch = vi.fn(() => new Promise((resolve) => { releaseFetch = resolve; }));
    const originalFetch = scope.fetch;
    const originalTrack = scope.intuit.tracking.ecs.webAnalytics.track;
    const hook = await installReplayPageHook({
      origin: 'https://stage.erp.intuit.com',
      transportPolicy: 'observe',
      observeAuthorizationRef: 'customer-approved parity exercise 2026-08-29',
      targetMarker: 'test-target',
      qualificationMode: true,
      allowlist,
      shapeOnly,
      leaseMs: 1000,
      heartbeatMs: 100,
    }, scope);
    hook.holdNextTransport();
    const pending = scope.intuit.tracking.ecs.webAnalytics.track({
      messageId: 'stalled', properties: trackerEvent('x').properties,
    });
    await vi.waitFor(() => expect(hook.hasHeldTransport()).toBe(true));
    await hook.teardown('lease-expired');
    expect(scope.fetch).toBe(originalFetch);
    expect(scope.intuit.tracking.ecs.webAnalytics.track).toBe(originalTrack);
    expect(hook.cleanupState()).toMatchObject({ installed: false, byMessageId: 0, serialized: 0 });
    releaseFetch({ ok: true, status: 200 });
    await pending;
    await Promise.resolve();
    expect(hook.cleanupState()).toMatchObject({
      installed: false, byMessageId: 0, serializedByMessageId: 0, serialized: 0, pendingSanitizers: 0,
    });
  });
});
