import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  LIVEPERSON_FACADE_ACTIVATE,
  initLivePersonInviteFacade,
} from '../scripts/liveperson-facade.js';

describe('LivePerson proactive invite facade', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-liveperson-invite-activated');
    document.body.innerHTML = '';
  });

  it('renders the invitation immediately without activating LivePerson', () => {
    const activation = vi.fn();
    window.addEventListener(LIVEPERSON_FACADE_ACTIVATE, activation, { once: true });

    initLivePersonInviteFacade({ enabled: true });

    const facade = document.getElementById('liveperson-invite-facade');
    expect(facade).not.toBeNull();
    expect(facade.textContent).toContain('Hi there');
    expect(document.documentElement.dataset.livepersonInviteActivated).toBeUndefined();
    expect(activation).not.toHaveBeenCalled();
  });

  it('activates once when the invitation is clicked', () => {
    const activation = vi.fn();
    window.addEventListener(LIVEPERSON_FACADE_ACTIVATE, activation);
    initLivePersonInviteFacade({ enabled: true });

    const facade = document.getElementById('liveperson-invite-facade');
    facade.querySelector('.lp-invite-action').click();
    facade.querySelector('.lp-invite-action').click();

    expect(document.documentElement.dataset.livepersonInviteActivated).toBe('true');
    expect(facade.hidden).toBe(true);
    expect(activation).toHaveBeenCalledOnce();
    window.removeEventListener(LIVEPERSON_FACADE_ACTIVATE, activation);
  });

  it('dismisses without activating LivePerson', () => {
    const activation = vi.fn();
    window.addEventListener(LIVEPERSON_FACADE_ACTIVATE, activation, { once: true });
    initLivePersonInviteFacade({ enabled: true });

    const facade = document.getElementById('liveperson-invite-facade');
    facade.querySelector('.lp-invite-dismiss').click();

    expect(facade.hidden).toBe(true);
    expect(document.documentElement.dataset.livepersonInviteActivated).toBeUndefined();
    expect(activation).not.toHaveBeenCalled();
  });

  it('does not render when chat-now is disabled', () => {
    initLivePersonInviteFacade({ enabled: false });
    expect(document.getElementById('liveperson-invite-facade')).toBeNull();
  });
});
