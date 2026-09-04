export const LIVEPERSON_FACADE_ACTIVATE = 'liveperson-facade:activate';
export const LIVEPERSON_FACADE_STARTED = 'liveperson-facade:started';

/**
 * Returns whether the URL opts into the LivePerson facade experiment.
 * @param {string} search URL search string
 * @returns {boolean} true only for `?liveperson-facade=on`
 */
export function isLivePersonFacadeEnabled(search = window.location.search) {
  return new URLSearchParams(search).get('liveperson-facade') === 'on';
}
