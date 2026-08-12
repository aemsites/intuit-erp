const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const paths=['/accounting','/account-management','/blog/accounting/cash-reconciliation','/pricing','/nonexistent-xyz'];
for(const p of paths){
  const t0=Date.now();
  let code, size=0;
  try{
    const r=await fetch('https://erp.intuit.com'+p+'/',{headers:{'User-Agent':UA,'Accept':'text/html'},redirect:'follow'});
    code=r.status; const txt=await r.text(); size=txt.length;
  }catch(e){ code='ERR:'+e.message.slice(0,40); }
  console.log(`${p} -> ${code} ${size}b ${Date.now()-t0}ms`);
  await new Promise(r=>setTimeout(r,1500));
}
