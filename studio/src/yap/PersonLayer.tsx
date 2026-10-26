import React, { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { OffthreadVideo, useBufferState, useCurrentFrame, useDelayRender, useVideoConfig } from 'remotion';
import { MaskReadiness, personMaskFrame, personMaskGeometry, personMaskUrl, personMaskWindow, type PersonMaskSource } from './person-mask';

type PersonPlan = { plate:string; fps:number; mask?:PersonMaskSource|null };
const fill:React.CSSProperties={position:'absolute',inset:0};

/** A mask image stays mounted while it is in the lookahead window. Readiness
 * comes from the SVG image that will actually paint, not a separate HTML Img. */
function MaskDefinition({id,url,inverse,filterId,geometry,onLoaded,onError}:{
  id:string;url:string;inverse:boolean;filterId:string;geometry:ReturnType<typeof personMaskGeometry>;
  onLoaded:(url:string,image:SVGImageElement)=>void;onError:(url:string)=>void;
}){
  const loaded=useCallback((event:React.SyntheticEvent<SVGImageElement>)=>onLoaded(url,event.currentTarget),[url,onLoaded]);
  const failed=useCallback(()=>onError(url),[url,onError]);
  return <mask id={id} maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox" x={0} y={0} width={1} height={1} style={{maskType:'luminance'}}>
    {inverse&&<rect x={0} y={0} width={1} height={1} fill="white"/>}
    <image href={url} {...geometry} preserveAspectRatio="none" filter={inverse?`url(#${filterId})`:undefined} onLoad={loaded} onError={failed}/>
  </mask>;
}

/** Loaded local SVG masks avoid replacing an external CSS image on every frame.
 * The bounded definitions retain their SVG image resources across playback. */
export function PersonMask({p,children,inverse=false,maskSize='100% 100%',maskPosition='0 0',maskCanvas}:{
  p:PersonPlan;children:React.ReactNode;inverse?:boolean;maskSize?:string;maskPosition?:string;maskCanvas?:{width:number;height:number};
}){
  const frame=useCurrentFrame(),video=useVideoConfig();
  const prefix=`person-${useId().replace(/[^a-zA-Z0-9_-]/g,'')}`;
  const {delayPlayback}=useBufferState(),{delayRender,continueRender}=useDelayRender();
  const cache=useRef(new MaskReadiness<SVGImageElement>());
  const [,refresh]=useState(0),[failure,setFailure]=useState<string|null>(null);
  if(!p.mask)throw new Error('This effect needs an automatic person cutout. Wait for it to finish preparing.');
  if(failure)throw new Error(failure);
  const index=personMaskFrame(frame,p.fps,p.mask),url=personMaskUrl(p.mask,index);
  const urls=personMaskWindow(p.mask,index);
  cache.current.setWindow(urls);
  const nextUrl=personMaskUrl(p.mask,Math.min(index+1,p.mask.count));
  const {visible:ready,canAdvance}=cache.current.readiness(url,nextUrl);
  const loaded=useCallback((source:string,image:SVGImageElement)=>{
    if(cache.current.accept(source,image))refresh(value=>value+1);
  },[]);
  const failed=useCallback((source:string)=>{
    if(cache.current.wants(source))setFailure('The automatic person cutout could not load. Prepare the preview again.');
  },[]);
  useLayoutEffect(()=>{
    // A slow next frame pauses with the current silhouette still visible.
    if(canAdvance)return;
    const playback=delayPlayback(),render=delayRender(`Preparing person mask ${index}`);
    return ()=>{playback.unblock();continueRender(render);};
  },[canAdvance,url,index,delayPlayback,delayRender,continueRender]);
  const geometry=personMaskGeometry(maskSize,maskPosition,maskCanvas?.width??video.width,maskCanvas?.height??video.height);
  const maskId=(source:string)=>`${prefix}-${source.slice(source.lastIndexOf('/')+1).replace(/[^a-zA-Z0-9_-]/g,'-')}`;
  const reference=`url(#${maskId(url)})`,filterId=`${prefix}-inverse`;
  return <>
    <svg width={0} height={0} aria-hidden="true" style={{position:'absolute',pointerEvents:'none'}}><defs>
      <filter id={filterId} x={0} y={0} width={1} height={1} colorInterpolationFilters="sRGB">
        <feComponentTransfer><feFuncR type="table" tableValues="1 0"/><feFuncG type="table" tableValues="1 0"/><feFuncB type="table" tableValues="1 0"/></feComponentTransfer>
      </filter>
      {urls.map(source=><MaskDefinition key={source} id={maskId(source)} url={source} inverse={inverse} filterId={filterId} geometry={geometry} onLoaded={loaded} onError={failed}/>)}
    </defs></svg>
    <div data-person-mask={index} data-mask-ready={ready?'true':'false'} style={{...fill,maskImage:reference,WebkitMaskImage:reference,maskMode:'luminance',visibility:ready?'visible':'hidden'}}>{children}</div>
  </>;
}

/** Deterministic exported frames; the live video buffers and stays within one
 * frame of the timeline instead of accepting the browser default's 0.45s drift. */
export function PersonLayer({p,style,videoStyle}:{p:PersonPlan;style?:React.CSSProperties;videoStyle?:React.CSSProperties}){
  return <div style={{...fill,...style}}><PersonMask p={p}><OffthreadVideo src={p.plate} muted pauseWhenBuffering acceptableTimeShiftInSeconds={1/p.fps} style={{...fill,width:'100%',height:'100%',objectFit:'cover',...videoStyle}}/></PersonMask></div>;
}
