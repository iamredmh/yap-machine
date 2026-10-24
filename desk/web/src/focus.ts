/** After a mouse click the focus goes back to the page, so Space plays or pauses instead of pressing that control again.
 *  A keyboard press (detail 0) keeps the focus where the person put it. */
export const hit = (fn: () => void) => (e: MouseEvent) => { fn(); if (e.detail > 0) (e.currentTarget as HTMLElement).blur(); };
