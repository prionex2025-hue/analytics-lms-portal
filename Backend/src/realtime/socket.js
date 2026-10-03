const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const { logger } = require("../utils/logger");
const Redis = require("ioredis");
const { redisClient, isRedisAvailable } = require("../config/redis");
const db = require("../config/db");
const { ROLES, isAdminLikeRole, isCollegeAdminRole, isDepartmentAdminRole, normalizeRole } = require("../constants/roles");
const { verifyAccessToken } = require("../utils/token");
const env = require("../config/env");
const { isAccessTokenRevoked } = require("../services/access-token-revocation.service");
const { canStudentAuthenticate } = require("../services/student-lifecycle.service");
const { consumeRateLimit, releaseRateLimit } = require("../middleware/rate-limit");
const { getSocketClientIp } = require("../utils/socket-client-ip");

let io = null;

const collegeRoom = (collegeId) => `college:${collegeId}`;
const collegeGeneralRoom = (collegeId) => `college:${collegeId}:general`;
const departmentRoom = (collegeId, departmentId) => `college:${collegeId}:dept:${departmentId}`;
let socketRedisPubClient = null;
let socketRedisSubClient = null;

const normalizeIdList = (values = []) =>
  [...new Set(values.filter(Boolean).map((value) => String(value)))];

// Mirrors validatePrincipalTokenClaims in middleware/auth.js so a token that
// REST would reject (revoked via tokenVersion bump) cannot open a socket either.
const assertTokenClaimScope = ({ payload, principal }) => {
  if (payload.collegeId && principal.collegeId && String(payload.collegeId) !== String(principal.collegeId)) {
    throw new Error("Invalid token scope");
  }
  if (payload.departmentId && principal.departmentId && String(payload.departmentId) !== String(principal.departmentId)) {
    throw new Error("Invalid token scope");
  }
  if (Number(payload.tokenVersion || 0) !== Number(principal.tokenVersion || 0)) {
    throw new Error("Token revoked");
  }
};

const loadSocketPrincipal = async (payload) => {
  const role = normalizeRole(payload.role || ROLES.STUDENT);

  if (role === ROLES.STUDENT) {
    const student = await db.student.findUnique({
      where: { id: payload.sub },
      include: { batches: true },
    });
    if (!student?.isActive || !canStudentAuthenticate(student)) {
      throw new Error("Inactive student");
    }
    assertTokenClaimScope({ payload, principal: student });
    const batchIds = normalizeIdList([...(Array.isArray(student.batchIds) ? student.batchIds : []), student.batchId]);
    return {
      sub: student.id,
      id: student.id,
      role,
      collegeId: student.collegeId || null,
      departmentId: student.departmentId || null,
      batchId: student.batchId || null,
      batchIds,
    };
  }

  if (isAdminLikeRole(role)) {
    const admin = await db.admin.findUnique({ where: { id: payload.sub } });
    if (!admin?.isActive || normalizeRole(admin.role) !== role) {
      throw new Error("Inactive admin");
    }
    assertTokenClaimScope({ payload, principal: admin });
    return {
      sub: admin.id,
      id: admin.id,
      role,
      collegeId: admin.collegeId || null,
      departmentId: admin.departmentId || null,
    };
  }

  if (role === ROLES.SUPER_ADMIN) {
    const superAdmin = await db.superAdmin.findUnique({ where: { id: payload.sub } });
    if (!superAdmin?.isActive || normalizeRole(superAdmin.role) !== ROLES.SUPER_ADMIN) {
      throw new Error("Inactive super admin");
    }
    assertTokenClaimScope({ payload, principal: superAdmin });
    return {
      sub: superAdmin.id,
      id: superAdmin.id,
      role,
      collegeId: null,
      departmentId: null,
    };
  }

  throw new Error("Unsupported role");
};

const adminCanMonitorTest = async (user, test) => {
  if (!test || String(test.collegeId || "") !== String(user.collegeId || "")) {
    return false;
  }

  if (isCollegeAdminRole(user.role)) {
    return true;
  }

  if (!isDepartmentAdminRole(user.role) || !user.departmentId) {
    return false;
  }

  if (String(test.departmentId || "") === String(user.departmentId)) {
    return true;
  }

  if (Array.isArray(test.assignedTo) && test.assignedTo.some((id) => String(id) === String(user.departmentId))) {
    return true;
  }

  const batchIds = normalizeIdList([
    test.batchId,
    ...(Array.isArray(test.batchAssignments) ? test.batchAssignments.map((item) => item?.batchId) : []),
  ]);
  if (batchIds.length === 0) {
    return false;
  }

  const matchingBatch = await db.batch.findFirst({
    where: {
      id: { in: batchIds },
      collegeId: user.collegeId,
      departmentId: user.departmentId,
    },
    select: { id: true },
  });

  return Boolean(matchingBatch);
};

const canJoinTestRoom = async (user, testId) => {
  const role = normalizeRole(user?.role);
  const test = await db.test.findUnique({
    where: { id: testId },
    include: {
      batchAssignments: {
        select: { batchId: true },
      },
    },
  });

  if (!test) {
    return false;
  }

  if (role === ROLES.SUPER_ADMIN) {
    return true;
  }

  if (isAdminLikeRole(role)) {
    return adminCanMonitorTest(user, test);
  }

  return false;
};

const attachRedisAdapterIfAvailable = async () => {
  if (!io || env.nodeEnv === "test" || !env.redis?.enabled || !env.redisUrl) {
    return;
  }

  // One-shot Redis adapter bootstrap:
  // if Redis is down, fall back to in-memory adapter without retry storms.
  const pubClient = new Redis(env.redisUrl, {
    connectionName: `lms-socket-pub:${env.nodeEnv}`,
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 3000,
    retryStrategy: () => null,
  });

  const subClient = pubClient.duplicate({
    connectionName: `lms-socket-sub:${env.nodeEnv}`,
    lazyConnect: true,
    retryStrategy: () => null,
    connectTimeout: 3000,
  });

  pubClient.on("error", (err) => {
    logger.throttled("error", "socket-redis-pub", 60_000, "socket.redis_adapter_error", { client: "pub", reason: err.message });
  });
  subClient.on("error", (err) => {
    logger.throttled("error", "socket-redis-sub", 60_000, "socket.redis_adapter_error", { client: "sub", reason: err.message });
  });

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    // Bootstrap is one-shot (no retry storm if Redis is down at boot), but once
    // the adapter is attached it must survive Redis restarts: without
    // reconnection, cross-replica broadcasts (live monitoring, report status)
    // would silently stop until the API is restarted.
    const reconnectWithBackoff = (attempt) => Math.min(attempt * 200, env.redis.maxRetryDelayMs || 2000);
    pubClient.options.retryStrategy = reconnectWithBackoff;
    subClient.options.retryStrategy = reconnectWithBackoff;
    io.adapter(createAdapter(pubClient, subClient));
    socketRedisPubClient = pubClient;
    socketRedisSubClient = subClient;
    console.log("Socket.IO Redis adapter attached for horizontal scaling.");
  } catch (error) {
    console.warn("Socket.IO Redis adapter unavailable, using in-memory adapter:", error?.message || "connection failed");
    try {
      pubClient.disconnect();
      subClient.disconnect();
    } catch {
      // noop
    }
  }
};

const initSocket = (httpServer, frontendOrigins) => {
  const allowedOrigins = Array.isArray(frontendOrigins)
    ? frontendOrigins
    : [frontendOrigins].filter(Boolean);

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  // A Socket.IO handshake checks Redis-backed token revocation, but already
  // connected clients would otherwise keep receiving local events through a
  // Redis outage. Close this replica's sockets when shared auth state drops;
  // clients can reconnect after Redis recovers and pass the normal handshake.
  const closeSocketsIfRedisUnavailable = () => {
    if (env.nodeEnv !== "production" || isRedisAvailable() || !io) return;
    logger.throttled("warn", "socket.auth_state_unavailable", 60_000, "socket.redis_unavailable_disconnect", {
      impact: "closed local sockets until Redis-backed authentication is restored",
    });
    io.local.disconnectSockets(true);
  };
  if (redisClient) {
    redisClient.on("error", closeSocketsIfRedisUnavailable);
    redisClient.on("end", closeSocketsIfRedisUnavailable);
  }

  attachRedisAdapterIfAvailable().catch((error) => {
    console.warn("Socket.IO Redis adapter bootstrap error, using in-memory adapter:", error?.message || "unknown error");
  });

  // Handshake limits (each handshake costs a JWT verify + DB principal load):
  //  - failed handshakes per client IP: a unit is reserved up front and given
  //    back on success, so bursts of bad tokens cannot exceed the limit while a
  //    whole lab (one NAT IP) connecting legitimately is never throttled;
  //  - successful connections per user: stops reconnect loops and one stolen
  //    token opening sockets in bulk.
  const rl = env.rateLimit;
  const rejectHandshake = (next, message) => next(new Error(message));

  io.use(async (socket, next) => {
    const clientIp = getSocketClientIp(socket.request);
    const failureQuota = { scope: "socket-auth-failure", identity: `ip:${clientIp}` };

    try {
      // Every early return below keeps this unit (a failed handshake); only a
      // successful authentication gives it back.
      const quota = await consumeRateLimit({ ...failureQuota, max: rl.socketAuthFailureMax, windowMs: rl.socketAuthFailureWindowMs });
      if (!quota.allowed) {
        await releaseRateLimit(failureQuota);
        logger.throttled("warn", `socket-auth-limited:${clientIp}`, 60_000, "rate_limit.exceeded", { scope: "socket-auth-failure", ip: clientIp });
        return rejectHandshake(next, "Too many failed connection attempts");
      }

      const authHeader = socket.handshake.auth?.token || socket.handshake.headers?.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

      if (!token) {
        return rejectHandshake(next, "Unauthorized");
      }

      const principal = verifyAccessToken(token);
      if (await isAccessTokenRevoked(principal)) {
        return rejectHandshake(next, "Unauthorized");
      }
      socket.data.user = await loadSocketPrincipal(principal);

      // Authenticated: this handshake is not a failure.
      await releaseRateLimit(failureQuota);

      const perUser = await consumeRateLimit({
        scope: "socket-connect",
        identity: `user:${principal.sub}`,
        max: rl.socketConnectMax,
        windowMs: rl.socketConnectWindowMs,
      });
      if (!perUser.allowed) {
        logger.throttled("warn", `socket-connect-limited:${principal.sub}`, 60_000, "rate_limit.exceeded", { scope: "socket-connect", actor: `user:${principal.sub}` });
        return rejectHandshake(next, "Too many connections");
      }
      return next();
    } catch (_error) {
      return rejectHandshake(next, "Unauthorized");
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    socket.join(`role:${user.role}`);
    socket.join(`user:${user.sub}`);
    // The `college:<id>` room carries admin/faculty monitoring events only
    // (student_status_update, test_status_change, violation_event, report:status).
    // Students must NOT join it: no student feature consumes those events, and
    // membership would leak peers' live progress, submission status, and
    // proctoring violations. Students receive their own events via `user:<id>`.
    //
    // College admins see the whole college. Department admins only join their
    // own department room plus the college-wide "general" room, so they do not
    // receive other departments' live student/violation events.
    if (user.collegeId && isCollegeAdminRole(user.role)) {
      socket.join(collegeRoom(user.collegeId));
    } else if (user.collegeId && isDepartmentAdminRole(user.role)) {
      socket.join(collegeGeneralRoom(user.collegeId));
      if (user.departmentId) {
        socket.join(departmentRoom(user.collegeId, user.departmentId));
      }
    }

    socket.on("join_test_room", async ({ testId } = {}) => {
      const normalizedTestId = String(testId || "").trim();
      if (!normalizedTestId) return;

      try {
        const allowed = await canJoinTestRoom(user, normalizedTestId);
        if (!allowed) {
          socket.emit("test_room_denied", { testId: normalizedTestId, code: "TEST_ROOM_FORBIDDEN" });
          return;
        }

        socket.join(`test_${normalizedTestId}`);
        socket.emit("test_room_joined", { testId: normalizedTestId });
      } catch {
        socket.emit("test_room_denied", { testId: normalizedTestId, code: "TEST_ROOM_AUTH_FAILED" });
      }
    });

    socket.on("leave_test_room", ({ testId } = {}) => {
      const normalizedTestId = String(testId || "").trim();
      if (!normalizedTestId) return;
      socket.leave(`test_${normalizedTestId}`);
    });
  });

  return io;
};

const getIO = () => io;

// Emit to a college's admins. With `departmentId`, the event carries data about
// one department (e.g. a student's live status) and reaches college admins plus
// that department's admins only. Without it, it is a college-wide notice and
// reaches every admin of the college.
const emitToCollege = (collegeId, event, payload, { departmentId = null } = {}) => {
  if (!io || !collegeId) return;
  const targetRoom = departmentId ? departmentRoom(collegeId, departmentId) : collegeGeneralRoom(collegeId);
  io.to([collegeRoom(collegeId), targetRoom]).emit(event, payload);
};

const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, payload);
};

// Force-close every live socket a user owns (logout, token revocation, account
// switch). Prevents a stale proctoring/monitoring socket from surviving past
// session end and leaking events to the wrong principal on a shared device.
const disconnectUserSockets = (userId) => {
  if (!io || !userId) return;
  io.in(`user:${userId}`).disconnectSockets(true);
};

const emitToRole = (role, event, payload) => {
  if (!io || !role) return;
  io.to(`role:${role}`).emit(event, payload);
};

const emitToTestRoom = (testId, event, payload) => {
  if (!io || !testId) return;
  io.to(`test_${testId}`).emit(event, payload);
};

// Disconnect clients first: open websockets would otherwise keep
// server.close() from ever completing. Clients reconnect to another replica.
const disconnectAllSockets = () => {
  if (!io) return;
  try {
    // io.local: only this replica's clients. Through the Redis adapter a plain
    // io.disconnectSockets() would disconnect every client on every replica.
    io.local.disconnectSockets(true);
  } catch {
    // Best effort during shutdown.
  }
};

const shutdownSocket = async () => {
  disconnectAllSockets();
  const closeClient = async (client) => {
    if (!client) return;
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  };

  await Promise.all([closeClient(socketRedisPubClient), closeClient(socketRedisSubClient)]);
  socketRedisPubClient = null;
  socketRedisSubClient = null;
};

module.exports = {
  initSocket,
  getIO,
  emitToCollege,
  emitToUser,
  emitToRole,
  emitToTestRoom,
  disconnectUserSockets,
  disconnectAllSockets,
  shutdownSocket,
};
