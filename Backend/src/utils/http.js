const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

class ApiError extends Error {
  constructor(statusCode, message, details = null, code = "API_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
  }
}

module.exports = {
  asyncHandler,
  ApiError,
};
