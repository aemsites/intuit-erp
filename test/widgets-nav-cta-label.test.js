import {
  describe, it, expect, afterEach, vi,
} from 'vitest';

const HEADER = '<header><button type="button" class="nav-cta"><span class="nav-cta-text">Schedule a call</span></button></header>';
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

// Fresh module per test: the widget keeps the baseline label and active variant in module state.
const load = async () => {
  vi.resetModules();
  return import('../widgets/pzn/nav-cta-label/nav-cta-label.js');
};

const navText = () => document.querySelector('header .nav-cta-text').textContent;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('nav-cta-label: resolveLabel', () => {
  it('uses the hero primary button, even when it is not the schedule link', async () => {
    const { resolveLabel } = await load();
    document.body.innerHTML = '<div class="section"><p><strong><a href="https://youtu.be/x">See a demo</a></strong>'
      + '<em><a href="#schedule">Talk to sales</a></em></p><div class="widget"></div></div>';
    expect(resolveLabel(document.querySelector('.widget'))).toBe('See a demo');

    document.body.innerHTML = '<div class="section"><p class="hero-actions"><button class="button primary icon-video">See a demo</button>'
      + '<a class="button secondary" href="#schedule">Talk to sales</a></p><div class="widget"></div></div>';
    expect(resolveLabel(document.querySelector('.widget'))).toBe('See a demo');
  });

  it('prefers the label param, else falls back to the first #schedule link', async () => {
    const { resolveLabel } = await load();
    document.body.innerHTML = '<div class="section"><a href="https://youtu.be/x">See a demo</a>'
      + '<a href="#schedule">Talk to sales</a><div class="widget"></div></div>';
    const widget = document.querySelector('.widget');
    expect(resolveLabel(widget)).toBe('Talk to sales');
    widget.dataset.label = 'Get your migration plan';
    expect(resolveLabel(widget)).toBe('Get your migration plan');
  });

  it('returns null when there is no label or schedule link', async () => {
    const { resolveLabel } = await load();
    document.body.innerHTML = '<div class="section"><div class="widget"></div></div>';
    expect(resolveLabel(document.querySelector('.widget'))).toBeNull();
  });
});

describe('nav-cta-label: decorate', () => {
  it('sets the header CTA label, including when the header renders later', async () => {
    const { default: decorate } = await load();
    document.body.innerHTML = '<main><div class="section"><a href="#schedule">See your upgrade path</a>'
      + '<div class="widget"></div></div></main>';
    decorate(document.querySelector('.widget'));
    document.body.insertAdjacentHTML('afterbegin', HEADER);
    await flush();
    expect(navText()).toBe('See your upgrade path');
  });

  it('follows the latest variant and restores the baseline when the variant is removed', async () => {
    const { default: decorate } = await load();
    document.body.innerHTML = `${HEADER}<main><div class="section v1"><a href="#schedule">Talk to sales</a>`
      + '<div class="widget"></div></div></main>';
    decorate(document.querySelector('.v1 .widget'));
    expect(navText()).toBe('Talk to sales');

    document.querySelector('.v1').outerHTML = '<div class="section v2"><a href="#schedule">Get your migration plan</a>'
      + '<div class="widget"></div></div>';
    decorate(document.querySelector('.v2 .widget'));
    expect(navText()).toBe('Get your migration plan');

    document.querySelector('.v2').remove();
    await flush();
    expect(navText()).toBe('Schedule a call');
  });

  it('does nothing when no label can be resolved', async () => {
    const { default: decorate } = await load();
    document.body.innerHTML = `${HEADER}<main><div class="section"><div class="widget"></div></div></main>`;
    decorate(document.querySelector('.widget'));
    expect(navText()).toBe('Schedule a call');
  });
});
