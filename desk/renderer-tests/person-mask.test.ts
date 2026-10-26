import { describe, expect, it } from 'vitest';
import { MaskReadiness, personMaskGeometry, personMaskFrame, personMaskUrl, personMaskWindow } from '../../studio/src/yap/person-mask';

describe('person mask timing', () => {
  it.each([24,25,30,60,30000/1001])('selects every exact mask frame at %s fps without floating-point repeats', fps => {
    const mask={fps,count:18000};
    for(let frame=0;frame<mask.count;frame++)expect(personMaskFrame(frame,fps,mask)).toBe(frame+1);
  });
  it('retains legacy lower-rate masks and clamps only beyond the actual mask duration', () => {
    const mask={fps:15,count:90};
    expect([0,1,2,3,4].map(f=>personMaskFrame(f,24,mask))).toEqual([1,1,2,2,3]);
    expect(personMaskFrame(-10,24,mask)).toBe(1);
    expect(personMaskFrame(144,24,mask)).toBe(90);
  });
  it('rejects unusable metadata rather than hiding timing failures behind mask one', () => {
    expect(()=>personMaskFrame(0,0,{fps:24,count:10})).toThrow('invalid frame timing');
    expect(()=>personMaskFrame(0,24,{fps:24,count:0})).toThrow('invalid frame timing');
  });
});

describe('decoded masks across playback and seeks', () => {
  const mask={url:'/cache/version-a/',fps:24,count:500};
  it('keeps a bounded decoded lookahead and never requests files outside the sequence', () => {
    expect(personMaskWindow(mask,1)[0]).toBe('/cache/version-a/000001.png');
    expect(personMaskWindow(mask,500).at(-1)).toBe('/cache/version-a/000500.png');
    for(let i=1;i<=500;i++)expect(personMaskWindow(mask,i).length).toBeLessThanOrEqual(8);
  });
  it('retains already decoded next frames so normal playback does not expose a loading silhouette', () => {
    const cache=new MaskReadiness<object>();
    cache.setWindow(personMaskWindow(mask,1));
    cache.accept(personMaskUrl(mask,2),{});
    cache.setWindow(personMaskWindow(mask,2));
    expect(cache.has(personMaskUrl(mask,2))).toBe(true);
  });
  it('holds a visible current mask when the next decode is late, including the last frame', () => {
    const cache=new MaskReadiness<object>(),current=personMaskUrl(mask,1),next=personMaskUrl(mask,2);
    cache.setWindow(personMaskWindow(mask,1));
    expect(cache.readiness(current,next)).toEqual({visible:false,canAdvance:false});
    cache.accept(current,{});
    expect(cache.readiness(current,next)).toEqual({visible:true,canAdvance:false});
    cache.accept(next,{});
    expect(cache.readiness(current,next)).toEqual({visible:true,canAdvance:true});
    const last=personMaskUrl(mask,mask.count);
    cache.setWindow(personMaskWindow(mask,mask.count));cache.accept(last,{});
    expect(cache.readiness(last,last)).toEqual({visible:true,canAdvance:true});
  });
  it('does not display the last loaded mask while a seek target is still decoding', async () => {
    const cache=new MaskReadiness<object>(),old=personMaskUrl(mask,1),next=personMaskUrl(mask,300);
    cache.setWindow(personMaskWindow(mask,1)); cache.accept(old,{});
    let finishOld:()=>void=()=>{};
    const oldDecode=new Promise<void>(resolve=>{finishOld=()=>{cache.accept(old,{});resolve();};});
    cache.setWindow(personMaskWindow(mask,300));
    expect(cache.has(old)).toBe(false); expect(cache.has(next)).toBe(false);
    finishOld(); await oldDecode;
    expect(cache.has(old)).toBe(false); expect(cache.has(next)).toBe(false);
    expect(cache.accept(next,{})).toBe(true); expect(cache.has(next)).toBe(true);
  });
  it('invalidates decoded silhouettes when regeneration changes the cache URL', () => {
    const cache=new MaskReadiness<object>(),old=personMaskUrl(mask,42);
    cache.setWindow(personMaskWindow(mask,42));cache.accept(old,{});
    const fresh={...mask,url:'/cache/version-b/'};
    cache.setWindow(personMaskWindow(fresh,42));
    expect(cache.has(old)).toBe(false);
    expect(cache.has(personMaskUrl(fresh,42))).toBe(false);
    expect(cache.size).toBe(0);
  });
});

describe('SVG mask geometry', () => {
  it('keeps a default mask relative to its local video box at any canvas size', () => {
    for(const [w,h] of [[540,960],[960,540],[400,400]])
      expect(personMaskGeometry('100% 100%','0 0',w,h)).toEqual({x:0,y:0,width:1,height:1});
  });
  it('preserves fitted pixel offsets, cropped overflow, and a local band canvas', () => {
    expect(personMaskGeometry('270px 480px','135px 100px',540,960)).toEqual({x:.25,y:100/960,width:.5,height:.5});
    expect(personMaskGeometry('800px 600px','-200px -100px',400,400)).toEqual({x:-.5,y:-.25,width:2,height:1.5});
    expect(personMaskGeometry('200px 400px','100px 0px',400,400)).toEqual({x:.25,y:0,width:.5,height:1});
  });
  it('matches CSS percentage positioning in the remaining space', () => {
    expect(personMaskGeometry('50% 50%','50% 100%',400,600)).toEqual({x:.25,y:.5,width:.5,height:.5});
  });
  it('fails clearly on geometry that cannot match the video', () => {
    expect(()=>personMaskGeometry('0px 100px','0 0',400,400)).toThrow('invalid image');
    expect(()=>personMaskGeometry('cover','0 0',400,400)).toThrow('Unsupported');
    expect(()=>personMaskGeometry('100% 100%','0 0',0,400)).toThrow('invalid canvas');
  });
});
