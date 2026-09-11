import { loadCSS, loadScript } from '../../scripts/aem.js';

const ASSET_BASE = `${window.hlx.codeBasePath}/widgets/icom-hp`;

/**
 * Loads and decorates the ICOM HP widget.
 */
export default async function decorate() {
  await Promise.all([
    loadCSS(`${ASSET_BASE}/ripple.css`),
    loadCSS(`${ASSET_BASE}/main.css`),
    loadScript(`${ASSET_BASE}/main.js`, { type: 'module' }),
  ]);
}
