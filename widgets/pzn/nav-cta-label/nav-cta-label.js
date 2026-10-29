/**
 * PZN widget: sets the header "Schedule a call" CTA label to match the variant's hero CTA.
 * Params: label (optional). Without it, the primary button in the widget's section is used,
 * falling back to the first #schedule link.
 */
const NAV_TEXT = 'header .nav-cta .nav-cta-text';
// Authored (strong > a) or decorated (.button.primary, incl. the hero's video button).
const PRIMARY_BUTTON = '.button.primary, strong > a';
const SCHEDULE_LINK = 'a[href$="#schedule"]';

let active = null;
let original = null;
let observer = null;

export function resolveLabel(widget) {
  const label = (widget.dataset.label || '').trim();
  if (label) return label;
  const section = widget.closest('.section');
  const link = section?.querySelector(PRIMARY_BUTTON) || section?.querySelector(SCHEDULE_LINK);
  return link?.textContent.trim() || null;
}

function apply() {
  const targets = [...document.querySelectorAll(NAV_TEXT)];
  if (!targets.length) return;
  if (original === null) original = targets[0].textContent;
  // The variant was removed (e.g. back to default): restore the baseline label.
  const text = active?.widget.isConnected ? active.label : original;
  targets.forEach((el) => {
    if (el.textContent !== text) el.textContent = text;
  });
}

export default function decorate(widget) {
  const label = resolveLabel(widget);
  if (!label) return;
  active = { widget, label };
  if (!observer) {
    // Re-apply once the lazy header renders and whenever a variant swap changes the page.
    observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  apply();
}
