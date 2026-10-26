export type PreviewReadiness = {
  fontsLoaded: boolean;
  buffering: boolean;
  pendingMasks: number;
  videos: readonly { readyState: number; seeking: boolean }[];
};

/** Mounting a Player is not proof that its first frame can be shown. */
export function previewCanPaint(state: PreviewReadiness): boolean {
  return state.fontsLoaded && !state.buffering && state.pendingMasks === 0
    && state.videos.every(video => video.readyState >= 2 && !video.seeking);
}

/** Allow layout/media effects to settle over consecutive paints, resetting after
 * every revision or interruption rather than accepting a stale ready callback. */
export class PreviewPaintGate {
  private revision = -1;
  private consecutive = 0;
  observe(revision: number, ready: boolean): boolean {
    if (revision !== this.revision) { this.revision = revision; this.consecutive = 0; }
    this.consecutive = ready ? this.consecutive + 1 : 0;
    return this.consecutive >= 3;
  }
}
