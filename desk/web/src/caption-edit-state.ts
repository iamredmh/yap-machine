type LookChange = { project: string };
type CaptionDesk = {
  look?: LookChange[];
  batches?: { project: string; status: string; look?: LookChange[] }[];
};

export type CaptionEditState = { queued: number; withAgent: number; saving: boolean };

/** Sending moves changes out of look and into a batch; they are not applied yet. */
export function captionEditState(desk: CaptionDesk, project: string, saving = false): CaptionEditState {
  return {
    queued: (desk.look ?? []).filter(change => change.project === project).length,
    withAgent: (desk.batches ?? [])
      .filter(batch => batch.project === project && (batch.status === 'waiting' || batch.status === 'picked'))
      .reduce((count, batch) => count + (batch.look ?? []).length, 0),
    saving,
  };
}

export function captionEditMessage(state: CaptionEditState): string | null {
  if (state.saving) return 'Saving your caption changes. They need to go to your agent before you export.';
  if (state.queued) return 'You have unsent caption or name-card changes. Send them to your agent, then review the updated cut before exporting.';
  if (state.withAgent) return 'Your caption or name-card changes are with your agent. Wait for the updated cut, then review it before exporting.';
  return null;
}
