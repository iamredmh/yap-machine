import React from 'react';
import { AbsoluteFill, OffthreadVideo, useCurrentFrame } from 'remotion';
import catalog from '../../catalog.json';
import { PACK, voiceFamily } from '../engine/style';
import { PersonLayer, PersonMask } from './PersonLayer';
import { FootageOverlay } from '../kit/FootageOverlay';
import type { VisualPlan } from './Visuals';
import { bounded, captionBlockHeight, captionGroups, captionRegion, currentCaption, footageGeometry, hookVisibility, openingText, type BrandNatConfig, type NatWord } from './brand-nat-layout';
export type { BrandNatConfig } from './brand-nat-layout';

const defaults:BrandNatConfig={caption:'C5',hook:'H10',layout:'L4',finish:'G2',title:'',subtitle:'',position:'auto'};
export function resolveBrandNat(p:Pick<VisualPlan,'pack'|'brandNat'>):BrandNatConfig|null {
  const row=([...catalog.styles,...catalog.legacyStyles] as Array<{id:string;brandNat?:Partial<BrandNatConfig>}>).find(s=>s.id===p.pack);
  return row?.brandNat || p.brandNat ? {...defaults,...row?.brandNat,...p.brandNat}:null;
}
const ink='#29251F',cream='#FFF5E5',ice='#D8F4FA',butter='#F6DE90';
const font=(kind:'display'|'body'|'accent'|'label'|'code')=>voiceFamily(kind);
const baseText:React.CSSProperties={lineHeight:1.08,margin:0,overflowWrap:'anywhere'};
const finishGround=(kind:BrandNatConfig['finish'])=>({G1:'#332C25',G2:'#F7F4EE',G3:'#DCE7F2',G4:'#EDF0F3',G5:'#45342C',G6:'#17292D',G7:'#F7D85B'})[kind];
const lightGround=(kind:BrandNatConfig['finish'])=>['G2','G3','G4','G7'].includes(kind);
const finishFilter=(kind:BrandNatConfig['finish'])=>({G1:'sepia(.08) saturate(1.08) contrast(1.035)',G2:'none',G3:'saturate(.94)',G4:'saturate(.94) contrast(1.025)',G5:'sepia(.18) saturate(.86) contrast(.98)',G6:'brightness(.46) saturate(.55)',G7:'none'})[kind];
function FittedVideo({p,config,person=false}:{p:VisualPlan;config:BrandNatConfig;person?:boolean}){
  const g=footageGeometry(p.width,p.height,p.shoot,config);
  return <div style={{position:'absolute',left:g.rect.x,top:g.rect.y,width:g.rect.width,height:g.rect.height,overflow:'hidden',borderRadius:config.layout==='L4'&&(config.finish==='G3'||config.finish==='G7')?Math.min(p.width,p.height)*.025:0}}>
    {!person&&(g.image.width<g.rect.width-.1||g.image.height<g.rect.height-.1)&&<OffthreadVideo src={p.plate} muted pauseWhenBuffering acceptableTimeShiftInSeconds={1/p.fps} style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',filter:`${finishFilter(config.finish)==='none'?'':finishFilter(config.finish)} blur(${Math.min(p.width,p.height)*.035}px) brightness(.65)`,transform:'scale(1.12)'}}/>}
    <div style={{position:'absolute',left:g.image.x,top:g.image.y,width:g.image.width,height:g.image.height}}>
      {person?<PersonLayer p={p} videoStyle={{filter:config.finish==='G6'?'brightness(1.06) saturate(.94)':finishFilter(config.finish)}}/>:<OffthreadVideo src={p.plate} muted pauseWhenBuffering acceptableTimeShiftInSeconds={1/p.fps} style={{width:'100%',height:'100%',filter:finishFilter(config.finish)}}/>}
    </div>
    {!person&&<FootageOverlay geometry={{width:g.rect.width,height:g.rect.height,image:g.image}}/>}
  </div>;
}
function Hook({p,config,behind=false}:{p:VisualPlan;config:BrandNatConfig;behind?:boolean}){
  const t=useCurrentFrame()/p.fps,opacity=hookVisibility(t,p.duration,p.timelineOffset??0);
  if(config.hook==='none'||!opacity)return null;
  const {title,subtitle}=openingText(p.words,config.title,config.subtitle);
  if(!title)return null;
  const W=p.width,H=p.height,u=Math.min(W,H),g=footageGeometry(W,H,p.shoot,config);
  const onCanvas=config.layout!=='L4'&&!behind;
  const top=behind?g.face.y+u*.055:onCanvas?H*.065:H*.035;
  const maxHeight=behind?u*.25:onCanvas?(g.sidebar?H*.25:Math.max(u*.035,Math.min(H*.19,g.rect.y-top-u*.025))):Math.max(u*.035,Math.min(H*.19,g.face.y-top-u*.025));
  // Both title lines, their leading and spacing share one explicit safe budget.
  const spacing=u*({none:0,H1:0,H3:.018,H4:.016,H5:.032,H8:.037,H10:.012}[config.hook]);
  const lineFactor=({none:1,H1:1.98,H3:1.72,H4:1.86,H5:1.46,H8:1.86,H10:2.06}[config.hook]);
  const size=Math.min(u*.096,Math.max(u*.015,(maxHeight-spacing)/lineFactor));
  const hookWidth=g.sidebar?(behind?g.rect.width*.86:W*.31):W*.82;
  const titleSize=Math.min(size,hookWidth/(Math.max(1,title.length)*.60));
  const secondary=Math.min(size*.9,hookWidth/(Math.max(1,subtitle.length)*.60));
  const light=(onCanvas&&lightGround(config.finish))||config.hook==='H5',colour=light?ink:'#fff';
  const shadow=light?'none':`0 ${u*.003}px ${u*.012}px #000b`;
  const wrapper:React.CSSProperties={position:'absolute',left:g.sidebar?(behind?g.rect.x+g.rect.width*.07:W*.065):W*.07,width:hookWidth,top,opacity,transform:`translateY(${-(1-opacity)*u*.08}px)`,textAlign:'center',color:colour,textShadow:shadow};
  const bold:React.CSSProperties={...baseText,fontFamily:font('display'),fontWeight:800,fontSize:titleSize,letterSpacing:'-.025em'};
  const small:React.CSSProperties={...baseText,fontFamily:font('body'),fontSize:secondary*.65,fontWeight:500,whiteSpace:'nowrap'};
  if(config.hook==='H1')return <div data-nat-hook="H1" style={wrapper}>{subtitle&&<p style={{...small,fontFamily:font('accent'),fontStyle:'italic',fontSize:secondary*.7}}>{subtitle}</p>}<p style={{...bold,fontSize:titleSize*1.2,color:p.accent??butter,textTransform:'uppercase',WebkitTextStroke:`${u*.003}px ${ink}`,paintOrder:'stroke fill'}}>{title}</p></div>;
  if(config.hook==='H10')return <div data-nat-hook="H10" style={wrapper}><p style={{...bold,textTransform:'uppercase'}}>{title}</p>{subtitle&&<p style={{...baseText,marginTop:u*.012,fontFamily:font('code'),fontWeight:400,fontSize:secondary,letterSpacing:'.035em',textTransform:'uppercase',whiteSpace:'nowrap'}}>{subtitle}</p>}</div>;
  if(config.hook==='H4')return <div data-nat-hook="H4" style={wrapper}>{subtitle&&<p style={{...small,fontFamily:font('accent'),fontStyle:'italic',fontSize:secondary*.8,marginBottom:u*.016}}>{subtitle}</p>}<p style={{...bold,textTransform:'lowercase',color:light?ink:cream}}>{title}</p></div>;
  if(config.hook==='H5')return <div data-nat-hook="H5" style={wrapper}><div style={{display:'inline-block',maxWidth:'100%',padding:`${u*.012}px ${u*.035}px`,background:'#fff',borderRadius:u*.025,boxShadow:`0 ${u*.012}px ${u*.04}px #0002`}}><p style={{...bold,fontSize:titleSize*.85,color:ink}}>{title}</p>{subtitle&&<p style={{...small,color:'#5C5C59',marginTop:u*.008,fontSize:secondary*.55}}>{subtitle}</p>}</div></div>;
  if(config.hook==='H8')return <div data-nat-hook="H8" style={wrapper}>{subtitle&&<p style={{...small,fontFamily:font('label'),fontWeight:700,fontSize:secondary*.8,textTransform:'uppercase',letterSpacing:'.04em',marginBottom:u*.012}}>{subtitle}</p>}<p style={{...bold,textTransform:'lowercase'}}>{title}</p><svg width={u*.26} height={u*.025} viewBox="0 0 120 10" aria-hidden="true"><path d="M3 7 Q53 1 117 5" fill="none" stroke={light?ink:p.accent??butter} strokeWidth="2" strokeLinecap="round"/></svg></div>;
  return <div data-nat-hook="H3" style={wrapper}><p style={{...bold,textTransform:'uppercase',color:light?ink:cream,WebkitTextStroke:light?undefined:`${u*.002}px ${ink}`,paintOrder:'stroke fill'}}>{title}</p>{subtitle&&<p style={{...small,marginTop:u*.018,color:light?'#724F24':'#E0AC6B'}}>{subtitle}</p>}</div>;
}
export function BrandNatPicture({p,config}:{p:VisualPlan;config:BrandNatConfig}){
  const time=useCurrentFrame()/p.fps;
  const behind=config.hook==='H1'&&hookVisibility(time,p.duration,p.timelineOffset??0)>0;
  const needsPerson=config.finish==='G6';
  const g=footageGeometry(p.width,p.height,p.shoot,config);
  return <AbsoluteFill style={{background:finishGround(config.finish)}}>
    {config.layout==='L6'&&<AbsoluteFill style={{backgroundImage:'repeating-linear-gradient(0deg,transparent 0 31px,#29251F0A 31px 32px)',opacity:.7}}/>}
    <FittedVideo p={p} config={config}/>
    {(config.finish==='G1'||config.finish==='G5'||config.finish==='G6')&&<AbsoluteFill style={{background:config.finish==='G6'?'linear-gradient(110deg,#063D4633,#001C2433),radial-gradient(ellipse at 50% 40%,transparent 40%,#0007)':'radial-gradient(ellipse at 50% 40%,transparent 45%,#27160844)'}}/>}
    {behind&&<PersonMask p={p} inverse maskSize={`${g.image.width}px ${g.image.height}px`} maskPosition={`${g.rect.x+g.image.x}px ${g.rect.y+g.image.y}px`}><Hook p={p} config={config} behind/></PersonMask>}
    {needsPerson&&<FittedVideo p={p} config={config} person/>}
    {config.hook!=='H1'&&<Hook p={p} config={config}/>}
  </AbsoluteFill>;
}
const revealed=(w:NatWord,t:number)=>t>=w.start;
const ease=(n:number)=>1-(1-bounded(n,0,1))**3;
function captionText(group:NatWord[],kind:BrandNatConfig['caption'],time:number,size:number,accent:string,dark=false){
  const key=group.length-1;
  const textColour=dark?ink:'#fff',keywordColour=dark?'#43616B':ice;
  const softShadow=dark?'none':`0 ${size*.04}px ${size*.16}px #000b`;
  const word=(w:NatWord,i:number,extra:React.CSSProperties={})=><span key={i} style={{display:'inline-block',opacity:revealed(w,time)?1:0,...extra}}>{w.text}{i<key?' ':''}</span>;
  const phrase:React.CSSProperties={fontFamily:font('body'),fontWeight:600,fontSize:size,lineHeight:1.15,whiteSpace:'normal',textShadow:softShadow,color:textColour};
  if(kind==='C2')return <span style={{fontFamily:font('display'),fontSize:size*1.75,fontWeight:800,lineHeight:1,textTransform:'uppercase',letterSpacing:'-.03em',textShadow:softShadow}}>{group[0].text}</span>;
  if(kind==='C8')return <span style={{...phrase,fontFamily:font('display'),fontSize:size*.62,letterSpacing:'.06em',textTransform:'uppercase'}}>{group.map(w=>w.text).join(' ')}</span>;
  if(kind==='C9')return <div style={{position:'relative',width:'100%',height:'100%',textAlign:'left'}}>{group.map((w,i)=>{
    const keyword=i===key,arrive=ease((time-w.start)/.15);
    return <div key={i} style={{position:'absolute',left:`${i*8}%`,top:i*size*1.08,whiteSpace:'nowrap',fontFamily:font(keyword?'accent':'display'),fontWeight:keyword?400:800,fontStyle:keyword?'italic':'normal',fontSize:keyword?size*1.8:size,color:keyword?keywordColour:textColour,opacity:revealed(w,time)?1:0,transform:`translateY(${(1-arrive)*size*.16}px)`,textShadow:softShadow}}>{w.text}{keyword&&<span style={{position:'absolute',bottom:-size*.10,left:0,right:0,height:Math.max(1,size*.055),background:keywordColour,transform:`scaleX(${ease((time-w.start)/.25)})`,transformOrigin:'left'}}/>}</div>;
  })}</div>;
  if(kind==='C6'||kind==='C7'){
    const head=group.slice(0,-1),last=group[key],entered=ease((time-last.start)/.18);
    return <div style={{...phrase,height:'100%'}}><div style={{fontSize:size*(kind==='C7'?.6:.78),letterSpacing:kind==='C7'?'.14em':0,textTransform:kind==='C7'?'uppercase':'lowercase',minHeight:size*1.12}}>{head.map((w,i)=>word(w,i,{marginRight:i<head.length-1?'.25em':0}))}</div><div style={{marginTop:size*.14,fontFamily:font(kind==='C7'?'accent':'display'),fontStyle:kind==='C7'?'italic':'normal',fontWeight:kind==='C7'?400:800,fontSize:size*1.65,lineHeight:1.02,color:kind==='C6'?(dark?'#76552B':butter):textColour,opacity:revealed(last,time)?1:0,transform:`translateY(${(1-entered)*size*.2}px)`,filter:kind==='C6'&&entered<1?`blur(${(1-entered)*5}px)`:undefined}}>{last.text}</div></div>;
  }
  return <div style={{...phrase,fontFamily:font(kind==='C1'?'label':'body'),fontWeight:kind==='C1'?700:600,lineHeight:1.3}}>{group.map((w,i)=>{
    const keyword=i===key,arrive=ease((time-w.start)/.13);
    if(kind==='C5')return word(w,i,{padding:keyword?'.06em .22em':'.06em 0',marginRight:i<key?'.2em':0,borderRadius:'.22em',background:keyword?'#fff':undefined,color:keyword?ink:textColour,fontFamily:font(keyword?'display':'body'),fontWeight:keyword?800:600,textShadow:keyword?'none':softShadow,transform:`scale(${.94+.06*arrive})`});
    return word(w,i,{fontFamily:font(kind==='C4'&&keyword?'display':kind==='C1'?'label':'body'),fontSize:kind==='C4'&&keyword?'1.7em':undefined,fontWeight:keyword?800:600,color:keyword?(dark?'#76552B':kind==='C1'?butter:accent):textColour,textShadow:kind==='C1'&&keyword&&!dark?`${softShadow},0 0 ${size*.2}px #F6DE9055`:softShadow,marginRight:i<key?'.16em':0});
  })}</div>;
}
export function BrandNatCaptions({p,config,activeTypes=[]}:{p:VisualPlan;config:BrandNatConfig;activeTypes?:string[]}){
  const time=useCurrentFrame()/p.fps;
  const groups=captionGroups(p.words,config.caption,config.emphasis),group=currentCaption(groups,time);
  if(config.caption==='C3')return null;
  const translated=p.translation?.find(c=>time>=c.start&&time<c.end);
  if(p.translation&&!translated)return null;
  if(!group&&!translated)return null;
  // Translations arrive as phrases, not aligned words; preserve the whole
  // supplied phrase rather than inventing word timings for staircase animation.
  const displayed=translated?translated.text.split(/\s+/).map(text=>({text,start:translated.start,end:translated.end})):group!;
  const backed=activeTypes.some(type=>['b-roll-overlay','checklist','growth-curve','phone-mockup','chat-takeover','green-screen','paper-cutout','magazine-cover'].includes(type));
  const kind=backed||(translated&&(config.caption==='C2'||config.caption==='C9'))?'C5':config.caption;
  const W=p.width,H=p.height,u=Math.min(W,H),geometry=footageGeometry(W,H,p.shoot,config);
  const blockHeight=captionBlockHeight(kind,u);
  const region=captionRegion({W,H,face:geometry.face,height:blockHeight,position:config.position,
    hookReserved:config.hook!=='none'&&displayed[0].start+(p.timelineOffset??0)<3,effects:activeTypes,rect:geometry.rect,sidebar:geometry.sidebar});
  const compact=region.scale<.65;
  const actualKind=compact&&kind==='C9'?'C5':kind;
  const height=compact&&kind==='C9'?captionBlockHeight('C5',u):blockHeight;
  const finalRegion=compact&&kind==='C9'?captionRegion({W,H,face:geometry.face,height,position:config.position,hookReserved:config.hook!=='none'&&displayed[0].start+(p.timelineOffset??0)<3,effects:activeTypes,rect:geometry.rect,sidebar:geometry.sidebar}):region;
  const maxWord=Math.max(...displayed.map(w=>w.text.length),1);
  const base=u*(actualKind==='C1'?.083:actualKind==='C9'?.078:.065);
  const widthLimit=actualKind==='C9'?finalRegion.width*.70/(maxWord*.55*1.8):actualKind==='C2'?finalRegion.width/(maxWord*.58*1.75):base;
  const size=Math.min(base,widthLimit)*finalRegion.scale;
  const allText=displayed.map(w=>w.text).join(' ');
  // A phrase is measured once in its completed form; reveal only changes opacity.
  const phraseScale=actualKind==='C9'||actualKind==='C2'?1:Math.min(1,finalRegion.width*2/(allText.length*size*.56));
  const dark=finalRegion.surface==='canvas'&&lightGround(config.finish)&&!backed;
  const style:React.CSSProperties={position:'absolute',left:finalRegion.x,top:finalRegion.y,width:finalRegion.width,height:finalRegion.height,color:dark?ink:'#fff',textAlign:'center',display:'flex',alignItems:'center',justifyContent:'center',fontSize:size*phraseScale,overflow:'visible',pointerEvents:'none'};
  return <div data-nat-caption={actualKind} data-caption-fallback={compact?'compact':undefined} style={style}>
    <div style={{width:backed?'auto':'100%',maxWidth:'100%',padding:backed?'.18em .35em':undefined,boxSizing:'border-box',borderRadius:backed?'.22em':undefined,background:backed?'#151A1DEB':undefined,height:actualKind==='C9'||actualKind==='C6'||actualKind==='C7'?'100%':undefined,WebkitTextStroke:!dark&&(actualKind==='C1'||actualKind==='C9')?`${Math.max(.3,size*.012)}px #29251F`:undefined,paintOrder:'stroke fill'}}>{captionText(displayed,actualKind,time,size*phraseScale,p.accent??PACK.palette.win,dark)}</div>
  </div>;
}
