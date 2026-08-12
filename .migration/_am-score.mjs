// scoring.md: dissimilarity = sum(weights)/normalizer*100; normalizer=max(props*2,20); sim=100-dissim
const W={high:3,med:2,low:1,content:5,struct:5,inter:3};
function score(props, diffs){ const sum=diffs.reduce((a,d)=>a+d.w,0); const norm=Math.max(props*2,20); const dis=sum/norm*100; return Math.max(0,Math.round((100-dis)*10)/10); }

const blocks={
  hero:{ props:16, diffs:[
    {c:'styling',prop:'section background-color',o:'rgb(243,242,239) light',m:'rgb(0,37,74) navy',w:W.high,sev:'high'},
    {c:'styling',prop:'h1 color',o:'rgb(0,0,0)',m:'rgb(255,255,255)',w:W.high,sev:'high'},
    {c:'styling',prop:'para color',o:'rgb(0,0,0)',m:'rgb(230,238,246)',w:W.high,sev:'high'},
    {c:'styling',prop:'CTA background-color',o:'rgb(0,37,74)',m:'rgb(255,255,255)',w:W.high,sev:'high'},
    {c:'styling',prop:'CTA color',o:'rgb(255,255,255)',m:'rgb(13,51,63)',w:W.high,sev:'high'},
    {c:'styling',prop:'h1 font-weight',o:'700',m:'400',w:W.med,sev:'medium'},
    {c:'styling',prop:'CTA padding',o:'0 28px',m:'0 30px',w:W.med,sev:'medium'},
    {c:'styling',prop:'img border-radius',o:'0px',m:'12px',w:W.low,sev:'low'},
  ]},
  'icon-columns':{ props:11, diffs:[
    {c:'styling',prop:'card body font-size',o:'18px',m:'13px',w:W.high,sev:'high'},
    {c:'styling',prop:'card heading font-size',o:'32px',m:'24px',w:W.high,sev:'high'},
    {c:'styling',prop:'card heading color',o:'rgb(57,58,61)',m:'rgb(17,24,28)',w:W.high,sev:'high'},
    {c:'styling',prop:'card heading line-height',o:'52px',m:'30px',w:W.med,sev:'medium'},
    {c:'styling',prop:'card heading font-weight',o:'500',m:'400',w:W.med,sev:'medium'},
    {c:'styling',prop:'card body line-height',o:'27px',m:'20.8px',w:W.med,sev:'medium'},
    {c:'structural',prop:'card heading level',o:'h2',m:'h3',w:W.low,sev:'low'},
    {c:'styling',prop:'card body color',o:'rgba(33,38,42,.8)',m:'rgb(107,108,114)',w:W.low,sev:'low'},
  ]},
  fragment:{ props:6, diffs:[
    // connect section + 5-field form present on both; link color matches (rgb(0,119,197)). one minor include note.
  ]},
};
let totW=0, totProps=0, per={};
for(const [n,b] of Object.entries(blocks)){ per[n]={sim:score(b.props,b.diffs),props:b.props,diffs:b.diffs,
  content:b.diffs.filter(d=>d.c==='content'),structural:b.diffs.filter(d=>d.c==='structural'),
  styling:b.diffs.filter(d=>d.c==='styling'),interactions:b.diffs.filter(d=>d.c==='inter')};
  totW+=per[n].sim*b.props; totProps+=b.props; }
const page=Math.round((totW/totProps)*10)/10;
console.log(JSON.stringify({page,per},null,2));
