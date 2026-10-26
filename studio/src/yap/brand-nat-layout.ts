/** Deterministic layout/timing shared by the live and exported Brand Nat looks. */
export type NatWord = { text: string; start: number; end: number };
export type BrandNatConfig = {
  caption: 'C1'|'C2'|'C3'|'C4'|'C5'|'C6'|'C7'|'C8'|'C9';
  hook: 'none'|'H1'|'H3'|'H4'|'H5'|'H8'|'H10';
  layout: 'L4'|'L5'|'L6'; finish: 'G1'|'G2'|'G3'|'G4'|'G5'|'G6'|'G7';
  title: string; subtitle: string; emphasis?: string; position: 'auto'|'top'|'bottom';
};
export type Rect = { x:number; y:number; width:number; height:number };
export type NatShoot = { width:number; height:number; faceX:number; crown:number; eyes:number; chin:number };
export const bounded = (n:number,a:number,b:number) => Math.max(a,Math.min(b,n));
export function hookVisibility(time:number,duration:number,offset=0):number {
  const end=Math.min(3,duration+offset), age=time+offset;
  if(age<0 || age>=end)return 0;
  return bounded((end-age)/.2,0,1);
}
const normalWord = (text:string) => text.normalize('NFKC').toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'');
export function emphasisWords(value=''):Set<string> {
  return new Set(value.split(',').map(normalWord).filter(Boolean));
}
export function captionGroups(words:readonly NatWord[],kind:BrandNatConfig['caption'],emphasis=''):NatWord[][] {
  if(kind==='C3')return [];
  const count=kind==='C2'?1:kind==='C9'?4:kind==='C8'?6:5;
  const maxChars=kind==='C8'?36:kind==='C9'?35:30;
  const result:NatWord[][]=[];
  const chosen=emphasisWords(emphasis);
  for(const word of words){
    const prev=result.at(-1);
    if(!prev || prev.length>=count || chosen.has(normalWord(prev.at(-1)!.text)) || word.start-prev.at(-1)!.end>.4 || /[.!?]$/.test(prev.at(-1)!.text)
      || [...prev,word].map(w=>w.text).join(' ').length>maxChars)result.push([word]);
    else prev.push(word);
  }
  return result;
}
export function currentCaption(groups:readonly NatWord[][],time:number):NatWord[]|undefined {
  // A short hold fills tiny ASR gaps, but never covers the next phrase.
  return groups.find((g,i)=>time>=g[0].start && time<Math.min(g.at(-1)!.end+.1,groups[i+1]?.[0].start??Infinity));
}
export function captionBlockHeight(kind:BrandNatConfig['caption'],unit:number):number {
  return unit*(kind==='C9'?.42:kind==='C6'||kind==='C7'?.23:kind==='C1'?.20:kind==='C2'?.15:kind==='C8'?.075:.16);
}
export function footageGeometry(W:number,H:number,shoot:NatShoot,config:Pick<BrandNatConfig,'layout'|'finish'>){
  const top=config.layout==='L5'?.25:config.layout==='L6'?.37:0;
  const sidebar=W/H>=1.25&&config.layout!=='L4';
  const framed=config.layout==='L4' && (config.finish==='G3'||config.finish==='G7');
  const rect:Rect=sidebar?{x:W*.44,y:0,width:W*.56,height:H}:{x:framed?W*.04:0,y:top*H+(framed?H*.035:0),width:W*(framed?.92:1),height:H*(1-top)*(framed?.93:1)};
  const cover=Math.max(rect.width/shoot.width,rect.height/shoot.height);
  // A very close shot fits rather than cutting off the head to fill a band.
  const scale=(shoot.chin-shoot.crown)*cover>rect.height*.76
    ? Math.min(rect.width/shoot.width,rect.height/shoot.height,rect.height*.5/Math.max(1,shoot.chin-shoot.crown)):cover;
  const width=shoot.width*scale,height=shoot.height*scale;
  const x=width>=rect.width?bounded(rect.width*.5-shoot.faceX*scale,rect.width-width,0):(rect.width-width)/2;
  const imageMin=Math.min(0,rect.height-height),imageMax=Math.max(0,rect.height-height);
  const yMin=Math.max(imageMin,-shoot.crown*scale),yMax=Math.min(imageMax,rect.height-shoot.chin*scale);
  const y=bounded(rect.height*.37-shoot.eyes*scale,yMin,yMax);
  const face={x:rect.x+x+shoot.faceX*scale,y:rect.y+y+shoot.crown*scale,
    bottom:rect.y+y+shoot.chin*scale,eyes:rect.y+y+shoot.eyes*scale};
  return {rect,image:{x,y,width,height},face,scale,sidebar};
}
export function captionRegion(args:{W:number;H:number;face:{y:number;bottom:number};height:number;
  position:BrandNatConfig['position'];hookReserved?:boolean;effects?:readonly string[];rect?:Rect;sidebar?:boolean}){
  const {W,H,face,height,position}=args,u=Math.min(W,H),gap=u*.025;
  const safeTop=H*.055,safeBottom=H*.84,left=W*.07,width=W*.80;
  const effects=args.effects??[];
  let regions:(Rect&{surface?:'canvas'|'footage'|'effect'})[];
  if(effects.includes('b-roll-overlay')){
    // The speaker inset begins at67% width; leave its whole column clear.
    regions=[{x:left,y:H*.735,width:W*.54,height:H*.105,surface:'effect'}];
  }else if(effects.includes('growth-curve')){
    regions=[{x:left,y:H*.69,width,height:H*.15,surface:'effect'}];
  }else if(effects.includes('checklist')){
    regions=[{x:left,y:H*.59,width,height:H*.25,surface:'effect'}];
  }else if(args.sidebar&&!effects.length){
    const start=args.hookReserved?H*.38:H*.12;
    regions=[{x:W*.065,y:start,width:W*.31,height:H*.82-start,surface:'canvas'}];
  }else{
    const topEnd=Math.max(safeTop,face.y-gap);
    const topStart=args.hookReserved?Math.max(safeTop,H*.28):safeTop;
    const lowerStart=Math.max(safeTop,face.bottom+gap,effects.includes('count-up')?H*.755:0);
    const boundary=args.rect?.y??0;
    // A caption occupies one surface; it never straddles a title band and video.
    regions=boundary>topStart&&boundary<topEnd&&!effects.length
      ?[{x:left,y:topStart,width,height:boundary-topStart,surface:'canvas'},
        {x:left,y:boundary,width,height:topEnd-boundary,surface:'footage'}]
      :[{x:left,y:topStart,width,height:Math.max(0,topEnd-topStart),surface:boundary>=topEnd&&!effects.length?'canvas':'footage'}];
    regions.push({x:left,y:lowerStart,width,height:Math.max(0,safeBottom-lowerStart),surface:'footage'});
  }
  const preferred=position==='bottom'?regions.at(-1)!:position==='top'?regions[0]:null;
  const fitting=regions.filter(r=>r.height>=height);
  const chosen=preferred && preferred.height>=height?preferred
    : fitting.sort((a,b)=>b.height-a.height)[0]??[...regions].sort((a,b)=>b.height-a.height)[0];
  // Geometry uses the complete phrase, never the number of words revealed.
  const scale=Math.min(1,Math.max(0,chosen.height)/height);
  const fittedHeight=height*scale;
  return {...chosen,height:fittedHeight,y:chosen.y+Math.max(0,(chosen.height-fittedHeight)/2),scale};
}
export function openingText(words:readonly NatWord[],title:string,subtitle:string){
  const actual=words.filter(w=>w.text.trim()).slice(0,9).map(w=>w.text);
  return {title:title.trim()||actual.slice(0,4).join(' '),subtitle:subtitle.trim()||actual.slice(4,9).join(' ')};
}
