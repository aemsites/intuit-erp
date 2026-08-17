/**
 * isBlogPage — the cheap "is this a blog article?" predicate, split out from
 * blog-template.js so scripts.js can gate blog decoration in the eager phase
 * without statically importing the (~21KB) blog-template module on every page.
 * blog-template.js re-exports it so its public API is unchanged.
 */
import { getMetadata } from '../../scripts/aem.js';

/**
 * True on a blog *article* page (drives the TOC/right-rail template build).
 * @returns {boolean}
 */
export function isBlogPage() {
  const path = window.location.pathname;
  if (!path.startsWith('/blog/')) return false;
  const template = getMetadata('template').trim().toLowerCase();
  if (template) return template === 'blog article';
  // fallback (no template metadata): /blog/<category>/<slug>, not /blog/author/*
  const segments = path.replace(/\/+$/, '').slice('/blog/'.length).split('/').filter(Boolean);
  return segments.length >= 2 && segments[0] !== 'author';
}

/**
 * True on a case-study detail page (template metadata = "case study"). These
 * pages use the dedicated case-study-header block; the autoblock synthesizes it
 * from metadata when it isn't hand-authored.
 * @returns {boolean}
 */
export function isCaseStudyPage() {
  const template = getMetadata('template').trim().toLowerCase();
  return template === 'case study';
}
