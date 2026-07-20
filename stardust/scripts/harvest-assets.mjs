// Harvest images per page into per-slug folders (no cross-page dedup).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const pages = [
  ['https://erp.intuit.com/','index'],
  ['https://erp.intuit.com/pricing/','pricing'],
  ['https://erp.intuit.com/accounting/','accounting'],
  ['https://erp.intuit.com/compare/','compare'],
  ['https://erp.intuit.com/erp-solutions/','erp-solutions'],
];
const root = 'stardust/prototypes/shared/media';
fs.mkdirSync(root, { recursive: true });
const manifest = {};

const browser = await chromium.launch();
for (const [url, slug] of pages) {
  const outDir = path.join(root, slug);
  fs.mkdirSync(outDir, { recursive: true });
  const seen = new Set();
  const ctx = await browser.newContext({ userAgent: UA, viewport:{width:1440,height:900}, deviceScaleFactor:2 });
  const page = await ctx.newPage();
  const map = {}; // original url -> local relative path
  page.on('response', async (resp) => {
    try {
      const ct = resp.headers()['content-type'] || '';
      const u = resp.url();
      if (!/image\/(png|jpe?g|svg\+xml|webp|gif)/.test(ct)) return;
      if (resp.status() !== 200) return;
      const body = await resp.body().catch(()=>null);
      if (!body || body.length < 300) return;
      const hash = crypto.createHash('md5').update(u).digest('hex').slice(0,8);
      if (seen.has(hash)) return; seen.add(hash);
      let ext = ct.includes('svg')?'svg':ct.includes('png')?'png':ct.includes('webp')?'webp':ct.includes('gif')?'gif':'jpg';
      let base = (u.split('?')[0].split('/').pop()||'img').replace(/[^a-zA-Z0-9._-]/g,'').slice(0,50);
      if (!/\.(png|jpe?g|svg|webp|gif)$/i.test(base)) base += '.'+ext;
      const fn = hash+'-'+base;
      fs.writeFileSync(path.join(outDir, fn), body);
      map[u] = 'media/'+slug+'/'+fn;
    } catch {}
  });
  await page.goto(url, { waitUntil:'domcontentloaded', timeout:45000 });
  await page.waitForTimeout(2500);
  for (let i=0;i<7;i++){ await page.mouse.wheel(0,900); await page.waitForTimeout(300); }
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.waitForTimeout(800);
  manifest[slug] = map;
  console.log(slug, 'saved', Object.keys(map).length, 'images');
  await ctx.close();
}
fs.writeFileSync(path.join(root,'_manifest.json'), JSON.stringify(manifest,null,1));
await browser.close();
