/**
 * embed — renders an authored external embed (Datawrapper charts, and other
 * iframe providers) as a responsive iframe. Mirrors production's Datawrapper
 * embed: a `.widget-container` wrapper + a `min-width:100%` responsive iframe,
 * plus the Datawrapper postMessage height-resize listener (installed once).
 *
 * Authoring: a block whose first cell contains a link to the embed URL
 * (e.g. https://datawrapper.dwcdn.net/kAxsQ/1/), or the URL as text.
 *
 * Supported today: Datawrapper (datawrapper.dwcdn.net). Unknown providers are
 * rendered as a plain responsive iframe as a safe fallback.
 */

// Install the Datawrapper responsive-height listener once per page. Datawrapper
// iframes post {'datawrapper-height': {<id>: <px>}} messages; match by source.
let dwResizeInstalled = false;
function installDatawrapperResize() {
  if (dwResizeInstalled) return;
  dwResizeInstalled = true;
  window.addEventListener('message', (event) => {
    const heights = event.data && event.data['datawrapper-height'];
    if (!heights) return;
    const iframes = document.querySelectorAll('iframe');
    Object.keys(heights).forEach((key) => {
      iframes.forEach((iframe) => {
        if (iframe.contentWindow === event.source) {
          iframe.style.height = `${heights[key]}px`;
        }
      });
    });
  });
}

function embedDatawrapper(url) {
  const container = document.createElement('div');
  container.className = 'widget-container';
  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', '');
  iframe.setAttribute('aria-label', 'Interactive chart');
  iframe.setAttribute('scrolling', 'no');
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('loading', 'lazy');
  iframe.src = url;
  // responsive: full column width, height set by the resize listener
  iframe.style.width = '0';
  iframe.style.minWidth = '100%';
  iframe.style.border = 'none';
  container.append(iframe);
  installDatawrapperResize();
  return container;
}

function embedGeneric(url) {
  const container = document.createElement('div');
  container.className = 'widget-container';
  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('frameborder', '0');
  iframe.style.width = '100%';
  iframe.style.border = 'none';
  container.append(iframe);
  return container;
}

export default function decorate(block) {
  // find the embed URL: an authored anchor, else the block's text content
  const link = block.querySelector('a[href]');
  const raw = link ? link.getAttribute('href') : block.textContent.trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    block.remove();
    return;
  }
  block.textContent = '';
  if (/datawrapper\.dwcdn\.net/.test(url.hostname + url.pathname)
    || url.hostname.endsWith('datawrapper.dwcdn.net')) {
    block.append(embedDatawrapper(url.href));
  } else {
    block.append(embedGeneric(url.href));
  }
}
