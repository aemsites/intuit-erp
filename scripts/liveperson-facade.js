export const LIVEPERSON_FACADE_ACTIVATE = 'liveperson-facade:activate';
export const LIVEPERSON_FACADE_STARTED = 'liveperson-facade:started';
export const DEFAULT_LIVEPERSON_INVITE_DELAY = 30000;
const DISMISSED_KEY = 'liveperson-invite-dismissed';
const DISPOSE_EVENT = 'liveperson-facade:dispose';

function wasDismissed() {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === 'true';
  } catch (e) {
    return false;
  }
}

function rememberDismissal() {
  try {
    sessionStorage.setItem(DISMISSED_KEY, 'true');
  } catch (e) { /* storage can be unavailable in privacy modes */ }
}

function removeInvite(facade) {
  facade.dispatchEvent(new Event(DISPOSE_EVENT));
  facade.remove();
}

function buildInvite() {
  const facade = document.createElement('aside');
  facade.id = 'liveperson-invite-facade';
  facade.className = 'lp-invite-facade tracking-talk-to-sales';
  facade.setAttribute('aria-label', 'Chat invitation');
  facade.setAttribute('aria-hidden', 'true');
  facade.inert = true;
  facade.setAttribute('data-tracking', 'talk_to_sales');
  facade.setAttribute('data-track-ui-object', 'button');
  facade.setAttribute('data-track-link-name', 'off');
  facade.innerHTML = `
    <h2>Hi there!</h2>
    <p class="lp-invite-copy">
      <span>Have questions about scaling your business with Intuit Enterprise Suite?</span>
      <span>Chat with a product specialist.</span>
    </p>
    <div class="lp-invite-actions">
      <button type="button" class="lp-invite-action" data-track-id="talk-to-sales:proactive-chat-invite">Chat live now</button>
      <button type="button" class="lp-invite-dismiss" data-track-skip>No thanks</button>
    </div>`;

  let activated = false;
  function chatStarted() {
    rememberDismissal();
    removeInvite(facade);
  }
  window.addEventListener(LIVEPERSON_FACADE_STARTED, chatStarted, { once: true });
  facade.addEventListener(DISPOSE_EVENT, () => {
    window.removeEventListener(LIVEPERSON_FACADE_STARTED, chatStarted);
  }, { once: true });
  facade.querySelector('.lp-invite-action').addEventListener('click', () => {
    if (activated) return;
    activated = true;
    facade.hidden = true;
    document.documentElement.dataset.livepersonInviteActivated = 'proactive';
    window.dispatchEvent(new CustomEvent(LIVEPERSON_FACADE_ACTIVATE, {
      detail: { source: 'proactive' },
    }));
  });
  facade.querySelector('.lp-invite-dismiss').addEventListener('click', () => {
    rememberDismissal();
    removeInvite(facade);
  });

  return facade;
}

/**
 * Schedules a lightweight proactive-chat invitation matching the LivePerson campaign.
 * LivePerson itself remains unloaded until the visitor accepts the invitation.
 *
 * @param {Object} options facade options
 * @param {boolean} options.enabled whether this page offers LivePerson chat
 * @param {number} options.delay milliseconds before the invitation is revealed
 */
export function initLivePersonInviteFacade({
  enabled = false,
  delay = DEFAULT_LIVEPERSON_INVITE_DELAY,
} = {}) {
  const root = document.documentElement;
  if (!enabled || root.dataset.livepersonInviteScheduled || wasDismissed()) return;
  root.dataset.livepersonInviteScheduled = 'true';

  // Paint the fixed-position facade with the eager page at effectively transparent
  // opacity. Revealing already-painted text later avoids creating a delayed LCP candidate.
  const facade = buildInvite();
  document.body.append(facade);

  const wait = Number.isFinite(Number(delay))
    ? Math.max(0, Number(delay))
    : DEFAULT_LIVEPERSON_INVITE_DELAY;
  window.setTimeout(() => {
    if (wasDismissed() || root.dataset.livepersonInviteActivated) {
      removeInvite(facade);
      return;
    }
    facade.classList.add('lp-invite-visible');
    facade.removeAttribute('aria-hidden');
    facade.inert = false;
  }, wait);
}
