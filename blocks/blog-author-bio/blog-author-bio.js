/**
 * blog-author-bio — end-of-article author bio + social-share strip, from the
 * blog query-index (author row) and the current article URL.
 *
 * Injected as a block before decorateSections so it rides the section pipeline:
 * hidden until this async decorate resolves, then revealed fully-formed below
 * the fold — no layout shift (#519). Untrusted feed values via textContent /
 * img.src, never innerHTML.
 */
import { getMetadata, toClassName, createOptimizedPicture } from '../../scripts/aem.js';
import { loadIndex } from '../../scripts/content-index.js';
import { trackAs } from '../../scripts/tracking.js';

const BLOG_INDEX = '/blog/query-index.json';

/**
 * Author's query-index row for the given slug, or null. The index is cached by
 * content-index.js, so this shares one fetch with the page's other blocks.
 * @param {string} slug author slug (e.g. "abigail-sims")
 * @returns {Promise<object|null>}
 */
async function fetchAuthorRow(slug) {
  try {
    const entries = await loadIndex(BLOG_INDEX);
    return entries.find((e) => e.path === `/blog/author/${slug}`) || null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.debug(`author-bio: could not load author row for "${slug}"`, error);
    return null;
  }
}

/**
 * Social-share strip (Facebook / X / LinkedIn) shown above the bio; links carry
 * the current article URL.
 * @returns {HTMLDivElement}
 */
function buildSocialShare() {
  const enc = encodeURIComponent(window.location.href);
  const networks = [
    { name: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc}` },
    { name: 'x', label: 'X', href: `https://twitter.com/share?url=${enc}` },
    { name: 'linkedin', label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc}` },
  ];
  const wrap = document.createElement('div');
  wrap.className = 'blog-social-share';
  const label = document.createElement('span');
  label.className = 'blog-social-share-label';
  label.textContent = 'Share';
  wrap.append(label);
  const list = document.createElement('ul');
  list.className = 'blog-social-share-list';
  networks.forEach((n) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = `blog-social-share-icon blog-social-${n.name}`;
    a.href = n.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', `Share on ${n.label}`);
    const icon = document.createElement('img');
    icon.src = `${window.hlx.codeBasePath}/icons/${n.name}.svg`;
    icon.alt = '';
    icon.width = 16;
    icon.height = 16;
    icon.loading = 'lazy';
    a.append(icon);
    li.append(a);
    list.append(li);
  });
  wrap.append(list);
  return wrap;
}

/**
 * Builds the author bio strip (circular headshot, linked name, description)
 * from the given query-index row.
 * @param {object} row the author's query-index row
 * @param {string} authorPath /blog/author/<slug>
 * @returns {HTMLDivElement}
 */
function buildBio(row, authorPath) {
  const inner = document.createElement('div');
  inner.className = 'blog-author-bio-inner';
  if (row.image) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'blog-author-bio-avatar';
    const picture = createOptimizedPicture(row.image, row.title || '', false, [{ width: '120' }]);
    const img = picture.querySelector('img');
    img.width = 120;
    img.height = 120;
    imgWrap.append(picture);
    inner.append(imgWrap);
  }
  const textWrap = document.createElement('div');
  textWrap.className = 'blog-author-bio-text';
  if (row.title) {
    const nameEl = document.createElement('p');
    nameEl.className = 'blog-author-bio-name';
    const nameLink = document.createElement('a');
    nameLink.href = authorPath;
    nameLink.textContent = row.title;
    nameEl.append(nameLink);
    textWrap.append(nameEl);
  }
  if (row.description) {
    const bioEl = document.createElement('p');
    bioEl.className = 'blog-author-bio-desc';
    bioEl.textContent = row.description;
    textWrap.append(bioEl);
  }
  inner.append(textWrap);
  return inner;
}

/**
 * loads and decorates the block
 * @param {Element} block the blog-author-bio block
 */
export default async function decorate(block) {
  const author = getMetadata('author');
  const slug = author && toClassName(author);
  const row = slug ? await fetchAuthorRow(slug) : null;
  if (!row) {
    // no row → drop the section so the pipeline doesn't reveal an empty band
    block.closest('.section')?.remove();
    return;
  }
  block.replaceChildren(buildSocialShare(), buildBio(row, `/blog/author/${slug}`));
  // author link reports under the `author_bio` trail (prod omits link_name)
  trackAs('author_bio', block, { key: 'author_bio', linkName: false });
}
