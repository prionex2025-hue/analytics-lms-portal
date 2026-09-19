const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const getPagination = (query = {}, options = {}) => {
  const maxLimit = toPositiveInt(options.maxLimit, MAX_LIMIT);
  const defaultLimit = Math.min(toPositiveInt(options.defaultLimit, DEFAULT_LIMIT), maxLimit);
  const page = toPositiveInt(query.page, DEFAULT_PAGE);
  const limit = Math.min(toPositiveInt(query.limit, defaultLimit), maxLimit);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

module.exports = {
  getPagination,
  MAX_LIMIT,
};
