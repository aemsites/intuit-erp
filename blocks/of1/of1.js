import { decorateMain } from '../../scripts/scripts.js';
import { loadSections, readBlockConfig } from '../../scripts/aem.js';
import { registerFaqPage, buildFaqEntity } from '../../scripts/structured-data.js';

const DEFAULT_WORKER_URL = 'https://of1-gen-web-service.franklin-prod.workers.dev';

/**
 * Registers a FAQPage node for any of1-deep-dive-faq-explainer content in a decorated section
 * (templates/of1-deep-dive-faq-explainer.html: details.of1-faqx-faq-item > summary /
 * .of1-faqx-faq-answer) — a no-op for every other of1 template, which has no such markup.
 * @param {Element} root
 * @param {*} key identifies the owning of1 block instance, so the SDK re-rendering a section
 *   (streamed content, retries) replaces this block's own prior contribution instead of piling
 *   up a duplicate/stale FAQPage node.
 */
function registerFaqEntities(root, key) {
  const faqEntities = [...root.querySelectorAll('.of1-faqx-faq-item')]
    .map((item) => buildFaqEntity(item.querySelector('summary'), item.querySelector('.of1-faqx-faq-answer')))
    .filter(Boolean);
  registerFaqPage(faqEntities, key);
}

/**
 * Legacy EDS decoration hook — passed to the SDK for non-template-routed section events that
 * need block decoration. `faqKey` defaults to a fixed value for direct/test invocation; real
 * usage (see decorate() below) binds it to the owning block element instead.
 */
export async function decorateAndLoad(sectionHtml, faqKey = 'of1-faq') {
  const tempMain = document.createElement('main');
  tempMain.innerHTML = `<div>${sectionHtml}</div>`;
  decorateMain(tempMain);
  await loadSections(tempMain);
  registerFaqEntities(tempMain, faqKey);
  return Array.from(tempMain.querySelectorAll(':scope > div'));
}

export default async function decorate(block) {
  const config = readBlockConfig(block);

  if (!config['api-endpoint']) {
    config['api-endpoint'] = DEFAULT_WORKER_URL;
  }
  if (!config.domain) {
    const host = window.location.hostname;
    const metaDomain = document.querySelector('meta[name="domain"]')?.content;
    if (metaDomain && metaDomain.includes('--')) {
      config.domain = metaDomain;
    } else if (host.endsWith('.aem.page') || host.endsWith('.aem.live')) {
      config.domain = host.replace(/\.aem\.(page|live)$/, '');
    } else {
      config.domain = metaDomain || host;
    }
  }

  if (!document.querySelector('meta[name="domain"]')) {
    const meta = document.createElement('meta');
    meta.name = 'domain';
    meta.content = config.domain;
    document.head.appendChild(meta);
  }

  block.textContent = '';

  // Load the OF1 client SDK from the worker
  const sdkUrl = `${config['api-endpoint']}/sdk/of1-client.js`;
  const { init } = await import(/* webpackIgnore: true */ sdkUrl);
  // Bind the FAQ registration key to this block instance (see decorateAndLoad/registerFaqEntities)
  // so a page with more than one of1 block keeps each one's FAQPage contribution separate.
  await init(block, config, {
    decorateAndLoad: (sectionHtml) => decorateAndLoad(sectionHtml, block),
  });
}
