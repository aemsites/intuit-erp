import { blockNameOf, normalizeBlockName } from '../../../scripts/utils.js';

const DA_CONFIG = 'https://admin.da.live/config';
// This plugin's row in the library sheet, by title or path (handles both spelling variants).
const PLUGIN_ID = /sem(?:an)?ticstyler/i;
const ALL = 'all';
/** Include token that makes default content (text outside any block) editable. */
export const DEFAULT_CONTENT = 'default-content';

const field = (row, name) => Object.entries(row || {})
  .find(([key]) => key.trim().toLowerCase() === name)?.[1];

function libraryRows(config) {
  const sheet = Object.entries(config || {})
    .find(([name]) => name.trim().toLowerCase() === 'library')?.[1];
  const rows = Array.isArray(sheet) ? sheet : sheet?.data;
  return Array.isArray(rows) ? rows : [];
}

function isPluginRow(row, pluginPath) {
  const path = String(field(row, 'path') || '');
  try {
    if (pluginPath && new URL(path, 'https://da.live').pathname === pluginPath) return true;
  } catch { /* not a URL, fall back to the name match */ }
  return ['title', 'path'].some((key) => PLUGIN_ID.test(
    String(field(row, key) || '').replace(/[^a-z]/gi, ''),
  ));
}

/**
 * The `?ref=` DA opened this plugin with. The iframe can't read the canvas URL, so it is derived
 * from where the plugin is served: `local` on localhost, else the branch of `{ref}--{repo}--{org}`.
 */
export function currentRef({ hostname } = window.location) {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'local';
  return hostname.includes('--') ? hostname.split('--')[0] : '';
}

const rowRef = (row) => String(field(row, 'ref') || '').trim().toLowerCase();

/** Parse an `include` cell: `null` means every block, otherwise the set of block names. */
export function parseInclude(value) {
  const names = String(value || '').split(/[,;\n]/).map(normalizeBlockName).filter(Boolean);
  return names.includes(ALL) ? null : new Set(names);
}

export function editableBlocksFromConfig(config, pluginPath, ref = '') {
  const rows = libraryRows(config).filter((r) => isPluginRow(r, pluginPath));
  // The row for the active ref wins; a row with no ref is the default for every other ref.
  const row = rows.find((r) => rowRef(r) === ref.toLowerCase())
    || rows.find((r) => !rowRef(r));
  return row ? parseInclude(field(row, 'include')) : undefined;
}

/**
 * Reads the `include` column of this plugin's row in the DA library config, checking the site
 * config before the org config. Resolves `undefined` when it can't be read so callers retry.
 */
export async function loadEditableBlocks({ actions, context }, pluginPath) {
  const ref = context.ref || currentRef();
  const urls = [
    `${DA_CONFIG}/${context.org}/${context.repo}/`,
    `${DA_CONFIG}/${context.org}/`,
  ];
  // Site config wins, so stop at the first config that has a row for the plugin.
  const next = async ([url, ...rest], read) => {
    // Config is readable but has no row for the plugin: nothing is editable until one is added.
    if (!url) return read ? new Set() : undefined;
    const resp = await actions.daFetch(url, { cache: 'no-store' }).catch(() => null);
    if (!resp?.ok) return next(rest, read);
    const config = await resp.json().catch(() => null);
    const blocks = editableBlocksFromConfig(config, pluginPath, ref);
    return blocks === undefined ? next(rest, true) : blocks;
  };
  return next(urls, false);
}

/** Whether a section child (a block element, or `null` for default content) is editable. */
export function isEditable(block, editable) {
  if (editable === null) return true;
  return editable.has(block ? blockNameOf(block) : DEFAULT_CONTENT);
}

/** Stable key for comparing two editable-block results. */
export const editableKey = (editable) => (editable === null ? ALL : [...editable].sort().join());
