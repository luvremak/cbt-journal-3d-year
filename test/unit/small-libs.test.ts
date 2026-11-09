import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { getBusinessProcess, runInBusinessProcess } from '../../src/lib/context.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../src/lib/errors.js';
import { isUuid } from '../../src/lib/uuid.js';

describe('isUuid', () => {
  it.each([
    '11111111-1111-4111-8111-111111111111',
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    '00000000-0000-0000-0000-000000000000',
  ])('accepts %s', (v) => expect(isUuid(v)).toBe(true));

  it.each([
    'abc',
    '',
    '11111111-1111-4111-8111-11111111111',
    '11111111-1111-4111-8111-1111111111111',
    ' 11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111 ',
    'g1111111-1111-4111-8111-111111111111',
    '111111111111-4111-8111-111111111111',
    undefined,
    null,
    123,
  ])('rejects %s', (v) => expect(isUuid(v)).toBe(false));
});

describe('domain errors map to spec status codes', () => {
  it.each([
    [new BadRequestError('x'), 400, 'BAD_REQUEST'],
    [new UnauthorizedError('x'), 401, 'UNAUTHORIZED'],
    [new ForbiddenError('x'), 403, 'FORBIDDEN'],
    [new NotFoundError('x'), 404, 'NOT_FOUND'],
    [new ConflictError('x'), 409, 'CONFLICT'],
    [new ValidationError('x', [1]), 422, 'VALIDATION_ERROR'],
  ])('%o', (error, status, code) => {
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.name).toBe(error.constructor.name);
    expect(error.message).toBe('x');
  });

  it('keeps details', () => {
    expect(new ValidationError('x', [{ field: 'a' }]).details).toEqual([{ field: 'a' }]);
    expect(new NotFoundError('x').details).toBeUndefined();
  });
});

describe('business-process context', () => {
  it('is visible inside the run and across awaits, not outside', async () => {
    expect(getBusinessProcess()).toBeUndefined();
    await runInBusinessProcess({ bpId: 'bp-1' }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(getBusinessProcess()?.bpId).toBe('bp-1');
    });
    expect(getBusinessProcess()).toBeUndefined();
  });

  it('returns the callback result', () => {
    expect(runInBusinessProcess({ bpId: 'x' }, () => 42)).toBe(42);
  });
});

describe('loadConfig', () => {
  it('defaults', () => {
    expect(loadConfig({})).toEqual({ PORT: 3000, LOG_LEVEL: 'info', STORAGE: 'memory' });
  });

  it('parses values', () => {
    expect(
      loadConfig({ PORT: '8080', LOG_LEVEL: 'debug', STORAGE: 'postgres', DATABASE_URL: 'pg://x' }),
    ).toEqual({ PORT: 8080, LOG_LEVEL: 'debug', STORAGE: 'postgres', DATABASE_URL: 'pg://x' });
  });

  it('requires DATABASE_URL for postgres', () => {
    expect(() => loadConfig({ STORAGE: 'postgres' })).toThrow(/DATABASE_URL is required/);
    expect(() => loadConfig({ STORAGE: 'postgres', DATABASE_URL: '' })).toThrow();
  });

  it.each([{ PORT: '0' }, { PORT: 'x' }, { LOG_LEVEL: 'loud' }, { STORAGE: 'redis' }])(
    'rejects %o',
    (env) => {
      expect(() => loadConfig(env)).toThrow();
    },
  );
});
