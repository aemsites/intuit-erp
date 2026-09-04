export const LIVEPERSON_FACADE_ACTIVATE = 'liveperson-facade:activate';

/**
 * Paints a lightweight proactive-chat invitation before the page is revealed.
 * LivePerson itself remains unloaded until the visitor accepts the invitation.
 *
 * @param {Object} options facade options
 * @param {boolean} options.enabled whether this page offers LivePerson chat
 */
export function initLivePersonInviteFacade({ enabled = false } = {}) {
  if (!enabled || document.getElementById('liveperson-invite-facade')) return;

  const facade = document.createElement('aside');
  facade.id = 'liveperson-invite-facade';
  facade.className = 'lp-invite-facade tracking-talk-to-sales';
  facade.setAttribute('aria-label', 'Chat invitation');
  facade.setAttribute('data-tracking', 'talk_to_sales');
  facade.setAttribute('data-track-ui-object', 'button');
  facade.setAttribute('data-track-link-name', 'off');
  facade.innerHTML = `
    <button type="button" class="lp-invite-dismiss" aria-label="Dismiss chat invitation" data-track-skip>
      <span aria-hidden="true">&times;</span>
    </button>
    <button type="button" class="lp-invite-action" data-track-id="talk-to-sales:proactive-chat-invite">
      <strong>Hi there</strong>
      <span>Have questions? Chat with us.</span>
    </button>`;

  let activated = false;
  facade.querySelector('.lp-invite-action').addEventListener('click', () => {
    if (activated) return;
    activated = true;
    facade.hidden = true;
    document.documentElement.dataset.livepersonInviteActivated = 'true';
    window.dispatchEvent(new CustomEvent(LIVEPERSON_FACADE_ACTIVATE));
  });
  facade.querySelector('.lp-invite-dismiss').addEventListener('click', () => {
    facade.hidden = true;
  });

  document.body.append(facade);
}
