/**
 * Click-tracking: derive the baseline payload from context/markup.
 *
 * ~75% of the SBSEG click-tracking fields a CTA needs are derivable from the
 * element and its block — only the authored residue comes from the tracking
 * sheet, and hierarchical context (section/page) layers on top. See
 * CLICK-TRACKING.md ("Auto-derive + a sparse authored layer" / "Identity vs
 * context").
 *
 * Pure functions (no DOM writes) so they can be unit-tested and reused by the
 * parity harness.
 */

// Constants the live tracker uses for a standard click CTA.
const UI_ACTION = 'clicked';
const ACTION = 'interacted';
const DEFAULT_OBJECT = 'content';

/**
 * Slugify a visible label the way the live site's `link_name` reads:
 * "Schedule a call" -> "schedule-a-call".
 * @param {string} label
 * @returns {string}
 */
export function slug(label) {
  return (label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `ui_object` from the element: styled CTAs report "button", a plain anchor
 * reports "link".
 * @param {string} tagName uppercase tag name (e.g. 'A', 'BUTTON')
 * @param {boolean} isButtonStyled whether an anchor is decorated as a button
 * @returns {string}
 */
export function uiObject(tagName, isButtonStyled) {
  if (tagName === 'BUTTON') return 'button';
  if (tagName === 'A') return isButtonStyled ? 'button' : 'link';
  return 'button';
}

/**
 * The block's own access-point segment, defaulted from its block name:
 * a "cta" block -> "cta_block". Hyphens become underscores to match the
 * tracker's trail normalization.
 * @param {string} blockName
 * @returns {string}
 */
export function blockAccessPoint(blockName) {
  if (!blockName) return '';
  return `${blockName.replace(/-/g, '_')}_block`;
}

/**
 * Derived baseline for one CTA. The sheet residue and section/page context
 * override/extend this in the resolve step; nothing here is authored.
 *
 * Returns a map keyed by tracking-field name (mirrors the sheet columns), plus
 * `anchor` (the sacrificial `data-tracking` value stamped on the CTA itself, so
 * the block's own segment survives the trail walk) and `custom-properties`
 * (a key->value map, merged later).
 * @param {{tagName: string, label: string, blockName: string, isButtonStyled?: boolean}} ctx
 * @returns {Record<string, unknown>}
 */
export function deriveBaseline({
  tagName, label, blockName, isButtonStyled = true,
}) {
  const kind = uiObject(tagName, isButtonStyled);
  const detail = (label || '').trim();
  const custom = {};
  if (detail) custom.link_name = `${kind}-${slug(detail)}`;
  return {
    object: DEFAULT_OBJECT,
    'ui-object': kind,
    'ui-object-detail': detail,
    'ui-action': UI_ACTION,
    action: ACTION,
    'access-point': blockAccessPoint(blockName),
    anchor: kind,
    'custom-properties': custom,
  };
}
