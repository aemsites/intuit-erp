/**
 * diff.mjs — structural (not byte) comparison of two DA HTML documents.
 *
 * Byte diffs are useless here (collapsed whitespace, genuinely-changed source
 * prose). What matters for a re-import is that the block/section STRUCTURE and
 * metadata line up. We reduce each document to a per-section list of block
 * classes + heading texts and diff those.
 */
import { JSDOM } from 'jsdom';

/** Per-section signature: array of sections, each an array of token strings. */
export function signature(html) {
  const main = new JSDOM(html).window.document.querySelector('main');
  if (!main) return [];
  return [...main.children].map((sec) => [...sec.children].map((el) => {
    if (el.classList.length) return `[${[...el.classList].join('.')}]`;
    if (/^H[1-6]$/.test(el.tagName)) return `${el.tagName.toLowerCase()}:${el.textContent.trim().slice(0, 40)}`;
    if (el.tagName === 'A' && el.querySelector('picture,img')) return `video:${(el.getAttribute('href') || '').slice(0, 40)}`;
    if (el.tagName === 'PICTURE' || el.tagName === 'IMG') return 'img';
    if (el.tagName === 'P' && el.querySelector('picture,img') && !el.querySelector('a')) return 'img';
    const a = el.tagName === 'P' ? el.querySelector('a') : null;
    if (a && !el.textContent.replace(a.textContent, '').trim()) return `link:${(a.getAttribute('href') || '').slice(0, 30)}`;
    return el.tagName.toLowerCase();
  }));
}

const flat = (sig) => sig.map((s, i) => `S${i}: ${s.join(' ')}`);

/**
 * Print a side-by-side structural diff. Returns true if identical.
 * @param {string} genHtml generated HTML
 * @param {string} daHtml existing/DA HTML
 * @param {(s:string)=>void} [log]
 */
export function diffStructure(genHtml, daHtml, log = console.log) {
  const gen = flat(signature(genHtml));
  const da = flat(signature(daHtml));
  const n = Math.max(gen.length, da.length);
  let same = true;
  for (let i = 0; i < n; i += 1) {
    const g = gen[i] || '';
    const d = da[i] || '';
    if (g === d) {
      log(`  = ${g}`);
    } else {
      same = false;
      log(`  - DA:  ${d}`);
      log(`  + GEN: ${g}`);
    }
  }
  return same;
}
