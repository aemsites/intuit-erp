import fs from 'node:fs'; import { PNG } from 'pngjs';
const src=process.argv[2], out=process.argv[3], y0=+process.argv[4], y1=+process.argv[5];
const png=PNG.sync.read(fs.readFileSync(src));
const h=y1-y0; const o=new PNG({width:png.width,height:h});
for(let y=0;y<h;y++)for(let x=0;x<png.width;x++){const si=((y0+y)*png.width+x)*4,di=(y*png.width+x)*4;for(let k=0;k<4;k++)o.data[di+k]=png.data[si+k];}
fs.writeFileSync(out,PNG.sync.write(o)); console.log('cropped',out,png.width+'x'+h);
