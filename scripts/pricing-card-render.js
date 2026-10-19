/**
 * pricing-card-render — the shared product-card renderer used by both
 * blocks/pricing-cards and blocks/shopping-widget. Extracted verbatim (in
 * behavior) from pricing-cards.js so the two blocks cannot drift: card
 * container + CardFlag sibling, the pc-card-with-flag/pc-card-without-flag
 * alignment modifiers, the featured box-shadow ring, price formatting, the
 * Intuit Intelligence section, the index merge, and the missing-card path all
 * live here and nowhere else.
 *
 * Card structure and the "featured" treatment (a highlighted ring around the
 * card, plus a pill-shaped flag docked above it) are ported from Intuit's
 * ShoppingWidget component (marketing-design-system
 * components/ShoppingWidget/src/components/{card,cardFlag,pricing}) — see
 * Card.tsx/.css and CardFlag.tsx/.css for the source layout, and
 * BolderPricing.tsx/formatLocalizedPrice.ts for the price-formatting rules
 * ported in formatPrice() below.
 *
 * Every class name emitted here is `pc-*`-prefixed and unscoped on purpose:
 * each consuming block scopes them in its own CSS (`.pricing-cards .pc-card`,
 * `.shopping-widget .pc-card`), per AGENTS.md's block-scoping rule.
 *
 * `titleBadge` (shopping-widget's authored `titleBadge` field) renders as a
 * SIBLING of the product-name element inside a shared flex row — never a
 * child of the name — so inline vs. own-row placement is a pure CSS concern
 * (the DOM order is identical in both modes) and an empty/absent name doesn't
 * suppress it. Its background/color are NOT content: consuming blocks pick
 * them with a block variant class (see shopping-widget.css's title-badge-*
 * variants).
 *
 * `aiLabelCell`/`featuresCell` on a plan object are plain string arrays (one
 * entry per bullet), not DOM cells — this DA setup only supports flat
 * key/value authoring, with no `<ul>`/`<li>` markup available to an author,
 * so both consuming blocks read bulleted fields as one `<p>` per bullet via
 * scripts/aem.js's readBlockConfig() and pass the resulting array straight
 * through.
 */

/**
 * Formats a price value the way ShoppingWidget's formatLocalizedPrice does:
 * currency symbol before the number, thousands-grouped, with cents appended
 * only when present and non-zero — e.g. "19" -> "$19", "19.99" -> "$19.99",
 * "19.00" -> "$19" (whole-dollar prices never show a trailing ".00").
 * @param {string} value raw price, e.g. "1999.99" or "19"
 * @returns {string} formatted price, or '' if value is empty/invalid
 */
export function formatPrice(value) {
  if (!value && value !== 0) return '';
  const [whole, cents] = String(value).split('.');
  if (!/^\d+$/.test(whole)) return '';
  const formattedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const showCents = cents && cents !== '00' && cents !== '0' && Number(cents) > 0;
  return showCents ? `$${formattedWhole}.${cents}` : `$${formattedWhole}`;
}

/**
 * @param {string[]} bullets plain bullet text, one entry per <li>
 * @param {string} className
 */
export function buildBulletList(bullets, className) {
  const ul = document.createElement('ul');
  ul.className = className;
  (bullets || []).forEach((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    ul.append(item);
  });
  return ul;
}

/**
 * The "Intuit Intelligence" section. Heading text and link label default to
 * the strings pricing-cards hardcoded; shopping-widget passes authored
 * overrides from its block-level `ai` row (see its §1.5). Omitted entirely
 * when the aiLabel cell has no <li> at all.
 * @param {object} plan merged plan object
 * @param {{title?: string, playButtonText?: string, titleIcon?: string,
 *   subtitle?: string}} [ai] authored chrome overrides
 */
export function buildAiSection(plan, ai = {}) {
  if (!plan.aiLabelCell?.length) return null;
  const section = document.createElement('div');
  section.className = 'pc-ai-section';

  const heading = document.createElement('p');
  heading.className = 'pc-ai-heading';
  if (ai.titleIcon) {
    const icon = document.createElement('img');
    icon.className = 'pc-ai-icon-img';
    icon.src = ai.titleIcon;
    icon.alt = '';
    icon.loading = 'lazy';
    heading.append(icon);
  } else {
    const icon = document.createElement('span');
    icon.className = 'pc-ai-icon';
    icon.setAttribute('aria-hidden', 'true');
    heading.append(icon);
  }
  heading.append(ai.title || 'Intuit Intelligence');
  section.append(heading);

  if (ai.subtitle) {
    const subtitle = document.createElement('p');
    subtitle.className = 'pc-ai-subtitle';
    subtitle.textContent = ai.subtitle;
    section.append(subtitle);
  }

  section.append(buildBulletList(plan.aiLabelCell, 'pc-ai-features'));

  if (plan.aiLink) {
    const link = document.createElement('a');
    link.className = 'pc-ai-link';
    link.href = plan.aiLink;
    link.textContent = ai.playButtonText || 'See how it works';
    section.append(link);
  }

  return section;
}

// Ported from ShoppingWidget's CardFlag.tsx: a pill-shaped flag docked on
// top of the card, a sibling BEFORE the card body, not a child inside it.
export function buildCardFlag(title) {
  const wrapper = document.createElement('div');
  wrapper.className = 'pc-flag-wrapper';
  const flag = document.createElement('div');
  flag.className = 'pc-flag';
  flag.textContent = title;
  wrapper.append(flag);
  return wrapper;
}

export function buildPriceSection(product) {
  const final = formatPrice(product?.price);
  const regular = formatPrice(product?.strikethroughprice);
  const showStrikethrough = Boolean(regular) && Boolean(final) && regular !== final;

  const section = document.createElement('div');
  section.className = 'pc-price-section';

  if (showStrikethrough) {
    const strike = document.createElement('div');
    strike.className = 'pc-price-strike';
    strike.textContent = regular;
    section.append(strike);
  }

  const displayPrice = final || regular;
  if (displayPrice) {
    const price = document.createElement('div');
    price.className = 'pc-price';
    price.textContent = displayPrice;
    section.append(price);
  }

  return section;
}

/**
 * Merges authored marketing fields with index catalog data. Index fields
 * (title, description, price, strikethroughprice, image, url, path) always
 * come from the index when present; marketing fields (badge, featured,
 * ctaLabel, ctaUrl, aiLabel, aiLink, features, titleBadge) come from the
 * authored plan, with defaults applied when both the authored value AND a
 * sensible index-derived fallback are needed (ctaUrl only — every other
 * marketing field simply renders nothing when unauthored).
 * @param {object} authoredPlan from a block's own row reader, or a bare
 *   defaultPlan() object for a personalization-selected SKU with no
 *   authored row
 * @param {object|null} product raw index row, or null if this sku wasn't found
 */
export function mergePlan(authoredPlan, product) {
  return {
    ...authoredPlan,
    found: Boolean(product),
    product,
    ctaUrl: authoredPlan.ctaUrl || product?.url || product?.path || '',
  };
}

// Bare defaults for a personalization-selected sku with no authored row —
// every marketing field empty, so renderCardBody/renderPlan's existing
// empty-field guards simply omit badge/AI/features and fall back to a
// generic "Choose plan" CTA pointed at the index's own url/path.
export function defaultPlan(sku) {
  return {
    sku,
    badge: '',
    featuredFlag: '',
    ctaLabel: '',
    ctaUrl: '',
    aiLabelCell: [],
    aiLink: '',
    featuresCell: [],
    titleBadge: '',
  };
}

export function isFeaturedPlan(plan) {
  return (plan.featuredFlag || '').trim().toLowerCase() === 'yes';
}

function renderCardBody(plan, ai) {
  const { product } = plan;
  const body = document.createElement('div');
  body.className = 'pc-card';
  body.dataset.sku = plan.sku || '';

  if (product?.image) {
    const img = document.createElement('img');
    img.className = 'pc-image';
    img.src = product.image;
    img.alt = '';
    img.loading = 'lazy';
    body.append(img);
  }

  const isFeatured = isFeaturedPlan(plan);
  if (plan.badge && !isFeatured) {
    const badge = document.createElement('span');
    badge.className = 'pc-badge';
    badge.textContent = plan.badge;
    body.append(badge);
  }

  const name = document.createElement('h3');
  name.className = 'pc-name';
  name.textContent = product?.title || plan.sku || '';

  // titleBadge is a flex SIBLING of the name inside one row container, never a
  // child of it — so `title-badge-own-row` can restack it with CSS alone
  // (order/flex-direction) without any DOM-order difference, and so a card
  // with an empty name still renders its badge.
  if (plan.titleBadge) {
    const nameRow = document.createElement('div');
    nameRow.className = 'pc-name-row';
    nameRow.append(name);
    const titleBadge = document.createElement('span');
    titleBadge.className = 'pc-title-badge';
    titleBadge.textContent = plan.titleBadge;
    nameRow.append(titleBadge);
    body.append(nameRow);
  } else {
    body.append(name);
  }

  if (product?.description) {
    const tagline = document.createElement('p');
    tagline.className = 'pc-tagline';
    // Index content is commerce-controlled, not arbitrary user input — inline
    // markup (e.g. "<strong>") is rendered as authored, matching the index's
    // documented support for inline HTML in `description`.
    tagline.innerHTML = product.description;
    body.append(tagline);
  }

  body.append(buildPriceSection(product));

  if (plan.ctaUrl) {
    const cta = document.createElement('a');
    cta.className = 'pc-cta';
    cta.href = plan.ctaUrl;
    cta.textContent = plan.ctaLabel || 'Choose plan';
    body.append(cta);
  }

  const aiSection = buildAiSection(plan, ai);
  if (aiSection) body.append(aiSection);

  if (plan.featuresCell?.length) body.append(buildBulletList(plan.featuresCell, 'pc-features'));

  return body;
}

/**
 * Ported from ShoppingWidget's Card.tsx: an outer container holding an
 * optional flag (sibling, not a child of the card) followed by the card
 * itself, with a modifier class distinguishing flagged/unflagged cards so
 * CSS can vertically align both kinds of cards in the same row.
 * @param {object} plan merged plan object
 * @param {object} [ai] authored Intuit Intelligence chrome overrides
 */
export function renderPlan(plan, ai) {
  const container = document.createElement('div');
  container.className = 'pc-card-container';

  const isFeatured = isFeaturedPlan(plan);
  if (isFeatured && plan.badge) {
    container.append(buildCardFlag(plan.badge));
  }

  const card = renderCardBody(plan, ai);
  card.classList.add(isFeatured ? 'pc-card-with-flag' : 'pc-card-without-flag');
  if (isFeatured) card.classList.add('pc-featured');
  container.append(card);

  return container;
}

export function renderMissingCard(sku) {
  const container = document.createElement('div');
  container.className = 'pc-card-container';
  const card = document.createElement('div');
  card.className = 'pc-card pc-card-error pc-card-without-flag';
  card.dataset.sku = sku || '';
  const heading = document.createElement('h3');
  heading.className = 'pc-name';
  heading.textContent = 'Plan unavailable';
  card.append(heading);
  const message = document.createElement('p');
  message.className = 'pc-error-message';
  message.textContent = 'This plan is temporarily unavailable.';
  card.append(message);
  container.append(card);
  return container;
}

/**
 * Renders one card for a plan: the normal card when the sku resolved in the
 * index (or carries enough authored content to be worth showing anyway), the
 * "Plan unavailable" card otherwise. Same guard pricing-cards used inline.
 * @param {object} plan authored/default plan object
 * @param {Map<string, object>} bySku index rows keyed by sku
 * @param {object} [ai] authored Intuit Intelligence chrome overrides
 */
export function renderCardForPlan(plan, bySku, ai) {
  const merged = mergePlan(plan, bySku.get(plan.sku));
  const hasAuthoredContent = merged.ctaUrl
    || merged.badge
    || merged.featuresCell?.length
    || merged.aiLabelCell?.length;
  return merged.found || hasAuthoredContent
    ? renderPlan(merged, ai)
    : renderMissingCard(plan.sku);
}
