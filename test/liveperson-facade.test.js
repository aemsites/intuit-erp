import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  DEFAULT_LIVEPERSON_INVITE_DELAY,
  LIVEPERSON_FACADE_ACTIVATE,
  LIVEPERSON_FACADE_STARTED,
  initLivePersonInviteFacade,
} from '../scripts/liveperson-facade.js';

describe('LivePerson proactive invite facade', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.removeAttribute('data-liveperson-invite-activated');
    document.documentElement.removeAttribute('data-liveperson-invite-scheduled');
    document.body.innerHTML = '';
    sessionStorage.clear();
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
    vi.advanceTimersByTime(DEFAULT_LIVEPERSON_INVITE_DELAY - 1);
    expect(facade.classList.contains('lp-invite-visible')).toBe(false);

    vi.advanceTimersByTime(1);
    expect(facade.classList.contains('lp-invite-visible')).toBe(true);
    expect(facade.hasAttribute('aria-hidden')).toBe(false);
    expect(facade.inert).toBe(false);
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
    expect(facade.querySelector('.lp-invite-action').textContent).toBe('Chat live now');
    expect(facade.querySelector('.lp-invite-dismiss').textContent).toBe('No thanks');
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
