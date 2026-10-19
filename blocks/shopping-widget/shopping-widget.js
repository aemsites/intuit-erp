/**
 * shopping-widget — a tabbed pricing grid: one group of product cards per
 * audience tab, plus an optional "Intuit Intelligence" chrome override and a
 * static step-flow scaffold. Cards themselves are rendered by the shared
 * scripts/pricing-card-render.js, the same module blocks/pricing-cards uses,
 * so the two blocks' cards cannot drift apart.
 *
 * Backed by the same per-product commerce JSON as pricing-cards: each
 * authored sku is fetched independently at PRODUCT_PATH(sku).json via the
 * shared, fetch-once-per-url, never-reject cache in scripts/product-bus.js's
 * loadProduct() — one request per sku across every tab, in parallel, not one
 * shared index. The real content's URL path segment matches the sku exactly
 * (unlike this project's earlier test fixtures, where paths like
 * `test-product1` were decoupled from their sku).
 *
 * The product pipeline lives on a different host
 * (main--erp--intuit.aem.network) than the page content
 * (main--erp--intuit.aem.page/.aem.live) and sends no
 * Access-Control-Allow-Origin header, so a direct cross-origin fetch to the
 * absolute aem.network URL is blocked by CORS in a real browser. Using a
 * root-relative path instead means the browser only ever talks to the page's
 * own origin — same-origin, no CORS — and requires a server-side same-origin
 * rewrite rule mapping this path prefix to aem.network (the platform/CDN
 * config that makes this work, analogous to how aem-cli's local dev proxy —
 * pointed at aem.network via AEM_PAGES_URL in .env — forwards this same path
 * during local testing; the rewrite needs to cover every sku's leaf under the
 * prefix, not just one path). Per-product JSON shape (flat, not schema.org
 * JSON-LD):
 *   { sku, url, title, path, description, price, strikethroughprice,
 *     brand, image, lastModified }
 * `price` is the current/discounted price; `strikethroughprice` (if present
 * and different) is the original price shown struck through. `description`
 * may contain inline HTML and is rendered as such, not escaped — the product
 * pipeline is a trusted, commerce-controlled source, not arbitrary user input.
 *
 * Content model: this DA setup only supports a flat two-column key/value
 * table per block (column 1 = field key, column 2 = field value) — there is
 * no multi-column row authoring and no way to repeat a row shape. Read via
 * the project's standard scripts/aem.js readBlockConfig(), which kebab-cases
 * each key (`toClassName`) and, for a value cell containing multiple <p>
 * elements, returns an array of their text instead of one string — the
 * mechanism this block uses for bulleted fields (aiLabel/features), one <p>
 * per bullet, rather than authoring a <ul>.
 *
 * Repetition (multiple tabs, multiple skus per tab, multiple steps) is
 * encoded with a numbered key prefix, since every key in one flat table must
 * be unique — there is no other way to express "N of these" in this shape.
 * Keys, kebab-case as typed by the author (shown here already kebab-cased):
 *   tab{N}-title, tab{N}-subtitle
 *   tab{N}-sku{M}            (required; the sku id itself is the value)
 *   tab{N}-sku{M}-badge, -featured ("yes"), -cta-label, -cta-url,
 *   tab{N}-sku{M}-ai-label (<p> per bullet), -ai-link,
 *   tab{N}-sku{M}-features (<p> per bullet), -title-badge
 *   step{S}-title, step{S}-subtitle, step{S}-active ("yes")
 *   ai-heading, ai-play-text, ai-icon, ai-subtitle
 * N, M, and S each start at 1 and must be contiguous — the parser stops
 * scanning a given prefix at the first missing index, so e.g. tab1 and tab3
 * with no tab2 silently drops tab3. `tab{N}-sku{M}` with no value for that
 * key ends that tab's sku list at `M-1`, the same way. A tab's id is never
 * authored — it is derived as `tab-${slugified tab{N}-title}`.
 *
 * Style choices are block variants, not content — selected by the author via
 * the block name's parenthetical suffix (e.g. "ShoppingWidget
 * (title-badge-own-row, outline-cta)"):
 *   - outline-cta / inline-price: same meaning as in pricing-cards.
 *   - title-badge-own-row: stacks the title badge above the product name
 *     instead of inline at the end of the name row (CSS only — identical DOM).
 *   - title-badge-orange (default) / title-badge-green / title-badge-blue:
 *     the badge's color treatment, which is never authored content.
 *
 * Personalization: follows event-spotlight's content-personalisation pattern
 * (see that block + scripts/experience.js's collectSlots/applyPznSlot). To
 * enable it, author ALL THREE on the SECTION (never the block — an AEM block's
 * content schema may strip arbitrary attributes): data-pzn="<access-point>",
 * data-pzn-block="shopping-widget", and
 * data-pzn-block-type="content-personalisation". The experience layer then
 * stamps data-pzn-resolved-id onto this block and re-invokes decorate().
 * Two payload shapes are accepted, both JSON-encoded in that attribute:
 *   tab-keyed (primary) — per-tab independence, the key property:
 *     {"tabs":{"tab-small-business":{"skus":["qbo-plus"],"featured":"qbo-plus"}},
 *      "activeTab":"tab-small-business"}
 *     A tab named in `tabs` has its sku list and featured sku FULLY REPLACED
 *     for that render; a tab absent from the map keeps its authored rows
 *     untouched. `activeTab` optionally picks which tab opens first.
 *   legacy single-list (pricing-cards parity):
 *     {"skus":["qbo-plus"],"featured":"qbo-plus"}
 *     Applied to the active tab only, leaving other tabs untouched.
 * Authored rows remain the fallback whenever the attribute is absent or fails
 * to parse/validate — a page with no data-pzn authored never queries
 * personalization at all. decorate() is idempotent: it clears the block and
 * re-reads its rows from a cached snapshot, so the post-stamp re-render
 * produces the same result as a first render with the stamp already present.
 *
 * CSS: blocks/shopping-widget/shopping-widget.css
 */
import { readBlockConfig, toClassName } from '../../scripts/aem.js';
import { loadProduct } from '../../scripts/product-bus.js';
import { trackAs } from '../../scripts/tracking.js';
import { defaultPlan, renderCardForPlan } from '../../scripts/pricing-card-render.js';

// {sku} is substituted directly — the real content's path segment matches
// its sku, per-product, not a shared index keyed separately by path.
const PRODUCT_PATH = (sku) => `/drafts/megha/us/products/test/${sku}.json`;

const AI_DEFAULTS = { title: 'Intuit Intelligence', playButtonText: 'See how it works' };

// decorate() empties the block to render, so a second invocation (after
// experience.js stamps data-pzn-resolved-id) would otherwise find no rows to
// read. Snapshot the authored content model on the first pass, keyed by the
// block element, and reuse it for every subsequent render.
const authoredCache = new WeakMap();

function slugifyTabId(title) {
  return `tab-${title.trim().toLowerCase().replace(/\s+/g, '-')}`;
}

function configText(config, key) {
  const value = config[key];
  return Array.isArray(value) ? value[0] ?? '' : (value || '').toString().trim();
}

function isYes(value) {
  return value.trim().toLowerCase() === 'yes';
}

// Bulleted fields (ai-label/features) are authored either as a <ul><li>
// list (DA's rich-text editor default) or as one <p> per bullet
// (readBlockConfig()'s own multi-value convention, used by key/value blocks
// elsewhere in this project). readBlockConfig() only special-cases <p>/<a>/
// <img> cells, so a <ul> cell falls through to plain textContent and loses
// its bullet boundaries — this reads the raw value cell directly to support
// both authoring styles.
function readBulletCell(block, key) {
  const row = [...block.children].find(
    (r) => toClassName(r.children[0]?.textContent) === key,
  );
  const cell = row?.children[1];
  if (!cell) return [];
  const items = [...cell.querySelectorAll('li')];
  if (items.length) return items.map((li) => li.textContent.trim()).filter(Boolean);
  const paragraphs = [...cell.querySelectorAll('p')];
  const source = paragraphs.length ? paragraphs : [cell];
  return source.map((el) => el.textContent.trim()).filter(Boolean);
}

// Reads tab{N}-sku{M}* keys for one tab index. Stops at the first missing
// sku{M} — sku indices must be contiguous starting at 1, same as tabs/steps.
function readSkusForTab(block, config, tabIndex) {
  const plans = [];
  for (let m = 1; ; m += 1) {
    const prefix = `tab${tabIndex}-sku${m}`;
    const sku = configText(config, prefix);
    if (!sku) break;
    plans.push({
      sku,
      badge: configText(config, `${prefix}-badge`),
      featuredFlag: configText(config, `${prefix}-featured`),
      ctaLabel: configText(config, `${prefix}-cta-label`),
      ctaUrl: configText(config, `${prefix}-cta-url`),
      aiLabelCell: readBulletCell(block, `${prefix}-ai-label`),
      aiLink: configText(config, `${prefix}-ai-link`),
      featuresCell: readBulletCell(block, `${prefix}-features`),
      titleBadge: configText(config, `${prefix}-title-badge`),
    });
  }
  return plans;
}

/**
 * Parses the block's flat key/value config into its content model. Tab, sku,
 * and step indices must each be contiguous starting at 1 — scanning for a
 * given prefix stops at the first missing index.
 * @param {Element} block
 * @returns {{tabs: Array, steps: Array, ai: object}}
 */
function readContentModel(block) {
  const config = readBlockConfig(block);

  const tabs = [];
  for (let n = 1; ; n += 1) {
    const title = configText(config, `tab${n}-title`);
    const plans = readSkusForTab(block, config, n);
    // A tab needs a title or at least one sku to exist; an entirely empty
    // tab{n} ends the scan rather than producing a blank tab.
    if (!title && !plans.length) break;
    tabs.push({
      id: title ? slugifyTabId(title) : `tab-${n}`,
      title,
      subTitle: configText(config, `tab${n}-subtitle`),
      implicit: false,
      plans,
    });
  }

  const steps = [];
  for (let s = 1; ; s += 1) {
    const title = configText(config, `step${s}-title`);
    const subtitle = configText(config, `step${s}-subtitle`);
    const active = configText(config, `step${s}-active`);
    if (!title && !subtitle && !active) break;
    steps.push({ title, subtitle, active: isYes(active) });
  }

  const ai = {
    title: configText(config, 'ai-heading') || AI_DEFAULTS.title,
    playButtonText: configText(config, 'ai-play-text') || AI_DEFAULTS.playButtonText,
    titleIcon: configText(config, 'ai-icon'),
    subtitle: configText(config, 'ai-subtitle'),
  };

  return { tabs, steps, ai };
}

function normalizeSkuList(value) {
  return Array.isArray(value)
    ? value.map((s) => String(s).trim()).filter(Boolean)
    : [];
}

function normalizeFeatured(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Parses and validates a personalization decision stamped on the block by
 * scripts/experience.js's content-personalisation apply-shape. Accepts both
 * the tab-keyed shape and the legacy single-list shape, normalizing the latter
 * into `{tabs: null, legacy: {...}}` so the caller has one code path. Returns
 * null for anything not immediately usable (absent, malformed JSON, no usable
 * skus anywhere) so the caller can fall back to authored rows without special
 * cases. Never throws.
 * @param {Element} block
 * @returns {{tabs: Object<string, {skus: string[], featured: string|null}>|null,
 *   legacy: {skus: string[], featured: string|null}|null,
 *   activeTab: string|null}|null}
 */
function readPersonalizedSelection(block) {
  const raw = block.dataset.pznResolvedId;
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const activeTab = normalizeFeatured(parsed.activeTab);

  if (parsed.tabs && typeof parsed.tabs === 'object' && !Array.isArray(parsed.tabs)) {
    const tabs = {};
    Object.entries(parsed.tabs).forEach(([id, entry]) => {
      const skus = normalizeSkuList(entry?.skus);
      // An entry resolving to zero usable skus is dropped rather than
      // blanking that tab — the tab keeps its authored rows.
      if (skus.length) tabs[id] = { skus, featured: normalizeFeatured(entry?.featured) };
    });
    if (!Object.keys(tabs).length && !activeTab) return null;
    return { tabs, legacy: null, activeTab };
  }

  const skus = normalizeSkuList(parsed.skus);
  if (!skus.length) return null;
  return {
    tabs: null,
    legacy: { skus, featured: normalizeFeatured(parsed.featured) },
    activeTab,
  };
}

/**
 * Applies a resolved sku list to one tab: selection and order come entirely
 * from personalization, with authored marketing fields reused for any sku that
 * also has an authored row (and bare defaults for one that doesn't). A
 * personalization-chosen featured sku overrides whichever sku, if any, the
 * author marked featured — a per-render decision, not an edit to the row.
 */
function applySelection(tab, selection) {
  const authoredBySku = new Map(tab.plans.map((plan) => [plan.sku, plan]));
  const plans = selection.skus.map((sku) => authoredBySku.get(sku) || defaultPlan(sku));
  return {
    ...tab,
    plans: selection.featured
      ? plans.map((plan) => ({
        ...plan,
        featuredFlag: plan.sku === selection.featured ? 'Yes' : '',
      }))
      : plans,
  };
}

function buildGrid(tab, bySku, ai) {
  const grid = document.createElement('div');
  grid.className = 'pc-grid';
  grid.style.setProperty('--pc-cols', tab.plans.length);
  grid.append(...tab.plans.map((plan) => renderCardForPlan(plan, bySku, ai)));
  return grid;
}

/**
 * The tab bar and its panels, wired with the WAI-ARIA tabs pattern: roving
 * tabindex (only the selected tab is focusable), Enter/Space to activate, and
 * ArrowLeft/ArrowRight to move between tabs with wraparound. A single tab is
 * not a control, so the tab bar is omitted entirely for one tab (and for the
 * implicit no-tabs-authored case) — the panel renders bare.
 */
function buildTabs(tabs, activeIndex, bySku, ai, uid) {
  const fragment = document.createDocumentFragment();
  const showTabBar = tabs.length > 1;

  const panels = tabs.map((tab, i) => {
    const panel = document.createElement('div');
    panel.className = 'sw-panel';
    panel.id = `${uid}-${tab.id}`;
    if (showTabBar) {
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `${uid}-${tab.id}-tab`);
      panel.tabIndex = 0;
    }
    panel.hidden = i !== activeIndex;
    // A tab with zero sku rows shows an empty grid, not error chrome.
    panel.append(buildGrid(tab, bySku, ai));
    return panel;
  });

  if (!showTabBar) {
    panels.forEach((panel) => fragment.append(panel));
    return fragment;
  }

  const tabList = document.createElement('div');
  tabList.className = 'sw-tab-list';
  tabList.setAttribute('role', 'tablist');

  const buttons = tabs.map((tab, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sw-tab';
    button.id = `${uid}-${tab.id}-tab`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `${uid}-${tab.id}`);
    button.setAttribute('aria-selected', String(i === activeIndex));
    button.tabIndex = i === activeIndex ? 0 : -1;

    const title = document.createElement('span');
    title.className = 'sw-tab-title';
    title.textContent = tab.title;
    button.append(title);

    if (tab.subTitle) {
      const subTitle = document.createElement('span');
      subTitle.className = 'sw-tab-subtitle';
      subTitle.textContent = tab.subTitle;
      button.append(subTitle);
    }
    return button;
  });

  const select = (next, focus) => {
    buttons.forEach((button, i) => {
      const selected = i === next;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      panels[i].hidden = !selected;
    });
    if (focus) buttons[next].focus();
  };

  buttons.forEach((button, i) => {
    button.addEventListener('click', () => select(i, false));
    button.addEventListener('keydown', (event) => {
      // Enter/Space activate; browsers already fire click for both on a
      // <button>, so only the arrow keys need handling here.
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        select((i + delta + buttons.length) % buttons.length, true);
      }
    });
    tabList.append(button);
  });

  fragment.append(tabList);
  panels.forEach((panel) => fragment.append(panel));
  return fragment;
}

/**
 * The step flow: a static visual scaffold only — no edit buttons, no click
 * handlers, no completed state, no navigation. The first step flagged active
 * wins; when none is flagged, no step is marked (we never default to step 0).
 */
function buildStepFlow(steps) {
  if (!steps.length) return null;
  const activeIndex = steps.findIndex((step) => step.active);

  const list = document.createElement('ol');
  list.className = 'sw-steps';

  steps.forEach((step, i) => {
    const item = document.createElement('li');
    item.className = 'sw-step';
    if (i === activeIndex) {
      item.classList.add('sw-step-active');
      item.setAttribute('aria-current', 'step');
    }

    const circle = document.createElement('div');
    circle.className = 'sw-step-circle';
    circle.setAttribute('aria-hidden', 'true');
    circle.textContent = String(i + 1);
    item.append(circle);

    const content = document.createElement('div');
    content.className = 'sw-step-content';
    if (step.title) {
      const title = document.createElement('p');
      title.className = 'sw-step-title';
      title.textContent = step.title;
      content.append(title);
    }
    if (step.subtitle) {
      const subtitle = document.createElement('p');
      subtitle.className = 'sw-step-subtitle';
      subtitle.textContent = step.subtitle;
      content.append(subtitle);
    }
    item.append(content);

    // A divider sits between items, never after the last one.
    if (i < steps.length - 1) {
      const divider = document.createElement('div');
      divider.className = 'sw-step-divider';
      divider.setAttribute('aria-hidden', 'true');
      item.append(divider);
    }

    list.append(item);
  });

  return list;
}

let uidCounter = 0;

export default async function decorate(block) {
  if (!authoredCache.has(block)) authoredCache.set(block, readContentModel(block));
  const { tabs: authoredTabs, steps, ai } = authoredCache.get(block);

  if (!block.dataset.swUid) {
    uidCounter += 1;
    block.dataset.swUid = `sw-${uidCounter}`;
  }
  const uid = block.dataset.swUid;

  const personalized = readPersonalizedSelection(block);

  // activeTab resolution: an unknown id falls back to the first authored tab.
  const requestedIndex = personalized?.activeTab
    ? authoredTabs.findIndex((tab) => tab.id === personalized.activeTab)
    : -1;
  const activeIndex = requestedIndex >= 0 ? requestedIndex : 0;

  let tabs = authoredTabs;
  if (personalized?.tabs) {
    // Per-tab independence: only tabs named in the map are replaced. An
    // unknown tab id in the map simply matches nothing and is ignored.
    tabs = authoredTabs.map((tab) => (
      personalized.tabs[tab.id] ? applySelection(tab, personalized.tabs[tab.id]) : tab
    ));
  } else if (personalized?.legacy) {
    // Legacy single-list shape applies to the active tab only.
    tabs = authoredTabs.map((tab, i) => (
      i === activeIndex ? applySelection(tab, personalized.legacy) : tab
    ));
  }

  block.textContent = '';
  if (!tabs.length && !steps.length) return;

  // One fetch per unique sku across every tab, in parallel, via the shared
  // never-reject cache — a missing/failed product resolves to null, not a
  // thrown error, so one bad sku never blocks the rest of the grid.
  const skus = [...new Set(tabs.flatMap((tab) => tab.plans.map((plan) => plan.sku)))];
  const products = await Promise.all(skus.map((sku) => loadProduct(PRODUCT_PATH(sku))));
  const bySku = new Map(
    skus.map((sku, i) => [sku, products[i]]).filter(([, product]) => product),
  );

  if (tabs.length) block.append(buildTabs(tabs, activeIndex, bySku, ai, uid));

  const stepFlow = buildStepFlow(steps);
  if (stepFlow) block.append(stepFlow);

  trackAs('shopping_widget', block, { key: 'shopping-widget' });
}
