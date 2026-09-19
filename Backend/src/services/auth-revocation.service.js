const { invalidateCachedUser } = require("./auth-cache.service");

const CACHE_ROLES_BY_MODEL = {
  student: ["student"],
  admin: ["admin", "college-admin"],
  superAdmin: ["superadmin"],
};

const getModelClient = (db, modelName) => db?.[modelName];

const invalidatePrincipalAuthCache = async (modelName, principalId) => {
  const cacheRoles = CACHE_ROLES_BY_MODEL[modelName] || [];
  await Promise.all(cacheRoles.map((role) => invalidateCachedUser(role, principalId)));
};

const bumpPrincipalTokenVersion = async (db, modelName, principalId) => {
  if (!principalId) {
    return null;
  }

  const model = getModelClient(db, modelName);
  if (!model) {
    await invalidatePrincipalAuthCache(modelName, principalId);
    return null;
  }

  const existing = await model.findUnique({
    where: { id: principalId },
    select: { id: true, tokenVersion: true },
  }).catch(() => null);

  if (!existing) {
    await invalidatePrincipalAuthCache(modelName, principalId);
    return null;
  }

  const tokenVersion = Number(existing.tokenVersion || 0) + 1;
  await model.update({
    where: { id: principalId },
    data: { tokenVersion },
  });
  await invalidatePrincipalAuthCache(modelName, principalId);
  return tokenVersion;
};

module.exports = {
  bumpPrincipalTokenVersion,
  invalidatePrincipalAuthCache,
};
