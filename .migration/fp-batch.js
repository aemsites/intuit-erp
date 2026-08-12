(async function(){
  try{
    // 1) settle: scroll through the whole page to trigger lazy/below-the-fold render
    var H=document.body.scrollHeight;
    for(var y=0;y<H;y+=600){ window.scrollTo(0,y); await new Promise(r=>setTimeout(r,120)); }
    window.scrollTo(0,document.body.scrollHeight);
    await new Promise(r=>setTimeout(r,600));
    // 2) reveal hidden tab/accordion panels so their headings/copy are countable
    document.querySelectorAll('[role="tabpanel"],[hidden],[aria-hidden="true"]').forEach(function(el){
      try{ el.hidden=false; el.removeAttribute('hidden'); el.setAttribute('aria-hidden','false'); if(getComputedStyle(el).display==='none') el.style.display='block'; }catch(e){}
    });
    await new Promise(r=>setTimeout(r,300));
    window.scrollTo(0,0);

    var pick=function(el,ps){if(!el)return null;var s=getComputedStyle(el);var o={};ps.forEach(function(p){o[p]=s[p];});return o;};
    var primary=function(f){return (f||'').split(',')[0].trim().replace(/["']/g,'');};
    var h1=document.querySelector('h1');
    var heroBg='rgba(0, 0, 0, 0)', n=h1;
    for(var i=0;i<8&&n;i++){var c=getComputedStyle(n).backgroundColor;if(c&&c!=='rgba(0, 0, 0, 0)'&&c!=='transparent'){heroBg=c;break;}n=n.parentElement;}
    // headings: strip chrome/nav/footer/cookie; keep only meaningful content headings
    var stop=/your privacy choices|manage consent|cookie|allow information|^company$|^for individuals$|^for small business$|^for accountants$|^capabilities$|^industry tools$|^pricing$|^resources$|^support$|^select country$|^sitemap$/i;
    var hEls=[].slice.call(document.querySelectorAll('h1,h2,h3,h4,[role="tab"],summary,[role="heading"]'));var hs=hEls.map(function(h){return h.textContent.replace(/\s+/g,' ').trim();}).filter(function(x){return x&&x.length>2&&!stop.test(x);});
    // dedupe
    var seen={}; hs=hs.filter(function(x){var k=x.toLowerCase();if(seen[k])return false;seen[k]=1;return true;});
    var isBlocked = /this page isn.?t working|http error|too many requests|access denied/i.test((h1&&h1.textContent)||'') || (document.body.innerText.trim().length<120);
    var formErr=[].slice.call(document.querySelectorAll('p,div')).map(function(p){return p.textContent.trim();}).filter(function(t){return /went wrong loading this form|try again/i.test(t)&&t.length<120;})[0]||null;
    return { ok:true, blocked:isBlocked,
      bodyFont:primary(getComputedStyle(document.querySelector('p')||document.body).fontFamily),
      h1: pick(h1,['fontSize','fontWeight','lineHeight','color']), h1Text:h1?h1.textContent.replace(/\s+/g,' ').trim():null,
      hero:{bg:heroBg}, headings:hs, headingCount:hs.length,
      images:document.querySelectorAll('img').length,
      paragraphs:[].slice.call(document.querySelectorAll('p')).filter(function(p){return p.textContent.trim().length>2;}).length,
      bodyTextLen:document.body.innerText.trim().length,
      formError:formErr };
  }catch(e){ return { error:String(e) }; }
})()
