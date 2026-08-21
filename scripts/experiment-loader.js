/**
 * True if experimentation is enabled. Includes `decisions-manifest` so a page using ONLY
 * that lane (no experiment/campaign/audience metadata) still loads the plugin.
 * @returns {boolean}
 */
const isExperimentationEnabled = () => document.head.querySelector('[name^="experiment"],[name^="campaign-"],[name^="audience-"],[name="decisions-manifest"],[property^="campaign:"],[property^="audience:"]')
  || [...document.querySelectorAll('.section-metadata div')].some((d) => d.textContent.match(/Experiment|Campaign|Audience/i));

/**
 * Loads the BYO decision-engine hooks spread onto the plugin config. Dynamic (loads only
 * alongside the plugin) and fail-open ({} leaves the plugin's default no-BYO behavior).
 * @returns {Promise<Object>} the hooks, or {} if they failed to load
 */
async function loadByoHooks() {
  try {
    // eslint-disable-next-line import/no-cycle -- cycles back to scripts.js via fragment.js
    return await import('./personalization/byo.js');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load BYO decision-engine hooks:', error);
    return {};
  }
}

/**
 * Loads the experimentation module (eager).
 * @param {Document} document The document object.
 * @param {Object} config The experimentation configuration.
 * @returns {Promise<void>} A promise that resolves when the experimentation module is loaded.
 */
export async function runExperimentation(document, config) {
  if (!isExperimentationEnabled()) {
    window.addEventListener('message', async (event) => {
      if (event.data?.type === 'hlx:experimentation-get-config') {
        event.source.postMessage({
          type: 'hlx:experimentation-config',
          config: { experiments: [], audiences: [], campaigns: [] },
          source: 'no-experiments',
        }, '*');
      }
    });
    return null;
  }

  try {
    // Vendored via git subtree at plugins/experimentation (see its README), not an
    // installed npm package, so this necessarily crosses a package.json boundary.
    // eslint-disable-next-line import/no-relative-packages
    const { loadEager } = await import('../plugins/experimentation/src/index.js');
    // BYO decision-engine hooks (see the plugin's byo-decision-engine.md). Opt-in —
    // spreading {} on failure leaves the plugin's default behavior untouched.
    const byoHooks = await loadByoHooks();
    return loadEager(document, { ...config, ...byoHooks });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load experimentation module (eager):', error);
    return null;
  }
}

/**
 * Loads the experimentation simulation UI (lazy). Authoring aid only — this is a
 * no-op in production; the coarse check below avoids even fetching the plugin
 * there, and the plugin re-checks authoritatively before showing anything.
 * @param {Document} document The document object.
 * @param {Object} config The experimentation configuration.
 * @returns {Promise<void>} A promise that resolves when the simulation UI is loaded.
 */
export async function runExperimentationLazy(document, config) {
  const { host, hostname, origin } = window.location;
  const isPreview = hostname === 'localhost'
    || hostname.endsWith('.page')
    || (typeof config.isProd === 'function' && !config.isProd())
    || (config.prodHost && ![host, hostname, origin].includes(config.prodHost));
  if (!isPreview) {
    return null;
  }

  try {
    // eslint-disable-next-line import/no-relative-packages
    const { loadLazy } = await import('../plugins/experimentation/src/index.js');
    // Same BYO hooks as eager, so the sim panel stays consistent with the engine.
    const byoHooks = await loadByoHooks();
    return loadLazy(document, { ...config, ...byoHooks });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load experimentation module (lazy):', error);
    return null;
  }
}
