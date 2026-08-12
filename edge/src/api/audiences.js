/**
 * GET /api/audiences — client-driven IXP experiment resolution, expressed as
 * remote audience tokens for the aem-experimentation plugin.
 *
 * The plugin gates page/section audiences (e.g. `ixptreatment`) on these tokens.
 * The worker attaches the key (or, when `IXP_MOCK=enabled`, uses the in-worker
 * mock), reads the visitor `ivid` from the cookie, resolves the **sticky** IXP
 * assignment for the page's experiment (looked up from the Referer via the IXP
 * route table), and returns the assigned arm as a token:
 *   { assignments: { "<experimentId>": "treatment" | "control" }, audiences: ["ixptreatment"] }
 * `no-store` — the assignment is per-visitor. Empty (no ivid / page not enrolled /
 * no assignment) ⇒ the plugin serves the control experience.
 */

import { fetchAssignment } from '../ixp/client.js';
import { mockAssignment } from '../ixp/mock.js';
import { resolveRoute } from '../ixp/routes.js';
import { readIvid } from '../ivid.js';
import { json, refererPath } from './http.js';

const NO_STORE = { 'cache-control': 'no-store' };
const emptyAudiences = () => json({ assignments: {}, audiences: [] }, { headers: NO_STORE });

export async function handleAudiences(request, env) {
  const url = new URL(request.url);
  // The plugin fetches with no query (page audiences call it same-origin), so the
  // page comes from the Referer; `?path=` is a QA/testing override.
  const page = url.searchParams.get('path') || refererPath(request) || '/';

  const route = resolveRoute(page);
  if (!route) return emptyAudiences();

  const ivid = readIvid(request);
  if (!ivid) return emptyAudiences();

  const params = { ivid, experimentId: route.experimentId, label: route.label };
  const res = env.IXP_MOCK === 'enabled'
    ? mockAssignment(params)
    : await fetchAssignment(env, params);

  if (!res || !Array.isArray(res.assignments) || res.assignments.length === 0) {
    return emptyAudiences();
  }

  const assignments = {};
  const audiences = [];
  for (const a of res.assignments) {
    const arm = a.control ? 'control' : 'treatment';
    assignments[String(a.experimentId)] = arm;
    // Token the client gates on, e.g. `ixptreatment` / `ixpcontrol`. Hyphen-free
    // so it round-trips through the plugin's page-metadata audience matching.
    const token = `ixp${arm}`;
    if (!audiences.includes(token)) audiences.push(token);
  }
  return json({ assignments, audiences }, { headers: NO_STORE });
}
