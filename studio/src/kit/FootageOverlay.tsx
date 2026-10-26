import React, { createContext, useContext } from 'react';
import { Sequence } from 'remotion';

/** Optional decorations that must follow the very same crop as the footage.
 * Scene chrome, captions and titles stay outside this slot. */
export type FootageGeometry = {
  width: number;
  height: number;
  image: { x:number; y:number; width:number; height:number };
};
export const SpokenCaptionHiddenContext=createContext(false);
export const FootageOverlayContext = createContext<((geometry:FootageGeometry)=>React.ReactNode)|null>(null);
export function FootageOverlay({geometry,sourceOffset=0}:{geometry:FootageGeometry;sourceOffset?:number}) {
  const render = useContext(FootageOverlayContext);
  if (!render) return null;
  // Presenter scenes run inside Sequences; native masks are indexed from the
  // source timeline, just like each presenter's startFrom={at} video.
  return <Sequence from={-sourceOffset} layout="none">{render(geometry)}</Sequence>;
}
