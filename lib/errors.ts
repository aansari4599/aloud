import type { ErrorKind } from './types';

/**
 * Typed operational error. Stages throw AppError; services/queue.ts is the only
 * place that maps kinds to job status (ARCHITECTURE §9).
 */
export class AppError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
  }
}
