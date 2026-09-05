// 1Mind launcher. Variant comes from the widget href's `?variant=a|b` query param
const DEPLOYMENTS = {
  a: '6dfht8qjmt',
  b: '5kxc4fwh8k',
};

export function resolveOneMindLoadPhase(params) {
  const phase = params.get('onemind');
  return ['delayed', 'off'].includes(phase) ? phase : 'lazy';
}

let readyListenerBound = false;

function revealSettledLauncher(event) {
  const iframe = document.querySelector('#onemind-iframe');
  if (!iframe || event.source !== iframe.contentWindow) return;

  let iframeOrigin;
  try {
    iframeOrigin = new URL(iframe.src).origin;
  } catch {
    return;
  }

  const { type, payload } = event.data || {};
  const isSettled = type === '1MIND_WIDGET_COLLAPSE'
    && payload?.state === '1mind_widget_collapsed'
    && payload.width
    && payload.height;
  if (event.origin === iframeOrigin && isSettled) {
    document.documentElement.classList.add('onemind-ready');
  }
}

function bindReadyListener() {
  if (readyListenerBound) return;
  window.addEventListener('message', revealSettledLauncher);
  readyListenerBound = true;
}

export default async function decorate(widget) {
  const variant = widget.dataset.variant?.toLowerCase();
  const deploymentId = DEPLOYMENTS[variant] || DEPLOYMENTS.a;
  const src = `https://launcher.1mind.com/deployment-${deploymentId}`;
  const phase = resolveOneMindLoadPhase(new URLSearchParams(window.location.search));
  if (phase === 'off') return;

  const load = () => {
    // Enables the eager mobile guard before the vendor can paint its launcher shell.
    document.documentElement.classList.add('onemind-active');
    bindReadyListener();

    // Guard against a duplicate launcher if the PZN treatment re-applies (e.g. a later swap).
    if (document.querySelector(`script[src="${src}"]`)) return;

    document.documentElement.classList.remove('onemind-ready');
    const script = document.createElement('script');
    script.defer = true;
    script.src = src;
    document.head.appendChild(script);
  };

  if (phase === 'delayed' && !window.hlx?.delayed) {
    window.addEventListener('aem:delayed', load, { once: true });
    return;
  }
  load();
}
