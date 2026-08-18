/**
 * Bootstraps the self-contained Vev "Future of Finance" experience.
 *
 * The experience is a Vev SPA: report-embed.min.js is the original Vev embed
 * bundle (markup + inline styles + runtime loaders), stored in this repo. It
 * must run as a real <script> so `document.currentScript.after()` can mount the
 * markup in place and the Vev React runtime initializes its scroll interactions
 * — injecting the markup via innerHTML instead leaves the animations unwired.
 * So we append the bundle as a script inside the widget rather than fetching it.
 */
export default async function decorate(widget) {
  if (widget.querySelector('script[data-vev-embed]')) return;
  const script = document.createElement('script');
  script.src = new URL('./report-embed.min.js', import.meta.url).href;
  script.dataset.vevEmbed = '';
  widget.appendChild(script);
}
