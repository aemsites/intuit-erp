import { chromium } from 'playwright';
const [url,out,w]=[process.argv[2],process.argv[3],+(process.argv[4]||1440)];
const b=await chromium.launch();const c=await b.newContext({viewport:{width:w,height:900},deviceScaleFactor:1});const p=await c.newPage();
await p.goto(url,{waitUntil:'networkidle',timeout:30000}).catch(()=>{});
await p.waitForTimeout(1500);
await p.screenshot({path:out,fullPage:true});
await b.close();console.log('shot',out);
