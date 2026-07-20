// Assemble <slug>-proposed.html from shared chrome + per-page body.
// Run from stardust/prototypes/:  node build.mjs [slug ...]
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(HERE, p), 'utf8');

const pages = {
  index:          { title: 'Enterprise Resource Planning (ERP) Software | Intuit Enterprise Suite', desc: 'Intuit Enterprise Suite is the connected ERP for consolidated reporting and inter-company eliminations. Gives finance teams visibility and control across multiple-entities.', headerMode: 'on-dark' },
  pricing:        { title: 'Pricing | Intuit Enterprise Suite', desc: 'A modern ERP without the legacy cost. Schedule a call to see if Intuit Enterprise Suite is a good fit.', headerMode: 'on-dark' },
  accounting:     { title: 'Accounting Software for Growing Businesses | Intuit Enterprise Suite', desc: 'Grow confidently with powerful financial tools: multi-entity management, custom roles, and automated revenue recognition.', headerMode: 'on-dark' },
  compare:        { title: 'Compare Intuit Enterprise Suite to traditional ERPs | Intuit Enterprise Suite', desc: 'See how Intuit Enterprise Suite gives you the power of a traditional ERP without the cost and complexity.', headerMode: 'on-dark' },
  'erp-solutions':{ title: 'ERP Solutions | Intuit Enterprise Suite', desc: 'The mid-market ERP for modern finance. Solutions that match your complexity.', headerMode: 'on-dark' },
};

const BASE = 'shared/';
const header = read('shared/header.html').replaceAll('{{BASE}}', BASE);
const footer = read('shared/footer.html').replaceAll('{{BASE}}', BASE);

const targets = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(pages);

for (const slug of targets) {
  const cfg = pages[slug];
  if (!cfg) { console.error('unknown page', slug); continue; }
  const bodyPath = `bodies/${slug}.html`;
  if (!fs.existsSync(path.join(HERE, bodyPath))) { console.error('missing body', bodyPath); continue; }
  const body = read(bodyPath).replaceAll('{{BASE}}', BASE);
  const hdr = header.replace('{{HEADER_MODE}}', cfg.headerMode || '');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${cfg.title}</title>
<meta name="description" content="${cfg.desc}">
<meta property="og:title" content="${cfg.title}">
<meta property="og:description" content="${cfg.desc}">
<link rel="icon" href="${BASE}media/index/a7b9a00a-Intuit_logo.png">
<link rel="stylesheet" href="${BASE}base.css">
<link rel="stylesheet" href="css/${slug}.css">
</head>
<body>
<main class="ies-main">
${hdr}
${body}
${footer}
</main>
</body>
</html>`;
  fs.writeFileSync(path.join(HERE, `${slug}-proposed.html`), html);
  console.log('built', `${slug}-proposed.html`, `(${html.length} bytes)`);
}
