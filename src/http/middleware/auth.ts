import type { RequestHandler, Response } from 'express';
import { getBusinessProcess } from '../../lib/context.js';
import { ForbiddenError } from '../../lib/errors.js';
import type { Role, User } from '../../modules/users/user.js';
import type { UserService } from '../../modules/users/user-service.js';

export const USER_HEADER = 'X-User-Id';

/** Справжньої авторизації немає (spec §6): користувач — із заголовка X-User-Id. */
export function authenticate(users: UserService): RequestHandler {
  return async (req, res, next) => {
    const user = await users.authenticate(req.header(USER_HEADER));
    res.locals.user = user;
    const bp = getBusinessProcess();
    if (bp) bp.userId = user.id;
    next();
  };
}

/** Клієнт на ендпоінті терапевта (або навпаки) → 403 (spec §7). */
export function requireRole(role: Role): RequestHandler {
  return (_req, res, next) => {
    if (currentUser(res).role !== role) {
      throw new ForbiddenError(`This endpoint is for role "${role}"`);
    }
    next();
  };
}

export function currentUser(res: Response): User {
  const user = res.locals.user as User | undefined;
  if (!user) {
    throw new Error('currentUser() called before authenticate()');
  }
  return user;
}
