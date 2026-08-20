/* eslint-disable no-restricted-syntax */
// OF1 intent tracker. Observes the visitor's on-page behavior (dwell time, scroll
// depth, clicks, section focus), derives per-domain interests + a purchase-intent
// profile, and persists it to localStorage under `of1_behavior_profiles`. Ported
// from the OF1 injected tracker; the pure model/heuristic functions are unit-tested,
// the DOM wiring is verified manually. Fail-open throughout: the page must never break.
//
// No side effects on import — behavior only starts when `initOf1Intent()` is called
// (delayed phase), so `pzn.js` can read a stored profile early without pulling the
// tracker's listeners onto the LCP path.

const STORAGE_KEY = 'of1_behavior_profiles';
const MIN_DWELL_TIME_MS = 2000;
const SCROLL_DEBOUNCE_MS = 200;
const FOCUS_SAMPLE_INTERVAL_MS = 1000;
const FLUSH_INTERVAL_MS = 3000;
// Dwell time (ms) at which a page's time-based interest score saturates.
const INTEREST_TIME_NORM_MS = 60000;

// --- Pure: DOM helpers -----------------------------------------------------

// CSS.escape where available (all supported browsers), with a minimal fallback.
const cssEscape = (value) => (typeof CSS !== 'undefined' && CSS.escape
  ? CSS.escape(value)
  : String(value).replace(/[^\w-]/g, (c) => `\\${c}`));

// A selector stable enough to key repeat clicks on the same control across a
// session: an id, then a stable attribute, else a structural nth-of-type path.
export function stableSelector(el) {
  if (el.id) return `#${cssEscape(el.id)}`;
  const tag = el.tagName.toLowerCase();
  for (const attr of ['data-testid', 'data-id', 'aria-label']) {
    const val = el.getAttribute(attr);
    if (val) return `${tag}[${attr}="${cssEscape(val)}"]`;
  }
  const parts = [];
  let node = el;
  while (node && node !== document.body) {
    const parent = node.parentElement;
    if (!parent) break;
    const { tagName } = node;
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === tagName);
    if (sameTag.length > 1) {
      parts.unshift(`${tagName.toLowerCase()}:nth-of-type(${sameTag.indexOf(node) + 1})`);
    } else {
      parts.unshift(tagName.toLowerCase());
    }
    node = parent;
  }
  return parts.join(' > ');
}

// The heading text of the nearest landmark containing `el` (what the visitor is
// looking at), capped at 80 chars.
export function sectionHeading(el) {
  const container = el.closest('section, [role="region"], article, main, header, footer, nav');
  return (container && container.querySelector('h1, h2, h3')?.textContent?.trim().slice(0, 80)) || '';
}

// --- Pure: interest scoring ------------------------------------------------

// Per page: time (saturating at INTEREST_TIME_NORM_MS) + scroll depth + click
// activity. Deduped by title/path keeping the best score; top 10, ranked.
export function deriveInterests(visits) {
  const totalTime = visits.reduce((sum, v) => sum + v.dwellTimeMs, 0);
  if (totalTime === 0) return [];
  const byTopic = new Map();
  for (const v of visits) {
    const timeScore = Math.min(v.dwellTimeMs / INTEREST_TIME_NORM_MS, 1);
    const clickScore = v.clickTargets.reduce((sum, c) => sum + c.count, 0) * 0.1;
    const raw = Math.round((timeScore + v.maxScrollDepth * 0.3 + clickScore) * 100);
    const score = Math.min(raw, 100);
    const topic = v.title || v.path;
    const current = byTopic.get(topic);
    if (!current || current.score < score) byTopic.set(topic, { score, source: v.url });
  }
  return [...byTopic.entries()]
    .map(([topic, { score, source }]) => ({ topic, score, source }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

// --- Pure: intent inference ------------------------------------------------

const INTENT_CATEGORIES = ['exploring', 'researching', 'comparing', 'purchase', 'deal-seeking', 'support'];

const INTENT_META = {
  exploring: { label: 'Exploring', description: 'Surface variety' },
  researching: { label: 'Researching', description: 'Surface details' },
  comparing: { label: 'Comparing', description: 'Highlight differences' },
  purchase: { label: 'Purchase consideration', description: 'Surface pricing' },
  'deal-seeking': { label: 'Deal seeking', description: 'Surface promotions' },
  support: { label: 'Support', description: 'Surface help content' },
};

// Click-text → intent signals.
const CLICK_TEXT_SIGNALS = [
  { pattern: /buy|purchase|add to cart|order|checkout/i, category: 'purchase', weight: 0.9 },
  { pattern: /price|pricing|cost|payment|finance|configure|get started/i, category: 'purchase', weight: 0.7 },
  { pattern: /specifications|specs|technical|datasheet/i, category: 'researching', weight: 0.7 },
  { pattern: /review|rating|testimonial|case study/i, category: 'researching', weight: 0.6 },
  { pattern: /details|features|how it works/i, category: 'researching', weight: 0.4 },
  { pattern: /compare|versus|vs\b|alternatives/i, category: 'comparing', weight: 0.8 },
  { pattern: /see all|view all|show more|browse/i, category: 'exploring', weight: 0.5 },
  { pattern: /learn more|read more|discover|explore/i, category: 'exploring', weight: 0.4 },
  { pattern: /deal|sale|discount|offer|promo|coupon|save/i, category: 'deal-seeking', weight: 0.8 },
  { pattern: /help|support|contact|faq|question|troubleshoot/i, category: 'support', weight: 0.8 },
  { pattern: /popular|trending|recommended|top picks/i, category: 'exploring', weight: 0.5 },
];

// URL-path → intent signals.
const URL_PATH_SIGNALS = [
  { pattern: /\/(cart|checkout|buy|order|configure|payment|pricing)/i, category: 'purchase', weight: 0.9 },
  { pattern: /\/(specs|specifications|features|review|details)/i, category: 'researching', weight: 0.7 },
  { pattern: /\/(compare|comparison|vs|versus)/i, category: 'comparing', weight: 0.9 },
  { pattern: /\/(deals?|sale|offers?|promo|discount)/i, category: 'deal-seeking', weight: 0.8 },
  { pattern: /\/(help|support|faq|contact|warranty)/i, category: 'support', weight: 0.8 },
];

function clickAndPathSignals(visits) {
  const out = [];
  for (const v of visits) {
    for (const click of v.clickTargets) {
      for (const { pattern, category, weight } of CLICK_TEXT_SIGNALS) {
        if (pattern.test(click.text)) {
          out.push({ source: `click: "${click.text.slice(0, 40)}"`, category, weight: (weight * Math.min(click.count, 3)) / 3 });
          break;
        }
      }
    }
    for (const { pattern, category, weight } of URL_PATH_SIGNALS) {
      if (pattern.test(v.path)) {
        out.push({ source: `url: ${v.path}`, category, weight });
        break;
      }
    }
  }
  return out;
}

function engagementSignals(visits) {
  const out = [];
  const avgDwell = visits.reduce((sum, v) => sum + v.dwellTimeMs, 0) / visits.length;
  const avgScroll = visits.reduce((sum, v) => sum + v.maxScrollDepth, 0) / visits.length;
  if (avgDwell > 30000 && avgScroll > 0.6) {
    out.push({ source: `engagement: avg ${Math.round(avgDwell / 1000)}s dwell, ${Math.round(avgScroll * 100)}% scroll`, category: 'researching', weight: 0.7 });
  }
  if (visits.length >= 4 && avgDwell < 15000) {
    out.push({ source: `engagement: ${visits.length} pages, avg ${Math.round(avgDwell / 1000)}s dwell`, category: 'exploring', weight: 0.6 });
  }
  const counts = new Map();
  for (const v of visits) counts.set(v.url, (counts.get(v.url) || 0) + 1);
  const revisited = [...counts.values()].filter((c) => c > 1).length;
  if (revisited >= 2) {
    out.push({ source: `engagement: ${revisited} pages revisited`, category: 'comparing', weight: 0.5 });
  }
  return out;
}

function trajectorySignals(visits) {
  const out = [];
  const kinds = visits.map((v) => {
    if (v.path === '/' || v.path === '') return 'homepage';
    return v.path.split('/').filter(Boolean).length === 1 ? 'category' : 'product';
  });
  const hasHome = kinds.includes('homepage');
  const hasCategory = kinds.includes('category');
  const products = kinds.filter((k) => k === 'product').length;
  if (hasHome && (hasCategory || products > 0)) {
    out.push({ source: 'trajectory: homepage → category/product funnel', category: 'purchase', weight: 0.5 + products * 0.1 });
  }
  if (products >= 2) {
    out.push({ source: `trajectory: ${products} product pages visited`, category: 'comparing', weight: 0.4 + products * 0.15 });
  }
  if (visits.length >= 3) {
    const third = Math.ceil(visits.length / 3);
    const lastThird = visits.slice(-third);
    const firstThird = visits.slice(0, third);
    const lastAvg = lastThird.reduce((sum, v) => sum + v.dwellTimeMs, 0) / lastThird.length;
    const firstAvg = firstThird.reduce((sum, v) => sum + v.dwellTimeMs, 0) / firstThird.length;
    if (lastAvg > firstAvg * 2) {
      out.push({ source: 'trajectory: dwell time increasing (narrowing focus)', category: 'researching', weight: 0.5 });
    }
  }
  return out;
}

// Sums signal weights per category and normalizes to 0–100. When there are no
// signals every score is 0 and `exploring` stays first (stable order).
function rankIntents(signals) {
  const totals = new Map(INTENT_CATEGORIES.map((cat) => [cat, { total: 0, signals: [] }]));
  for (const signal of signals) {
    const bucket = totals.get(signal.category);
    if (bucket) {
      bucket.total += signal.weight;
      bucket.signals.push(signal.source);
    }
  }
  const max = Math.max(...[...totals.values()].map((b) => b.total), 0.01);
  return INTENT_CATEGORIES
    .map((cat) => {
      const bucket = totals.get(cat);
      return {
        category: cat,
        score: Math.round((bucket.total / max) * 100),
        label: INTENT_META[cat].label,
        description: INTENT_META[cat].description,
        signals: bucket.signals,
      };
    })
    .sort((a, b) => b.score - a.score);
}

// The intent profile for a set of visits. `personaSignals` (optional, from tenant
// config we don't fetch here) default to none — inference is fully behavioral.
export function deriveIntent(visits, personaSignals = []) {
  const signals = (personaSignals || [])
    .map((s) => ({ source: s.source, category: s.category, weight: s.weight }));
  signals.push(...clickAndPathSignals(visits));
  if (visits.length > 0) {
    signals.push(...engagementSignals(visits));
    signals.push(...trajectorySignals(visits));
  }
  const intents = rankIntents(signals);
  return {
    intents, topIntent: intents[0].category, topScore: intents[0].score, updatedAt: Date.now(),
  };
}

// --- Pure: profile model ---------------------------------------------------

export function emptyProfile(domain) {
  return {
    domain, pageVisits: [], interests: [], inferredIntent: '', totalTimeMs: 0, updatedAt: Date.now(),
  };
}

function mergeClicks(existing, incoming) {
  const map = new Map();
  for (const click of existing) map.set(click.selector, { ...click });
  for (const click of incoming) {
    const current = map.get(click.selector);
    if (current) current.count += click.count;
    else map.set(click.selector, { ...click });
  }
  return [...map.values()];
}

// Folds a freshly-tracked visit into the domain profile: same URL accumulates
// (sum dwell, max scroll, merged clicks, unioned focus), a new URL appends. Then
// recomputes interests + intent over all visits.
export function mergeVisit(profile, visit, personaSignals = []) {
  const idx = profile.pageVisits.findIndex((v) => v.url === visit.url);
  let pageVisits;
  if (idx < 0) {
    pageVisits = [...profile.pageVisits, visit];
  } else {
    const prev = profile.pageVisits[idx];
    const merged = prev.visitedAt === visit.visitedAt ? visit : {
      ...prev,
      dwellTimeMs: prev.dwellTimeMs + visit.dwellTimeMs,
      maxScrollDepth: Math.max(prev.maxScrollDepth, visit.maxScrollDepth),
      clickTargets: mergeClicks(prev.clickTargets, visit.clickTargets),
      focusAreas: [...new Set([...prev.focusAreas, ...visit.focusAreas])],
      visitedAt: visit.visitedAt,
    };
    pageVisits = profile.pageVisits.map((v, i) => (i === idx ? merged : v));
  }
  const interests = deriveInterests(pageVisits);
  return {
    ...profile,
    pageVisits,
    interests,
    inferredIntent: interests.length > 0 ? interests[0].topic : 'Exploring',
    intentProfile: deriveIntent(pageVisits, personaSignals),
    totalTimeMs: pageVisits.reduce((sum, v) => sum + v.dwellTimeMs, 0),
    updatedAt: Date.now(),
  };
}

// --- Pure: entry / source attribution --------------------------------------

const LLM_HOSTS = {
  'chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'claude.ai': 'Claude',
  'perplexity.ai': 'Perplexity',
  'gemini.google.com': 'Gemini',
  'copilot.microsoft.com': 'Copilot',
};

const SOCIAL_HOSTS = [
  { match: /facebook\.com$/, label: 'Facebook' },
  { match: /instagram\.com$/, label: 'Instagram' },
  { match: /tiktok\.com$/, label: 'TikTok' },
  { match: /pinterest\./, label: 'Pinterest' },
  { match: /(twitter\.com|x\.com)$/, label: 'X (Twitter)' },
  { match: /reddit\.com$/, label: 'Reddit' },
  { match: /linkedin\.com$/, label: 'LinkedIn' },
  { match: /snapchat\.com$/, label: 'Snapchat' },
];

const SEARCH_HOSTS = [
  { match: /google\./, label: 'Google (Organic)' },
  { match: /bing\.com$/, label: 'Bing (Organic)' },
  { match: /duckduckgo\.com$/, label: 'DuckDuckGo' },
  { match: /yahoo\./, label: 'Yahoo (Organic)' },
];

const stripWww = (host) => host.replace(/^www\./, '');
const matchHost = (host, table) => table.find((t) => t.match.test(host))?.label;

// Referrer host + tracking params from the entry referrer/query string.
export function parseReferrer(referrer = '', search = '', currentHost = '') {
  const params = new URLSearchParams(search);
  let referrerHost = '';
  try {
    referrerHost = referrer ? stripWww(new URL(referrer).hostname.toLowerCase()) : '';
  } catch {
    referrerHost = '';
  }
  return {
    referrerHost,
    referrerUrl: (referrer || '').toLowerCase(),
    currentHost: currentHost ? stripWww(currentHost.toLowerCase()) : undefined,
    gclid: params.get('gclid') || undefined,
    fbclid: params.get('fbclid') || undefined,
    msclkid: params.get('msclkid') || undefined,
    utmSource: params.get('utm_source') || undefined,
    utmMedium: params.get('utm_medium') || undefined,
    utmCampaign: params.get('utm_campaign') || undefined,
    utmTerm: params.get('utm_term') || undefined,
    utmContent: params.get('utm_content') || undefined,
    llmAppCtx: params.get('llm_app_ctx') || undefined,
  };
}

const isShopping = (p) => !!(
  p.utmSource === 'google_shopping'
  || /\/shopping/.test(p.referrerUrl)
  || /shopping\.google\./.test(p.referrerHost)
  || (p.utmCampaign && /shopping/i.test(p.utmCampaign))
);

const isPaid = (p) => !!(p.gclid || p.fbclid || p.msclkid || (p.utmMedium && /^(cpc|ppc|paid)$/i.test(p.utmMedium)));

const isEmail = (p) => p.utmMedium?.toLowerCase() === 'email';

function adNetworkLabel(p) {
  if (p.gclid) return 'Google Ads';
  if (p.fbclid) return 'Facebook Ads';
  if (p.msclkid) return 'Bing Ads';
  if (/google\./.test(p.referrerHost)) return 'Google Ads';
  if (/facebook\.com$/.test(p.referrerHost)) return 'Facebook Ads';
  if (/bing\.com$/.test(p.referrerHost)) return 'Bing Ads';
  return 'Paid Ads';
}

// Classifies an entry into a source channel + label.
export function classifySource(parsed) {
  if (parsed.llmAppCtx) return { source: 'ai', label: 'ChatGPT' };
  if (isShopping(parsed)) return { source: 'shopping', label: 'Google Shopping' };
  if (isPaid(parsed)) return { source: 'ads', label: adNetworkLabel(parsed) };
  if (isEmail(parsed)) return { source: 'email', label: 'E-Mail' };
  if (parsed.referrerHost && LLM_HOSTS[parsed.referrerHost]) return { source: 'ai', label: LLM_HOSTS[parsed.referrerHost] };
  if (parsed.utmSource && LLM_HOSTS[parsed.utmSource]) return { source: 'ai', label: LLM_HOSTS[parsed.utmSource] };
  const social = parsed.referrerHost ? matchHost(parsed.referrerHost, SOCIAL_HOSTS) : undefined;
  if (social) return { source: 'social', label: social };
  const search = parsed.referrerHost ? matchHost(parsed.referrerHost, SEARCH_HOSTS) : undefined;
  if (search) return { source: 'organic-search', label: search };
  if (!parsed.referrerHost && !parsed.utmSource && !parsed.utmMedium && !parsed.utmCampaign) {
    return { source: 'direct', label: 'Direct' };
  }
  if (parsed.referrerHost && parsed.referrerHost !== parsed.currentHost) {
    return { source: 'referral', label: parsed.referrerHost };
  }
  return { source: 'direct', label: 'Direct' };
}

// The stored entry context: source channel + label + tracking params.
export function buildEntryContext(referrer, search, capturedAt = Date.now(), currentHost = '') {
  const parsed = parseReferrer(referrer, search, currentHost);
  const { source, label } = classifySource(parsed);
  return {
    source,
    label,
    referrer: referrer || undefined,
    utmSource: parsed.utmSource,
    utmMedium: parsed.utmMedium,
    utmCampaign: parsed.utmCampaign,
    utmTerm: parsed.utmTerm,
    utmContent: parsed.utmContent,
    injectedContext: parsed.llmAppCtx,
    capturedAt,
  };
}

// --- Persistence -----------------------------------------------------------

// In-memory fallback for when localStorage is unavailable (private mode / disabled).
const memoryStore = new Map();

function rawGet(key) {
  try {
    const value = window.localStorage.getItem(key);
    if (value !== null) return value;
  } catch { /* fall through to memory */ }
  return memoryStore.has(key) ? memoryStore.get(key) : null;
}

function rawSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    memoryStore.delete(key);
  } catch {
    memoryStore.set(key, value);
  }
}

function readAll() {
  try {
    const raw = rawGet(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function currentDomain() {
  try {
    return stripWww(window.location.hostname);
  } catch {
    return '';
  }
}

// The stored behavior profile for a domain, or null.
export function readProfile(domain = currentDomain()) {
  return readAll()[domain] || null;
}

function writeProfile(profile) {
  const all = readAll();
  all[profile.domain] = profile;
  rawSet(STORAGE_KEY, JSON.stringify(all));
}

// Alias used by consumers (pzn) reading the current-domain profile.
export function getIntentProfile(domain = currentDomain()) {
  return readProfile(domain);
}

const JOURNEY_STAGE = {
  exploring: 'awareness',
  researching: 'consideration',
  comparing: 'consideration',
  purchase: 'decision',
  'deal-seeking': 'decision',
  support: 'retention',
};

// A flat, decision-friendly context object for the pzn/ixp request (mirrors the
// flattened OF1 signal shape). Returns null when there's no profile yet.
export function buildIntentContext(profile) {
  if (!profile) return null;
  const interests = Array.isArray(profile.interests) ? profile.interests : [];
  const visits = Array.isArray(profile.pageVisits) ? profile.pageVisits : [];
  const topIntent = profile.intentProfile?.topIntent || profile.inferredIntent || 'exploring';
  return {
    topInterests: interests.map((i) => i.topic).filter(Boolean).slice(0, 5),
    topIntent,
    journeyStage: JOURNEY_STAGE[topIntent] || '',
    pagesViewed: visits.map((v) => v.path).filter(Boolean).slice(0, 10),
    entrySource: profile.entryContext?.source || '',
  };
}

// Merges a tracked visit into its domain profile and persists it. Captures the
// entry context once, on the first visit for the domain (when the referrer is
// still the external one). Fail-open.
function trackVisit(visit) {
  try {
    let domain;
    try {
      domain = stripWww(new URL(visit.url).hostname);
    } catch {
      domain = currentDomain();
    }
    let profile = mergeVisit(readProfile(domain) || emptyProfile(domain), visit);
    if (!profile.entryContext) {
      profile = {
        ...profile,
        entryContext: buildEntryContext(
          document.referrer,
          window.location.search,
          Date.now(),
          domain,
        ),
      };
    }
    writeProfile(profile);
  } catch { /* never break the page */ }
}

// --- Behavior tracker ------------------------------------------------------

// Observes the current page and calls `onVisit(visit)` on flush (periodic, on
// SPA navigation, and on unload). Only emits after MIN_DWELL_TIME_MS. Returns a
// stop function. SPA-aware via popstate + an href poll.
export function createVisitTracker(onVisit) {
  let visit = null;
  let removeListeners = null;

  function buildVisit() {
    if (!visit || Date.now() - visit.startTime < MIN_DWELL_TIME_MS) return null;
    return {
      url: visit.url,
      path: visit.path,
      title: visit.title,
      dwellTimeMs: Date.now() - visit.startTime,
      maxScrollDepth: visit.scrollDepth,
      clickTargets: [...visit.clicks.values()],
      focusAreas: [...visit.focusAreas],
      visitedAt: visit.startTime,
    };
  }

  function flush() {
    const v = buildVisit();
    if (v) onVisit(v);
  }

  function clearTimers() {
    if (visit?.focusInterval) clearInterval(visit.focusInterval);
    if (visit?.flushInterval) clearInterval(visit.flushInterval);
    if (visit?.scrollTimer) clearTimeout(visit.scrollTimer);
    if (removeListeners) removeListeners();
  }

  function start() {
    flush();
    clearTimers();
    visit = {
      url: window.location.href,
      path: window.location.pathname,
      title: document.title,
      startTime: Date.now(),
      scrollDepth: 0,
      clicks: new Map(),
      focusAreas: new Set(),
      scrollTimer: null,
      focusInterval: null,
      flushInterval: null,
    };

    const onScroll = () => {
      if (!visit) return;
      if (visit.scrollTimer) clearTimeout(visit.scrollTimer);
      visit.scrollTimer = window.setTimeout(() => {
        if (!visit) return;
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        if (scrollable > 0) {
          visit.scrollDepth = Math.max(visit.scrollDepth, window.scrollY / scrollable);
        }
      }, SCROLL_DEBOUNCE_MS);
    };

    const onClick = (e) => {
      if (!visit) return;
      const node = e.target;
      if (!node) return;
      const el = node.closest('a, button, [role="button"], input[type="submit"]') || node;
      const selector = stableSelector(el);
      const entry = visit.clicks.get(selector);
      if (entry) entry.count += 1;
      else visit.clicks.set(selector, { selector, text: el.textContent?.trim().slice(0, 100) || '', count: 1 });
    };

    const focusInterval = window.setInterval(() => {
      if (!visit) return;
      document.querySelectorAll('section, [role="region"], article, main').forEach((section) => {
        const rect = section.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.8 && rect.bottom > window.innerHeight * 0.2) {
          const heading = sectionHeading(section);
          if (heading) visit.focusAreas.add(heading);
        }
      });
    }, FOCUS_SAMPLE_INTERVAL_MS);

    const flushInterval = window.setInterval(flush, FLUSH_INTERVAL_MS);

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('click', onClick, true);
    visit.focusInterval = focusInterval;
    visit.flushInterval = flushInterval;
    removeListeners = () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('click', onClick, true);
    };
  }

  function onLocationChange() {
    if (visit && visit.url !== window.location.href) {
      flush();
      clearTimers();
      setTimeout(start, 500);
    }
  }

  window.addEventListener('popstate', onLocationChange);
  let lastHref = window.location.href;
  const hrefPoll = window.setInterval(() => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      onLocationChange();
    }
  }, 500);
  window.addEventListener('beforeunload', () => { if (visit) flush(); });

  start();

  return () => {
    flush();
    clearTimers();
    clearInterval(hrefPoll);
  };
}

let started = false;

// Starts behavior tracking for the current page. Idempotent, fail-open.
export function initOf1Intent() {
  if (started) return;
  started = true;
  try {
    createVisitTracker(trackVisit);
  } catch { /* never break the page */ }
}
