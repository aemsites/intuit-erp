/**
 * Resolves the visiting company's firmographics from a demo URL param
 * (?account=<preset-id> or ?firmo=<domain>) — the mock analog of ZoomInfo
 * reverse-IP identification — and stores the result in localStorage for both
 * the OF1 personalizer and the of1-preview-extension to read. Mirrors the
 * chatgpt-context.js / google-ads-context.js pattern.
 */
import resolveFirmographics from './firmographics-provider.js';

const STORAGE_KEY = 'of1_firmographic_context';

export default async function captureFirmographicContext(of1BaseUrl, tenantId) {
  const params = new URLSearchParams(window.location.search);
  const accountId = params.get('account');
  const domain = params.get('firmo');
  if (!accountId && !domain) return null;

  // The worker resolves firmographics from the tenant's own config, so the
  // tenant id is required. `domain` here is the visiting COMPANY's domain
  // (from ?firmo=), sent alongside the tenant id — not the tenant slug.
  const firmographics = await resolveFirmographics(
    { id: tenantId, ...(accountId ? { accountId } : { domain }) },
    of1BaseUrl,
  );
  if (!firmographics) return null;

  const { audiences = [], ...attrs } = firmographics;
  const payload = { firmographics: attrs, audiences };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    // localStorage unavailable (private mode, quota) — still return the payload
  }
  return payload;
}
