export const OVERRIDE_FIELDS = [
  'object',
  'object-detail',
  'action',
  'ui-object',
  'ui-object-detail',
  'ui-action',
  'wa-link',
  'custom-properties',
  'survey',
];

export const DA_SOURCE_WRITE_METHOD = 'POST';

const STRUCTURAL_FIELDS = new Set(['path', 'id']);
const EDITOR_FIELDS = new Set(OVERRIDE_FIELDS);

function cleanPath(path) {
  const value = String(path || '*').trim();
  if (!value || value === '*') return '*';
  const pathname = value.split(/[?#]/)[0];
  const withSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const withoutTrailingSlash = withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : '/';
  if (withoutTrailingSlash === '/index') return '/';
  return withoutTrailingSlash.endsWith('/index')
    ? withoutTrailingSlash.slice(0, -6)
    : withoutTrailingSlash;
}

function cleanValue(value) {
  return String(value == null ? '' : value).trim();
}

export function resolveEditorPath({ contextPath = '', search = '' } = {}) {
  const requested = new URLSearchParams(search).get('path');
  const raw = String(requested || contextPath || '/').trim().split(/[?#]/)[0];
  const withoutHtml = raw.endsWith('.html') ? raw.slice(0, -5) || '/' : raw;
  return cleanPath(withoutHtml);
}

/** Build the frame-free editor inventory from global and current-page sheet rows. */
export function trackingRowsForPath(sheet, path) {
  const pagePath = cleanPath(path);
  return (sheet?.data || []).flatMap((row) => {
    const id = cleanValue(row.id);
    const rowPath = cleanPath(row.path);
    if (!id || (rowPath !== '*' && rowPath !== pagePath)) return [];

    const override = Object.fromEntries(OVERRIDE_FIELDS
      .filter((field) => cleanValue(row[field]))
      .map((field) => [field, row[field]]));
    const effective = { ...override };
    if (effective.object && effective.action) {
      effective.event = `${effective.object}:${effective.action}`;
    }
    const separator = id.indexOf(':');
    const block = separator > 0 ? id.slice(0, separator) : 'page';

    return [{
      id,
      matchedId: id,
      path: pagePath,
      label: cleanValue(row['ui-object-detail']) || cleanValue(row['object-detail']) || id,
      href: '',
      tag: '',
      block,
      editable: true,
      scope: rowPath === '*' ? 'global' : 'page',
      automatic: {},
      override,
      effective,
    }];
  });
}

function rowMatches(row, path, id) {
  return cleanPath(row.path) === cleanPath(path) && cleanValue(row.id) === cleanValue(id);
}

export function findOverride(sheet, path, id) {
  return (sheet?.data || []).find((row) => rowMatches(row, path, id)) || null;
}

function hasStoredValue(row) {
  return Object.entries(row).some(([key, value]) => !STRUCTURAL_FIELDS.has(key)
    && cleanValue(value));
}

function cloneSheet(sheet) {
  const source = sheet && typeof sheet === 'object' ? sheet : {};
  const data = Array.isArray(source.data) ? source.data.map((row) => ({ ...row })) : [];
  return {
    ...source,
    ':type': source[':type'] || 'sheet',
    total: data.length,
    data,
  };
}

export function applyOverride(sheet, { path, id, values } = {}) {
  const out = cloneSheet(sheet);
  const targetId = cleanValue(id);
  if (!targetId) return out;

  const targetPath = cleanPath(path);
  let index = out.data.findIndex((row) => rowMatches(row, targetPath, targetId));
  const row = index >= 0 ? { ...out.data[index] } : { path: targetPath, id: targetId };

  Object.entries(values || {}).forEach(([field, value]) => {
    if (!EDITOR_FIELDS.has(field)) return;
    const cleaned = cleanValue(value);
    if (cleaned) row[field] = cleaned;
    else delete row[field];
  });

  if (hasStoredValue(row)) {
    if (index >= 0) out.data[index] = row;
    else out.data.push(row);
  } else if (index >= 0) {
    out.data.splice(index, 1);
    index = -1;
  }

  out.total = out.data.length;
  return out;
}

function validatePairs(value, { delimiters = false } = {}) {
  const text = cleanValue(value);
  if (!text) return '';
  const pairs = text.split(/[;\n]+/).map((pair) => pair.trim()).filter(Boolean);
  if (delimiters && pairs.some((pair) => /[|,]/.test(pair))) {
    return 'Keys and values cannot contain "|" or ",".';
  }
  if (pairs.some((pair) => {
    const equals = pair.indexOf('=');
    return equals < 1 || !pair.slice(equals + 1).trim();
  })) {
    return 'Use one key=value pair per line.';
  }
  return '';
}

export function validateOverride(values = {}) {
  const errors = {};
  const customError = validatePairs(values['custom-properties'], { delimiters: true });
  if (customError) errors['custom-properties'] = customError;
  const surveyError = validatePairs(values.survey);
  if (surveyError) errors.survey = surveyError;
  return errors;
}

export function mergeOverride({ base, latest, change } = {}) {
  const baseRow = findOverride(base, change?.path, change?.id) || {};
  const latestRow = findOverride(latest, change?.path, change?.id) || {};
  const conflicts = [];

  Object.entries(change?.values || {}).forEach(([field, desired]) => {
    if (!EDITOR_FIELDS.has(field)) return;
    const before = cleanValue(baseRow[field]);
    const now = cleanValue(latestRow[field]);
    const wanted = cleanValue(desired);
    if (before !== now && now !== wanted) conflicts.push(field);
  });

  if (conflicts.length) return { conflicts, sheet: null };
  return { conflicts: [], sheet: applyOverride(latest, change) };
}

export function buildSheetFormData(sheet) {
  const data = new Blob([`${JSON.stringify(cloneSheet(sheet), null, 2)}\n`], {
    type: 'application/json',
  });
  const body = new FormData();
  body.append('data', data);
  return body;
}
