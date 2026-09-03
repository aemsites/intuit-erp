/**
 * Get value of cookie found with accurate key
 * @param {String} cookieName key of the cookie to be retrieved
 * @returns {String|null} value of cookie if found else null
 */
export const getCookieValue = (cookieName) => {
  if (!cookieName) {
    return null;
  }
  const regex = new RegExp(
    `(?:^|; )${cookieName.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1')}=([^;]*)`,
  );
  const matches = regex.exec(document.cookie);
  return matches ? matches[1] : null;
};

/**
 * Creates unique uuid string
 */
/* eslint-disable no-bitwise -- v4 UUID generation */
export const createUUID = () => {
  const lut = [];
  for (let i = 0; i < 256; i += 1) {
    lut[i] = (i < 16 ? '0' : '') + i.toString(16);
  }
  const d0 = (Math.random() * 0xffffffff) | 0;
  const d1 = (Math.random() * 0xffffffff) | 0;
  const d2 = (Math.random() * 0xffffffff) | 0;
  const d3 = (Math.random() * 0xffffffff) | 0;
  return `${
    lut[d0 & 0xff]
      + lut[(d0 >> 8) & 0xff]
      + lut[(d0 >> 16) & 0xff]
      + lut[(d0 >> 24) & 0xff]
  }-${lut[d1 & 0xff]}${lut[(d1 >> 8) & 0xff]}-${
    lut[((d1 >> 16) & 0x0f) | 0x40]
  }${lut[(d1 >> 24) & 0xff]}-${lut[(d2 & 0x3f) | 0x80]}${
    lut[(d2 >> 8) & 0xff]
  }-${lut[(d2 >> 16) & 0xff]}${lut[(d2 >> 24) & 0xff]}${lut[d3 & 0xff]}${
    lut[(d3 >> 8) & 0xff]
  }${lut[(d3 >> 16) & 0xff]}${lut[(d3 >> 24) & 0xff]}`;
};
/* eslint-enable no-bitwise */

/**
 * Loads the Munchkin JavaScript library for Marketo and initializes it with a specified form ID
 * @param {String} environment - The unique identifier for the Marketo Munchkin id
 */
export const loadMunchkinTag = (munchkinId) => {
  let didInit = false;
  const initMunchkin = () => {
    const munchkin = window.Munchkin;
    if (munchkin && !didInit) {
      didInit = true;
      munchkin.init(munchkinId);
    }
  };

  const scriptEl = document.createElement('script');
  scriptEl.type = 'text/javascript';
  scriptEl.src = '//munchkin.marketo.net/munchkin.js';
  scriptEl.onload = initMunchkin;
  document.head.appendChild(scriptEl);
};

/**
 * Get value of a query param from the current URL
 * @param {String} paramName name of the query param to retrieve
 * @returns {String} value of query param if found else null
 */
export const getQueryParamValue = (paramName) => {
  const value = new URLSearchParams(window.location.search).get(paramName);
  return value === '' ? null : value;
};

/**
 * Get value of cid from URL query param or cookies
 * @returns {String} value of cid if found else empty string
 */
export const getCidValue = () => {
  const cidFromQuery = getQueryParamValue('cid') || getQueryParamValue('CID');
  if (cidFromQuery) {
    return cidFromQuery;
  }

  let cidVal = getCookieValue('qbn.qbo_sc') || '';
  cidVal = (cidVal && cidVal.includes('|') && cidVal.split('|')[0]) || '';
  cidVal = (cidVal && cidVal.includes(':') && cidVal.split(':')[1]) || '';
  return cidVal;
};

/**
 * Get dynamic screen data based on geo and pathname
 * @param {String} countryCode
 * @returns {String|""}
 */
export const getDynamicScreenData = (countryCode) => {
  const pathName = window?.location.pathname;
  if (pathName) {
    const pathnameArr = pathName.replace(/\/+$/, '').split('/');
    if (pathnameArr && pathnameArr.length > 1) {
      if (countryCode === pathnameArr[1]) {
        return pathnameArr.length > 2
          ? pathnameArr.splice(2).join('/')
          : 'homepage';
      }
      return pathnameArr.splice(1).join('/');
    }
    return 'homepage';
  }
  return '';
};

/**
 * get dynamic scope data based on geo and pathname
 * @param {String} countryCode
 * @returns {String|""}
 */
export const getDynamicScopeArea = (countryCode) => {
  const pathName = window?.location?.pathname;
  if (pathName) {
    const pathnameArr = pathName.replace(/\/+$/, '').split('/');
    if (pathnameArr && pathnameArr.length > 1) {
      if (countryCode === pathnameArr[1]) {
        if (pathnameArr.length > 2) {
          return pathnameArr[2];
        }
        return 'homepage';
      }
      return pathnameArr[1];
    }
    return 'homepage';
  }
  return '';
};

/**
 * Get Page Hierarchy value
 * returns {String} page hierarchy
 * @param initConfig
 * @param trackObj
 */
export const buildPageHierarchy = (
  initConfig,
  trackObj,
) => {
  const arr = ['', '', '', '', ''];
  if (initConfig) {
    arr[0] = initConfig.org || '';
    arr[1] = initConfig.purpose || '';
    arr[2] = initConfig.scope || '';
  }
  if (trackObj) {
    arr[3] = trackObj.scope_area || '';
    arr[4] = trackObj.screen || '';
  }
  return arr.join('|');
};

/**
 * Build Track data object.
 * @returns track object:{Object}
 * @param countryCode
 */
export const getTrackData = (countryCode) => ({
  scope_area: getDynamicScopeArea(countryCode),
  screen: getDynamicScreenData(countryCode),
  action: 'create_submitted',
  object: 'lead',
  ui_action: 'clicked',
  ui_object: 'button',
  ui_object_detail: 'Submit',
  ui_access_point: 'form|form_group',
  type: 'track',
  cid: getCidValue(),
  page_name_parameter: '',
  custom_properties: {},
  _mkto_trk: getCookieValue('_mkto_trk'),
});

/**
 * Get phone number country code
 * @param {String} geoCountry
 * @returns {String}
 */
export const getPhCountryCodeForGeo = (geoCountry) => {
  let phCountryCode = '+1';
  const countryCodes = {
    us: '+1',
    uk: '+44',
    ca: '+1',
    fr: '+33',
    mx: '+52',
    za: '+27',
    br: '+55',
    au: '+61',
    in: '+91',
    sg: '+65',
  };
  if (geoCountry) {
    phCountryCode = countryCodes[geoCountry?.toLowerCase()] || '+1';
  }
  return phCountryCode;
};
