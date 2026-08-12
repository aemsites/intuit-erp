() => {
  const pick=(el,ps)=>{if(!el)return null;const s=getComputedStyle(el);const o={};ps.forEach(p=>o[p]=s[p]);return o;};
  const primary=f=>(f||'').split(',')[0].trim().replace(/["']/g,'');
  const h1=document.querySelector('h1');
  let heroBg='rgba(0, 0, 0, 0)', n=h1;
  for(let i=0;i<8&&n;i++){const c=getComputedStyle(n).backgroundColor;if(c&&c!=='rgba(0, 0, 0, 0)'&&c!=='transparent'){heroBg=c;break;}n=n.parentElement;}
  const heroCTA=[...document.querySelectorAll('a,button')].find(a=>/^schedule a call$/i.test(a.textContent.trim()));
  const stop=/your privacy choices|manage consent|cookie|allow information/i;
  const headings=[...document.querySelectorAll('h1,h2,h3,h4')].map(h=>({t:h.tagName.toLowerCase(),x:h.textContent.trim().slice(0,55)})).filter(h=>h.x&&!stop.test(h.x));
  const imgs=document.querySelectorAll('img').length;
  const paras=[...document.querySelectorAll('p')].filter(p=>p.textContent.trim().length>2).length;
  const h2=document.querySelector('h2');
  return { url:location.pathname,
    global:{ bodyFont:primary(getComputedStyle(document.querySelector('p')||document.body).fontFamily), h1Font:h1?primary(getComputedStyle(h1).fontFamily):null,
      h1:pick(h1,['fontSize','fontWeight','lineHeight','color']), h1Text:h1?.textContent.trim(),
      h2:pick(h2,['fontSize','fontWeight','lineHeight','color']) },
    hero:{ bg:heroBg, cta:pick(heroCTA,['backgroundColor','color','borderRadius','fontSize','fontWeight','padding']), ctaText:heroCTA?.textContent.trim() },
    content:{ headingCount:headings.length, headings:headings.slice(0,25), images:imgs, paragraphs:paras } };
}
