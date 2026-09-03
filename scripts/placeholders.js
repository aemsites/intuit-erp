/*
 * Placeholders — centrally managed UI strings, authored in a `placeholders`
 * sheet rather than hard-coded in blocks. Adapted from the AEM block collection
 * (adobe/aem-block-collection scripts/placeholders.js), which is where the
 * feature lives now that it is no longer part of the boilerplate.
 * See https://www.aem.live/developer/placeholders
 *
 * Sheet columns are `Key` / `Text`; keys are camel-cased on the way in, so
 * `form thank you heading` is read back as `formThankYouHeading`.
 */
import { toCamelCase } from './aem.js';

/**
 * Fetches the placeholders sheet for a prefix and returns it as a keyed object.
 * Cached on `window.placeholders` per prefix, so repeated calls across blocks
 * share one request. A missing sheet or a failed fetch resolves to `{}` — every
 * caller is expected to carry its own fallback string.
 * @param {string} [prefix] folder holding the sheet ('default' = site root)
 * @returns {Promise<object>} placeholder keys mapped to their text
 */
// eslint-disable-next-line import/prefer-default-export
export async function fetchPlaceholders(prefix = 'default') {
  window.placeholders = window.placeholders || {};
  if (!window.placeholders[prefix]) {
    window.placeholders[prefix] = new Promise((resolve) => {
      fetch(`${prefix === 'default' ? '' : prefix}/placeholders.json`)
        .then((resp) => (resp.ok ? resp.json() : {}))
        .then((json) => {
          const placeholders = {};
          (json.data || [])
            .filter((placeholder) => placeholder.Key)
            .forEach((placeholder) => {
              placeholders[toCamelCase(placeholder.Key)] = placeholder.Text;
            });
          window.placeholders[prefix] = placeholders;
          resolve(window.placeholders[prefix]);
        })
        .catch(() => {
          window.placeholders[prefix] = {};
          resolve(window.placeholders[prefix]);
        });
    });
  }
  return window.placeholders[`${prefix}`];
}
