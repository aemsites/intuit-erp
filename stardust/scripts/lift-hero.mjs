import { chromium } from 'playwright';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const [url, w] = [process.argv[2], +(process.argv[3]||1440)];
const b = await chromium.launch();
const c = await b.newContext({ userAgent: UA, viewport:{width:w,height:900}, deviceScaleFactor:1 });
const p = await c.newPage();
await p.emulateMedia({ reducedMotion:'reduce' });
await p.goto(url, { waitUntil:'domcontentloaded', timeout:45000 });
await p.waitForTimeout(2500);
const r = await p.evaluate(() => {
  // deepest text-bearing leaf under h1
  const leaf = (el) => { let n=el; while(n){ const kids=[...n.children].filter(c=>(c.textContent||'').trim()); if(!kids.length) break; n=kids[0]; } return n; };
  const out = {};
  for (const tag of ['h1','h2','h3']) {
    const el = document.querySelector('main '+tag) || document.querySelector(tag);
    if (!el) continue;
    const lf = leaf(el);
    const c = getComputedStyle(lf);
    out[tag] = { text:(el.textContent||'').trim().slice(0,50), wrapSize:getComputedStyle(el).fontSize, leafTag:lf.tagName, leafSize:c.fontSize, leafLH:c.lineHeight, leafWeight:c.fontWeight, leafLS:c.letterSpacing, color:c.color };
  }
  // hero section bg
  const hero = document.querySelector('main section, section');
  out.heroBg = hero ? getComputedStyle(hero).backgroundColor : null;
  // nav link + logo
  const navlink = document.querySelector('header a, nav a');
  out.navLink = navlink ? { size:getComputedStyle(navlink).fontSize, weight:getComputedStyle(navlink).fontWeight, color:getComputedStyle(navlink).color } : null;
  return out;
});
console.log(JSON.stringify(r,null,1));
await b.close();
