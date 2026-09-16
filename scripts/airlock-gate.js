/*
 * `?martech=airlock` — the airlock reference-site rewire arm (airlock spec 050 / ADR-0029).
 *
 * ADDITIVE to the Tealium provider, not a replacement. When `?martech=airlock` is set, this module
 * (1) installs airlock's native-tag suppressor to neutralize the FOUR TBT-dominant vendor RUNTIMES
 * as utag tries to inject them, and (2) boots airlock's off-thread runtime, which re-emits those
 * four vendors' governed beacons from Web Workers. utag still loads normally, so the container's
 * other ~20 tags + the custom ECS/clicktrack chain are untouched — only the four migrated vendors
 * are rewired through airlock. Loaded via dynamic import from scripts.js, so a normal (non-airlock)
 * page load costs nothing.
 *
 * GROUNDING (airlock repo `npm run rig:erp-waterfall`, a public headless load of erp.intuit.com):
 * the Tealium `intuit/ies-erp/prod` container injects the three Google vendors as THREE SEPARABLE
 * `www.googletagmanager.com/gtag/js?id=<AW|DC|G>` runtimes plus `connect.facebook.net/.../fbevents.js`.
 * Their native beacons (GA4 `/g/collect`, Google Ads + Floodlight `www.google.com/ccm/collect`,
 * Google Ads `pagead/viewthroughconversion`, Floodlight `ad.doubleclick.net/activity`, Meta `/tr`)
 * are all fired BY those runtimes, so neutralizing the runtimes suppresses the beacons too.
 *
 * CARVE-OUT: airlock re-emits GA4 `/g/collect`, Google Ads + Floodlight `ccm/collect`, and Meta
 * `/tr` at the container's BYTE-IDENTICAL URLs (by design — parity). airlock's own egress is
 * exempted from suppression by the suppressor's fetch({keepalive:true}) TRANSPORT signature
 * (airlock spec 049-02), not by a URL allow-set — so no `allow` matchers are needed here.
 *
 * NOTE (airlock spec 044): airlock reproduces Google Ads' `ccm/collect` conversion beacon, NOT its
 * `pagead/viewthroughconversion` leg — both native legs are suppressed with the runtime; only
 * `ccm/collect` is re-emitted.
 */
import { installTagSuppressor } from './airlock/tag-suppressor.js';
import { boot } from './airlock/eds.js';

// The four migrated vendors' ids. AW/DC/GA4 are the container's public tag ids (they appear in every
// beacon). The Meta pixel id is a runtime value extracted from the container's `utag.21.js` template
// (airlock spec ADR-0018 R5): not a secret (it appears in every `/tr` beacon), kept here as the
// single config point rather than deeply embedded.
const GA4_MEASUREMENT_ID = 'G-GCCMSJL6CT';
const GOOGLE_ADS_CONVERSION_ID = 'AW-1030811807';
const FLOODLIGHT_CONVERSION_ID = 'DC-1996823';
// Floodlight activity identity, from the container's `ad.doubleclick.net/activity;src=...;type=...;cat=...` beacon.
const FLOODLIGHT_ACTIVITY = { src: '1996823', activityType: 'intuc741', cat: 'intuw830' };
const META_PIXEL_ID = '850485508311844';

// OneTrust consent group 4 → the four ad/analytics purposes it grants (matches the container's
// Consent-Mode-v2 gating). airlock reads OneTrust's own resolved surface (`window.OnetrustActiveGroups`)
// and re-derives on `OptanonWrapper` changes; a denied ad-consent HOLDS the ad beacons and a
// mid-session accept FLUSHES them (airlock MVP8 composite), preserving the container's behavior.
const ERP_ONETRUST_GROUP_PURPOSE_MAP = {
  4: ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'],
};

/**
 * Install the `?martech=airlock` rewire arm. Call this in `loadEager`, BEFORE utag loads (utag is
 * injected in `loadLazy`). The suppressor is patched in synchronously (guaranteed before utag);
 * `boot()` then spins up the off-thread runtime.
 *
 * @param {{ onDiagnostic?: (record: object) => void }} [opts] optional airlock diagnostics sink
 *   (suppression events, beacon holds/flushes) — handy for validation.
 * @returns {Promise<object>} the airlock composite handle (`window.airlock`).
 */
export async function installAirlockRewire({ onDiagnostic } = {}) {
  // (1) Suppress the four vendor RUNTIMES before utag injects them (airlock spec 049-01). Matchers
  // key on the three separable gtag/js?id= loads + fbevents.js — host-scoped, so the OneTrust
  // consent stack (otSDKStub / gdpr-util) and every other utag tag are untouched (they load from
  // different hosts), and the ~20-tag tail + ECS chain stay green.
  installTagSuppressor({
    suppress: [
      { host: 'www.googletagmanager.com', pathname: '/gtag/js', query: { id: GOOGLE_ADS_CONVERSION_ID } },
      { host: 'www.googletagmanager.com', pathname: '/gtag/js', query: { id: FLOODLIGHT_CONVERSION_ID } },
      { host: 'www.googletagmanager.com', pathname: '/gtag/js', query: { id: GA4_MEASUREMENT_ID } },
      { host: 'connect.facebook.net' }, // fbevents.js (host-only: the intended over-broad case; airlock's own egress is transport-exempt)
    ],
    onDiagnostic,
  });

  // (2) Boot the off-thread runtime that re-emits the four vendors' governed beacons. `ga4-gtag`
  // auto-sources client/session id from the `_ga` cookie. OneTrust-gated end-to-end (see the map above).
  return boot(
    {
      connectors: [
        { type: 'ga4-gtag', measurementId: GA4_MEASUREMENT_ID },
        { type: 'google-ads', conversionId: GOOGLE_ADS_CONVERSION_ID },
        { type: 'floodlight', conversionId: FLOODLIGHT_CONVERSION_ID, ...FLOODLIGHT_ACTIVITY },
        { type: 'pixel', vendor: 'meta', pixelId: META_PIXEL_ID },
      ],
      onetrust: { groupPurposeMap: ERP_ONETRUST_GROUP_PURPOSE_MAP },
    },
    { onDiagnostic },
  );
}
