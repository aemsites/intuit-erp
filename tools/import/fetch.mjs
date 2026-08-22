/**
 * fetch.mjs — fetch a source page from erp.intuit.com.
 *
 * The source is a Next.js site behind Akamai that blocks headless scrapers and
 * hard rate-limits (HTTP 429). The only proven method is curl with a browser
 * User-Agent, absorbing all backoff INSIDE curl via --retry (never sleep /
 * background / polling). We shell out to the system curl rather than using
 * node fetch precisely because node/undici gets blocked.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/** curl flags proven against erp.intuit.com's Akamai rate limiting. */
export const CURL_ARGS = [
  '-sS', '-A', UA,
  '--retry', '15', '--retry-delay', '20',
  '--retry-all-errors', '--retry-max-time', '400', '--max-time', '45',
];

/**
 * Fetch a URL's SSR HTML. If `cacheFile` exists it is used instead of the
 * network (lets the tool run offline against a pre-downloaded page, and keeps
 * bulk runs from re-hammering the source).
 * @param {string} url
 * @param {{cacheFile?: string}} [opts]
 * @returns {string} the SSR HTML
 */
export function fetchSource(url, { cacheFile } = {}) {
  if (cacheFile && existsSync(cacheFile)) {
    return readFileSync(cacheFile, 'utf8');
  }
  const res = spawnSync('curl', [...CURL_ARGS, url], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 420 * 1000,
  });
  if (res.error) throw new Error(`curl failed for ${url}: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`curl exited ${res.status} for ${url}: ${(res.stderr || '').trim()}`);
  }
  const html = res.stdout || '';
  if (html.length < 500) {
    throw new Error(`suspiciously small response (${html.length} bytes) for ${url} — likely blocked/429`);
  }
  return html;
}
