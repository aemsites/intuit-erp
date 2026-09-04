// 1Mind launcher. Variant comes from the widget href's `?variant=a|b` query param
const DEPLOYMENTS = {
  a: '6dfht8qjmt',
  b: '5kxc4fwh8k',
};

export default async function decorate(widget) {
  const variant = widget.dataset.variant?.toLowerCase();
  const deploymentId = DEPLOYMENTS[variant] || DEPLOYMENTS.a;
  const src = `https://launcher.1mind.com/deployment-${deploymentId}`;

  // Guard against a duplicate launcher if the PZN treatment re-applies (e.g. a later swap).
  if (document.querySelector(`script[src="${src}"]`)) return;

  const script = document.createElement('script');
  script.defer = true;
  script.src = src;
  document.head.appendChild(script);
}
