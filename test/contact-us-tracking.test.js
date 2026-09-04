import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  resetTrackingState, resolveTrackable, stampInteraction, trackIdOf,
} from '../scripts/tracking.js';

const { metadata } = vi.hoisted(() => ({ metadata: {} }));

vi.mock('../scripts/aem.js', () => ({ getMetadata: (name) => metadata[name] || '' }));
vi.mock('../scripts/schedule-modal.js', () => ({ openScheduleModal: vi.fn() }));

const { default: initContactUs } = await import('../blocks/contact-us/contact-us.js');

describe('contact-us tracking', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/accounting/business-intelligence-reports');
    window.hlx = { codeBasePath: '' };
    document.documentElement.removeAttribute('data-liveperson-invite-activated');
    delete window.lpTag;
    Object.keys(metadata).forEach((key) => delete metadata[key]);
    resetTrackingState();
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      text: async () => (String(url).includes('contact-info')
        ? '<div class="contact-info"><div><div>Sales Phone</div><div>1-800-555-0100</div></div><div><div>Sales Hours</div><div>Monday-Friday</div></div><div><div>Support URL</div><div><a href="https://quickbooks.intuit.com/support">Support</a></div></div></div>'
        : '<svg></svg>'),
    })));
  });

  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    vi.useRealTimers();
  });

  it('keeps the close control trackable with a stable sheet identity', async () => {
    await initContactUs();
    const close = document.querySelector('.cu-close');

    expect(trackIdOf(close)).toBe('talk-to-sales:close-sales-widget');
    expect(close.hasAttribute('data-track-skip')).toBe(false);
    expect(resolveTrackable(close)).not.toBeNull();

    stampInteraction({ target: close });
    expect(close.getAttribute('data-ui-action')).toBe('clicked');
  });

  it('uses a distinct close identity for the blog widget', async () => {
    window.history.replaceState(null, '', '/blog/construction/automation-in-construction');
    await initContactUs();
    const close = document.querySelector('.cu-close');
    const trigger = document.querySelector('.cu-bubble');
    const panel = document.querySelector('.cu-panel');

    expect(trackIdOf(close)).toBe('talk-to-sales:close-sales-widget-blog');
    expect(resolveTrackable(close)).not.toBeNull();

    trigger.click();
    expect(panel.hidden).toBe(false);
    expect(document.activeElement).toBe(close);

    close.click();
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('reports the blog support CTA as a button, matching its widget presentation', async () => {
    window.history.replaceState(null, '', '/blog/construction/automation-in-construction');
    await initContactUs();
    const support = document.querySelector('.cu-support');

    stampInteraction({ target: support });

    expect(support.getAttribute('data-ui-object')).toBe('button');
  });

  it('loads LivePerson only after the panel Chat now CTA is selected', async () => {
    metadata['chat-now'] = 'true';
    const requestLivePerson = vi.fn();
    const offerEvents = {};
    const triggerEngagement = vi.fn(() => true);
    window.lpTag = {
      events: {
        bind: vi.fn((appName, eventName, callback) => {
          offerEvents[`${appName}:${eventName}`] = callback;
        }),
      },
      taglets: { rendererStub: { click: triggerEngagement } },
    };
    await initContactUs({ requestLivePerson });

    const trigger = document.querySelector('.cu-bubble');
    const facade = document.querySelector('.cu-chat-facade');
    const target = document.getElementById('ies-button-div');

    expect(facade).not.toBeNull();
    expect(facade.textContent).toBe('Chat now');
    expect(requestLivePerson).not.toHaveBeenCalled();

    trigger.click();

    expect(requestLivePerson).not.toHaveBeenCalled();
    expect(facade.disabled).toBe(false);
    expect(facade.textContent).toBe('Chat now');

    facade.click();

    expect(requestLivePerson).toHaveBeenCalledOnce();
    expect(facade.disabled).toBe(true);
    expect(facade.textContent).toBe('Loading chat…');
    offerEvents['LP_OFFERS:OFFER_DISPLAY']({
      engagementId: '123456',
      engagementType: 5,
    });

    const livePersonContainer = document.createElement('div');
    livePersonContainer.className = 'LPMcontainer';
    livePersonContainer.innerHTML = '<button data-lp-event="click">Chat now</button>';
    target.append(livePersonContainer);
    await Promise.resolve();

    expect(facade.hidden).toBe(true);
    expect(triggerEngagement).toHaveBeenCalledWith('123456');

    document.querySelector('.cu-close').click();
    trigger.click();
    expect(requestLivePerson).toHaveBeenCalledOnce();
  });

  it('requests and starts the embedded LivePerson engagement from the proactive facade', async () => {
    metadata['chat-now'] = 'true';
    const requestLivePerson = vi.fn();
    const offerEvents = {};
    const triggerEngagement = vi.fn(() => true);
    window.lpTag = {
      events: {
        bind: vi.fn((appName, eventName, callback) => {
          offerEvents[`${appName}:${eventName}`] = callback;
        }),
      },
      taglets: { rendererStub: { click: triggerEngagement } },
    };
    await initContactUs({ requestLivePerson });

    window.dispatchEvent(new CustomEvent('liveperson-facade:activate', {
      detail: { source: 'proactive' },
    }));

    expect(document.querySelector('.cu-panel').hidden).toBe(true);
    expect(requestLivePerson).toHaveBeenCalledOnce();
    expect(offerEvents['LP_OFFERS:OFFER_DISPLAY']).toBeTypeOf('function');

    offerEvents['LP_OFFERS:OFFER_DISPLAY']({
      engagementId: '123456',
      engagementType: 5,
    });

    const vendorInvite = document.createElement('div');
    vendorInvite.className = 'LPMcontainer LPMoverlay';
    vendorInvite.innerHTML = '<img src="https://example.com/qb-IES-proactive-invite-left.png" alt="">';
    document.body.append(vendorInvite);

    const engagement = document.createElement('div');
    engagement.className = 'LPMcontainer LPMoverlay';
    const livePersonButton = document.createElement('button');
    livePersonButton.dataset.lpEvent = 'click';
    const startChat = vi.fn();
    livePersonButton.addEventListener('click', startChat);
    engagement.append(livePersonButton);
    document.getElementById('ies-button-div').append(engagement);
    await Promise.resolve();

    expect(vendorInvite.hidden).toBe(true);
    expect(triggerEngagement).toHaveBeenCalledWith('123456');
    expect(startChat).not.toHaveBeenCalled();
  });

  it('starts an embedded engagement that LivePerson rendered before facade activation', async () => {
    metadata['chat-now'] = 'true';
    const requestLivePerson = vi.fn();
    const offerEvents = {};
    const triggerEngagement = vi.fn(() => true);
    window.lpTag = {
      events: {
        bind: vi.fn((appName, eventName, callback) => {
          offerEvents[`${appName}:${eventName}`] = callback;
        }),
      },
      taglets: { rendererStub: { click: triggerEngagement } },
    };
    await initContactUs({ requestLivePerson });

    const engagement = document.createElement('div');
    engagement.className = 'LPMcontainer LPMoverlay';
    const livePersonButton = document.createElement('button');
    livePersonButton.dataset.lpEvent = 'click';
    const startChat = vi.fn();
    livePersonButton.addEventListener('click', startChat);
    engagement.append(livePersonButton);
    document.getElementById('ies-button-div').append(engagement);
    offerEvents['LP_OFFERS:OFFER_DISPLAY']({
      engagementId: '123456',
      engagementType: 5,
    });
    await Promise.resolve();
    expect(triggerEngagement).not.toHaveBeenCalled();

    window.dispatchEvent(new CustomEvent('liveperson-facade:activate', {
      detail: { source: 'proactive' },
    }));
    await Promise.resolve();

    expect(requestLivePerson).toHaveBeenCalledOnce();
    expect(triggerEngagement).toHaveBeenCalledWith('123456');
    expect(startChat).not.toHaveBeenCalled();
  });

  it('suppresses a vendor campaign invite that arrives after chat starts', async () => {
    metadata['chat-now'] = 'true';
    await initContactUs({ requestLivePerson: vi.fn() });
    window.dispatchEvent(new CustomEvent('liveperson-facade:activate', {
      detail: { source: 'proactive' },
    }));

    const engagement = document.createElement('div');
    engagement.className = 'LPMcontainer LPMoverlay';
    const livePersonButton = document.createElement('button');
    livePersonButton.dataset.lpEvent = 'click';
    engagement.append(livePersonButton);
    document.getElementById('ies-button-div').append(engagement);
    await Promise.resolve();

    const vendorInvite = document.createElement('div');
    vendorInvite.className = 'LPMcontainer LPMoverlay';
    vendorInvite.innerHTML = '<img src="https://example.com/qb-IES-proactive-invite-right.png" alt="">';
    document.body.append(vendorInvite);
    await Promise.resolve();

    expect(vendorInvite.hidden).toBe(true);
  });

  it('does not hide unrelated LivePerson overlays after proactive activation', async () => {
    metadata['chat-now'] = 'true';
    await initContactUs({ requestLivePerson: vi.fn() });
    window.dispatchEvent(new CustomEvent('liveperson-facade:activate', {
      detail: { source: 'proactive' },
    }));

    const chatWindow = document.createElement('div');
    chatWindow.className = 'LPMcontainer LPMoverlay';
    chatWindow.innerHTML = '<iframe title="LivePerson chat"></iframe>';
    document.body.append(chatWindow);
    await Promise.resolve();

    expect(chatWindow.hidden).toBe(false);
  });

  it('opens the contact options when proactive chat does not become ready', async () => {
    vi.useFakeTimers();
    const clearInterval = vi.spyOn(window, 'clearInterval');
    metadata['chat-now'] = 'true';
    await initContactUs({ requestLivePerson: vi.fn() });
    window.dispatchEvent(new CustomEvent('liveperson-facade:activate', {
      detail: { source: 'proactive' },
    }));

    vi.advanceTimersByTime(15000);

    expect(document.querySelector('.cu-panel').hidden).toBe(false);
    expect(document.querySelector('.cu-chat-facade').textContent)
      .toBe('Chat is taking longer than expected');
    expect(clearInterval).toHaveBeenCalled();
  });

  it('shows a visible fallback when LivePerson renders but cannot start the engagement', async () => {
    vi.useFakeTimers();
    metadata['chat-now'] = 'true';
    const offerEvents = {};
    window.lpTag = {
      events: {
        bind: vi.fn((appName, eventName, callback) => {
          offerEvents[`${appName}:${eventName}`] = callback;
        }),
      },
      taglets: { rendererStub: { click: vi.fn(() => false) } },
    };
    await initContactUs({ requestLivePerson: vi.fn() });
    window.dispatchEvent(new CustomEvent('liveperson-facade:activate', {
      detail: { source: 'proactive' },
    }));
    offerEvents['LP_OFFERS:OFFER_DISPLAY']({
      engagementId: '123456',
      engagementType: 5,
    });

    const engagement = document.createElement('div');
    engagement.className = 'LPMcontainer';
    document.getElementById('ies-button-div').append(engagement);
    await Promise.resolve();

    expect(document.querySelector('.cu-chat-facade').hidden).toBe(false);
    vi.advanceTimersByTime(15000);

    const fallback = document.querySelector('.cu-chat-facade');
    expect(document.querySelector('.cu-panel').hidden).toBe(false);
    expect(fallback.hidden).toBe(false);
    expect(fallback.textContent).toBe('Chat is taking longer than expected');
  });

  it('keeps facade activation wired while the page is in the back-forward cache', async () => {
    metadata['chat-now'] = 'true';
    const requestLivePerson = vi.fn();
    await initContactUs({ requestLivePerson });
    const pagehide = new Event('pagehide');
    Object.defineProperty(pagehide, 'persisted', { value: true });

    window.dispatchEvent(pagehide);
    window.dispatchEvent(new CustomEvent('liveperson-facade:activate', {
      detail: { source: 'proactive' },
    }));

    expect(requestLivePerson).toHaveBeenCalledOnce();
  });

  it('starts a proactive request made before the contact widget is ready', async () => {
    metadata['chat-now'] = 'true';
    document.documentElement.dataset.livepersonInviteActivated = 'proactive';
    const requestLivePerson = vi.fn();

    await initContactUs({ requestLivePerson });

    expect(document.querySelector('.cu-panel').hidden).toBe(true);
    expect(requestLivePerson).toHaveBeenCalledOnce();
  });
});
