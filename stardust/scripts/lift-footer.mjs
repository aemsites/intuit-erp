import { chromium } from 'playwright';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const b = await chromium.launch();
const c = await b.newContext({ userAgent: UA, viewport:{width:1440,height:900}, deviceScaleFactor:1 });
const p = await c.newPage();
await p.goto('https://erp.intuit.com/', { waitUntil:'domcontentloaded', timeout:45000 });
await p.waitForTimeout(3500);
const r = await p.evaluate(() => {
  const clean = s => (s||'').replace(/\s+/g,' ').trim();
  // The footer column headings from screenshot: Company / For Individuals / For Small Business / For Accountants
  // Find them by text
  const wanted = ['Company','For Individuals','For Small Business','For Accountants'];
  const cols = [];
  for (const w of wanted) {
    const head = [...document.querySelectorAll('*')].find(el=>el.children.length===0 && clean(el.textContent)===w);
    if (!head) { cols.push({head:w, links:[], found:false}); continue; }
    // climb to a container that holds the following link list
    let container = head.parentElement;
    for (let i=0;i<4 && container;i++){ if(container.querySelectorAll('a').length>=2) break; container=container.parentElement; }
    const links = container ? [...container.querySelectorAll('a')].map(a=>({t:clean(a.textContent),href:a.getAttribute('href')})).filter(x=>x.t) : [];
    cols.push({head:w, links});
  }
  // bottom strip: Sitemap, country selector, legal links, copyright
  const bottomLinks = [...document.querySelectorAll('a')].map(a=>({t:clean(a.textContent),href:a.getAttribute('href')})).filter(x=>['Legal','Privacy','Security','Compliance','Sitemap','About cookies','Your California Privacy Rights'].includes(x.t));
  // copyright text
  const cp = [...document.querySelectorAll('*')].map(el=>clean(el.textContent)).find(t=>/©\s*2026 Intuit Inc/.test(t) && t.length<400) || '';
  return { cols, bottomLinks, cp };
});
console.log(JSON.stringify(r,null,1));
await b.close();
