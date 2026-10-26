export type PreviewRequest<T> = { id: number; key: string; revision: number; value: T };

/** Keep the last painted document until the newest requested document/frame is
 * ready. A late acknowledgment may never reveal a superseded style or seek. */
export class PreviewHandoff<T> {
  private nextId = 0;
  private nextRevision = 0;
  requested: PreviewRequest<T> | null = null;
  visible: PreviewRequest<T> | null = null;

  request(key: string, value: T): PreviewRequest<T> {
    // A seek or edit can invalidate media/masks even when the pack is the same.
    // Freeze the painted document; a loading replacement can absorb subsequent
    // drag/input revisions without creating a fresh iframe on every event.
    const reusePending = this.requested?.key === key && this.requested.id !== this.visible?.id;
    const id = reusePending ? this.requested!.id : ++this.nextId;
    this.requested = { id, key, revision: ++this.nextRevision, value };
    return this.requested;
  }

  reveal(id: number, revision: number): boolean {
    if (this.requested?.id !== id || this.requested.revision !== revision) return false;
    this.visible = this.requested;
    return true;
  }

  isCurrent(id: number, revision?: number): boolean {
    return this.requested?.id === id && (revision === undefined || this.requested.revision === revision);
  }

  entries(): PreviewRequest<T>[] {
    if (!this.requested) return [];
    return this.visible && this.visible.id !== this.requested.id ? [this.visible, this.requested] : [this.requested];
  }
}
