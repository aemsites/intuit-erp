import { chromium } from 'playwright';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const url = process.argv[2] || 'https://erp.intuit.com/';
const b = await chromium.launch();
const c = await b.newContext({ userAgent: UA, viewport:{width:1440,height:900}, deviceScaleFactor:1 });
const p = await c.newPage();
await p.goto(url, { waitUntil:'domcontentloaded', timeout:45000 });
await p.waitForTimeout(3500);
const r = await p.evaluate(() => {
  const clean = (s) => (s||'').replace(/\s+/g,' ').trim();
  // top-level body children tag names
  const topTags = [...document.body.children].map(el=>el.tagName+(el.id?'#'+el.id:'')+(el.className&&typeof el.className==='string'?'.'+el.className.split(' ')[0]:''));
  // find nav-like: any element with role banner/navigation or custom tag containing 'nav'/'header'
  const customEls = [...document.querySelectorAll('*')].filter(el=>el.tagName.includes('-')).map(el=>el.tagName.toLowerCase());
  const uniqCustom = [...new Set(customEls)];
  // all links in top 200px (header zone)
  const headerZone = [...document.querySelectorAll('a')].filter(a=>{const r=a.getBoundingClientRect();return r.top>=0&&r.top<150&&r.width>0;}).map(a=>({t:clean(a.textContent),href:a.getAttribute('href'),top:Math.round(a.getBoundingClientRect().top),left:Math.round(a.getBoundingClientRect().left)}));
  // footer zone: links with top > docheight-1000
  const dh = document.documentElement.scrollHeight;
  const footZone = [...document.querySelectorAll('a')].map(a=>({t:clean(a.textContent),href:a.getAttribute('href'),top:Math.round(a.getBoundingClientRect().top+scrollY)})).filter(x=>x.top>dh-1400 && x.t);
  return { topTags, uniqCustom: uniqCustom.slice(0,40), headerZone, footZoneCount: footZone.length, footZone: footZone.slice(0,120), dh };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
