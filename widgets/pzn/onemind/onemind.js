// 1Mind launcher. Variant comes from the widget href's `?variant=a|b` query param
const DEPLOYMENTS = {
  a: '6dfht8qjmt',
  b: '5kxc4fwh8k',
};

export function resolveOneMindLoadPhase(params) {
  const phase = params.get('onemind');
  return ['delayed', 'off'].includes(phase) ? phase : 'lazy';
}

export default async function decorate(widget) {
  const variant = widget.dataset.variant?.toLowerCase();
  const deploymentId = DEPLOYMENTS[variant] || DEPLOYMENTS.a;
  const src = `https://launcher.1mind.com/deployment-${deploymentId}`;
  const phase = resolveOneMindLoadPhase(new URLSearchParams(window.location.search));
  if (phase === 'off') return;

  const load = () => {
    // Enables the eager, mobile sizing guard before the vendor can paint its launcher shell.
    document.documentElement.classList.add('onemind-active');

    // Guard against a duplicate launcher if the PZN treatment re-applies (e.g. a later swap).
    if (document.querySelector(`script[src="${src}"]`)) return;

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
