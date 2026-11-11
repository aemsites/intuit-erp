import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import decorate from '../blocks/promo-banner/promo-banner.js';

function make(cells) {
  const block = document.createElement('div');
  block.className = 'promo-banner block';
  block.innerHTML = `<div>${cells.map((c) => `<div>${c}</div>`).join('')}</div>`;
  return block;
}

const text = (block) => block.querySelector('.promo-banner-text').textContent;

describe('promo-banner block', () => {
  it('renders the text, a brace-less label and the authored CTA', () => {
    const block = make([
      '<p>Get {{50% OFF}} QuickBooks for 3 months*</p>',
      '<p><a href="/buy">Buy now</a></p>',
    ]);
    decorate(block);
    const labels = block.querySelectorAll('.promo-banner-label');
    expect(labels.length).toBe(1);
    expect(labels[0].textContent).toBe('50% OFF');
    expect(text(block)).toBe('Get 50% OFF QuickBooks for 3 months*');
    expect(block.textContent).not.toMatch(/\{\{|\}\}/);
    const cta = block.querySelector('.promo-banner-cta a.button.primary');
    expect(cta.getAttribute('href')).toBe('/buy');
    expect(cta.textContent).toBe('Buy now');
  });

  it('renders text without a label normally', () => {
    const block = make(['<p>QuickBooks for 3 months</p>', '<p><a href="/buy">Buy now</a></p>']);
    decorate(block);
    expect(block.querySelector('.promo-banner-label')).toBeNull();
    expect(text(block)).toBe('QuickBooks for 3 months');
  });

  it('highlights every label in the text', () => {
    const block = make(['<p>{{A}} and {{B}}</p>', '<p><a href="/buy">Buy now</a></p>']);
    decorate(block);
    const labels = [...block.querySelectorAll('.promo-banner-label')].map((l) => l.textContent);
    expect(labels).toEqual(['A', 'B']);
    expect(text(block)).toBe('A and B');
  });

  it('unwraps a pre-buttonized CTA without leaving empty wrappers', () => {
    const block = make([
      '<p>Save now</p>',
      '<p class="button-wrapper"><strong><a class="button primary" href="/x">Go</a></strong></p>',
    ]);
    decorate(block);
    const ctas = block.querySelectorAll('.promo-banner-cta a.button.primary');
    expect(ctas.length).toBe(1);
    expect(ctas[0].parentElement.className).toBe('promo-banner-cta');
    expect(block.querySelector('.promo-banner-cta p, .promo-banner-cta strong')).toBeNull();
    [...block.querySelectorAll('p, strong')].forEach((el) => expect(el.textContent.trim()).not.toBe(''));
  });

  it('forces the CTA to the primary style', () => {
    const em = make(['<p>Save</p>', '<p><em><a href="/e">Go</a></em></p>']);
    decorate(em);
    expect(em.querySelector('.promo-banner-cta a').className).toBe('button primary');
    expect(em.querySelector('em')).toBeNull();

    const secondary = make([
      '<p>Save</p>',
      '<p class="button-wrapper"><em><a class="button secondary" href="/s">Go</a></em></p>',
    ]);
    decorate(secondary);
    expect(secondary.querySelector('.promo-banner-cta a').className).toBe('button primary');
  });

  it('uses the last link of a single cell as the CTA', () => {
    const block = make(['<p>Save {{20%}} <a href="/y">Shop</a></p>']);
    decorate(block);
    const cta = block.querySelector('.promo-banner-cta a.button.primary');
    expect(cta.getAttribute('href')).toBe('/y');
    expect(text(block)).not.toContain('Shop');
    expect(block.querySelector('.promo-banner-label').textContent).toBe('20%');
  });

  it('omits the CTA when no link is authored', () => {
    const block = make(['<p>Get {{50% OFF}} today</p>']);
    decorate(block);
    expect(block.querySelector('.promo-banner-cta')).toBeNull();
    expect(text(block)).toBe('Get 50% OFF today');
  });

  it('leaves empty or partial braces literal', () => {
    const block = make(['<p>Empty {{}} and {{ }} and {{open</p>', '<p><a href="/b">Go</a></p>']);
    decorate(block);
    expect(block.querySelector('.promo-banner-label')).toBeNull();
    expect(text(block)).toBe('Empty {{}} and {{ }} and {{open');
  });
});

describe('promo-banner responsive CSS', () => {
  const css = readFileSync('blocks/promo-banner/promo-banner.css', 'utf8');
  const rule = (source, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*{([^}]*)}`));
    return match ? match[1] : '';
  };
  const media = css.match(/@media \(width >= 768px\)\s*{([\s\S]*?)\n}/);

  it('is at least 136px tall on mobile', () => {
    expect(rule(css, '.promo-banner .promo-banner-inner')).toContain('min-height: 136px;');
  });

  it('is at least 80px tall and centered from 768px', () => {
    expect(media).toBeTruthy();
    const inner = rule(media[1], '.promo-banner .promo-banner-inner');
    expect(inner).toContain('min-height: 80px;');
    expect(inner).toContain('justify-content: center;');
  });

  it('uses the white primary button and the green label', () => {
    const button = rule(css, '.promo-banner a.button.primary');
    expect(button).toContain('background: #fff;');
    expect(button).toContain('color: var(--navy);');
    expect(rule(css, '.promo-banner .promo-banner-label')).toContain('color: var(--green-bright);');
  });

  it('only uses the shared 768px breakpoint', () => {
    expect(css).not.toMatch(/@media[^{]*max-width/);
    const queries = css.match(/@media[^{]*/g) || [];
    expect(queries.map((q) => q.trim())).toEqual(['@media (width >= 768px)']);
  });
});
