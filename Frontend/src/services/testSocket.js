import { io } from "socket.io-client";
import { getAccessToken } from "@/services/httpClient";
import { adminTokenStorage, collegeAdminTokenStorage, superAdminTokenStorage } from "@/services/api";
import { SOCKET_BASE_URL } from "@/services/runtimeConfig";

const socketsByRole = new Map();

const getSocketUrl = () => {
  return SOCKET_BASE_URL;
};

const getSocketToken = (role = "student") => {
  if (role === "college-admin") {
    return collegeAdminTokenStorage.getAccess() || "";
  }
  if (role === "admin") {
    return adminTokenStorage.getAccess() || "";
  }
  if (role === "super-admin") {
    return superAdminTokenStorage.getAccess() || "";
  }
  return getAccessToken() || "";
};

// Sockets are cached per key. Test rooms use the bare role as the key; other
// long-lived listeners (e.g. portal notifications) use their own key so a page
// that tears down its test socket on unmount cannot disconnect them.
const connectSocketForKey = (key, role) => {
  let socket = socketsByRole.get(key);

  if (socket?.connected) {
    return socket;
  }

  if (!socket) {
    socket = io(getSocketUrl(), {
      transports: ["websocket", "polling"],
      withCredentials: true,
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
      timeout: 15000,
      auth: {
        token: getSocketToken(role) ? `Bearer ${getSocketToken(role)}` : "",
      },
    });
    socketsByRole.set(key, socket);

    // Access tokens are short-lived: re-read the CURRENT token before every
    // reconnection attempt. Without this, an automatic reconnect replays the
    // token captured at first connect, and once that token expires the
    // handshake is rejected forever (infinite reconnect loop on a dead token).
    socket.io.on("reconnect_attempt", () => {
      const freshToken = getSocketToken(role);
      socket.auth = { token: freshToken ? `Bearer ${freshToken}` : "" };
    });
  }

  socket.auth = {
    token: getSocketToken(role) ? `Bearer ${getSocketToken(role)}` : "",
  };

  if (!socket.connected) {
    socket.connect();
  }

  return socket;
};

export const connectTestSocket = (role = "student") => {
  const normalizedRole = role || "student";
  return connectSocketForKey(normalizedRole, normalizedRole);
};

const notificationKey = (role) => `${role}:notifications`;

export const connectNotificationSocket = (role) => connectSocketForKey(notificationKey(role), role);

export const disconnectNotificationSocket = (role) => {
  const socket = socketsByRole.get(notificationKey(role));
  if (socket?.connected) {
    socket.disconnect();
  }
  socketsByRole.delete(notificationKey(role));
};

export const getTestSocket = (role = "student") => socketsByRole.get(role || "student") || null;

export const disconnectTestSocket = (role = null) => {
  if (role) {
    const socket = socketsByRole.get(role);
    if (socket?.connected) {
      socket.disconnect();
    }
    socketsByRole.delete(role);
    return;
  }

  for (const socket of socketsByRole.values()) {
    if (socket?.connected) {
      socket.disconnect();
    }
  }
  socketsByRole.clear();
};

export const joinTestRoom = (testId, role = "student") => {
  const socket = getTestSocket(role);
  if (!socket || !testId) return;
  socket.emit("join_test_room", { testId });
};

export const leaveTestRoom = (testId, role = "student") => {
  const socket = getTestSocket(role);
  if (!socket || !testId) return;
  socket.emit("leave_test_room", { testId });
};
