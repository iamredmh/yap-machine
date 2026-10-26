import { describe, expect, it } from 'vitest';
import { captionEditMessage, captionEditState } from './caption-edit-state.js';

describe('caption edits and styled exports', () => {
  const change = { project: 'mine' };
  it('stays blocked when sending moves unsent changes into a waiting batch', () => {
    const unsent = captionEditState({ look: [change] }, 'mine');
    const sent = captionEditState({ look: [], batches: [{ project: 'mine', status: 'waiting', look: [change] }] }, 'mine');
    expect(unsent).toEqual({ queued: 1, withAgent: 0, saving: false });
    expect(sent).toEqual({ queued: 0, withAgent: 1, saving: false });
    expect(captionEditMessage(unsent)).toContain('unsent');
    expect(captionEditMessage(sent)).toContain('updated cut');
  });
  it('waits for the agent to finish, including picked batches', () => {
    const desk = { batches: [{ project: 'mine', status: 'picked', look: [change] }] };
    expect(captionEditMessage(captionEditState(desk, 'mine'))).not.toBeNull();
    desk.batches[0].status = 'done';
    expect(captionEditMessage(captionEditState(desk, 'mine'))).toBeNull();
  });
  it('does not block ordinary exports for unrelated projects or note-only batches', () => {
    expect(captionEditMessage(captionEditState({
      look: [{ project: 'other' }],
      batches: [
        { project: 'other', status: 'waiting', look: [{ project: 'other' }] },
        { project: 'mine', status: 'picked', look: [] },
      ],
    }, 'mine'))).toBeNull();
  });
  it('covers an edit while its save request and desk refresh are in flight', () => {
    expect(captionEditMessage(captionEditState({}, 'mine', true))).toContain('Saving');
    expect(captionEditMessage(captionEditState({}, 'mine'))).toBeNull();
  });
  it('prioritises unsent edits when earlier corrections are already with the agent', () => {
    const state = captionEditState({ look: [change], batches: [{ project: 'mine', status: 'picked', look: [change] }] }, 'mine');
    expect(state).toMatchObject({ queued: 1, withAgent: 1 });
    expect(captionEditMessage(state)).toContain('Send them');
  });
});
