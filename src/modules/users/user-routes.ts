import type { Router } from 'express';
import { currentUser } from '../../http/middleware/auth.js';
import { parsePage } from '../../lib/pagination.js';
import type { UserService } from './user-service.js';

export function mountClientUserRoutes(router: Router, users: UserService): void {
  router.get('/therapist', async (_req, res) => {
    res.json(await users.getTherapistOf(currentUser(res)));
  });
}

export function mountTherapistUserRoutes(router: Router, users: UserService): void {
  router.get('/clients', async (req, res) => {
    res.json(await users.listClientsOf(currentUser(res), parsePage(req.query)));
  });
}
