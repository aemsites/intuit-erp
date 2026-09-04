/*
 * Akamai EdgeWorker — inline the aem.live header (nav) and footer fragments into
 * the HTML document at the edge, and forward the `edge-cache-tag` so push
 * invalidation still purges every page that inlined a changed fragment.
 *
 * This is the Akamai port of adobe-rnd/helix-mixer `src/inlines.js` (Cloudflare/
 * Fastly). The pure inlining + cache-tag logic lives in ./inline.js (unit-tested);
 * this file only wires it to the EdgeWorkers runtime (subrequests + response).
 *
 * Runs as a `responseProvider`, so the property must NOT attach it to
 * `*.plain.html`, JSON, or assets (that would recurse / waste compute) — see
 * README.md "Property Manager requirements".
 */
import { httpRequest } from 'http-request';
import { createResponse } from 'create-response';
import { ReadableStream } from 'streams';
import { logger } from 'log';
import { TextEncoder } from 'encoding';
import {
  resolveFragmentPaths,
  toPlainHtmlPath,
  createCacheKeys,
  mergeCacheKeys,
  serializeCacheKeys,
  inlineTag,
} from './inline.js';

const CDN_TYPE = 'akamai';

/**
 * Adapt an EdgeWorkers httpResponse header accessor (getHeader → string[]) to the
 * `{ get(name) => string|null }` shape inline.js expects.
 */
function headerBag(resp) {
  return {
    get(name) {
      const values = resp.getHeader(name);
      return values && values.length ? values.join(',') : null;
    },
  };
}

/**
 * Headers to forward to origin on every subrequest so aem.live emits the Akamai
 * `edge-cache-tag`, honors push invalidation, and passes site-auth. These mirror
 * the property's own origin request headers.
 */
function forwardHeaders(request) {
  const headers = {
    'x-forwarded-host': [request.host],
    'x-byo-cdn-type': [CDN_TYPE],
    'x-push-invalidation': ['enabled'],
  };
  // aem.live site-auth token. Kept in Property Manager (PMUSER_ORIGIN_AUTH), never
  // in worker code. Omit the behavior/variable if the origin has no site-auth.
  const token = request.getVariable('PMUSER_ORIGIN_AUTH');
  if (token) headers.authorization = [`token ${token}`];
  return headers;
}

function isHtml(resp) {
  return (resp.getHeader('content-type')?.[0] || '').includes('text/html');
}

/**
 * Fetch a fragment's `.plain.html`. Returns the response on 200 HTML, else null.
 */
async function fetchFragment(path, fwd) {
  try {
    const resp = await httpRequest(toPlainHtmlPath(path), { headers: fwd });
    if (resp.status === 200 && isHtml(resp)) return resp;
    logger.log('inline: skip fragment %s (status %d)', path, resp.status);
  } catch (e) {
    logger.log('inline: fragment %s failed: %s', path, e.message);
  }
  return null;
}

/**
 * Copy the page response headers, drop the ones invalidated by rewriting the body,
 * and set the unioned edge-cache-tag.
 */
function buildResponseHeaders(pageResp, cacheKeys) {
  const headers = pageResp.getHeaders(); // { name: [values] }, lowercased names
  delete headers['content-length'];
  delete headers['content-encoding']; // body is emitted uncompressed; CDN recompresses
  const tags = serializeCacheKeys(cacheKeys);
  if (tags) headers['edge-cache-tag'] = [tags];
  return headers;
}

function streamFromString(str) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(str));
      controller.close();
    },
  });
}

// eslint-disable-next-line import/prefer-default-export
export async function responseProvider(request) {
  const fwd = forwardHeaders(request);

  // 1. Fetch the page from origin (through the property pipeline).
  const page = await httpRequest(request.url, { headers: fwd });

  // 2. Only transform GET + 200 + HTML documents. Anything else passes through
  //    untouched (body stream is still intact — we haven't read it).
  if (request.method !== 'GET' || page.status !== 200 || !isHtml(page)) {
    return createResponse(page.status, page.getHeaders(), page.body);
  }

  let html = await page.text();
  const cacheKeys = createCacheKeys(headerBag(page));
  const { navPath, footerPath } = resolveFragmentPaths(html);

  // 3. Fetch nav + footer in parallel (no-ops when a path is null — e.g. hidden
  //    header/footer or no empty tag to inline into).
  const [nav, footer] = await Promise.all([
    navPath ? fetchFragment(navPath, fwd) : null,
    footerPath ? fetchFragment(footerPath, fwd) : null,
  ]);

  // 4. Inline each fragment and union its cache tag into the page's — this is what
  //    keeps push invalidation correct after inlining.
  if (nav) {
    mergeCacheKeys(cacheKeys, headerBag(nav));
    html = inlineTag(html, 'header', await nav.text());
  }
  if (footer) {
    mergeCacheKeys(cacheKeys, headerBag(footer));
    html = inlineTag(html, 'footer', await footer.text());
  }

  // 5. Return the composed page as a stream. String bodies cap at 16 KB in
  //    responseProvider; real pages exceed that, so a ReadableStream is required.
  return createResponse(200, buildResponseHeaders(page, cacheKeys), streamFromString(html));
}
