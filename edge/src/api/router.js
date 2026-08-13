/**
 * /api/* router: guard → preflight → dispatch → CORS merge. Additive to the SSR
 * proxy in index.js; consulted before any proxy logic when the path is /api/*.
 */

import { guard } from './guard.js';
import { handlePzn } from './pzn.js';
import { handleIxp } from './ixp.js';

export async function handleApi(request, env) {
  const { pathname } = new URL(request.url);
  const g = guard(request, env);
  const cors = g.ok ? g.cors : {};

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: g.ok ? 204 : 403, headers: cors });
  }
  if (!g.ok) return g.response;

  let res;
  if (pathname === '/api/pzn' && request.method === 'POST') {
    res = await handlePzn(request, env);
  } else if (pathname === '/api/ixp' && request.method === 'GET') {
    res = await handleIxp(request, env);
  } else {
    res = new Response('Not found', { status: 404 });
  }

  if (Object.keys(cors).length === 0) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
