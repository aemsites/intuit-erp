import {
  beforeEach, describe, expect, it, vi,
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
    Object.keys(metadata).forEach((key) => delete metadata[key]);
    resetTrackingState();
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      text: async () => (String(url).includes('contact-info')
        ? '<div class="contact-info"><div><div>Sales Phone</div><div>1-800-555-0100</div></div><div><div>Sales Hours</div><div>Monday-Friday</div></div><div><div>Support URL</div><div><a href="https://quickbooks.intuit.com/support">Support</a></div></div></div>'
        : '<svg></svg>'),
    })));
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

  it('loads LivePerson only after the contact panel opens and replaces the facade when ready', async () => {
    metadata['chat-now'] = 'true';
    const requestLivePerson = vi.fn();
    await initContactUs({ requestLivePerson });

    const trigger = document.querySelector('.cu-bubble');
    const facade = document.querySelector('.cu-chat-facade');
    const target = document.getElementById('ies-button-div');

    expect(facade).not.toBeNull();
    expect(facade.textContent).toBe('Chat now');
    expect(requestLivePerson).not.toHaveBeenCalled();

    trigger.click();

    expect(requestLivePerson).toHaveBeenCalledOnce();
    expect(facade.disabled).toBe(true);
    expect(facade.textContent).toBe('Loading chat…');

    const livePersonButton = document.createElement('button');
    livePersonButton.className = 'LPMcontainer';
    livePersonButton.textContent = 'Chat now';
    target.append(livePersonButton);
    await Promise.resolve();

    expect(facade.hidden).toBe(true);

    document.querySelector('.cu-close').click();
    trigger.click();
    expect(requestLivePerson).toHaveBeenCalledOnce();
  });

  it('opens and requests LivePerson when the proactive facade is activated', async () => {
    metadata['chat-now'] = 'true';
    const requestLivePerson = vi.fn();
    await initContactUs({ requestLivePerson });

    window.dispatchEvent(new CustomEvent('liveperson-facade:activate'));

    expect(document.querySelector('.cu-panel').hidden).toBe(false);
    expect(requestLivePerson).toHaveBeenCalledOnce();
  });

  it('honors a proactive-facade click that happens before the contact widget is ready', async () => {
    metadata['chat-now'] = 'true';
    document.documentElement.dataset.livepersonInviteActivated = 'true';
    const requestLivePerson = vi.fn();

    await initContactUs({ requestLivePerson });

    expect(document.querySelector('.cu-panel').hidden).toBe(false);
    expect(requestLivePerson).toHaveBeenCalledOnce();
  });
});
