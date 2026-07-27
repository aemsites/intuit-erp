/**
 * Thin, keyless client for the OF1 worker's /api/firmographics endpoint.
 * Contains NO provider logic and NO API key — the mock/real (ZoomInfo) swap
 * lives entirely server-side in of1-gen-web. Public source safe.
 */
export default async function resolveFirmographics(identity, of1BaseUrl) {
  try {
    const res = await fetch(`${of1BaseUrl}/api/firmographics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(identity),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}
