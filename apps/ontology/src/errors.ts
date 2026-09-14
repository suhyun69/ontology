/**
 * Status codes these routes actually produce.
 *
 * 409 is for an action refused because the instance is in the wrong state --
 * the request was well formed and the caller may be able to retry later, which
 * 400 would not convey.
 */
export type HttpErrorStatus = 400 | 404 | 409 | 500 | 501;

/** An error carrying the status the client should see. Handled in index.ts. */
export class HttpError extends Error {
  readonly status: HttpErrorStatus;
  /** Extra machine-readable context, e.g. JSON Schema validation errors. */
  readonly details: unknown;

  constructor(status: HttpErrorStatus, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}
