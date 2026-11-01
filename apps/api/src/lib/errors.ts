export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}
export const notFound = (what = 'Not found') => new HttpError(404, what, 'not_found');
export const forbidden = (why = 'Forbidden') => new HttpError(403, why, 'forbidden');
export const bad = (why: string, code = 'bad_request') => new HttpError(400, why, code);
