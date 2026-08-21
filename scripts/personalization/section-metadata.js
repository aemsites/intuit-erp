// Client-side Section Metadata -> data-* conversion for Intuit's personalization /
// experimentation authoring (`pzn` / `exp` rows in a `.section-metadata` block — see
// experience-workspace/skills/add-personalization-experimentation.md).
//
// The aem.live pipeline does NOT convert Section Metadata into attributes: it serves the
// raw `.section-metadata` block. Stock aem.js does that conversion client-side in
// decorateSections, but this project runs a trimmed decorateSections that does not — so
// nothing produced `data-pzn` / `data-exp` before, and the authored discovery lane
// (scripts/personalization/discover.js) found nothing on real content. This module
// restores that one conversion, scoped to the pzn/exp keys, and scripts.js runs it before
// decorateMain and the authored pzn/exp lanes.
import { readBlockConfig, toCamelCase } from '../aem.js';

// The Section Metadata keys this project's pzn/exp authoring uses. Only these are lifted
// to data-* here; every other key (section `background`/`style`, the plugin's native
// `Experiment`/`Campaign`/`Audience` keys that experiment-loader.js detects off the raw
// block) is left alone for its own consumer.
export const AUTHORED_TAG_KEYS = ['pzn', 'pzn-block', 'pzn-variants', 'exp', 'exp-block', 'exp-variants'];

/**
 * Converts authored `pzn`/`exp` Section Metadata rows into `data-*` attributes on the
 * owning section — the client-side decoration the pipeline does not do for us. A
 * `.section-metadata` block that carried a pzn/exp tag is removed once consumed, so its
 * raw rows never render; a block without any pzn/exp tag is left in place untouched (so
 * section backgrounds and native Experiment detection still see it). Must run before
 * decorateMain and the authored pzn/exp lanes (see scripts.js's loadEager). Idempotent in
 * effect on a page with no such tags: a pure no-op.
 * @param {Element} main The main element
 */
export default function decorateSectionMetadata(main) {
  if (!main) return;
  main.querySelectorAll('.section-metadata').forEach((meta) => {
    // The section is the block's nearest ancestor that is a direct child of <main> —
    // resolved by class-free structure so it holds whether or not decorateSections has run.
    const section = meta.closest('main > div');
    if (!section) return;
    const config = readBlockConfig(meta);
    const tags = AUTHORED_TAG_KEYS.filter((key) => config[key] != null && config[key] !== '');
    if (!tags.length) return; // not a pzn/exp tag — leave for section styles / native experiments
    tags.forEach((key) => { section.dataset[toCamelCase(key)] = config[key]; });
    meta.remove();
  });
}
