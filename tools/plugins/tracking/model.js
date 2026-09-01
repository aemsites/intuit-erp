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

const STRUCTURAL_FIELDS = new Set(['path', 'id']);
const EDITOR_FIELDS = new Set(OVERRIDE_FIELDS);

function cleanPath(path) {
  const value = String(path || '*').trim();
  if (!value || value === '*') return '*';
  const pathname = value.split(/[?#]/)[0];
  const withSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : '/';
}

function cleanValue(value) {
  return String(value == null ? '' : value).trim();
}

function rowMatches(row, path, id) {
  return cleanPath(row.path) === cleanPath(path) && cleanValue(row.id) === cleanValue(id);
}

export function findOverride(sheet, path, id) {
  return (sheet?.data || []).find((row) => rowMatches(row, path, id)) || null;
}

function hasStoredValue(row) {
  return Object.keys(row).some((key) => !STRUCTURAL_FIELDS.has(key));
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
