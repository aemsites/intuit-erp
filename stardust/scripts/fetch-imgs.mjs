// Fetch specific image URLs with browser headers (referer) via Playwright request ctx.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const urls = fs.readFileSync(process.argv[2], 'utf8').split('\n').map(s=>s.trim()).filter(Boolean);
const outDir = process.argv[3] || 'stardust/prototypes/shared/media/common';
fs.mkdirSync(outDir, { recursive: true });

const b = await chromium.launch();
const ctx = await b.newContext({ userAgent: UA, extraHTTPHeaders:{ referer:'https://erp.intuit.com/', 'accept':'image/avif,image/webp,image/png,image/svg+xml,*/*' } });
const map = {};
for (const u of urls) {
  try {
    const r = await ctx.request.get(u, { timeout: 30000 });
    if (!r.ok()) { console.log('FAIL', r.status(), u.slice(0,80)); continue; }
    const buf = await r.body();
    const ct = r.headers()['content-type']||'';
    let ext = ct.includes('svg')?'svg':ct.includes('png')?'png':ct.includes('webp')?'webp':ct.includes('jpe')?'jpg':'png';
    const hash = crypto.createHash('md5').update(u).digest('hex').slice(0,8);
    let base=(u.split('?')[0].split('/').pop()||'img').replace(/[^a-zA-Z0-9._-]/g,'').slice(0,46);
    if(!/\.(png|jpe?g|svg|webp)$/i.test(base)) base+='.'+ext;
    const fn=hash+'-'+base;
    fs.writeFileSync(path.join(outDir,fn),buf);
    map[u]='media/common/'+fn;
    console.log('OK', buf.length, fn);
  } catch(e){ console.log('ERR', u.slice(0,70), e.message); }
}
fs.writeFileSync(path.join(outDir,'_map.json'), JSON.stringify(map,null,1));
await b.close();
