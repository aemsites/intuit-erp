/*
 * live-capture-engine.js — the in-page capture engine for the live stage validation.
 *
 * NOT a module. Eval this whole file once in the target page (via claude-in-chrome
 * javascript_tool): it defines window.__mk, stores __mk.toString() in
 * sessionStorage.__eng (survives same-origin nav so a nav-away CTA can resume), and
 * calls __mk() to install. Per page: set sessionStorage.__t/__p/__b/__page/__diag,
 * (re-)eval __eng if window.__capStep is gone, then window.__capStep().
 *
 * v2 overhaul (capture-coverage): scroll-preload lazy sections; a rich location ladder
 * (data-testid, external-href domain, arrow aria/class, nav/footer-scoped text, and
 * prefix-stripped humanized hints for internal-id labels like nav|accountants,
 * ftr-global-legal-About, qb_desktop_migration|schedule_call); dedup-by-element so
 * duplicate labels (Register, Find out more) click distinct nodes; per-page cas-id /
 * appVars diagnostic. PII is sanitized in-page (KEEP allowlist raw, everything else a
 * shape token) so nothing sensitive leaves the browser.
 */
/* eslint-disable no-restricted-syntax, no-continue, no-plusplus, max-len, no-underscore-dangle, object-curly-newline, no-nested-ternary, no-await-in-loop, no-empty, prefer-rest-params, func-names, no-restricted-globals */
window.__mk = function () {
  const S = sessionStorage;
  const KEEP = new Set(['type', 'event', 'writeKey', '_metadata', 'object', 'object_detail', 'action', 'ui_object', 'ui_object_detail', 'ui_action', 'ui_access_point', 'data-wa-link', 'icom_user_action', 'link_name', 'link_href', 'link_href_domain', 'site_section', 'screen', 'scope_area', 'top_screen', 'top_scope_area', 'page_hierarchy', 'page_hierarchy_extended', 'page_name_parameter', 'page_category_parameter', 'page_geography', 'url', 'url_clean', 'url_host_name', 'channel_cookie_90day', 'org', 'purpose', 'scope', 'platform', 'env', 'ecs_version', 'write_key', 'page_language', 'loadAdobeVisitorApi', 'event_sender_path', 'gpc_enabled', 'privacy_essential', 'privacy_advertising', 'prefs_essential_ccpa', 'prefs_essential_cpra', 'prefs_advertising_ccpa', 'prefs_advertising_cpra', 'page_cas_id', 'project_asset_id', 'personalization_details', 'enriched_ecs_version', 'tracking_library', 'library']);
  const tok = (v) => { if (v === null) return 'NULL'; if (Array.isArray(v)) return `ARR:${v.length}`; const t = typeof v; if (t === 'object') return 'OBJ'; if (t === 'string') return `STR:${v.length}`; if (t === 'number') return 'NUM'; if (t === 'boolean') return 'BOOL'; return t; };
  const sani = (o, all) => { const r = {}; for (const [k, v] of Object.entries(o || {})) r[k] = (all || !KEEP.has(k)) ? tok(v) : v; return r; };
  const sanitize = (pl) => { const r = {}; for (const [k, v] of Object.entries(pl || {})) { if (k === 'properties' || k === 'context') r[k] = sani(v, false); else if (k === 'integrations') r[k] = sani(v, true); else r[k] = KEEP.has(k) ? v : tok(v); } return r; };

  if (!window.__capInstalled) {
    window.__capInstalled = true;
    const push = (b) => { try { const a = JSON.parse(S.getItem('__b') || '[]'); a.push(b); S.setItem('__b', JSON.stringify(a)); } catch (e) { /* */ } };
    const rec = (u, b) => { try { if (/eventbus\.intuit\.com/.test(u) && typeof b === 'string') push(b); } catch (e) { /* */ } };
    const of = window.fetch; window.fetch = function (u, o) { try { rec(typeof u === 'string' ? u : (u && u.url), o && o.body); } catch (e) { /* */ } return of.apply(this, arguments); };
    const os = navigator.sendBeacon; if (os) navigator.sendBeacon = function (u, b) { try { rec(u, b); } catch (e) { /* */ } return os.apply(this, arguments); };
    const oo = XMLHttpRequest.prototype.open; const oss = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return oo.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (b) { try { rec(this.__u, b); } catch (e) { /* */ } return oss.apply(this, arguments); };
    document.addEventListener('click', (e) => e.preventDefault(), true);
    try { window.open = () => null; } catch (e) { /* */ }
    try { window.history.pushState = () => {}; window.history.replaceState = () => {}; } catch (e) { /* */ }
  }

  const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const vis = (el) => !!(el && el.offsetParent !== null);
  const nohost = (h) => (h || '').replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/\/$/, '');
  // external destination host (not our own stage/prod host), else '' — used to match out-nav CTAs.
  const extHost = (h) => { try { const u = new URL(h, window.location.href); return /(^|\.)erp\.intuit\.com$/.test(u.host) ? '' : u.host; } catch (e) { return ''; } };
  const scopeOf = (el, scope) => { if (scope === 'nav') return !!el.closest('header,nav,[class*="nav"]'); if (scope === 'footer') return !!el.closest('footer,[class*="footer"]'); return true; };
  const CLICKABLE = 'a,button,[role="button"],summary,[data-testid]';

  // Locate the DOM element for a rich target {label, href, testid, hints[], scope, arrow},
  // skipping already-clicked nodes so duplicate labels resolve to distinct elements.
  function locate(t, clicked) {
    const all = [...document.querySelectorAll(CLICKABLE)].filter((e) => vis(e) && !clicked.has(e));
    const pick = (fn) => all.find((e) => scopeOf(e, t.scope) && fn(e));
    let el;
    if (t.testid) { el = pick((e) => e.getAttribute('data-testid') === t.testid); if (el) return el; }
    if (t.arrow) { const rx = t.arrow === 'left' ? /(^|[^a-z])(left|prev|previous|back)([^a-z]|$)/i : /(^|[^a-z])(right|next|forward)([^a-z]|$)/i; el = pick((e) => rx.test(`${e.getAttribute('aria-label') || ''} ${e.getAttribute('title') || ''} ${e.className || ''} ${norm(e.textContent)}`)); if (el) return el; }
    if (t.href) { const host = extHost(t.href); if (host) { el = pick((e) => e.tagName === 'A' && (e.getAttribute('href') || '').includes(host)); if (el) return el; } const path = nohost(t.href); if (path) { el = pick((e) => e.tagName === 'A' && nohost(e.getAttribute('href')) === path); if (el) return el; } }
    for (const hint of (t.hints || [])) {
      const h = norm(hint); if (!h) continue;
      el = pick((e) => norm(e.textContent) === h); if (el) return el;
      el = pick((e) => norm(e.getAttribute('aria-label')) === h || norm(e.getAttribute('title')) === h); if (el) return el;
      el = pick((e) => { const tx = norm(e.textContent); return tx.includes(h) && tx.length <= h.length + 40; }); if (el) return el;
      el = pick((e) => (norm(e.getAttribute('aria-label')) || '').includes(h)); if (el) return el;
    }
    return null;
  }

  async function clickEl(el) {
    try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* */ }
    try { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); } catch (e) { /* */ }
    await sleep(45);
    try { el.click(); } catch (e) { /* */ }
    await sleep(500);
  }

  // Trigger lazy-rendered sections (EDS loads below-fold blocks on scroll) so faqs / cards
  // / footer exist before we click. BOUNDED: viewport-sized steps, capped iterations (a
  // growing/huge scrollHeight otherwise makes this grind), then jump to bottom + back to top.
  async function preload() {
    for (const f of [0.2, 0.4, 0.6, 0.8, 1]) { window.scrollTo(0, document.body.scrollHeight * f); await sleep(220); }
    window.scrollTo(0, document.body.scrollHeight); await sleep(300);
    window.scrollTo(0, 0); await sleep(400);
  }

  function diag() {
    const meta = (n) => (document.querySelector(`meta[name="${n}"]`) || {}).content || '';
    return {
      cas_id_meta: meta('cas-id'),
      appVars_externalContentIdentifier: (window.appVars && window.appVars.externalContentIdentifier) || '',
      wa_links_at_rest: document.querySelectorAll('a[data-wa-link],[data-wa-link]').length,
      utag: typeof window.utag,
    };
  }

  window.__capStep = async () => {
    for (let k = 0; k < 40 && typeof window.utag === 'undefined'; k++) await sleep(250);
    await preload();
    const targets = JSON.parse(S.getItem('__t') || '[]');
    const clicked = new Set();
    let prog = +(S.getItem('__p') || '0');
    for (; prog < targets.length; prog++) {
      S.setItem('__p', String(prog + 1)); // mark done BEFORE click so a nav-away resumes past it
      const el = locate(targets[prog], clicked);
      if (el) { clicked.add(el); await clickEl(el); }
    }
    try { S.setItem('__diag', JSON.stringify(diag())); } catch (e) { /* */ }
    document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide'));
    await sleep(900);
    S.setItem('__done', '1');
  };

  window.__capHarvest = () => { const raw = JSON.parse(S.getItem('__b') || '[]'); const out = []; for (const b of raw) { try { const j = JSON.parse(b); if (Array.isArray(j)) { for (const x of j) if (x && x.event) out.push(sanitize(x)); } else if (j && j.event && String(j.event).includes(':')) out.push(sanitize(j)); } catch (e) { /* */ } } return out; };

  window.__capRender = () => {
    const o = window.__capHarvest();
    const secs = ['properties', 'context', 'integrations', '_metadata'];
    const J = (v) => JSON.stringify(v);
    const shared = { top: {}, properties: {}, context: {}, integrations: {}, _metadata: {} };
    if (o.length) {
      const tk = new Set(); for (const b of o) for (const k of Object.keys(b)) if (!secs.includes(k)) tk.add(k);
      for (const k of tk) if (o.every((b) => k in b && J(b[k]) === J(o[0][k]))) shared.top[k] = o[0][k];
      for (const s of secs) { const ks = new Set(); for (const b of o) for (const k of Object.keys(b[s] || {})) ks.add(k); for (const k of ks) if (o.every((b) => (b[s] || {})[k] !== undefined && J((b[s] || {})[k]) === J((o[0][s] || {})[k]))) shared[s][k] = o[0][s][k]; }
    }
    const beacons = o.map((b) => { const d = { top: {}, properties: {}, context: {}, integrations: {}, _metadata: {} }; for (const k of Object.keys(b)) if (!secs.includes(k) && J(b[k]) !== J(shared.top[k])) d.top[k] = b[k]; for (const s of secs) for (const k of Object.keys(b[s] || {})) if (J(b[s][k]) !== J(shared[s][k])) d[s][k] = b[s][k]; return d; });
    let dg = {}; try { dg = JSON.parse(S.getItem('__diag') || '{}'); } catch (e) { /* */ }
    const out2 = { shared, beacons, diag: dg };
    const pre = document.createElement('pre'); pre.textContent = `CAPSTART${J(out2)}CAPEND`; document.body.innerHTML = ''; document.body.appendChild(pre);
    return { n: o.length, chars: J(out2).length, diag: dg };
  };
};
sessionStorage.setItem('__eng', window.__mk.toString());
window.__mk();
