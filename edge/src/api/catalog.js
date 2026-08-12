/**
 * GET /api/audiences/catalog — the audiences the decision engine knows about, so
 * tooling can enumerate them. The AEM Sidekick simulation panel needs an
 * exhaustive list to populate its audience switcher, which the generic
 * per-visitor `remote` handler can't provide (it only resolves membership, one
 * visitor at a time).
 *
 * Metadata only — no ivid, per-visitor-independent, safe to cache. For the POC it
 * enumerates the mock's firmographic segments (de/mock.js) plus the IXP arm
 * tokens; a real deployment would source this from the engine's segment /
 * experiment configuration (Intuit exposes no enumeration API yet).
 */

import { SEGMENTS } from '../de/mock.js';
import { json } from './http.js';

// The IXP arm tokens the client gates on (see api/audiences.js).
const IXP_AUDIENCES = ['ixptreatment', 'ixpcontrol'];

export function handleCatalog() {
  const audiences = [...SEGMENTS, ...IXP_AUDIENCES];
  return json({ audiences }, { headers: { 'cache-control': 'public, max-age=300' } });
}
