export const HTTP_STATUS = {
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  tooManyRequests: 429,
  serverErrorMin: 500,
  serverErrorMax: 599,
} as const;
