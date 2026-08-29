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
 *
 * v3 (capture-completeness, ~91 uncaught): rect+style visibility (fixes position:fixed floating
 * widget / sticky nav wrongly skipped by offsetParent); a reveal() phase that hover-opens CSS
 * mega-nav flyouts, clicks aria-expanded disclosures, and opens the sales/contact widget before
 * locating (nav|accountants, talktosales items lived in closed containers); settle-aware preload
 * for long lazy blog pages; horizontal scrollIntoView for off-screen carousel cards; and a
 * bounded reveal-and-retry on each locate miss.
 *
 * v3.1 (nav-away hardening): neutralize location.assign/replace + form submit so a CTA's JS
 * navigation can't abort the run mid-capture (location.href= is [Unforgeable] — those still nav but
 * are recoverable via the sessionStorage resume); and SCOPE reveal's disclosure-clicks to
 * nav/header/footer + the sales/contact widget so it no longer clicks page content-accordions
 * (which fired spurious non-target beacons).
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
    document.addEventListener('submit', (e) => e.preventDefault(), true);
    try { window.open = () => null; } catch (e) { /* */ }
    try { window.history.pushState = () => {}; window.history.replaceState = () => {}; } catch (e) { /* */ }
    // v3.1: neutralize programmatic navigation so a CTA's JS handler (e.g. "Take the tour" ->
    // navattic) can't nav the tab away mid-capture. location.assign/replace ARE overridable;
    // location.href= is [Unforgeable] and cannot be blocked in-page — those still nav, but the
    // beacon is captured before the nav and sessionStorage (__b/__p/__eng) survives the round-trip,
    // so the drive resumes past the offending CTA on the way back.
    try { window.location.assign = () => {}; window.location.replace = () => {}; } catch (e) { /* */ }
  }

  const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  // v3: rect+style visibility (offsetParent is null for position:fixed, so the old check
  // wrongly skipped the floating talk-to-sales widget and sticky nav). Accepts below-fold
  // elements (they have a rect; we scroll to them) but rejects display:none/hidden/0-size.
  const vis = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.pointerEvents !== 'none' && +s.opacity !== 0;
  };
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
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { /* */ } // inline: bring horizontally-scrolled carousel cards into view
    await sleep(60);
    try { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); } catch (e) { /* */ }
    await sleep(45);
    try { el.click(); } catch (e) { /* */ }
    await sleep(500);
  }

  // Trigger lazy-rendered sections (EDS loads below-fold blocks on scroll) so faqs / cards
  // / footer exist before we click. BOUNDED: viewport-sized steps, capped iterations (a
  // growing/huge scrollHeight otherwise makes this grind), then jump to bottom + back to top.
  async function preload() {
    // v3: finer, settle-aware scroll — long blog pages (/blog/construction had 33 uncaught)
    // lazy-render many sections; step in 1/12ths and stop early once scrollHeight stabilizes.
    let last = -1;
    for (let i = 1; i <= 12; i++) {
      window.scrollTo(0, (i / 12) * document.body.scrollHeight); await sleep(240);
      const h = document.body.scrollHeight; if (h === last && i >= 6) break; last = h;
    }
    window.scrollTo(0, document.body.scrollHeight); await sleep(350);
    window.scrollTo(0, 0); await sleep(350);
  }

  // v3: expose hidden targets before locating. Hover-opens CSS mega-nav flyouts (nav|accountants
  // et al. live in a closed dropdown), clicks disclosure togglers, and opens the floating
  // sales/contact widget (its inner items — Visit support page, close — need it open).
  // Bounded; the capture-time preventDefault neutralizes any navigation these fire, and re-firing a
  // toggle's own beacon is harmless (harvest matches by contentKey, not order).
  // v3.1: disclosure-clicks are SCOPED to nav/header/footer + the sales/contact widget — NOT the
  // whole page — so reveal no longer clicks page content-accordions (faq/feature tabs), which fired
  // spurious non-target beacons and could trip a nav-away feature CTA.
  async function reveal() {
    const hover = [...document.querySelectorAll('header nav *, [class*="meganav"] *, nav [aria-haspopup], nav [aria-expanded], [class*="dropdown"] [class*="toggle"]')].filter(vis).slice(0, 40);
    for (const t of hover) { try { for (const ev of ['pointerover', 'mouseover', 'mouseenter']) t.dispatchEvent(new PointerEvent(ev, { bubbles: true })); } catch (e) { /* */ } }
    await sleep(180);
    const openers = [...document.querySelectorAll('header [aria-expanded="false"], nav [aria-expanded="false"], footer [aria-expanded="false"], [class*="talk"] button, [class*="sales"] button, [class*="contact-us"] button, [aria-label*="talk to" i], [aria-label*="sales" i], [aria-label*="chat" i]')].filter(vis).slice(0, 24);
    for (const o of openers) { try { o.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); o.click(); } catch (e) { /* */ } await sleep(110); }
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
    await reveal();
    const targets = JSON.parse(S.getItem('__t') || '[]');
    const clicked = new Set();
    let prog = +(S.getItem('__p') || '0');
    let reReveals = 0;
    for (; prog < targets.length; prog++) {
      S.setItem('__p', String(prog + 1)); // mark done BEFORE click so a nav-away resumes past it
      let el = locate(targets[prog], clicked);
      // a miss is often a collapsed flyout/widget/carousel — reveal & retry once (bounded total).
      if (!el && reReveals < 10) { reReveals++; await reveal(); el = locate(targets[prog], clicked); }
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
