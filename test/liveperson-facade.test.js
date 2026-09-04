import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  DEFAULT_LIVEPERSON_INVITE_DELAY,
  LIVEPERSON_FACADE_ACTIVATE,
  LIVEPERSON_FACADE_STARTED,
  default as decorateLivePersonFacade,
  initLivePersonInviteFacade,
  isLivePersonFacadeEnabled,
} from '../blocks/liveperson-facade/liveperson-facade.js';

describe('LivePerson proactive invite facade', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.removeAttribute('data-liveperson-invite-activated');
    document.documentElement.removeAttribute('data-liveperson-invite-scheduled');
    document.documentElement.removeAttribute('data-liveperson-invite-visible');
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  it('only enables the optimization when its URL flag is on', () => {
    expect(isLivePersonFacadeEnabled('')).toBe(false);
    expect(isLivePersonFacadeEnabled('?liveperson-facade=off')).toBe(false);
    expect(isLivePersonFacadeEnabled('?liveperson-facade=on')).toBe(true);
    expect(isLivePersonFacadeEnabled('?foo=bar&liveperson-facade=on')).toBe(true);
  });

  it('decorates the auto-created block element in place', () => {
    const wrapper = document.createElement('div');
    const block = document.createElement('div');
    block.className = 'liveperson-facade block';
    block.dataset.inviteDelay = '1234';
    wrapper.className = 'liveperson-facade-wrapper';
    wrapper.append(block);
    document.body.append(wrapper);

    decorateLivePersonFacade(block);

    expect(document.getElementById('liveperson-invite-facade')).toBe(block);
    expect(block.querySelector('.lp-invite-desktop-label').textContent).toBe('Chat live now');
    vi.advanceTimersByTime(1233);
    expect(block.classList.contains('lp-invite-visible')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(block.classList.contains('lp-invite-visible')).toBe(true);

    block.querySelector('.lp-invite-dismiss').click();
    expect(wrapper.isConnected).toBe(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('paints the invitation eagerly but reveals it after the configured default delay', () => {
    expect(DEFAULT_LIVEPERSON_INVITE_DELAY).toBe(30000);
    initLivePersonInviteFacade({ enabled: true });

    const facade = document.getElementById('liveperson-invite-facade');
    expect(facade).not.toBeNull();
    expect(facade.classList.contains('lp-invite-visible')).toBe(false);
    expect(facade.getAttribute('aria-hidden')).toBe('true');
    expect(facade.inert).toBe(true);
    expect(document.documentElement.dataset.livepersonInviteVisible).toBeUndefined();
    vi.advanceTimersByTime(DEFAULT_LIVEPERSON_INVITE_DELAY - 1);
    expect(facade.classList.contains('lp-invite-visible')).toBe(false);

    vi.advanceTimersByTime(1);
    expect(facade.classList.contains('lp-invite-visible')).toBe(true);
    expect(facade.hasAttribute('aria-hidden')).toBe(false);
    expect(facade.inert).toBe(false);
    expect(document.documentElement.dataset.livepersonInviteVisible).toBe('true');
  });

  it('honors an authored invitation delay override', () => {
    initLivePersonInviteFacade({ enabled: true, delay: 1234 });

    const facade = document.getElementById('liveperson-invite-facade');
    vi.advanceTimersByTime(1233);
    expect(facade.classList.contains('lp-invite-visible')).toBe(false);

    vi.advanceTimersByTime(1);
    expect(facade.classList.contains('lp-invite-visible')).toBe(true);
  });

  it('matches the LivePerson invitation copy and actions', () => {
    initLivePersonInviteFacade({ enabled: true, delay: 0 });
    vi.runAllTimers();

    const facade = document.getElementById('liveperson-invite-facade');
    expect(facade.querySelector('h2').textContent).toBe('Hi there!');
    expect(facade.querySelector('.lp-invite-copy').textContent).toContain(
      'Have questions about scaling your business with Intuit Enterprise Suite?',
    );
    expect(facade.querySelector('.lp-invite-copy').textContent).toContain(
      'Chat with a product specialist.',
    );
    const action = facade.querySelector('.lp-invite-action');
    const dismiss = facade.querySelector('.lp-invite-dismiss');
    expect(action.querySelector('.lp-invite-desktop-label').textContent).toBe('Chat live now');
    expect(action.querySelector('.lp-invite-mobile-label').textContent)
      .toBe('Chat with a specialist');
    expect(dismiss.textContent).toBe('No thanks');
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss chat invitation');
  });

  it('requests direct proactive-chat activation once', () => {
    const activations = [];
    const activation = (event) => activations.push(event.detail);
    window.addEventListener(LIVEPERSON_FACADE_ACTIVATE, activation);
    initLivePersonInviteFacade({ enabled: true, delay: 0 });
    vi.runAllTimers();

    const facade = document.getElementById('liveperson-invite-facade');
    facade.querySelector('.lp-invite-action').click();
    facade.querySelector('.lp-invite-action').click();

    expect(document.documentElement.dataset.livepersonInviteActivated).toBe('proactive');
    expect(sessionStorage.getItem('liveperson-invite-dismissed')).toBeNull();
    expect(facade.hidden).toBe(true);
    expect(document.documentElement.dataset.livepersonInviteVisible).toBeUndefined();
    expect(activations).toEqual([{ source: 'proactive' }]);

    window.dispatchEvent(new CustomEvent(LIVEPERSON_FACADE_STARTED));
    expect(sessionStorage.getItem('liveperson-invite-dismissed')).toBe('true');
    expect(document.getElementById('liveperson-invite-facade')).toBeNull();
    window.removeEventListener(LIVEPERSON_FACADE_ACTIVATE, activation);
  });

  it('persists No thanks for the browser session without activating LivePerson', () => {
    const activation = vi.fn();
    window.addEventListener(LIVEPERSON_FACADE_ACTIVATE, activation, { once: true });
    initLivePersonInviteFacade({ enabled: true, delay: 0 });
    vi.runAllTimers();

    document.querySelector('.lp-invite-dismiss').click();
    expect(document.getElementById('liveperson-invite-facade')).toBeNull();
    expect(sessionStorage.getItem('liveperson-invite-dismissed')).toBe('true');
    expect(activation).not.toHaveBeenCalled();

    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-liveperson-invite-scheduled');
    initLivePersonInviteFacade({ enabled: true, delay: 0 });
    vi.runAllTimers();
    expect(document.getElementById('liveperson-invite-facade')).toBeNull();
  });

  it('does not schedule an invitation when chat-now is disabled', () => {
    initLivePersonInviteFacade({ enabled: false });
    vi.runAllTimers();
    expect(document.getElementById('liveperson-invite-facade')).toBeNull();
  });

  it('removes the pending invitation when the contact panel activates first', () => {
    initLivePersonInviteFacade({ enabled: true });
    document.documentElement.dataset.livepersonInviteActivated = 'panel';

    vi.runAllTimers();

    expect(document.getElementById('liveperson-invite-facade')).toBeNull();
  });
});
