export function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const e = new Error(message) as Error & { statusCode: number };
  e.statusCode = statusCode;
  e.name = 'HttpError';
  return e;
}
