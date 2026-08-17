import {
  loadHeader,
  loadFooter,
  decorateIcons,
  decorateSections,
  decorateBlocks,
  decorateTemplateAndTheme,
  waitForFirstImage,
  loadSection,
  loadSections,
  loadCSS,
  buildBlock,
  getMetadata,
  readBlockConfig,
  toClassName,
} from './aem.js';
import { runExperimentation, runExperimentationLazy } from './experiment-loader.js';
// exp.js / pzn.js are dynamically imported (via runExperienceLayer) only when a
// `data-pzn` / `data-exp` section is present, so pages without personalization
// never load them.
// Vendored via git subtree at plugins/martech (see its README), not an
// installed npm package, so this necessarily crosses a package.json boundary.
import {
  initMartech, martechEager, martechLazy, updateUserConsent,
  // eslint-disable-next-line import/no-relative-packages
} from '../plugins/martech/src/index.js';
// Not a vendored subtree (unlike plugins/martech above) — project-owned code, but the relative
// import still crosses into plugins/ so the disable comment mirrors the existing martech import.
// eslint-disable-next-line import/no-relative-packages
import TealiumMartech from '../plugins/tealium-martech/src/index.js';
// Cheap predicates only — the heavy blog-template / video blocks they belong to
// are NOT pulled onto the eager critical path here. buildBlogTemplate is
// dynamically imported in loadEager for blog pages only (see below); the full
// video block loads lazily when a video is actually decorated.
import { isBlogPage, isCaseStudyPage } from '../blocks/blog-template/blog-detect.js';
import { isVideoLink } from '../blocks/video/video-info.js';
import { isGuidePage } from '../blocks/guide-hero/guide-detect.js';

// Adobe Web SDK / AEP datastream. The datastream id is public (not a secret)
// and safe in client source. While the id starts with "REPLACE_", martech is
// NOT initialized (see loadEager), so this changes nothing and cannot affect
// the live demo. Datastream confirmed valid against the sapphiredemo1 org
// (developersandbox1) — verified live in Adobe Assurance (events, identity
// stitch, and RTCDP segment resolution all working).
const AEP_DATASTREAM_ID = 'a114467b-290b-4429-9d7e-56bc5b5786fa';
const AEP_ORG_ID = '87020D54659BEED90A495E68@AdobeOrg';
// Experience Workspace previews the page from a *.preview.da.live domain —
// martech (Alloy) loading there can interfere with that preview, so it's
// disabled regardless of datastream config on that host.
const MARTECH_ENABLED = !AEP_DATASTREAM_ID.startsWith('REPLACE_')
  && !window.location.hostname.endsWith('.preview.da.live');

// Provider gate via the `?martech=` query param:
//   off    -> disable ALL martech (no Tealium, no Adobe — fully inert)
//   adobe  -> legacy Adobe/aem-martech path (opt-in)
//   local  -> Tealium, loading utag.js + the OneTrust consent stack from local copies in
//             /scripts/martech/ (for testing without Intuit's VPN-gated consent CDN)
//   (absent / any other value) -> Tealium, loading from the vendor CDNs (the default)
// Tealium still self-gates via TealiumMartech's `resolveEnvironment`
// (plugins/tealium-martech/src/index.js): only erp.intuit.com -> 'prod'; stage.erp.intuit.com, the
// aem.page/aem.live previews, and localhost -> 'dev'; every other host stays inert.
const MARTECH_PARAM = new URLSearchParams(window.location.search).get('martech');
const MARTECH_PROVIDER = { off: 'off', adobe: 'adobe' }[MARTECH_PARAM] || 'tealium';
// `?martech=local`: load utag.js + the consent stack from /scripts/martech/ instead of the CDNs.
const MARTECH_LOCAL = MARTECH_PARAM === 'local';

// Set in loadEager when MARTECH_PROVIDER === 'tealium' (the default); stays undefined on the
// opt-in Adobe path. Exposed via getTealium() so scripts/delayed.js can call `.delayed()`
// without importing the class itself.
let tealium;

/**
 * Returns the active `TealiumMartech` instance, or `undefined` when the opt-in Adobe provider
 * (`?martech=adobe`) is active instead.
 * @returns {TealiumMartech|undefined} the active Tealium loader instance, if any
 */
export function getTealium() {
  return tealium;
}

let siteConfigPromise;

// Site-wide integration values (Marketo/ChiliPiper/reCAPTCHA) live in the
// ops-owned /site-config.json DA sheet, never in code or per-page authoring.
// Fetched once; returns a flat key->value map ("true"/"false" coerced to
// boolean), or {} when the sheet is unavailable (local/dev without it).
export function getSiteConfig() {
  if (!siteConfigPromise) {
    siteConfigPromise = fetch('/site-config.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const cfg = {};
        (json?.data || []).forEach(({ key, value }) => {
          if (!key) return;
          if (value === 'true') cfg[key] = true;
          else if (value === 'false') cfg[key] = false;
          else cfg[key] = value;
        });
        return cfg;
      })
      .catch(() => ({}));
  }
  return siteConfigPromise;
}

// no custom prod domain configured yet — treat only the .aem.live CDN as
// prod (no pill overlay); .aem.page previews and localhost stay in debug mode.
const experimentationConfig = {
  isProd: () => window.location.hostname.endsWith('.aem.live'),
  audiences: {
    mobile: () => window.innerWidth < 600,
    desktop: () => window.innerWidth >= 600,
  },
};

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
 * preceding sibling — in the latter case it is absorbed into the block so the
 * video block owns a single poster (with play button) instead of leaving the
 * image orphaned and the block falling back to the provider thumbnail.
 * Skips inline prose links and links already inside a block cell (e.g.
 * testimonial.video), so only standalone thumbnail-links are upgraded.
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

// Populated in loadEager (via dynamic import) only on blog article pages, so the
// ~21KB blog-template module never loads on other pages. Stays undefined
// elsewhere, which also serves as the "is this a blog page" gate below.
let buildBlogTemplate;

// Same treatment for the Guide landing-page card: imported in loadEager only for
// `template: Guide` pages, so the other ~335 pages in the sitemap never fetch or
// parse it. Undefined elsewhere, which is the gate in buildAutoBlocks.
let buildGuideHeroAutoBlock;

// Populated in loadEager (via dynamic import) only on case-study pages, so the
// case-study-header module loads only where needed. Also serves as the gate in
// buildAutoBlocks below.
let buildCaseStudyHeader;

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function buildAutoBlocks(main) {
  try {
    // Blog article autoblock — must run FIRST so the right-rail /fragments/ link
    // it injects is present when the fragment collection below queries for it.
    // Guard on main.isConnected: decorateMain also runs on the DETACHED main that
    // loadFragment builds for the right-rail fragment. buildBlogTemplate is only
    // set on blog pages (loadEager); the isConnected guard stops the autoblock
    // from re-injecting a right-rail link into every loaded fragment (which
    // buildAutoBlocks would then re-load — an infinite loop).
    if (buildBlogTemplate && main.isConnected) buildBlogTemplate(main);
    // Guide landing pages get their own lead card instead. The isConnected guard
    // matters as much here as above: loadFragment decorates a DETACHED main, and
    // getMetadata reads the HOST page's head — so on a Guide page every loaded
    // fragment would otherwise have its own first section wrapped in a second
    // card (verified: 2 `.guide-hero` blocks, the fragment's heading inside one).
    if (buildGuideHeroAutoBlock && main.isConnected) buildGuideHeroAutoBlock(main);
    // Case-study autoblock — synthesize the case-study-header (eyebrow + byline +
    // banner) from metadata when it isn't hand-authored, so migrated case studies
    // show their author. isConnected guard mirrors buildBlogTemplate (skip the
    // detached fragment main).
    if (buildCaseStudyHeader && main.isConnected) buildCaseStudyHeader(main);
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
    // Decide per-paragraph up front (before any mutation): a paragraph may hold a
    // single CTA (whose text must equal the paragraph's) OR multiple formatted CTA
    // links sharing one line (e.g. primary <strong><a> + secondary <em><a>). In the
    // multi-link case we buttonize each link and skip the whole-paragraph text guard.
    const formatted = [...p.querySelectorAll(':scope strong > a[href], :scope em > a[href]')];
    // Only treat as a multi-CTA paragraph when the paragraph's ENTIRE visible text
    // is just the formatted link texts (plus whitespace/separators) — i.e. a row of
    // CTAs, not prose that happens to bold/italic-link two words. This mirrors the
    // single-CTA "sole content" guard so buttonization stays scoped to real CTAs.
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

/**
 * Applies section-level style variants from "Section Metadata" blocks.
 *
 * This project uses a trimmed decorateSections() (in aem.js, which must not be
 * modified) that does not read Section Metadata into style classes like the
 * stock boilerplate does. This re-adds that behaviour generically: any section
 * whose Section Metadata has a "Style" key gets those values applied as classes
 * on the section element. It is a no-op for sections without Section Metadata,
 * so existing pages are unaffected.
 * @param {Element} main The main element
 */
function decorateSectionStyles(main) {
  main.querySelectorAll('.section .section-metadata').forEach((meta) => {
    const section = meta.closest('.section');
    if (!section) return;
    const config = readBlockConfig(meta);
    if (config.style) {
      config.style.split(',')
        .map((s) => toClassName(s.trim()))
        .filter((s) => !!s)
        .forEach((s) => section.classList.add(s));
    }
    // remove the metadata block (and its wrapper) so it is neither rendered nor
    // picked up by decorateBlocks() as a loadable block.
    const wrapper = meta.closest('.section-metadata-wrapper');
    (wrapper || meta).remove();
  });
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
// eslint-disable-next-line import/prefer-default-export
export function decorateMain(main) {
  decorateIcons(main);
  buildAutoBlocks(main);
  decorateSections(main);
  decorateSectionStyles(main);
  decorateBlocks(main);
  decorateButtons(main);
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
function redirectConstructionQToLlmAppCtx() {
  if (window.location.pathname !== '/construction') return;
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  if (!q) return;
  params.delete('q');
  params.set('llm_app_ctx', q);
  window.location.replace(`${window.location.pathname}?${params.toString()}${window.location.hash}`);
}

/**
 * Personalization (`data-pzn`) + experimentation (`data-exp`) for a DOM scope.
 * Loads pzn.js / exp.js only when the corresponding marker is present in `root`
 * (which may itself carry the attribute), runs both concurrently under one
 * fail-open guard, and skips the `skip` section (used to run the first/LCP
 * section eagerly and the rest lazily without double-processing).
 * @param {Element} root
 * @param {{ skip?: Element }} [opts]
 */
async function runExperienceLayer(root, { skip } = {}) {
  if (!root) return;
  const has = (attr) => (root.matches?.(`[${attr}]`) && root !== skip)
    || [...root.querySelectorAll(`[${attr}]`)].some((el) => el !== skip);
  const hasPzn = has('data-pzn');
  const hasExp = has('data-exp');
  if (!hasPzn && !hasExp) return;
  const { withTimeout } = await import('./personalization/decision.js');
  const tasks = [];
  if (hasPzn) tasks.push(import('./pzn.js').then(({ runPersonalization }) => runPersonalization(root, { skip })));
  if (hasExp) tasks.push(import('./exp.js').then(({ runBlockExperiments }) => runBlockExperiments(root, { skip })));
  await withTimeout(Promise.all(tasks), 1500);
}

async function loadEager(doc) {
  redirectConstructionQToLlmAppCtx();
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();

  // The cyan events bar (blocks/header/header.js) is part of the header, which
  // only renders in the lazy phase — so without an eager height hint the bar
  // pops in later and shoves the page down (CLS). Mirror the per-page opt-in
  // (events-bar metadata) onto <body> now, in the eager phase, so styles.css
  // can reserve the taller header height up front. Keep the truthy test in sync
  // with eventsBarHTML() in header.js.
  if (['true', 'yes'].includes((getMetadata('events-bar') || '').trim().toLowerCase())) {
    document.body.classList.add('has-events-bar');
  }

  // Seed window.appVars before martech so the tracker finds it; analytics.js fills the arrays.
  const appVars = window.appVars || (window.appVars = {});
  const casId = getMetadata('cas-id') || getMetadata('page-cas-id');
  appVars.externalContentIdentifier = casId || appVars.externalContentIdentifier || '';
  appVars.pznRecDetailsArr = appVars.pznRecDetailsArr || [];
  appVars.pznPageRecDetailsArr = appVars.pznPageRecDetailsArr || [];
  appVars.ixpDetailsArr = appVars.ixpDetailsArr || [];

  // Gated conversion pages (e.g. /webinar-* form landings) opt out of the global
  // header/footer via `hide-header` / `hide-footer` metadata, matching production
  // which serves them chrome-less. Set the body classes eagerly (like has-events-bar)
  // so styles.css can drop the reserved header height NOW and avoid a post-LCP
  // layout shift when loadLazy skips loadHeader/loadFooter.
  if (['true', 'yes', 'hide'].includes((getMetadata('hide-header') || '').trim().toLowerCase())) {
    document.body.classList.add('hide-header');
  }
  if (['true', 'yes', 'hide'].includes((getMetadata('hide-footer') || '').trim().toLowerCase())) {
    document.body.classList.add('hide-footer');
  }

  // Adobe Web SDK (aem-martech). Kept INERT until a real AEP datastream id is
  // set (MARTECH_ENABLED). When enabled, initMartech kicks off the datastream
  // call that will surface RTCDP/AJO propositions; martechEager applies any
  // personalization decisions before content reveal (flicker-free). Guarded so
  // a missing/placeholder datastream never initializes Alloy or hides the body.
  // Only runs on the opt-in Adobe provider path (`?martech=adobe`).
  let martechLoadedPromise = null;
  if (MARTECH_PROVIDER === 'adobe' && MARTECH_ENABLED) {
    try {
      martechLoadedPromise = initMartech(
        { datastreamId: AEP_DATASTREAM_ID, orgId: AEP_ORG_ID },
        { personalization: true },
      );
    } catch (e) {
      martechLoadedPromise = null;
    }
  } else if (MARTECH_PROVIDER === 'tealium') {
    // Real Tealium (env 'prod'/'qa'/'dev') only ever loads once TealiumMartech#resolveEnvironment
    // recognizes the hostname; every other host stays inert — eager() itself does no network work.
    tealium = new TealiumMartech({ local: MARTECH_LOCAL });
    tealium.eager();
  }

  await runExperimentation(doc, experimentationConfig);
  // Intuit IXP whole-page experiment: swaps <main> before decoration. Metadata-
  // gated (loaded only when enrolled) and phase-bounded so it never blocks reveal.
  if (getMetadata('experiment-id') || getMetadata('experiment-label')) {
    const [{ runExperiment }, { withTimeout }] = await Promise.all([
      import('./exp.js'),
      import('./personalization/decision.js'),
    ]);
    await withTimeout(runExperiment(doc), 1500);
  }
  const main = doc.querySelector('main');
  if (main) {
    // Blog article pages need buildBlogTemplate during eager decoration; import
    // it here — only for those pages — so buildAutoBlocks can call it
    // synchronously while every other page skips the ~21KB module entirely.
    if (isBlogPage()) {
      ({ buildBlogTemplate } = await import('../blocks/blog-template/blog-template.js'));
    } else if (isCaseStudyPage()) {
      ({ buildCaseStudyHeader } = await import('../blocks/case-study-header/case-study-header.js'));
      // case-study pages share the same in-article testimonial pull-quote
      // treatment as blog articles; that override lives in blog-template.css,
      // which only blog pages otherwise load.
      loadCSS(`${window.hlx.codeBasePath}/blocks/blog-template/blog-template.css`);
    }
    // Guide landing pages: same shape, so the module is fetched only for the
    // pages that use it. Gated on the `Guide` template alone — see guide-detect.js
    // for why the path is deliberately not part of the test.
    if (isGuidePage()) {
      ({ default: buildGuideHeroAutoBlock } = await import('../blocks/guide-hero/guide-hero-autoblock.js'));
    }
    decorateMain(main);
    // Personalize/experiment the first (LCP) section before reveal so the visitor
    // sees final content with no flash. Sections below the fold are handled in
    // loadLazy (post-LCP) so their pzn/exp swaps never block LCP.
    const firstSection = main.querySelector('.section');
    if (firstSection) await runExperienceLayer(firstSection);
    document.body.classList.add('appear');
    await Promise.all([
      martechLoadedPromise ? martechLoadedPromise.then(martechEager) : Promise.resolve(),
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

// Pages that already carry the full contact form (the live page and the
// library stencil authors copy it from) suppress the site-wide floating
// "Contact us" widget, matching production behavior.
const CONTACT_WIDGET_EXCLUDED_PATHS = ['/contact', '/library/templates/contact'];

/** True unless the current path opts out of the floating contact widget. */
function shouldRenderContactUs() {
  return !CONTACT_WIDGET_EXCLUDED_PATHS.includes(window.location.pathname);
}

/**
 * Loads everything that doesn't need to be delayed.
 * @param {Element} doc The container element
 */
async function loadLazy(doc) {
  // Gated/conversion pages opt out of the global header/footer via the
  // `hide-header` / `hide-footer` metadata, surfaced as body classes in the eager
  // phase (see loadEager) so the reserved header height is dropped before LCP.
  // Here we simply skip loading (and remove the empty element). Default: load both.
  const headerEl = doc.querySelector('header');
  if (headerEl && document.body.classList.contains('hide-header')) headerEl.remove();
  else loadHeader(headerEl);

  const main = doc.querySelector('main');
  // Below-the-fold personalization/experimentation: run the sections after the
  // first (the LCP one, already handled eagerly) now that LCP has painted. Not
  // awaited — these swaps must never block reveal or the lazy pipeline.
  if (main) runExperienceLayer(main, { skip: main.querySelector('.section') }).catch(() => {});
  await loadSections(main);

  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();

  const footerEl = doc.querySelector('footer');
  if (footerEl && document.body.classList.contains('hide-footer')) footerEl.remove();
  else loadFooter(footerEl);

  // Persistent bottom-right sales widget ("Contact us" / "Talk to sales"),
  // present on every page except CONTACT_WIDGET_EXCLUDED_PATHS. Loaded here
  // (lazy phase) so it never touches LCP.
  if (shouldRenderContactUs()) {
    loadCSS(`${window.hlx.codeBasePath}/blocks/contact-us/contact-us.css`);
    // eslint-disable-next-line import/no-cycle
    import('../blocks/contact-us/contact-us.js')
      .then(({ default: initContactUs }) => initContactUs())
      .catch(() => { /* non-fatal — widget is non-critical chrome */ });
  }

  if (MARTECH_PROVIDER === 'adobe' && MARTECH_ENABLED) {
    try { await martechLazy(); } catch (e) { /* non-fatal */ }
    // Demo posture: auto-grant collection consent (martech inits consent 'pending', which
    // would otherwise drop sendEvent). Needed for blocks/form/form.js's lead-identity
    // sendEvent call on this provider path. Fail-open — never blocks the page.
    try { await updateUserConsent({ collect: true }); } catch (e) { /* non-fatal */ }
  } else if (MARTECH_PROVIDER === 'tealium') {
    // Loads utag.js for the resolved env (no-op on an inert host) and applies consent. Fail-open,
    // like the Adobe branch above — never block the page.
    try { await tealium.lazy(); } catch (e) { /* non-fatal */ }
  }

  await runExperimentationLazy(doc, experimentationConfig);

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
