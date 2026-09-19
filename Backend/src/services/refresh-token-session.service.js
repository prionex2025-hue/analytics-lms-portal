const { createRefreshToken, verifyRefreshToken } = require("../utils/token");
const { ApiError } = require("../utils/http");
const {
  cacheRefreshToken,
  getCachedRefreshToken,
  hashRefreshToken,
  invalidateRefreshToken,
  invalidateRefreshTokenRecord,
} = require("./refresh-token-cache.service");

const invalidRefreshTokenError = (code = "INVALID_REFRESH_TOKEN") =>
  new ApiError(401, "Invalid refresh token", null, code);

const verifyRefreshPayloadOrThrow = (refreshToken) => {
  try {
    return verifyRefreshToken(refreshToken);
  } catch {
    throw invalidRefreshTokenError();
  }
};

const isExpired = (record) => {
  const expiresAt = new Date(record?.expiresAt || 0).getTime();
  return !Number.isFinite(expiresAt) || expiresAt < Date.now();
};

const tokenLookupWhere = (refreshToken) => ({
  OR: [
    { tokenHash: hashRefreshToken(refreshToken) },
    { token: refreshToken },
  ],
});

const findRefreshTokenRecord = async ({ db, modelName, scope, refreshToken }) => {
  const model = db?.[modelName];
  if (!model) {
    return null;
  }

  const cached = await getCachedRefreshToken(scope, refreshToken);
  if (cached) {
    if (!cached.id) {
      return cached;
    }

    const freshRecord = await model.findUnique({ where: { id: cached.id } });
    if (freshRecord) {
      return freshRecord;
    }
  }

  const record = await model.findFirst({
    where: tokenLookupWhere(refreshToken),
  });

  if (record && !record.revokedAt && !isExpired(record)) {
    await cacheRefreshToken(scope, refreshToken, record);
  }

  return record;
};

const createRefreshTokenRecord = async ({
  db,
  modelName,
  scope,
  principal,
  ownerField,
  type = null,
  metadata = {},
}) => {
  const refreshToken = createRefreshToken(principal);
  const payload = verifyRefreshPayloadOrThrow(refreshToken);
  const data = {
    ...metadata,
    tokenHash: hashRefreshToken(refreshToken),
    [ownerField]: principal.id,
    expiresAt: new Date(payload.exp * 1000),
  };

  if (type) {
    data.type = type;
  }

  const refreshRecord = await db[modelName].create({ data });
  await cacheRefreshToken(scope, refreshToken, refreshRecord);

  return {
    refreshToken,
    refreshRecord,
    payload,
  };
};

const revokeAllRefreshTokensForOwner = async ({
  db,
  modelName,
  scope,
  ownerField,
  ownerId,
  reason = "revoked",
}) => {
  if (!ownerId) {
    return { count: 0 };
  }

  const model = db[modelName];
  const activeTokens = await model.findMany({
    where: { [ownerField]: ownerId, revokedAt: null },
  });

  const revokedAt = new Date();
  const result = await model.updateMany({
    where: { [ownerField]: ownerId, revokedAt: null },
    data: { revokedAt, revokedReason: reason },
  });

  await Promise.all(activeTokens.map((record) => invalidateRefreshTokenRecord(scope, record)));
  return result;
};

const assertRefreshTokenRecordUsable = async ({
  db,
  modelName,
  scope,
  ownerField,
  record,
  ownerId = null,
}) => {
  if (!record) {
    throw invalidRefreshTokenError();
  }

  if (record.revokedAt) {
    await invalidateRefreshTokenRecord(scope, record);
    await revokeAllRefreshTokensForOwner({
      db,
      modelName,
      scope,
      ownerField,
      ownerId: ownerId || record[ownerField],
      reason: "reused_refresh_token",
    });
    throw invalidRefreshTokenError("REFRESH_TOKEN_REUSED");
  }

  if (isExpired(record)) {
    await invalidateRefreshTokenRecord(scope, record);
    throw invalidRefreshTokenError();
  }

  return record;
};

const rotateRefreshTokenRecord = async ({
  db,
  modelName,
  scope,
  ownerField,
  oldRefreshToken,
  oldRecord,
  principal,
  type = null,
  metadata = {},
}) => {
  const model = db[modelName];
  const rotatedAt = new Date();
  const result = await model.updateMany({
    where: {
      ...tokenLookupWhere(oldRefreshToken),
      revokedAt: null,
    },
    data: {
      revokedAt: rotatedAt,
      rotatedAt,
      revokedReason: "rotated",
    },
  });

  await invalidateRefreshToken(scope, oldRefreshToken);

  if ((result?.count || 0) < 1) {
    await revokeAllRefreshTokensForOwner({
      db,
      modelName,
      scope,
      ownerField,
      ownerId: oldRecord?.[ownerField] || principal?.id,
      reason: "refresh_rotation_conflict",
    });
    throw invalidRefreshTokenError("REFRESH_TOKEN_REUSED");
  }

  const rotated = await createRefreshTokenRecord({
    db,
    modelName,
    scope,
    principal,
    ownerField,
    type,
    metadata,
  });

  if (oldRecord?.id && rotated.refreshRecord?.id) {
    await model.update({
      where: { id: oldRecord.id },
      data: { replacedByTokenId: rotated.refreshRecord.id },
    }).catch(() => {});
  }

  return rotated;
};

const revokeRefreshTokenValue = async ({
  db,
  modelName,
  scope,
  refreshToken,
  reason = "logout",
}) => {
  if (!refreshToken) {
    return { count: 0 };
  }

  const result = await db[modelName].updateMany({
    where: {
      ...tokenLookupWhere(refreshToken),
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revokedReason: reason,
    },
  });

  await invalidateRefreshToken(scope, refreshToken);
  return result;
};

module.exports = {
  assertRefreshTokenRecordUsable,
  createRefreshTokenRecord,
  findRefreshTokenRecord,
  revokeAllRefreshTokensForOwner,
  revokeRefreshTokenValue,
  rotateRefreshTokenRecord,
  verifyRefreshPayloadOrThrow,
};
