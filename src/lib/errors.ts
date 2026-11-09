/**
 * Доменні помилки. Сервіси кидають їх, а глобальний обробник
 * перетворює на HTTP-відповідь за полем `status`.
 */
export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  readonly status = 400;
  readonly code = 'BAD_REQUEST';
}

export class UnauthorizedError extends AppError {
  readonly status = 401;
  readonly code = 'UNAUTHORIZED';
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = 'FORBIDDEN';
}

export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = 'NOT_FOUND';
}

export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = 'CONFLICT';
}

export class ValidationError extends AppError {
  readonly status = 422;
  readonly code = 'VALIDATION_ERROR';
}
