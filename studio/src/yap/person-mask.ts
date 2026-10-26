export type PersonMaskSource = { url:string; fps:number; count:number };

/** Masks start at time zero. Multiplication first avoids 29/30*30 underflow. */
export function personMaskFrame(frame:number, fps:number, mask:Pick<PersonMaskSource,'fps'|'count'>):number {
  if (!(fps>0 && mask.fps>0 && Number.isInteger(mask.count) && mask.count>0))
    throw new Error('The person cutout has invalid frame timing. Prepare the cutout again.');
  return Math.max(1,Math.min(mask.count,Math.floor(Math.max(0,frame)*mask.fps/fps+1e-7)+1));
}
export const personMaskUrl = (mask:PersonMaskSource, index:number) => `${mask.url}${String(index).padStart(6,'0')}.png`;

/** Small decoded window, not an unbounded preload of a user's entire video. */
export function personMaskWindow(mask:PersonMaskSource,index:number):string[] {
  return Array.from({length:Math.min(mask.count,index+5)-Math.max(1,index-2)+1},(_,i)=>personMaskUrl(mask,Math.max(1,index-2)+i));
}

/** A decode callback from an old seek may never expose an unrelated frame. */
export class MaskReadiness<T> {
  private wanted = new Set<string>();
  private decoded = new Map<string,T>();
  setWindow(urls:readonly string[]) {
    this.wanted=new Set(urls);
    for(const url of this.decoded.keys())if(!this.wanted.has(url))this.decoded.delete(url);
  }
  accept(url:string,value:T):boolean {
    if(!this.wanted.has(url))return false;
    this.decoded.set(url,value); return true;
  }
  wants(url:string):boolean { return this.wanted.has(url); }
  has(url:string):boolean { return this.wants(url)&&this.decoded.has(url); }
  readiness(current:string,next:string):{visible:boolean;canAdvance:boolean} {
    const visible=this.has(current);
    return {visible,canAdvance:visible&&this.has(next)};
  }
  get size():number { return this.decoded.size; }
}

/** CSS pixel/percentage geometry expressed in the local SVG mask's unit box.
 * Explicit canvas dimensions are supplied for fitted/banded video containers. */
export function personMaskGeometry(size:string,position:string,width:number,height:number){
  if(!(width>0&&height>0))throw new Error('The person cutout has invalid canvas dimensions.');
  const pair=(value:string)=>{const parts=value.trim().split(/\s+/);return [parts[0],parts[1]??parts[0]];};
  const length=(value:string,extent:number)=>{
    if(!/^-?(?:\d+\.?\d*|\.\d+)(?:px|%)?$/.test(value))throw new Error('Unsupported person cutout geometry.');
    return parseFloat(value)*(value.endsWith('%')?extent/100:1);
  };
  const [sw,sh]=pair(size),[px,py]=pair(position);
  const w=length(sw,width),h=length(sh,height);
  if(!(w>0&&h>0))throw new Error('The person cutout has invalid image dimensions.');
  // CSS percentage positions refer to the space left after sizing the image.
  const x=length(px,px.endsWith('%')?width-w:width),y=length(py,py.endsWith('%')?height-h:height);
  return {x:x/width,y:y/height,width:w/width,height:h/height};
}
