import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
// Real-render wiring guard for media-text's AI-agents promo CTA. On /accounting the "Explore
// agents" button is a loose media-text CTA that prod tags with the upstream `feature` component's
// authored residue: object_detail = ui_object_detail = `feature|explore_agents_cta`, ui_object=
// button, data-wa-link=`feature-explore-agents-cta`. Our build JIT-derives it at pointerdown via
// trackAs({ payload }); nothing is stamped at rest. The block's OTHER CTAs stay generic derives.
import { initTracking, resetTrackingState, stampInteraction } from '../scripts/tracking.js';
import { computeTrackingPayload } from '../scripts/diff/tracker-replica.mjs';

const { default: decorate } = await import('../blocks/media-text/media-text.js');

// media-text authored shape (default split row): cell 1 = text (heading / body / CTA), cell 2 =
// media. Row 0 is the AI-agents feature promo; row 1 is a plain promo whose CTA must stay generic.
function makeMediaText() {
  const block = document.createElement('div');
  block.className = 'media-text tint block';
  block.setAttribute('data-block-name', 'media-text');
  block.innerHTML = ''
    + '<div>'
    + '  <div>'
    + '    <h2>Work faster, plan smarter with Intuit’s AI agents</h2>'
    + '    <p>Put AI agents to work across your business.</p>'
    + '    <p class="button-wrapper"><a class="button primary" href="/ai-agents">Explore agents</a></p>'
    + '  </div>'
    + '  <div><img src="/agents.png" alt="AI agents"></div>'
    + '</div>'
    + '<div>'
    + '  <div>'
    + '    <h2>Boost productivity with custom roles</h2>'
    + '    <p>Tailor access to every team.</p>'
    + '    <p class="button-wrapper"><a class="button primary" href="/pricing">Refer a client</a></p>'
    + '  </div>'
    + '  <div><img src="/roles.png" alt="Custom roles"></div>'
    + '</div>';
  return block;
}

function makeCardsMediaText() {
  const block = document.createElement('div');
  block.className = 'media-text cards block';
  block.setAttribute('data-block-name', 'media-text');
  block.innerHTML = ''
    + '<div>'
    + '  <div>'
    + '    <h2>Payroll</h2>'
    + '    <p class="button-wrapper"><a class="button primary" href="/">Schedule a consultation</a></p>'
    + '  </div>'
    + '  <div><img src="/payroll.png" alt="Payroll"></div>'
    + '</div>';
  return block;
}

function setup() {
  document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState();
  const main = document.createElement('main');
  const block = makeMediaText();
  main.append(block); document.body.append(main);
  decorate(block);
  initTracking(document);
  return block;
}

describe('media-text — AI-agents feature CTA tracking (JIT-derived)', () => {
  beforeEach(() => {
    document.head.innerHTML = ''; document.body.innerHTML = ''; resetTrackingState();
    window.history.replaceState({}, '', '/');
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('the /ai-agents promo CTA JIT-stamps the authored feature|explore_agents_cta residue', () => {
    const block = setup();
    const cta = block.querySelector('a.button[href="/ai-agents"]');
    expect(cta).not.toBeNull();

    stampInteraction({ target: cta });
    // object_detail + ui_object_detail carry the upstream `feature` id; ui_object=button;
    // wa-link is the campaign code. These are what the customer golden gates for this beacon.
    expect(cta.getAttribute('data-object-detail')).toBe('feature|explore_agents_cta');
    expect(cta.getAttribute('data-ui-object-detail')).toBe('feature|explore_agents_cta');
    expect(cta.getAttribute('data-ui-object')).toBe('button');
    expect(cta.getAttribute('data-wa-link')).toBe('feature-explore-agents-cta');

    // Through the tracker replica: the full per-click payload matches the golden's gated fields.
    const p = computeTrackingPayload(cta);
    expect(p.object).toBe('content');
    expect(p.object_detail).toBe('feature|explore_agents_cta');
    expect(p.ui_object).toBe('button');
    expect(p.ui_object_detail).toBe('feature|explore_agents_cta');
    expect(p.action).toBe('interacted');
    expect(p.ui_action).toBe('clicked');
    expect(p['data-wa-link']).toBe('feature-explore-agents-cta');
    // prod emits no ui_access_point on this loose CTA; we keep the `page` superset (not gated).
    expect(p.ui_access_point).toBe('page');
  });

  it('other media-text CTAs stay generic loose derives (deriver is /ai-agents-scoped)', () => {
    const block = setup();
    const other = block.querySelector('a.button[href="/pricing"]');
    expect(other).not.toBeNull();

    stampInteraction({ target: other });
    // No feature residue: object_detail/wa-link absent, ui_object_detail is the plain label.
    expect(other.getAttribute('data-object-detail')).toBeNull();
    expect(other.getAttribute('data-wa-link')).toBeNull();
    expect(other.getAttribute('data-ui-object-detail')).toBe('Refer a client');
  });

  it('the cards variant resolves its authored sheet row through the cards namespace', async () => {
    window.history.replaceState({}, '', '/erp-solutions');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{
        path: '/erp-solutions',
        id: 'cards:schedule-a-consultation',
        'object-detail': 'payroll card',
        action: 'goto',
        'wa-link': 'see-plans-payroll',
      }] }),
    }));
    const main = document.createElement('main');
    const block = makeCardsMediaText();
    main.append(block); document.body.append(main);
    decorate(block);
    initTracking(document);
    const cta = block.querySelector('a.button');

    await vi.waitFor(() => {
      stampInteraction({ target: cta });
      expect(cta.getAttribute('data-track-id')).toBe('cards:erp');
      expect(cta.getAttribute('data-object-detail')).toBe('payroll card');
      expect(cta.getAttribute('data-action')).toBe('goto');
      expect(cta.getAttribute('data-wa-link')).toBe('see-plans-payroll');
    });
  });
});
