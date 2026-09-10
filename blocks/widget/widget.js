import { loadCSS } from '../../scripts/aem.js';

/**
 * Parses a widget href into folder path and name.
 * @param {string} pathname URL pathname (e.g. `/widgets/path1/name.html`)
 * @returns {{ widgetPath: string, widgetName: string }}
 */
function parseWidgetHref(pathname) {
  const pathSegments = pathname.split('/').filter((p) => p);
  const widgetName = pathSegments[pathSegments.length - 1].split('.')[0];
  const widgetPath = pathSegments.slice(1, -1).join('/');
  return { widgetPath, widgetName };
}

/**
 * Builds a widget asset URL.
 * @param {string} widgetPath Folder path under `/widgets/`
 * @param {string} widgetName Widget file name without extension
 * @param {string} extension File extension (`html`, `css`, `js`)
 */
function widgetUrl(widgetPath, widgetName, extension) {
  const prefix = widgetPath ? `${widgetPath}/` : '';
  return `${window.hlx.codeBasePath}/widgets/${prefix}${widgetName}.${extension}`;
}

/**
 * Applies widget metadata, block classes, and section shell classes.
 * Must run before widget HTML/JS load so decorate can read config from the DOM.
 * @param {Element} widget The widget block element
 * @param {HTMLAnchorElement} source The authored widget link
 * @param {string} widgetName Widget file name without extension
 * @param {URLSearchParams} searchParams Query params from the widget href
 */
function applyWidgetShell(widget, source, widgetName, searchParams) {
  widget.classList.add(widgetName);
  widget.classList.remove('block');
  widget.dataset.source = source.href;
  searchParams.forEach((value, key) => {
    widget.dataset[key] = value;
  });

  const wrapper = widget.closest('.widget-wrapper');
  if (wrapper) {
    wrapper.classList.add(`${widgetName}-wrapper`);
    wrapper.classList.remove('widget-wrapper');
  }
  const container = widget.closest('.widget-container');
  if (container) {
    container.classList.add(`${widgetName}-container`);
    container.classList.remove('widget-container');
  }
}

/**
 * Loads and decorates a widget block.
 * @param {Element} widget The widget block element
 */
export default async function decorate(widget) {
  const source = widget.querySelector('a[href]');
  const { pathname, searchParams } = new URL(source.href);
  const { widgetPath, widgetName } = parseWidgetHref(pathname);

  try {
    applyWidgetShell(widget, source, widgetName, searchParams);

    // CSS is optional; a HEAD probe avoids importing a stylesheet that isn't
    // there. Kicked off up front so it loads in parallel with the JS import.
    const cssUrl = widgetUrl(widgetPath, widgetName, 'css');
    const cssLoaded = fetch(cssUrl, { method: 'HEAD' })
      .then((resp) => (resp.ok ? loadCSS(cssUrl) : null));

    // JS is the widget's mandatory entry point. Import it first so it can opt in
    // to a static HTML template with `export const html = true`. Widgets are
    // JS-first (they build their own DOM), so we never speculatively fetch — and
    // 404 on — an HTML file the widget doesn't ship. Either way the authored
    // link is replaced (with the template, or cleared) before decorate runs.
    const mod = await import(widgetUrl(widgetPath, widgetName, 'js'));
    if (mod.html) {
      const htmlResp = await fetch(widgetUrl(widgetPath, widgetName, 'html'));
      widget.innerHTML = htmlResp.ok ? await htmlResp.text() : '';
    } else {
      widget.innerHTML = '';
    }

    if (mod.default) await mod.default(widget);
    await cssLoaded;
  } catch (error) {
    window.coreServiceAdapter?.logger?.error?.(`failed to load widget ${widgetPath}/${widgetName}`, { error });
  }
}
