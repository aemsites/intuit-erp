import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const ROOT='content';
const files=[];
(function walk(d){for(const e of readdirSync(d)){const p=join(d,e);const s=statSync(p);if(s.isDirectory())walk(p);else if(e.endsWith('.plain.html'))files.push('/'+relative(ROOT,p).replace(/\.plain\.html$/,''));}})(ROOT);
const excl=/^\/(drafts|library|fragments|experiments|test|of1|pzn)\b|\/(nav|footer|metadata)$/;
const real=files.filter(f=>!excl.test(f));
const draftish=files.filter(f=>excl.test(f));
// "top-level product pages" (not blog) — most likely to have a real source counterpart
const blog=real.filter(f=>f.startsWith('/blog'));
const product=real.filter(f=>!f.startsWith('/blog'));
console.log('total:',files.length);
console.log('excluded (drafts/library/fragments/experiments/test/of1/pzn/nav/footer):',draftish.length);
console.log('real content pages:',real.length);
console.log('  - blog articles:',blog.length);
console.log('  - product/marketing pages (non-blog):',product.length);
console.log('\nproduct/marketing pages:');
product.sort().forEach(p=>console.log('  ',p));
