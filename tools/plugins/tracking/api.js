import { buildSheetFormData } from './model.js';

export const TRACKING_SOURCE_PATH = '/tracking.json';
export const DA_ADMIN_ORIGIN = 'https://admin.da.live';
export const AEM_ADMIN_ORIGIN = 'https://admin.hlx.page';

function cleanRef(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEtag(value) {
  return cleanRef(value).replace(/^W\//, '');
}

export function resolveTrackingRef({ ref, context = {}, hostname } = {}) {
  const configured = cleanRef(ref) || cleanRef(context.ref);
  if (configured) return configured === 'local' ? 'main' : configured;

  const currentHostname = cleanRef(hostname)
    || cleanRef(typeof window === 'undefined' ? '' : window.location?.hostname);
  const suffix = '.preview.da.live';
  if (!currentHostname.endsWith(suffix)) return 'main';

  const previewParts = currentHostname.slice(0, -suffix.length).split('--');
  if (previewParts.length !== 3 || previewParts.some((part) => !part)) return 'main';
  return previewParts[0];
}

function statusDetails(response) {
  return [response?.status, response?.statusText].filter(Boolean).join(' ');
}

export function createTrackingApi({ daFetch, context = {}, ref } = {}) {
  if (typeof daFetch !== 'function') {
    throw new TypeError('A DA SDK daFetch function is required for tracking sheet delivery.');
  }

  const { org, repo } = context;
  if (!org || !repo) {
    throw new TypeError('DA context.org and context.repo are required for tracking sheet delivery.');
  }

  const resolvedRef = resolveTrackingRef({ context, ref });
  const sourceUrl = `${DA_ADMIN_ORIGIN}/source/${org}/${repo}${TRACKING_SOURCE_PATH}`;
  const deliveryUrl = (operation) => (
    `${AEM_ADMIN_ORIGIN}/${operation}/${org}/${repo}/${resolvedRef}${TRACKING_SOURCE_PATH}`
  );

  async function request(action, url, options) {
    let response;
    try {
      response = await daFetch(url, options);
    } catch (error) {
      throw new Error(`Could not ${action}: ${error.message}`, { cause: error });
    }

    if (!response?.ok) {
      const details = statusDetails(response);
      throw new Error(`Could not ${action}${details ? ` (${details})` : ''}.`);
    }
    return response;
  }

  async function parseSheet(response) {
    try {
      return await response.json();
    } catch (error) {
      throw new Error('The tracking sheet response from DA is not valid JSON.', { cause: error });
    }
  }

  return {
    async readSource() {
      const response = await request('read tracking sheet', sourceUrl, {
        method: 'GET',
        cache: 'no-store',
      });
      return parseSheet(response);
    },

    async readSourceRevision() {
      const response = await request('read tracking sheet', sourceUrl, {
        method: 'GET',
        cache: 'no-store',
      });
      const sheet = await parseSheet(response);
      const etag = normalizeEtag(response.headers?.get('etag'));
      if (!etag) {
        throw new Error('The tracking sheet response did not include the ETag required for safe editing.');
      }
      return { sheet, etag };
    },

    async writeSource(sheet, { etag } = {}) {
      const revision = normalizeEtag(etag);
      if (!revision) {
        throw new TypeError('An ETag is required for a safe tracking sheet update.');
      }
      return request('save tracking sheet', sourceUrl, {
        method: 'POST',
        headers: { 'If-Match': revision },
        body: buildSheetFormData(sheet),
      });
    },

    preview() {
      return request('preview tracking sheet', deliveryUrl('preview'), { method: 'POST' });
    },

    publish() {
      return request('publish tracking sheet', deliveryUrl('live'), { method: 'POST' });
    },
  };
}
