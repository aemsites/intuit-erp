import {PNG} from 'pngjs';
import fs from 'fs';
const src = PNG.sync.read(fs.readFileSync('stardust/current/assets/screenshots/pricing.png'));
console.log('size', src.width, src.height);
function crop(x,y,w,h,out){
  const dst = new PNG({width:w,height:h});
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const si=((y+j)*src.width+(x+i))<<2, di=(j*w+i)<<2;
    dst.data[di]=src.data[si];dst.data[di+1]=src.data[si+1];dst.data[di+2]=src.data[si+2];dst.data[di+3]=src.data[si+3];
  }
  fs.writeFileSync(out, PNG.sync.write(dst));
}
// media row text regions (full width bands)
crop(0,1850,1440,520,'/tmp/row1.png');
crop(0,2450,1440,520,'/tmp/row2.png');
crop(0,3050,1440,560,'/tmp/row3.png');
