export const UPDATE_NOTE_MIN = 10;
export const UPDATE_NOTE_MAX = 200;
export const UPDATE_COOLDOWN_MS = 7 * 86400000;
export interface UpdateIntent { updateKind: 'minor' | 'major'; updateNote: string }
export function normalizeUpdateNote(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
}
export function parseUpdateIntent(input: { updateKind?: unknown; updateNote?: unknown }): UpdateIntent {
  const updateKind = input.updateKind === undefined ? 'minor' : input.updateKind;
  if (updateKind !== 'minor' && updateKind !== 'major') throw new Error('update_kind_invalid');
  if (input.updateNote !== undefined && typeof input.updateNote !== 'string') throw new Error('update_note_invalid');
  const updateNote = normalizeUpdateNote(input.updateNote ?? '');
  if (updateKind === 'minor' ? updateNote !== '' : [...updateNote].length > UPDATE_NOTE_MAX || [...updateNote.replace(/\p{White_Space}/gu, '')].length < UPDATE_NOTE_MIN) {
    throw new Error('update_note_invalid');
  }
  return { updateKind, updateNote };
}
