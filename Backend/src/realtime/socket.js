const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const Redis = require("ioredis");
const db = require("../config/db");
const { ROLES, isAdminLikeRole, isCollegeAdminRole, isDepartmentAdminRole, normalizeRole } = require("../constants/roles");
const { verifyAccessToken } = require("../utils/token");
const env = require("../config/env");

let io = null;
let socketRedisPubClient = null;
let socketRedisSubClient = null;

const normalizeIdList = (values = []) =>
  [...new Set(values.filter(Boolean).map((value) => String(value)))];

const assertTokenClaimScope = ({ payload, principal }) => {
  if (payload.collegeId && principal.collegeId && String(payload.collegeId) !== String(principal.collegeId)) {
    throw new Error("Invalid token scope");
  }
  if (payload.departmentId && principal.departmentId && String(payload.departmentId) !== String(principal.departmentId)) {
    throw new Error("Invalid token scope");
  }
};

const loadSocketPrincipal = async (payload) => {
  const role = normalizeRole(payload.role || ROLES.STUDENT);

  if (role === ROLES.STUDENT) {
    const student = await db.student.findUnique({
      where: { id: payload.sub },
      include: { batches: true },
    });
    if (!student?.isActive) {
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
    console.error("Socket.IO Redis pub client error:", err.message);
  });
  subClient.on("error", (err) => {
    console.error("Socket.IO Redis sub client error:", err.message);
  });

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
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

  attachRedisAdapterIfAvailable().catch((error) => {
    console.warn("Socket.IO Redis adapter bootstrap error, using in-memory adapter:", error?.message || "unknown error");
  });

  io.use(async (socket, next) => {
    try {
      const authHeader = socket.handshake.auth?.token || socket.handshake.headers?.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

      if (!token) {
        return next(new Error("Unauthorized"));
      }

      const principal = verifyAccessToken(token);
      socket.data.user = await loadSocketPrincipal(principal);
      return next();
    } catch (_error) {
      return next(new Error("Unauthorized"));
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
    if (user.collegeId && isAdminLikeRole(user.role)) {
      socket.join(`college:${user.collegeId}`);
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

const emitToCollege = (collegeId, event, payload) => {
  if (!io || !collegeId) return;
  io.to(`college:${collegeId}`).emit(event, payload);
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

const shutdownSocket = async () => {
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
  shutdownSocket,
};

