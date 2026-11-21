// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

const BLOCK_TEXT_TAGS = ['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];

/** Parse a page's Metadata block into a flat { name: value } object. */
export function parseMetadata(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const block = doc.querySelector('div.metadata');
  if (!block) return {};

  const meta = {};
  const rows = block.querySelectorAll(':scope > div');
  rows.forEach((row) => {
    const cells = row.querySelectorAll(':scope > div');
    if (cells.length < 2) return;
    const name = cells[0].textContent.trim().toLowerCase();
    const value = cells[1].textContent.trim();
    if (name) meta[name] = value;
  });
  return meta;
}

function pick(meta, ...keys) {
  return keys.map((k) => meta[k]).find(Boolean);
}

/** Join the text of each block-level element with a single space so items
 * never run together (a plain .textContent grab loses these boundaries). */
function flattenAnswer(answerEl) {
  const blocks = [...answerEl.querySelectorAll(BLOCK_TEXT_TAGS.join(','))];
  const parts = blocks
    .map((block) => block.textContent.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (parts.length) return parts.join(' ');
  return answerEl.textContent.replace(/\s+/g, ' ').trim();
}

/** Find every .faq-classed block (any variant, e.g. "faq cmp") and extract
 * its Q&A rows, de-duplicating exact repeats (a whole block can appear
 * twice in authored content by accident). */
export function extractFaqEntities(doc) {
  const entities = [];
  const seen = new Set();
  const faqBlocks = [...doc.querySelectorAll('div')]
    .filter((node) => node.classList.contains('faq'));

  faqBlocks.forEach((block) => {
    const rows = [...block.querySelectorAll(':scope > div')];
    rows.forEach((row) => {
      const cells = [...row.querySelectorAll(':scope > div')];
      if (cells.length < 2) return;
      const question = cells[0].textContent.replace(/\s+/g, ' ').trim();
      const answer = flattenAnswer(cells[1]);
      const key = `${question} ${answer}`;
      if (question && answer && !seen.has(key)) {
        seen.add(key);
        entities.push({ question, answer });
      }
    });
  });

  return entities;
}

function buildSourceUrl(context) {
  const site = context.site || context.repo;
  return `https://admin.da.live/source/${context.org}/${site}${context.path}.html`;
}

function buildPageUrl(context) {
  const site = context.site || context.repo;
  return `https://main--${site}--${context.org}.aem.page${context.path}`;
}

/** Parse the page's existing json-ld metadata value, if any.
 * Returns { graph, isGraph } where graph is always an array of nodes
 * (a lone node gets wrapped) and isGraph tracks whether the source used
 * a @graph wrapper, so we can round-trip the same shape back out. */
function parseExistingJsonLd(meta) {
  const raw = meta['json-ld'];
  if (!raw) return { graph: [], isGraph: false };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed['@graph'])) {
      return { graph: parsed['@graph'], isGraph: true };
    }
    return { graph: [parsed], isGraph: false };
  } catch {
    return { graph: [], isGraph: false };
  }
}

/** Resolve the canonical URL to build the FAQPage @id from, in order:
 * 1. an existing WebPage node's url/@id in the page's own json-ld
 * 2. a plain canonical/url metadata key
 * 3. the current aem.page/aem.live URL, as a last resort. */
function resolveCanonicalUrl(graph, meta, context) {
  const webPage = graph.find((node) => {
    const type = node['@type'];
    return type === 'WebPage' || (Array.isArray(type) && type.includes('WebPage'));
  });
  const fromWebPage = webPage?.url || webPage?.['@id'];
  if (fromWebPage) return fromWebPage.split('#')[0];

  const fromMeta = pick(meta, 'canonical', 'url');
  if (fromMeta) return fromMeta;

  return buildPageUrl(context);
}

export function buildFaqPageSchema(entities, baseUrl) {
  return {
    '@type': 'FAQPage',
    '@id': `${baseUrl}#faq`,
    mainEntity: entities.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
}

/** Merge the FAQPage node into the existing graph, replacing any prior
 * FAQPage node by @type so re-running the plugin is idempotent. */
function mergeGraph(graph, faqNode) {
  const withoutFaq = graph.filter((node) => node['@type'] !== 'FAQPage');
  return [...withoutFaq, faqNode];
}

function buildOutputJson(existing, faqNode) {
  const { graph, isGraph } = existing;

  if (!graph.length) {
    return { '@context': 'https://schema.org', ...faqNode };
  }

  const merged = mergeGraph(graph, faqNode);

  if (!isGraph && merged.length === 1) {
    return { '@context': 'https://schema.org', ...merged[0] };
  }

  return { '@context': 'https://schema.org', '@graph': merged };
}

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  children.forEach((child) => node.appendChild(child));
  return node;
}

function showStatus(container, text, kind) {
  container.textContent = '';
  container.appendChild(el('p', { class: `status ${kind || ''}`, text }));
}

function renderResult(container, { entities, json }) {
  container.textContent = '';

  const list = el('ul', { class: 'faq-list' }, entities.map(({ question, answer }) => el('li', {}, [
    el('p', { class: 'faq-question', text: question }),
    el('p', { class: 'faq-answer', text: answer.length > 140 ? `${answer.slice(0, 140)}…` : answer }),
  ])));

  const note = el('p', {
    class: 'note',
    text: 'Re-run this after any FAQ content change — this tool does not auto-update the page.',
  });

  const pre = el('pre', { class: 'preview', text: json });

  const copyBtn = el('button', { class: 'copy-btn', text: 'Copy JSON-LD to clipboard' });
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(json);
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied ✓';
      setTimeout(() => { copyBtn.textContent = original; }, 1500);
    } catch {
      copyBtn.hidden = true;
      const textarea = document.createElement('textarea');
      textarea.value = json;
      textarea.rows = 10;
      textarea.className = 'fallback-textarea';
      textarea.addEventListener('focus', () => textarea.select());
      container.appendChild(textarea);
    }
  });

  container.append(
    el('p', { class: 'summary', text: `Found ${entities.length} FAQ item${entities.length === 1 ? '' : 's'}.` }),
    list,
    note,
    pre,
    copyBtn,
  );
}

async function init() {
  const root = document.getElementById('app');

  const { context, actions } = await DA_SDK;

  showStatus(root, 'Loading page…', '');

  let html;
  try {
    const response = await actions.daFetch(buildSourceUrl(context));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    html = await response.text();
  } catch {
    showStatus(root, 'Could not load page source.', 'error');
    return;
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const entities = extractFaqEntities(doc);

  if (!entities.length) {
    showStatus(root, 'No .faq block found on this page.', 'error');
    return;
  }

  const meta = parseMetadata(html);
  const existing = parseExistingJsonLd(meta);
  const baseUrl = resolveCanonicalUrl(existing.graph, meta, context);
  const faqNode = buildFaqPageSchema(entities, baseUrl);
  const output = buildOutputJson(existing, faqNode);
  const json = JSON.stringify(output, null, 2);

  renderResult(root, { entities, json });
}

init().catch(() => {
  const root = document.getElementById('app');
  if (root) showStatus(root, 'Something went wrong loading the plugin.', 'error');
});
