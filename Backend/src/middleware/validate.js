const { ZodError } = require("zod");
const { ApiError } = require("../utils/http");

const validate = (schema) => (req, _res, next) => {
  try {
    const parsed = schema.parse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    req.body = parsed.body;
    req.params = parsed.params;
    req.query = parsed.query;

    next();
  } catch (error) {
    if (error instanceof ZodError) {
      return next(new ApiError(422, "Validation failed", error.flatten()));
    }

    next(error);
  }
};

module.exports = validate;
