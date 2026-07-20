// Lift exact design tokens + per-element computed styles from the live site.
// Runs per URL per breakpoint. Writes stardust/current/tokens/<slug>-<w>.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const args = process.argv.slice(2);
const url = args[0];
const slug = args[1];
const width = +(args[2] || 1440);
if (!url || !slug) { console.error('usage: lift-tokens.mjs <url> <slug> <width>'); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(2500);
// scroll to trigger lazy content
for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(250); }
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(500);

const data = await page.evaluate(() => {
  const cs = (el) => el ? getComputedStyle(el) : null;
  const pick = (el, props) => {
    if (!el) return null;
    const c = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = c.getPropertyValue(p);
    const r = el.getBoundingClientRect();
    o._rect = { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
    o._text = (el.textContent || '').trim().slice(0, 60);
    return o;
  };
  const boxProps = ['font-family','font-size','font-weight','line-height','letter-spacing','color','background-color','padding','margin','border','border-radius','box-shadow','text-transform','max-width','width','display','gap','text-align'];

  // type ramp: sample each heading level + body + first paragraph
  const ramp = {};
  for (const tag of ['h1','h2','h3','h4','h5','h6']) {
    const el = document.querySelector('main ' + tag) || document.querySelector(tag);
    if (el) ramp[tag] = pick(el, boxProps);
  }
  const p = document.querySelector('main p') || document.querySelector('p');
  if (p) ramp.p = pick(p, boxProps);

  // buttons / CTAs
  const buttons = [];
  const btnEls = [...document.querySelectorAll('a[class*="button" i], button, a[class*="btn" i], [role="button"]')].slice(0, 12);
  for (const b of btnEls) buttons.push(pick(b, boxProps));

  // body + html
  const body = pick(document.body, boxProps);
  const html = pick(document.documentElement, ['font-family','font-size','line-height','color','background-color']);

  // main content root candidates
  const rootCandidates = [];
  for (const sel of ['main','#main','[role="main"]','.main','#__next','body>div']) {
    const el = document.querySelector(sel);
    if (el) rootCandidates.push({ sel, ...pick(el, ['max-width','width','margin','padding','display']) });
  }

  // container widths: sample wrappers with constrained max-width
  const containers = {};
  const all = [...document.querySelectorAll('main div, section, div')].slice(0, 400);
  const mwCount = {};
  for (const el of all) {
    const mw = getComputedStyle(el).maxWidth;
    if (mw && mw !== 'none' && mw.endsWith('px')) mwCount[mw] = (mwCount[mw]||0)+1;
  }
  const topMw = Object.entries(mwCount).sort((a,b)=>b[1]-a[1]).slice(0,8);

  // section vertical paddings
  const secPads = [];
  for (const sec of [...document.querySelectorAll('section')].slice(0, 20)) {
    const c = getComputedStyle(sec);
    secPads.push({ pt: c.paddingTop, pb: c.paddingBottom, bg: c.backgroundColor, text: (sec.textContent||'').trim().slice(0,40) });
  }

  // header / nav
  const header = document.querySelector('header') || document.querySelector('nav');
  const headerInfo = pick(header, ['position','height','background-color','padding','box-shadow','display']);

  // fonts actually loaded
  const fonts = [...document.fonts].map(f => ({ family: f.family, weight: f.weight, style: f.style, status: f.status }));

  // doc height
  const docH = document.documentElement.scrollHeight;

  return { ramp, buttons, body, html, rootCandidates, topMw, secPads, headerInfo, fonts, docH, vw: innerWidth };
});

const outDir = 'stardust/current/tokens';
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${slug}-${width}.json`);
fs.writeFileSync(out, JSON.stringify({ url, slug, width, capturedAt: new Date().toISOString(), ...data }, null, 2));
console.log('wrote', out, '| docH', data.docH, '| fonts', data.fonts.length, '| topMaxWidths', JSON.stringify(data.topMw));
await browser.close();
