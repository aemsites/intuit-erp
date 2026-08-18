/**
 * Click-tracking sheet: the authored residue + overrides.
 *
 * A dedicated multi-column DA sheet (deliberately NOT the flat site-config.json,
 * which is a global key->value map), fetched once and cached. Rows are keyed by
 * `key`, which matches the `tracking-<key>` block variant class. A block with
 * multiple CTAs uses one row per CTA with a 1-based `cta` column (DOM order
 * within the block); a row without `cta` applies to the block's first CTA.
 *
 * Blank cells mean "defer to the derived value" and are dropped here, so the
 * resolve step can treat the row as `sheet ?? derived`. See CLICK-TRACKING.md
 * ("Identity vs context", "Cascade mechanics").
 *
 * Schema (columns):
 *   key, cta, object, object-detail, action, ui-object, ui-object-detail,
 *   ui-action, access-point, ui-access-point, wa-link, custom-properties, survey
 * `custom-properties` and `survey` are authored as `k=v` pairs separated by
 * newlines or semicolons (never the tracker's fragile `k|v,k|v` string — code
 * assembles that, so the pipe trap can't happen).
 */

const SHEET_URL = '/tracking.json';

// Scalar columns copied straight through (blank -> dropped).
const SCALAR_COLUMNS = [
  'object', 'object-detail', 'action', 'ui-object', 'ui-object-detail',
  'ui-action', 'access-point', 'ui-access-point', 'wa-link',
];

/**
 * Parse a `k=v` list (newline- or semicolon-separated) into a map. Blank-safe;
 * segments without a `=` (or with an empty key) are skipped.
 * @param {string} str
 * @returns {Record<string, string>}
 */
export function parseKeyValues(str) {
  const out = {};
  (str || '')
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 1) return;
      const k = pair.slice(0, eq).trim();
      const v = pair.slice(eq + 1).trim();
      if (k) out[k] = v;
    });
  return out;
}

/**
 * Normalize one raw sheet row into a per-CTA config: blank cells dropped,
 * `custom-properties`/`survey` parsed to maps, `cta` coerced to a number.
 * @param {Record<string, string>} row
 * @returns {Record<string, unknown>}
 */
export function normalizeRow(row) {
  const cfg = {};
  SCALAR_COLUMNS.forEach((col) => {
    const v = (row[col] ?? '').toString().trim();
    if (v !== '') cfg[col] = v;
  });
  const cp = parseKeyValues(row['custom-properties']);
  if (Object.keys(cp).length) cfg['custom-properties'] = cp;
  const survey = parseKeyValues(row.survey);
  if (Object.keys(survey).length) cfg.survey = survey;
  const cta = parseInt(row.cta, 10);
  if (Number.isFinite(cta)) cfg.cta = cta;
  return cfg;
}

/**
 * Index raw sheet rows into `key -> [config, ...]`, each key's configs ordered
 * by `cta` (rows without a `cta` sort last). Rows without a `key` are skipped.
 * @param {Array<Record<string, string>>} data
 * @returns {Map<string, Array<Record<string, unknown>>>}
 */
export function indexRows(data) {
  const byKey = new Map();
  (data || []).forEach((row) => {
    const key = (row.key ?? '').toString().trim();
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(normalizeRow(row));
  });
  byKey.forEach((rows) => rows.sort((a, b) => (a.cta ?? Infinity) - (b.cta ?? Infinity)));
  return byKey;
}

let sheetPromise;

/**
 * Fetch + index the tracking sheet once (cached). Returns an empty Map when the
 * sheet is unavailable (local/dev without it), so decoration fails open.
 * @returns {Promise<Map<string, Array<Record<string, unknown>>>>}
 */
export function fetchTrackingSheet() {
  if (!sheetPromise) {
    sheetPromise = fetch(SHEET_URL)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => indexRows(json?.data))
      .catch(() => new Map());
  }
  return sheetPromise;
}
