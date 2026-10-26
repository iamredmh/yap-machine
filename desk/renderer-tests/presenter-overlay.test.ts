import { describe, expect, it, vi } from 'vitest';
import { FullFrame, HalfBand, Tile, type Shoot } from '../../studio/src/kit/Presenter';

vi.mock('../../studio/node_modules/remotion/dist/esm/index.mjs',()=>({
    OffthreadVideo:'video', Sequence:'sequence', staticFile:(s:string)=>s,useCurrentFrame:()=>24,
}));
vi.mock('../../studio/src/engine/motion',()=>({punch:()=>1}));
vi.mock('../../studio/src/engine/signature',()=>({SIG:{edge:'clean',chrome:'window',surface:'terminal',tilt:0}}));
vi.mock('../../studio/src/engine/style',()=>({
    FONT:{code:'monospace'}, packColour:(s:string)=>s,
    PACK:{presenter:{tile:{ring:null,shadow:'none',radius:12},halfBand:{feather:0,rule:null}},palette:{panel:'#111',line:'#333',textSoft:'#aaa'}},
}));
const elements=(node:any):any[]=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];
const shoot:Shoot={plate:'video.mp4',width:540,height:960,faceX:270,crown:94,eyes:259,chin:405};
const parts=(node:any)=>({video:elements(node).find(n=>n.type==='video'),overlay:elements(node).find(n=>n.type?.name==='FootageOverlay')});

describe('behind-person overlay shares the scene presenter crop',()=>{
    it('follows full-frame scale, crop and punch transform without a second source video',()=>{
        const output=FullFrame({shoot,at:42,k:1.78,crownY:420,zoom:1.12});
        const {video,overlay}=parts(output),v=video.props.style;
        expect(overlay.props.geometry).toEqual({width:1080,height:1920,image:{x:v.left,y:v.top,width:v.width,height:v.height}});
        expect(overlay.props.sourceOffset).toBe(video.props.startFrom);
        expect((output as any).props.style.transform).toBe('scale(1.12)');
        expect(elements(output).filter(n=>n.type==='video')).toHaveLength(1);
    });
    it('shares the exact lower-band crop and source timeline offset',()=>{
        const output=HalfBand({shoot,at:120,top:1000});
        const {video,overlay}=parts(output),v=video.props.style;
        expect(overlay.props.geometry).toEqual({width:1080,height:920,image:{x:v.left,y:v.top,width:v.width,height:v.height}});
        expect(overlay.props.sourceOffset).toBe(120);
    });
    it('excludes the terminal window bar while matching its footage underneath',()=>{
        const output=Tile({shoot,at:72,x:150,y:880,w:780,h:780});
        const {video,overlay}=parts(output),v=video.props.style;
        expect(overlay.props.geometry).toEqual({width:780,height:780,image:{x:v.left,y:v.top-56,width:v.width,height:v.height}});
        expect(overlay.props.sourceOffset).toBe(72);
        const box=elements(output).find(n=>n.props?.children===overlay);
        expect(box.props.style).toMatchObject({top:56,height:780,overflow:'hidden'});
    });
});
