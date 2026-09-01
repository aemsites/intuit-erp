import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';

// loadFragment is the only external the header truly needs controlled — it returns
// the (already navigation.js-decorated) nav fragment. Mock it to a representative
// `.navigation` block; leave the rest of the header's decorate to run for real.
vi.mock('../blocks/fragment/fragment.js', () => ({ loadFragment: vi.fn() }));

const { loadFragment } = await import('../blocks/fragment/fragment.js');
const { default: decorate } = await import('../blocks/header/header.js');
const {
  initTracking, stampInteraction, resetTrackingState, ctasIn, trackIdOf,
} = await import('../scripts/tracking.js');

// A representative /nav fragment in the shape fetchChromeHTML() parses: a utility
// row (brand-strip logos) + a main row (IES logo in cell 1; flat .nav-item flyouts
// + a .nav-cta in cell 2, incl. a Resources item that seeds the secondary nav).
function navFragment() {
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="navigation">
      <div>
        <div><a href="https://www.intuit.com/"><img src="/i.svg" alt="Intuit"></a></div>
        <div><ul>
          <li><a href="https://turbotax.intuit.com/"><img src="/tt.svg" alt="TurboTax"></a></li>
          <li><a href="https://mailchimp.com/"><img src="/mc.svg" alt="Mailchimp"></a></li>
        </ul></div>
      </div>
      <div>
        <div><a href="https://erp.intuit.com/"><img src="/erp.svg" alt="IES"></a></div>
        <div>
          <div class="nav-item"><button type="button">Capabilities</button>
            <div class="flyout"><div class="flyout-col"><a href="https://erp.intuit.com/accounting">Accounting</a></div></div></div>
          <div class="nav-item"><button type="button">Pricing</button></div>
          <div class="nav-item"><button type="button">Resources</button>
            <div class="flyout"><p class="flyout-heading">Resource center</p>
              <div class="flyout-col"><a href="https://erp.intuit.com/blog/">Resource center</a><a href="https://erp.intuit.com/compare/">Compare ERPs</a></div></div></div>
          <a class="nav-link nav-cta" href="#schedule">Schedule a call</a>
        </div>
      </div>
    </div>`;
  return el;
}

async function buildHeader() {
  const headerEl = document.createElement('header');
  const block = document.createElement('div');
  block.className = 'header block';
  headerEl.append(block);
  document.body.append(headerEl);
  await decorate(block);
  return block;
}

const idOf = (el) => el.getAttribute('data-track-id');
const buttonNamed = (block, name) => [...block.querySelectorAll('.nav-item > button')]
  .find((button) => button.textContent.trim() === name);

describe('header/nav click-tracking — id-based keying (real render)', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.body.className = '';
    resetTrackingState();
    loadFragment.mockResolvedValue(navFragment());
    // decorate() touches a couple of browser APIs jsdom lacks.
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    window.requestAnimationFrame = (cb) => { cb(); return 0; };
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('stamps a nav: data-track-id on every tracked CTA; skip controls get none', async () => {
    const block = await buildHeader();
    // the hamburger toggle is a pure-UI control -> skipped, no id
    const toggle = block.querySelector('.nav-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle.closest('[data-track-skip]')).not.toBeNull();
    expect(trackIdOf(toggle)).toBe(null);
    // every non-skipped CTA carries a well-formed nav: id
    const tracked = ctasIn(block).filter((el) => !el.closest('[data-track-skip]'));
    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked.every((el) => /^nav:/.test(trackIdOf(el) || ''))).toBe(true);
  });

  it('keys brand logos + IES logo by host, flyout buttons by label, schedule CTA by label', async () => {
    const block = await buildHeader();
    expect(idOf(block.querySelector('.bs-logo[href="https://turbotax.intuit.com/"]'))).toBe('nav:turbotax');
    expect(idOf(block.querySelector('.bs-logo[href="https://mailchimp.com/"]'))).toBe('nav:mailchimp');
    expect(idOf(block.querySelector('.nav-logo'))).toBe('nav:erp'); // own host -> hostLabel
    const capabilities = [...block.querySelectorAll('.nav-item > button')].find((b) => b.textContent.trim() === 'Capabilities');
    expect(idOf(capabilities)).toBe('nav:capabilities');
    expect(idOf(block.querySelector('.nav-cta'))).toBe('nav:schedule-a-call'); // href-less -> label
  });

  it('resolves a flyout button to its sheet residue by id (not DOM position)', async () => {
    const block = await buildHeader();
    const sheet = [{ path: '*', id: 'nav:capabilities', 'wa-link': 'ies-nav:capabilities', 'object-detail': 'nav|capabilities' }];
    vi.stubGlobal('fetch', vi.fn((url) => (String(url).includes('tracking.json')
      ? Promise.resolve({ ok: true, json: () => Promise.resolve({ data: sheet }) })
      : Promise.resolve({ ok: false }))));
    initTracking(document);
    await new Promise((r) => { setTimeout(r, 0); });
    const capabilities = [...block.querySelectorAll('.nav-item > button')].find((b) => b.textContent.trim() === 'Capabilities');
    stampInteraction({ target: capabilities });
    expect(capabilities.getAttribute('data-wa-link')).toBe('ies-nav:capabilities');
    expect(capabilities.getAttribute('data-object-detail')).toBe('nav|capabilities');
    expect(capabilities.getAttribute('data-action')).toBe('engaged'); // nav block default
  });

  it('lets flyout button clicks reach the delegated document tracker', async () => {
    const block = await buildHeader();
    const capabilities = buttonNamed(block, 'Capabilities');
    const delegatedTracker = vi.fn();
    document.addEventListener('click', delegatedTracker, { once: true });

    capabilities.click();

    expect(delegatedTracker).toHaveBeenCalledOnce();
  });

  it('keeps a bubbled flyout click open and toggles it closed on the next click', async () => {
    const block = await buildHeader();
    const capabilities = buttonNamed(block, 'Capabilities');
    const item = capabilities.closest('.nav-item');
    const panel = item.querySelector('.flyout');
    const panelLink = panel.querySelector('a');

    capabilities.click();
    expect(item.classList.contains('open')).toBe(true);
    expect(item.closest('.nav-main').classList.contains('has-open')).toBe(true);
    expect(capabilities.getAttribute('aria-expanded')).toBe('true');
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    expect(panelLink.hasAttribute('tabindex')).toBe(false);

    capabilities.click();
    expect(item.classList.contains('open')).toBe(false);
    expect(item.closest('.nav-main').classList.contains('has-open')).toBe(false);
    expect(capabilities.getAttribute('aria-expanded')).toBe('false');
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(panelLink.getAttribute('tabindex')).toBe('-1');
  });

  it('switches flyouts and closes the active flyout on an outside click', async () => {
    const block = await buildHeader();
    const capabilities = buttonNamed(block, 'Capabilities');
    const resources = buttonNamed(block, 'Resources');

    capabilities.click();
    resources.click();
    expect(capabilities.getAttribute('aria-expanded')).toBe('false');
    expect(resources.getAttribute('aria-expanded')).toBe('true');
    expect(block.querySelectorAll('.nav-item.open')).toHaveLength(1);

    document.body.click();
    expect(resources.getAttribute('aria-expanded')).toBe('false');
    expect(block.querySelectorAll('.nav-item.open')).toHaveLength(0);
  });

  it('closes the active flyout on Escape', async () => {
    const block = await buildHeader();
    const capabilities = buttonNamed(block, 'Capabilities');
    capabilities.click();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(capabilities.getAttribute('aria-expanded')).toBe('false');
    expect(block.querySelectorAll('.nav-item.open')).toHaveLength(0);
  });

  it('preserves the mobile menu and scroll lock when a flyout click bubbles', async () => {
    const block = await buildHeader();
    const menuToggle = block.querySelector('.nav-toggle');
    const capabilities = buttonNamed(block, 'Capabilities');
    menuToggle.click();

    capabilities.click();

    expect(block.classList.contains('nav-open')).toBe(true);
    expect(menuToggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.classList.contains('nav-scroll-lock')).toBe(true);
  });
});
