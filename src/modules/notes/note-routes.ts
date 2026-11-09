import type { Router } from 'express';
import { currentUser } from '../../http/middleware/auth.js';
import { parseBody } from '../../http/validate.js';
import { createNoteBody, toNoteDto } from './note-schemas.js';
import type { NoteService } from './note-service.js';

export function mountTherapistNoteRoutes(router: Router, notes: NoteService): void {
  router.get('/entries/:entryId/notes', async (req, res) => {
    const list = await notes.list(currentUser(res), req.params.entryId);
    res.json(list.map(toNoteDto));
  });

  router.post('/entries/:entryId/notes', async (req, res) => {
    const { text } = parseBody(createNoteBody, req.body);
    const note = await notes.create(currentUser(res), req.params.entryId, text);
    res.status(201).json(toNoteDto(note));
  });
}
