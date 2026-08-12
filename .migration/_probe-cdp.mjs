const CDP='http://localhost:39185';
const v=await (await fetch(CDP+'/json/version')).json();
const ws=new WebSocket(v.webSocketDebuggerUrl); let id=0; const p=new Map();
await new Promise(r=>ws.onopen=r);
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}};
const send=(method,params={},sid)=>{id++;const mid=id;const pl={id:mid,method,params};if(sid)pl.sessionId=sid;return new Promise(res=>{p.set(mid,res);ws.send(JSON.stringify(pl));});};
const t=(await send('Target.createTarget',{url:'about:blank'})).result.targetId;
const sid=(await send('Target.attachToTarget',{targetId:t,flatten:true})).result.sessionId;
await send('Page.enable',{},sid); await send('Runtime.enable',{},sid);
for(const label of ['try1','try2']){
  await send('Page.navigate',{url:'https://erp.intuit.com/pricing/'},sid);
  await new Promise(r=>setTimeout(r,8000));
  const r=await send('Runtime.evaluate',{expression:'JSON.stringify({title:document.title,h1:(document.querySelector("h1")||{}).textContent,bodyLen:document.body.innerText.length})',returnByValue:true},sid);
  console.log(label, r.result.result.value);
  await new Promise(r=>setTimeout(r,4000));
}
ws.close();
