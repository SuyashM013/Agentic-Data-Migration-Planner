class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const badRequest = (message, details, code = 'VALIDATION_ERROR') => new AppError(400, code, message, details);
const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
const conflict = (message, code = 'INVALID_STATE', details) => new AppError(409, code, message, details);

module.exports = { AppError, badRequest, notFound, conflict };
