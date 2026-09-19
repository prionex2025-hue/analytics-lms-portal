/**
 * Global database client wrapper
 * Provides lazy-loaded models via the custom dbClient with caching
 * to avoid repeated initialization calls
 */

const models = require("../models");

let cachedDb = null;

/**
 * Get the database client instance (cached)
 * Can be called multiple times without performance penalty
 */
const getDb = async () => {
  if (!cachedDb) {
    try {
      const m = await models.init();
      cachedDb = m.dbClient;
    } catch (error) {
      console.error("Failed to initialize database client:", error);
      throw error;
    }
  }
  return cachedDb;
};

/**
 * Reset cache (useful for testing or when reconnecting)
 */
const resetDbCache = () => {
  cachedDb = null;
};

module.exports = {
  getDb,
  resetDbCache,
};
