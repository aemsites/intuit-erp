/*
 * Embed Block
 * Renders external embeds (Datawrapper charts, and generic iframe providers)
 * directly on the page. Modeled on the AEM Block Collection embed block
 * (https://github.com/adobe/aem-block-collection/tree/main/blocks/embed):
 * a per-provider EMBEDS_CONFIG, lazy IntersectionObserver load, and an
 * `embed-<provider>` class. Datawrapper reproduces production's `.widget-container`
 * treatment (responsive iframe + the `datawrapper-height` postMessage resize).
 */

// Install the Datawrapper responsive-height listener once per page. Datawrapper
// iframes post {'datawrapper-height': {<id>: <px>}}; match the posting frame by
// its contentWindow and apply the height. The listener is scoped to
// `.embed-datawrapper iframe` and rejects messages that are not from a
// datawrapper (*.dwcdn.net) origin.
let dwResizeInstalled = false;
function installDatawrapperResize() {
  if (dwResizeInstalled) return;
  dwResizeInstalled = true;
  window.addEventListener('message', (event) => {
    if (!event.origin.endsWith('.dwcdn.net')) return;
    const heights = event.data && event.data['datawrapper-height'];
    if (!heights) return;
    const iframes = document.querySelectorAll('.embed-datawrapper iframe');
    Object.keys(heights).forEach((key) => {
      iframes.forEach((iframe) => {
        if (iframe.contentWindow === event.source) {
          iframe.style.height = `${heights[key]}px`;
        }
      });
    });
  });
}

const embedDatawrapper = (url) => {
  installDatawrapperResize();
  return `<div class="widget-container">
      <iframe title="" aria-label="Interactive chart" src="${url.href}" scrolling="no" frameborder="0" loading="lazy"></iframe>
    </div>`;
};

const getDefaultEmbed = (url) => `<div style="left: 0; width: 100%; height: 0; position: relative; padding-bottom: 56.25%;">
    <iframe src="${url.href}" style="border: 0; top: 0; left: 0; width: 100%; height: 100%; position: absolute;" allowfullscreen=""
      scrolling="no" allow="encrypted-media" title="Content from ${url.hostname}" loading="lazy">
    </iframe>
  </div>`;

const loadEmbed = (block, link) => {
  if (block.classList.contains('embed-is-loaded')) return;

  const EMBEDS_CONFIG = [
    {
      match: ['datawrapper.dwcdn.net', 'datawrapper'],
      embed: embedDatawrapper,
    },
  ];

  const config = EMBEDS_CONFIG.find((e) => e.match.some((m) => link.includes(m)));
  const url = new URL(link);
  if (config) {
    block.innerHTML = config.embed(url);
    block.classList = `block embed embed-${config.match[0].split('.')[0]}`;
  } else {
    block.innerHTML = getDefaultEmbed(url);
    block.classList = 'block embed';
  }
  block.classList.add('embed-is-loaded');
};

export default function decorate(block) {
  const anchor = block.querySelector('a');
  const link = anchor ? anchor.href : block.textContent.trim();
  if (!link) { block.remove(); return; }
  try {
    // validate
    new URL(link); // eslint-disable-line no-new
  } catch {
    block.remove();
    return;
  }
  block.textContent = '';

  // Load immediately. The generated iframe carries loading="lazy", so the browser
  // still defers the actual network fetch until the chart nears the viewport.
  // (An IntersectionObserver on the block/wrapper is unreliable here: once the
  // block is emptied it collapses to 0px height, and an observer never reports a
  // zero-area target as intersecting, so the embed would never load.)
  loadEmbed(block, link);
}
