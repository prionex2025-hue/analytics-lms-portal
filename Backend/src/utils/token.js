const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const env = require("../config/env");
const { ROLES, normalizeRole } = require("../constants/roles");

const createAccessToken = (principal) => {
  const role = normalizeRole(principal.role || ROLES.STUDENT);

  return jwt.sign(
    {
      sub: principal.id,
      userId: principal.id,
      role,
      collegeId: principal.collegeId || null,
      departmentId: principal.departmentId || null,
      tokenVersion: Number(principal.tokenVersion || 0),
      permissions: Array.isArray(principal.permissions) ? principal.permissions : undefined,
    },
    env.jwtAccessSecret,
    {
      expiresIn: env.jwtAccessExpiresIn,
      jwtid: crypto.randomUUID(),
    }
  );
};

const createRefreshToken = (principal) => {
  return jwt.sign(
    {
      sub: principal.id,
      role: normalizeRole(principal.role || ROLES.STUDENT),
      type: "refresh",
    },
    env.jwtRefreshSecret,
    {
      expiresIn: env.jwtRefreshExpiresIn,
      jwtid: crypto.randomUUID(),
    }
  );
};

const verifyAccessToken = (token) => jwt.verify(token, env.jwtAccessSecret);
const verifyRefreshToken = (token) => jwt.verify(token, env.jwtRefreshSecret);

module.exports = {
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
