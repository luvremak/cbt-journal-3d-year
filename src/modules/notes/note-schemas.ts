import { z } from 'zod';
import type { Note } from './note.js';

export const createNoteBody = z.object({
  text: z.string().trim().min(1).max(5000),
});

export function toNoteDto(note: Note) {
  return {
    id: note.id,
    entry_id: note.entryId,
    text: note.text,
    created_at: note.createdAt.toISOString(),
  };
}
