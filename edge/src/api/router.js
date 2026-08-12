/**
 * /api/* router: guard → preflight → dispatch → CORS merge. Additive to the SSR
 * proxy in index.js; consulted before any proxy logic when the path is /api/*.
 */

import { guard } from './guard.js';
import { handleDe } from './de.js';
import { handleIxp } from './ixp.js';
import { handleManifest } from './manifest.js';
import { handleAudiences } from './audiences.js';
import { handleCatalog } from './catalog.js';

export async function handleApi(request, env) {
  const { pathname } = new URL(request.url);
  const g = guard(request, env);
  const cors = g.ok ? g.cors : {};

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: g.ok ? 204 : 403, headers: cors });
  }
  if (!g.ok) return g.response;

  let res;
  if (pathname === '/api/de' && request.method === 'POST') {
    res = await handleDe(request, env);
  } else if (pathname === '/api/ixp' && request.method === 'GET') {
    res = await handleIxp(request, env);
  } else if (pathname === '/api/pzn-manifest.json' && request.method === 'GET') {
    res = await handleManifest(request, env);
  } else if (pathname === '/api/audiences/catalog' && request.method === 'GET') {
    res = await handleCatalog();
  } else if (pathname === '/api/audiences' && request.method === 'GET') {
    res = await handleAudiences(request, env);
  } else {
    res = new Response('Not found', { status: 404 });
  }

  if (Object.keys(cors).length === 0) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
