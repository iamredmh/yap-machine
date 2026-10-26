import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Img, OffthreadVideo, useBufferState, useCurrentFrame, useDelayRender } from 'remotion';
import { MaskReadiness, personMaskFrame, personMaskUrl, personMaskWindow, type PersonMaskSource } from './person-mask';

type PersonPlan = { plate:string; fps:number; mask?:PersonMaskSource|null };
const fill:React.CSSProperties={position:'absolute',inset:0};

function MaskImage({url,current,onDecoded}:{url:string;current:boolean;onDecoded:(url:string,image:HTMLImageElement)=>void}){
  const decoded=useCallback((image:HTMLImageElement)=>onDecoded(url,image),[url,onDecoded]);
  return <Img src={url} onImageFrame={decoded} pauseWhenLoading={current} style={{display:'none'}}/>;
}

/** The one mask-loading path used by effects and Brand Nat. Never paints an
 * undecoded mask or a previous seek's silhouette. Keeps decoded neighbours alive
 * so normal playback does not wait for a network request on every frame. */
export function PersonMask({p,children,inverse=false,maskSize='100% 100%',maskPosition='0 0'}:{
  p:PersonPlan;children:React.ReactNode;inverse?:boolean;maskSize?:string;maskPosition?:string;
}){
  const frame=useCurrentFrame();
  const {delayPlayback}=useBufferState(),{delayRender,continueRender}=useDelayRender();
  const cache=useRef(new MaskReadiness<HTMLImageElement>());
  const [,refresh]=useState(0);
  if(!p.mask)throw new Error('This effect needs an automatic person cutout. Wait for it to finish preparing.');
  const index=personMaskFrame(frame,p.fps,p.mask),url=personMaskUrl(p.mask,index);
  const urls=personMaskWindow(p.mask,index);
  cache.current.setWindow(urls);
  const nextUrl=personMaskUrl(p.mask,Math.min(index+1,p.mask.count));
  const {visible:ready,canAdvance}=cache.current.readiness(url,nextUrl);
  const decoded=useCallback((source:string,image:HTMLImageElement)=>{
    if(cache.current.accept(source,image))refresh(value=>value+1);
  },[]);
  useLayoutEffect(()=>{
    // Pause with the current silhouette still visible if the next decode is
    // late. Waiting only after advancing would briefly hide the text layer.
    if(canAdvance)return;
    const playback=delayPlayback(),render=delayRender(`Preparing person mask ${index}`);
    return ()=>{playback.unblock();continueRender(render);};
  },[canAdvance,url,index,delayPlayback,delayRender,continueRender]);
  const image=`url("${url}")`;
  const maskStyle:React.CSSProperties=inverse?{
    maskImage:`linear-gradient(#fff,#fff),${image}`,WebkitMaskImage:`linear-gradient(#fff,#fff),${image}`,
    maskMode:'alpha,luminance',maskComposite:'exclude',WebkitMaskComposite:'xor',
    maskSize:`100% 100%,${maskSize}`,WebkitMaskSize:`100% 100%,${maskSize}`,
    maskPosition:`0 0,${maskPosition}`,WebkitMaskPosition:`0 0,${maskPosition}`,
  }:{maskImage:image,WebkitMaskImage:image,maskMode:'luminance',maskSize,WebkitMaskSize:maskSize,maskPosition,WebkitMaskPosition:maskPosition};
  return <>
    {urls.map(source=><MaskImage key={source} url={source} current={source===url} onDecoded={decoded}/>)}
    <div data-person-mask={index} data-mask-ready={ready?'true':'false'} style={{...fill,...maskStyle,maskRepeat:'no-repeat',WebkitMaskRepeat:'no-repeat',visibility:ready?'visible':'hidden'}}>{children}</div>
  </>;
}

/** Deterministic exported frames; the live video buffers and stays within one
 * frame of the timeline instead of accepting the browser default's 0.45s drift. */
export function PersonLayer({p,style,videoStyle}:{p:PersonPlan;style?:React.CSSProperties;videoStyle?:React.CSSProperties}){
  return <div style={{...fill,...style}}><PersonMask p={p}><OffthreadVideo src={p.plate} muted pauseWhenBuffering acceptableTimeShiftInSeconds={1/p.fps} style={{...fill,width:'100%',height:'100%',objectFit:'cover',...videoStyle}}/></PersonMask></div>;
}
