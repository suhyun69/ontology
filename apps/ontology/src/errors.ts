/** Status codes these routes actually produce. */
export type HttpErrorStatus = 400 | 404 | 500;

/** An error carrying the status the client should see. Handled in index.ts. */
export class HttpError extends Error {
  readonly status: HttpErrorStatus;

  constructor(status: HttpErrorStatus, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}
