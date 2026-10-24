import React from 'react';
import { continueRender, delayRender } from 'remotion';
import { MEASURE, PACK, TYPE } from '../engine/style';

/**
 * A line of display type given the stack's measure, by the pack's fit rule: 'width' scales it to fill the measure
 * exactly; 'cap' keeps the scene's size times fitScale and only shrinks a line that would pass the measure. It measures
 * itself once the fonts are in, so the fit holds on every frame. It lines up as the pack's composition says.
 */
export const Fit: React.FC<{ children: React.ReactNode; measure?: number }> = ({ children, measure = MEASURE }) => {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [k, setK] = React.useState(1);
  const [nh, setNh] = React.useState(0);
  const [handle] = React.useState(() => delayRender('fit'));
  const L = TYPE.display.layout;
  const align = PACK.composition.align;
  React.useLayoutEffect(() => {
    let done = false;
    const measureIt = () => {
      if (!ref.current) return;
      const nat = ref.current.offsetWidth;
      if (nat <= 0) return;
      const room = (L.measure ?? 1) * measure;
      setK(L.fit === 'width' ? room / nat : Math.min(L.fitScale, room / nat));
      setNh(ref.current.offsetHeight);
    };
    measureIt();
    document.fonts.ready.then(() => {
      measureIt();
      if (!done) {
        done = true;
        continueRender(handle);
      }
    });
    return () => {
      if (!done) {
        done = true;
        continueRender(handle);
      }
    };
  }, [measure, handle, L.fit, L.fitScale, L.measure]);
  return (
    // the box takes the scaled height, so the gaps around a fitted line measure true. A flex box, so a centred line
    // wider than the measure (before it shrinks) spills evenly both sides and scales back onto the centre; with
    // text-align it would pin to the left edge and the centred scale would push it off to the right. Not stretched,
    // or the line would take the box's height and the next measure would grow the box.
    <div style={{ width: measure, height: nh ? nh * k : 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: align === 'left' ? 'flex-start' : 'center' }}>
      <span ref={ref} style={{ display: 'inline-block', flexShrink: 0, whiteSpace: 'nowrap', transform: `scale(${k})`, transformOrigin: align === 'left' ? '0 0' : '50% 0' }}>
        {children}
      </span>
    </div>
  );
};
