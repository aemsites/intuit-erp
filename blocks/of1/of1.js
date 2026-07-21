import { decorateMain } from '../../scripts/scripts.js';
import { loadSections, readBlockConfig } from '../../scripts/aem.js';

const DEFAULT_WORKER_URL = 'https://of1-gen-web-service.franklin-prod.workers.dev';

/**
 * Legacy EDS decoration hook — passed to the SDK for non-template-routed
 * section events that need block decoration.
 */
async function decorateAndLoad(sectionHtml) {
  const tempMain = document.createElement('main');
  tempMain.innerHTML = `<div>${sectionHtml}</div>`;
  decorateMain(tempMain);
  await loadSections(tempMain);
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
  await init(block, config, { decorateAndLoad });
}
