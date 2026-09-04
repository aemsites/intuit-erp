import {
  loadHeader,
  loadFooter,
  decorateBlock,
  decorateIcons,
  decorateSections,
  decorateBlocks,
  decorateTemplateAndTheme,
  waitForFirstImage,
  loadSection,
  loadSections,
  loadCSS,
  loadBlock,
  buildBlock,
  getMetadata,
} from './aem.js';
// Adobe/Alloy (plugins/martech, a git subtree) is armed but commented out; Tealium is the default.
// Uncomment the AEP blocks in loadEager / loadLazy to load it in parallel.
// The tealium plugin below is NOT a vendored subtree (project-owned code), but the relative
// eslint-disable-next-line import/no-relative-packages
import TealiumMartech, { parseTealiumTagUids } from '../plugins/tealium-martech/src/index.js';
import installEcsEnrich from './ecs-enrich.js';
import { isBlogPage, hasAuthoredCaseStudyHeader } from '../blocks/blog-template/blog-detect.js';
import { isVideoLink, videoInfo } from '../blocks/video/video-info.js';
import { isGuidePage } from '../blocks/guide-hero/guide-detect.js';
import { isLivePersonFacadeEnabled } from '../blocks/liveperson-facade/liveperson-facade-events.js';
// eslint-disable-next-line import/no-cycle
import { applyPageExperience, applyEagerLayers } from './experience.js';

// AEP (Adobe Web SDK) datastream — armed but disabled. Uncomment with the AEP blocks in loadEager
// / loadLazy to enable it (parallel with Tealium). The datastream id is public, not a secret.
// const AEP_DATASTREAM_ID = 'a114467b-290b-4429-9d7e-56bc5b5786fa';
// const AEP_ORG_ID = '87020D54659BEED90A495E68@AdobeOrg';
// // Disabled on *.preview.da.live (Alloy interferes with Experience Workspace previews).
// const MARTECH_ENABLED = !AEP_DATASTREAM_ID.startsWith('REPLACE_')
//   && !window.location.hostname.endsWith('.preview.da.live');

// Provider gate via the `?martech=` query param:
//   off    -> disable ALL martech (no Tealium, no Adobe — fully inert)
//   local  -> Tealium, loading utag.js + the OneTrust consent stack from local copies in
//             /scripts/martech/ (for testing without Intuit's VPN-gated consent CDN)
//   (absent / any other value) -> Tealium, loading from the vendor CDNs (the default)
// Adobe/AEP is no longer a runtime value — armed but commented out (see loadEager / loadLazy).
// Tealium still self-gates via TealiumMartech's `resolveEnvironment`
// (plugins/tealium-martech/src/index.js): only erp.intuit.com -> 'prod'; stage.erp.intuit.com, the
// aem.page/aem.live previews, and localhost -> 'dev'; every other host stays inert.
const URL_PARAMS = new URLSearchParams(window.location.search);
const MARTECH_PARAM = URL_PARAMS.get('martech');
const MARTECH_PROVIDER = MARTECH_PARAM === 'off' ? 'off' : 'tealium';
// `?martech=local`: load utag.js + the consent stack from /scripts/martech/ instead of the CDNs.
const MARTECH_LOCAL = MARTECH_PARAM === 'local';
// Lab-only: keep most active tags in lazy, but move UIDs 9/15/23/27 to delayed_ready.
const MARTECH_PHASE_SPLIT = URL_PARAMS.get('martech-phase-split') === 'on';
const TEALIUM_TAG_UIDS = parseTealiumTagUids(URL_PARAMS);

function isLivePersonOnDemand() {
  return ['true', 'yes'].includes((getMetadata('chat-now') || '').trim().toLowerCase());
}

function livePersonInviteDelay() {
  const value = Number.parseInt(getMetadata('chat-invite-delay'), 10);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

// Active Tealium instance (undefined when `?martech=off`); exposed via getTealium().
let tealium;

/**
 * Returns the active `TealiumMartech` instance, or `undefined` when martech is disabled
 * (`?martech=off`).
 * @returns {TealiumMartech|undefined} the active Tealium loader instance, if any
 */
export function getTealium() {
  return tealium;
}

let siteConfigPromise;

// Site-wide configuration / integration values (Marketo/ChiliPiper/reCAPTCHA)
export function getSiteConfig() {
  if (!siteConfigPromise) {
    siteConfigPromise = fetch('/site-config.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const cfg = {};
        (json?.data || []).forEach(({ key, value }) => {
          // Trim sheet whitespace once, here, so downstream consumers never have to.
          const k = typeof key === 'string' ? key.trim() : key;
          if (!k) return;
          const v = typeof value === 'string' ? value.trim() : value;
          if (v === 'true') cfg[k] = true;
          else if (v === 'false') cfg[k] = false;
          else cfg[k] = v;
        });
        return cfg;
      })
      .catch(() => ({}));
  }
  return siteConfigPromise;
}

if (window.trustedTypes && window.trustedTypes.createPolicy) {
  const innerTT = window.trustedTypes.createPolicy('tt-inner', {
    createHTML: (s) => s, // avoid stack overflow
  });

  window.trustedTypes.createPolicy('default', {
    createHTML: (input, type, sink) => {
      let processedInput = input;
      if (/srcdoc\s*=/i.test(processedInput)) {
        const doc = new DOMParser().parseFromString(innerTT.createHTML(processedInput), 'text/html');
        doc.querySelectorAll('iframe[srcdoc]').forEach((el) => el.removeAttribute('srcdoc'));
        processedInput = doc.body.innerHTML;
      }
      if (sink.includes('createContextualFragment') || sink.includes('Document write')) {
        const doc = new DOMParser().parseFromString(innerTT.createHTML(processedInput), 'text/html');
        doc.querySelectorAll('script').forEach((el) => el.remove());
        processedInput = doc.body.innerHTML;
      }
      return processedInput;
    },
    createScriptURL: (input) => input,
    createScript: (input) => input,
  });
}

/**
 * load fonts.css and set a session storage flag
 */
async function loadFonts() {
  await loadCSS(`${window.hlx.codeBasePath}/styles/fonts.css`);
  try {
    if (!window.location.hostname.includes('localhost')) sessionStorage.setItem('fonts-loaded', 'true');
  } catch (e) {
    // do nothing
  }
}

/**
 * Turns `/widgets/...` links into widget blocks.
 * @param {Element} main The container element
 */
function buildWidgetAutoBlocks(main) {
  const widgetLinks = [...main.querySelectorAll('a[href*="/widgets/"]')];
  widgetLinks.forEach((link) => {
    if (link.closest('.widget')) return;
    const newLink = link.cloneNode(true);
    const widgetBlock = buildBlock('widget', { elems: [newLink] });
    const p = link.closest('p');
    if (
      p
      && p.querySelectorAll('a').length === 1
      && p.querySelector('a') === link
      && p.textContent.trim() === link.textContent.trim()
    ) {
      p.replaceWith(widgetBlock);
    } else {
      link.replaceWith(widgetBlock);
    }
  });
}

/**
 * True when `el` is an authored poster-only node — a bare <picture>/<img>, or a
 * <p> that wraps only a <picture>/<img> with no other text/links. Used to pair a
 * standalone poster with an adjacent video link (see buildVideoAutoBlocks).
 * @param {Element|null} el
 * @returns {boolean}
 */
function isPosterOnly(el) {
  if (!el) return false;
  if (el.tagName === 'PICTURE' || el.tagName === 'IMG') return true;
  return el.tagName === 'P'
    && !!el.querySelector('picture, img')
    && !el.querySelector('a')
    && el.textContent.trim() === '';
}

/**
 * Turns a section-level paragraph that is only a link to a video host
 * (YouTube/Vimeo) into a `video` block. The poster image may be authored inside
 * the link paragraph, or as a standalone <picture>/<img> in the immediately
 * preceding sibling
 * @param {Element} main The container element
 */
function buildVideoAutoBlocks(main) {
  main.querySelectorAll('p a[href]').forEach((a) => {
    if (!isVideoLink(a.getAttribute('href'))) return;
    const p = a.closest('p');
    // section-level only: p is a direct child of a section div under main
    if (!p || !p.parentElement || p.parentElement.parentElement !== main) return;
    if (p.querySelectorAll('a').length !== 1) return;
    // the link must be the whole paragraph (image poster has no text)
    if (p.textContent.replace(a.textContent, '').trim()) return;
    // absorb a standalone poster authored in the preceding sibling, if any, so
    // the block renders one thumbnail + play button rather than an orphaned
    // image above a provider-thumbnail video block.
    const elems = [];
    const poster = p.previousElementSibling;
    if (!p.querySelector('img') && isPosterOnly(poster)) {
      elems.push(poster.tagName === 'P' ? poster.querySelector('picture, img') : poster);
      poster.remove();
    }
    elems.push(a.cloneNode(true));
    p.replaceWith(buildBlock('video', { elems }));
  });
}

let buildBlogTemplate;
let buildGuideHeroAutoBlock;
const BLOG_TEMPLATE_CSS_TIMEOUT = 2000;

async function resolveBlogTemplate(main) {
  if (!isBlogPage() || hasAuthoredCaseStudyHeader(main)) return undefined;
  let cssTimer;
  try {
    const [mod] = await Promise.all([
      import('../blocks/blog-template/blog-template.js'),
      Promise.race([
        loadCSS(`${window.hlx.codeBasePath}/blocks/blog-template/blog-template.css`)
          .catch(() => {}),
        new Promise((resolve) => {
          cssTimer = window.setTimeout(resolve, BLOG_TEMPLATE_CSS_TIMEOUT);
        }),
      ]),
    ]);
    return mod.buildBlogTemplate;
  } catch (e) {
    return undefined; // render the article unstyled rather than not at all
  } finally {
    window.clearTimeout(cssTimer);
  }
}

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function buildAutoBlocks(main) {
  try {
    if (buildBlogTemplate && main.isConnected) buildBlogTemplate(main);
    if (buildGuideHeroAutoBlock && main.isConnected) buildGuideHeroAutoBlock(main);
    // auto load `*/fragments/*` references
    const fragments = [...main.querySelectorAll('a[href*="/fragments/"]')].filter((f) => !f.closest('.fragment'));
    if (fragments.length > 0) {
      // eslint-disable-next-line import/no-cycle
      import('../blocks/fragment/fragment.js').then(({ loadFragment }) => {
        fragments.forEach(async (fragment) => {
          try {
            const { pathname } = new URL(fragment.href);
            const frag = await loadFragment(pathname);
            fragment.parentElement.replaceWith(...frag.children);
            import('./schedule-modal.js').then(({ bindScheduleLinks }) => bindScheduleLinks(main)).catch(() => {});
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Fragment loading failed', error);
          }
        });
      });
    }
    buildWidgetAutoBlocks(main);
    buildVideoAutoBlocks(main);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

/**
 * Decorates formatted links to style them as buttons.
 * @param {HTMLElement} main The main container element
 */
function decorateButtons(main) {
  main.querySelectorAll('p').forEach((p) => {
    const formatted = [...p.querySelectorAll(':scope strong > a[href], :scope em > a[href]')];
    const ctaOnly = formatted.length > 1 && (() => {
      let rest = p.textContent;
      formatted.forEach((a) => { rest = rest.replace(a.textContent, ''); });
      return rest.replace(/[\s|·•,/–-]+/g, '') === '';
    })();
    const multi = ctaOnly;
    const links = multi ? formatted : [...p.querySelectorAll(':scope a[href]')];

    links.forEach((a) => {
      a.title = a.title || a.textContent;
      const text = a.textContent.trim();

      // skip links that wrap an image
      if (a.querySelector('img')) return;

      // require authored formatting for buttonization
      const strong = a.closest('strong');
      const em = a.closest('em');
      if (!strong && !em) return;

      // single-CTA paragraphs must be the sole content
      if (!multi && p.textContent.trim() !== text) return;

      // skip URL display links
      try {
        if (new URL(a.href).href === new URL(text, window.location).href) return;
      } catch { /* continue */ }

      if (multi) p.classList.add('button-wrapper', 'buttons-multi');
      else p.className = 'button-wrapper';
      a.className = 'button';
      if (strong && em) { // high-impact call-to-action
        a.classList.add('accent');
        const outer = strong.contains(em) ? strong : em;
        outer.replaceWith(a);
      } else if (strong) {
        a.classList.add('primary');
        strong.replaceWith(a);
      } else {
        a.classList.add('secondary');
        em.replaceWith(a);
      }
    });
  });
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp)(\?|$)/i;
const HEX_RE = /#([\da-f]{6}|[\da-f]{3})\b/gi;

function hexLuminance(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function isDarkBackground(color) {
  const hexes = String(color).match(HEX_RE);
  if (!hexes) return false;
  const mean = hexes.reduce((sum, h) => sum + hexLuminance(h), 0) / hexes.length;
  return mean < 0.5;
}

function decorateSectionBackgrounds(main) {
  main.querySelectorAll('.section').forEach((section) => {
    const { background } = section.dataset;
    if (!background) return;
    if (IMAGE_EXT_RE.test(background)) {
      const { pathname } = new URL(background, window.location.href);
      section.style.backgroundImage = `url('${pathname}?width=2000&format=webply&optimize=medium')`;
      section.style.backgroundSize = 'cover';
      section.style.backgroundPosition = 'center';
    } else {
      section.style.background = background;
      section.classList.add('colored-background');
      section.classList.add(isDarkBackground(background) ? 'dark-background' : 'light-background');
    }
  });
}

/**
 * Injects an authored eyebrow label as the first child of a section's
 * default-content-wrapper, from the section metadata value in
 * `section.dataset.eyebrowText`.
 * @param {Element} main The main element
 */
function decorateSectionEyebrows(main) {
  main.querySelectorAll('.section').forEach((section) => {
    const { eyebrowText } = section.dataset;
    if (!eyebrowText) return;
    if (section.querySelector('.section-eyebrow')) return;
    const eyebrow = document.createElement('h2');
    eyebrow.className = 'section-eyebrow';
    eyebrow.textContent = eyebrowText;
    const wrapper = section.querySelector('.default-content-wrapper') || section;
    wrapper.insertBefore(eyebrow, wrapper.firstChild);
  });
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
// eslint-disable-next-line import/prefer-default-export
/**
 * Opens a video in a dismissible lightbox, reusing the `.video-modal-*` markup
 * and styles that blocks/video owns. Shared by the video, carousel and hero
 * blocks and by default-content video links (see decorateVideoLinks).
 * @param {string} embedUrl provider embed URL
 * @param {string} title accessible iframe title
 */
export function openVideoModal(embedUrl, title) {
  if (document.querySelector('.video-modal-overlay')) return;
  loadCSS(`${window.hlx.codeBasePath}/blocks/video/video.css`);
  const overlay = document.createElement('div');
  overlay.className = 'video-modal-overlay';
  const frame = document.createElement('div');
  frame.className = 'video-modal-frame';
  const iframe = document.createElement('iframe');
  iframe.src = embedUrl;
  iframe.title = title || 'Video';
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  iframe.allowFullscreen = true;
  frame.append(iframe);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'video-modal-close';
  close.setAttribute('aria-label', 'Close video');
  close.textContent = '×';
  const modal = document.createElement('div');
  modal.className = 'video-modal';
  modal.append(close, frame);
  overlay.append(modal);

  function dismiss() {
    overlay.remove();
    // eslint-disable-next-line no-use-before-define
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') dismiss(); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
  close.addEventListener('click', dismiss);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
}

/**
 * Turns default-content video links/buttons (YouTube/Vimeo) into modal openers.
 * The anchor is replaced with a <button> — no href means no navigation, the same
 * approach the video block uses — that opens the video in the lightbox. Links
 * inside blocks are left alone; those blocks own their own video CTAs.
 * @param {Element} main The container element
 */
function decorateVideoLinks(main) {
  main.querySelectorAll('a[href]').forEach((a) => {
    if (a.closest('.block')) return;
    const info = videoInfo(a.getAttribute('href'));
    if (!info) return;
    const button = document.createElement('button');
    button.type = 'button';
    // carry over authored classes (button primary/secondary), title, data-track-*
    [...a.attributes].forEach((attr) => {
      if (attr.name !== 'href') button.setAttribute(attr.name, attr.value);
    });
    button.textContent = a.textContent.trim();
    button.addEventListener('click', () => openVideoModal(info.embedUrl, button.textContent));
    a.replaceWith(button);
  });
}

export function decorateMain(main) {
  decorateIcons(main);
  buildAutoBlocks(main);
  decorateSections(main);
  decorateSectionBackgrounds(main);
  decorateSectionEyebrows(main);
  decorateBlocks(main);
  decorateButtons(main);
  decorateVideoLinks(main);
}

function shouldRenderContactUs() {
  return !['true', 'yes', 'hide'].includes((getMetadata('hide-contact-widget') || '').trim().toLowerCase());
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();
  const livePersonOnDemand = isLivePersonOnDemand() && isLivePersonFacadeEnabled();

  if (['true', 'yes'].includes((getMetadata('events-bar') || '').trim().toLowerCase())) {
    document.body.classList.add('has-events-bar');
  }

  // Seed window.appVars before martech so the tracker finds it; analytics.js fills the arrays.
  // The page pathname is the content identifier (stable across localhost/preview/prod).
  const appVars = window.appVars || (window.appVars = {});
  appVars.externalContentIdentifier = window.location.pathname;
  appVars.pznRecDetailsArr = appVars.pznRecDetailsArr || [];
  appVars.pznPageRecDetailsArr = appVars.pznPageRecDetailsArr || [];
  appVars.ixpDetailsArr = appVars.ixpDetailsArr || [];

  // Enrich the ECS profile's beacons with EDS-derived values it lost from SSR: page-view
  // pzn/experiments (from appVars) + click page_cas_id (= pathname). Installs before utag loads.
  // FIXME: remove once the profile reads appVars / the runtime pathname. See ecs-enrich.js.
  if (MARTECH_PROVIDER !== 'off') installEcsEnrich();

  // Gated conversion pages (e.g. /webinar-* form landings) opt out of the global
  // header/footer via `hide-header` / `hide-footer` metadata
  if (['true', 'yes', 'hide'].includes((getMetadata('hide-header') || '').trim().toLowerCase())) {
    document.body.classList.add('hide-header');
  }
  if (['true', 'yes', 'hide'].includes((getMetadata('hide-footer') || '').trim().toLowerCase())) {
    document.body.classList.add('hide-footer');
  }

  // Tealium (default): loads only once resolveEnvironment recognizes the host; inert elsewhere.
  if (MARTECH_PROVIDER === 'tealium') {
    tealium = new TealiumMartech({
      local: MARTECH_LOCAL,
      phaseSplit: MARTECH_PHASE_SPLIT,
      livePersonOnDemand,
      tagUids: TEALIUM_TAG_UIDS,
    });
    tealium.eager();
  }

  // Uncomment to enable AEP in parallel with Tealium (martechEager applies below).
  // let martechLoadedPromise = null;
  // let applyMartechEager = null;
  // if (MARTECH_PROVIDER !== 'off' && MARTECH_ENABLED) {
  //   try {
  //     // eslint-disable-next-line import/no-relative-packages
  //     const { initMartech, martechEager } = await import('../plugins/martech/src/index.js');
  //     applyMartechEager = martechEager;
  //     martechLoadedPromise = initMartech(
  //       { datastreamId: AEP_DATASTREAM_ID, orgId: AEP_ORG_ID },
  //       { personalization: true },
  //     );
  //   } catch (e) {
  //     martechLoadedPromise = null;
  //   }
  // }

  // EAGER experience — the single consolidated call + any whole-page swap, BEFORE decorateMain.
  const pageSwapped = await applyPageExperience(doc);
  const main = doc.querySelector('main');
  if (main) {
    buildBlogTemplate = await resolveBlogTemplate(main);
    if (isGuidePage()) {
      ({ default: buildGuideHeroAutoBlock } = await import('../blocks/guide-hero/guide-hero-autoblock.js'));
    }
    decorateMain(main);
    if (livePersonOnDemand && shouldRenderContactUs() && tealium?.enabled) {
      const facade = buildBlock('liveperson-facade', '');
      const facadeWrapper = document.createElement('div');
      const inviteDelay = livePersonInviteDelay();
      if (inviteDelay !== undefined) facade.dataset.inviteDelay = inviteDelay;
      facadeWrapper.append(facade);
      document.body.append(facadeWrapper);
      decorateBlock(facade);
      await loadBlock(facade);
    }
    // AFTER decorateMain: resolve a swapped page's own section/block slots (recursion-safe)
    // and swap the first/LCP section — both before reveal. No-op without an experience response.
    await applyEagerLayers(doc, pageSwapped);
    document.body.classList.add('appear');
    await Promise.all([
      // Uncomment with the AEP block above (applies eager martech decisions).
      // martechLoadedPromise ? martechLoadedPromise.then(applyMartechEager) : Promise.resolve(),
      loadSection(main.querySelector('.section'), waitForFirstImage),
    ]);
  }

  try {
    /* if desktop (proxy for fast connection) or fonts already loaded, load fonts.css */
    if (window.innerWidth >= 900 || sessionStorage.getItem('fonts-loaded')) {
      loadFonts();
    }
  } catch (e) {
    // do nothing
  }
}

/**
 * Loads everything that doesn't need to be delayed.
 * @param {Element} doc The container element
 */
async function loadLazy(doc) {
  // opt out of the global header/footer via the `hide-header` / `hide-footer` metadata
  const headerEl = doc.querySelector('header');
  if (headerEl && document.body.classList.contains('hide-header')) headerEl.remove();
  else loadHeader(headerEl);

  const main = doc.querySelector('main');
  // Below-the-fold personalization/experimentation
  let experienceTracking;
  if (window.hlx?.experienceResponse || window.hlx?.experienceResponsePromise) {
    const experienceModule = import('./experience.js');
    experienceTracking = experienceModule
      .then(({ applyLazyExperience }) => applyLazyExperience(doc))
      .catch(() => {});
  }
  await loadSections(main);

  // Global "Schedule a call" trigger — covers any a[href$="#schedule"] anywhere in
  // main (tabs panels, bare default content), not just blocks that opt in individually.
  if (main) {
    import('./schedule-modal.js').then(({ bindScheduleLinks }) => bindScheduleLinks(main)).catch(() => {});
  }

  // Click tracking (opt-in `tracking-` blocks) is not render-critical
  if (main) {
    import('./tracking.js')
      .then(({ initTracking }) => initTracking(document))
      .catch(() => {});
  }

  // Experience Preview engine — preview/dev hosts only, so it's inert on live/prod. Powers
  // the "Experience Preview" sidekick palette;
  const host = window.location.hostname;
  if (/\.(aem|hlx)\.page$/.test(host) || host === 'localhost' || host === '127.0.0.1') {
    // eslint-disable-next-line import/no-cycle
    import('./experience-preview.js').then((m) => m.init()).catch(() => {});
  }

  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();

  const footerEl = doc.querySelector('footer');
  if (footerEl && document.body.classList.contains('hide-footer')) footerEl.remove();
  else loadFooter(footerEl);

  // Persistent bottom-right sales widget ("Contact us" / "Talk to sales"),
  if (shouldRenderContactUs()) {
    loadCSS(`${window.hlx.codeBasePath}/blocks/contact-us/contact-us.css`);
    // eslint-disable-next-line import/no-cycle
    import('../blocks/contact-us/contact-us.js')
      .then(({ default: initContactUs }) => initContactUs({
        requestLivePerson: () => tealium?.requestLivePerson(),
      }))
      .catch(() => { /* non-fatal — widget is non-critical chrome */ });
  }

  // Tealium (default): load utag.js for the resolved env + apply consent. Fail-open.
  if (MARTECH_PROVIDER === 'tealium') {
    if (experienceTracking) await experienceTracking;
    try { await tealium.lazy(); } catch (e) { /* non-fatal */ }
  }

  // Uncomment to enable AEP in parallel with Tealium.
  // if (MARTECH_PROVIDER !== 'off' && MARTECH_ENABLED) {
  //   // eslint-disable-next-line import/no-relative-packages
  //   const adobe = await import('../plugins/martech/src/index.js').catch(() => null);
  //   if (adobe) {
  //     try { await adobe.martechLazy(); } catch (e) { /* non-fatal */ }
  //     // Auto-grant collect consent (martech inits 'pending', else form.js sendEvent drops).
  //     try { await adobe.updateUserConsent({ collect: true }); } catch (e) { /* non-fatal */ }
  //   }
  // }

  loadCSS(`${window.hlx.codeBasePath}/styles/lazy-styles.css`);
  loadFonts();
}

/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
function loadDelayed() {
  // eslint-disable-next-line import/no-cycle
  window.setTimeout(() => import('./delayed.js'), 3000);
  // load anything that can be postponed to the latest here
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
  loadDelayed();
}

loadPage();
