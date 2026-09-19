import { getAccessToken } from "@/services/httpClient";
import { API_BASE_URL } from "@/services/runtimeConfig";

const API_BASE = API_BASE_URL;
const isFormDataBody = (value) => typeof FormData !== "undefined" && value instanceof FormData;
const shouldAttachJsonContentType = (options = {}) => Boolean(options.body) && !isFormDataBody(options.body);
export const isCollegeAdminRuntimeRoute = () =>
  typeof window !== "undefined" &&
  (String(window.location?.pathname || "") === "/college-admin" ||
    String(window.location?.pathname || "").startsWith("/college-admin/"));

const resolveAdminScopedPath = (path) => {
  const normalizedPath = String(path || "");
  if (!normalizedPath.startsWith("/admin")) {
    return normalizedPath;
  }

  if (isCollegeAdminRuntimeRoute()) {
    return normalizedPath.replace(/^\/admin(?=\/|$)/, "/college-admin");
  }

  return normalizedPath;
};

const safeWriteStorage = (key, value) => {
  try {
    if (value === null || value === undefined || value === "") {
      localStorage.removeItem(key);
      return;
    }

    localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
};

const createTokenStorage = (prefix) => {
  const accessKey = `${prefix}_access_token`;
  const refreshKey = `${prefix}_refresh_token`;
  safeWriteStorage(accessKey, null);
  safeWriteStorage(refreshKey, null);
  let accessToken = null;

  return {
    getAccess: () => accessToken,
    getRefresh: () => null,
    setTokens: ({ accessToken: nextAccessToken }) => {
      accessToken = nextAccessToken || null;
      safeWriteStorage(accessKey, null);
      safeWriteStorage(refreshKey, null);
    },
    clear: () => {
      accessToken = null;
      safeWriteStorage(accessKey, null);
      safeWriteStorage(refreshKey, null);
    },
  };
};

export const tokenStorage = {
  getAccess: () => getAccessToken(),
  getRefresh: () => null,
  setTokens: ({ accessToken }) => {
    void accessToken;
    return null;
  },
  clear: () => {
    return null;
  },
};
export const adminTokenStorage = createTokenStorage("lms_admin");
export const collegeAdminTokenStorage = createTokenStorage("lms_college_admin");
export const superAdminTokenStorage = createTokenStorage("lms_super_admin");

// Admin and College-Admin reuse the same pages/API layer, differentiated only by
// URL. Keep their access tokens in separate in-memory slots and pick the right
// one by the active route, so signing into one portal never clobbers the other
// (each portal also has its own path-scoped refresh cookie on the backend).
export const getActiveAdminTokenStorage = () =>
  isCollegeAdminRuntimeRoute() ? collegeAdminTokenStorage : adminTokenStorage;

const buildApiErrorMessage = (payload) => {
  if (!payload || typeof payload !== "object") {
    return "API request failed";
  }

  const message = payload.message || "API request failed";
  const formErrors = payload.details?.formErrors || [];
  const fieldErrors = payload.details?.fieldErrors || {};

  const formErrorList = Array.isArray(formErrors) ? formErrors.filter(Boolean) : [];
  const fieldErrorList = Object.values(fieldErrors)
    .flatMap((errors) => (Array.isArray(errors) ? errors.filter(Boolean) : []));
  const validationMessages = [...formErrorList, ...fieldErrorList];

  if (validationMessages.length > 0) {
    return `${message}: ${validationMessages.join("; ")}`;
  }

  return message;
};

const isLoginPath = (path) => /\/auth\/login$/.test(path);

const toApiError = (payload, status, retryAfterHeader = null) => {
  const retryAfterSeconds = Number.parseInt(String(retryAfterHeader || "0"), 10);
  const error = new Error(buildApiErrorMessage(payload));
  error.code = payload?.code || "REQUEST_FAILED";
  error.status = status;
  error.details = payload?.details || null;
  error.requestId = payload?.requestId || null;
  error.retryable = status >= 500 || status === 429;
  error.retryAfterSeconds = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds
    : Number(payload?.details?.retryAfterSeconds || 0) || null;
  return error;
};

let refreshingPromise = null;
let adminRefreshingPromise = null;
let superAdminRefreshingPromise = null;
const inFlightGetRequests = new Map();

const buildRequestFingerprint = (path, options = {}, headers = {}) => {
  const method = String(options.method || "GET").toUpperCase();
  return `${method}:${path}:${headers.Authorization || "anon"}`;
};

const performRequestWithDedupe = ({ path, options = {}, headers = {}, requestFactory }) => {
  const method = String(options.method || "GET").toUpperCase();
  if (method !== "GET") {
    return requestFactory();
  }

  const key = buildRequestFingerprint(path, options, headers);
  const existing = inFlightGetRequests.get(key);
  if (existing) {
    return existing;
  }

  const pending = requestFactory().finally(() => {
    inFlightGetRequests.delete(key);
  });

  inFlightGetRequests.set(key, pending);
  return pending;
};

const refreshAccessToken = async () => {
  if (!refreshingPromise) {
    refreshingPromise = fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Refresh failed");
        const data = await response.json();
        tokenStorage.setTokens({ accessToken: data.accessToken });
        return data.accessToken;
      })
      .finally(() => {
        refreshingPromise = null;
      });
  }

  return refreshingPromise;
};

const refreshAdminAccessToken = async () => {
  if (!adminRefreshingPromise) {
    const refreshPath = resolveAdminScopedPath("/admin/auth/refresh");
    adminRefreshingPromise = fetch(`${API_BASE}${refreshPath}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Refresh failed");
        const data = await response.json();
        getActiveAdminTokenStorage().setTokens({
          accessToken: data.accessToken,
        });
        return data.accessToken;
      })
      .finally(() => {
        adminRefreshingPromise = null;
      });
  }

  return adminRefreshingPromise;
};

const refreshSuperAdminAccessToken = async () => {
  if (!superAdminRefreshingPromise) {
    superAdminRefreshingPromise = fetch(`${API_BASE}/super-admin/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Refresh failed");
        const data = await response.json();
        superAdminTokenStorage.setTokens({
          accessToken: data.accessToken,
        });
        return data.accessToken;
      })
      .finally(() => {
        superAdminRefreshingPromise = null;
      });
  }

  return superAdminRefreshingPromise;
};

export const apiRequest = async (path, options = {}) => {
  const headers = {
    ...(options.headers || {}),
  };
  if (shouldAttachJsonContentType(options) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const accessToken = tokenStorage.getAccess();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const makeRequest = () =>
    performRequestWithDedupe({
      path,
      options,
      headers,
      requestFactory: () =>
        fetch(`${API_BASE}${path}`, {
          ...options,
          credentials: "include",
          headers,
        }),
    });

  let response = await makeRequest();

  if (response.status === 401 && !isLoginPath(path)) {
    try {
      const newAccessToken = await refreshAccessToken();
      headers.Authorization = `Bearer ${newAccessToken}`;
      response = await makeRequest();
    } catch {
      tokenStorage.clear();
      throw new Error("Session expired. Please login again.");
    }
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw toApiError(payload, response.status, response.headers.get("retry-after"));
  }

  return payload;
};

export const adminApiRequest = async (path, options = {}) => {
  const scopedPath = resolveAdminScopedPath(path);
  const headers = {
    ...(options.headers || {}),
  };
  if (shouldAttachJsonContentType(options) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const accessToken = getActiveAdminTokenStorage().getAccess();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const makeRequest = () =>
    performRequestWithDedupe({
      path: `admin:${scopedPath}`,
      options,
      headers,
      requestFactory: () =>
        fetch(`${API_BASE}${scopedPath}`, {
          ...options,
          credentials: "include",
          headers,
        }),
    });

  let response = await makeRequest();

  if (response.status === 401 && !isLoginPath(scopedPath)) {
    try {
      const newAccessToken = await refreshAdminAccessToken();
      headers.Authorization = `Bearer ${newAccessToken}`;
      response = await makeRequest();
    } catch {
      getActiveAdminTokenStorage().clear();
      throw new Error("Session expired. Please login again.");
    }
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw toApiError(payload, response.status, response.headers.get("retry-after"));
  }

  return payload;
};

export const adminApiTextRequest = async (path, options = {}) => {
  const scopedPath = resolveAdminScopedPath(path);
  const headers = {
    ...(options.headers || {}),
  };

  const accessToken = getActiveAdminTokenStorage().getAccess();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const makeRequest = () =>
    fetch(`${API_BASE}${scopedPath}`, {
      ...options,
      credentials: "include",
      headers,
    });

  let response = await makeRequest();

  if (response.status === 401) {
    try {
      const newAccessToken = await refreshAdminAccessToken();
      headers.Authorization = `Bearer ${newAccessToken}`;
      response = await makeRequest();
    } catch {
      getActiveAdminTokenStorage().clear();
      throw new Error("Session expired. Please login again.");
    }
  }

  const payloadText = await response.text();

  if (!response.ok) {
    let payload = {};
    try {
      payload = payloadText ? JSON.parse(payloadText) : {};
    } catch {
      payload = { message: payloadText || "API request failed" };
    }
    throw toApiError(payload, response.status, response.headers.get("retry-after"));
  }

  return payloadText;
};

export const adminApiBlobRequest = async (path, options = {}) => {
  const scopedPath = resolveAdminScopedPath(path);
  const headers = {
    ...(options.headers || {}),
  };

  const accessToken = getActiveAdminTokenStorage().getAccess();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const makeRequest = () =>
    fetch(`${API_BASE}${scopedPath}`, {
      ...options,
      credentials: "include",
      headers,
    });

  let response = await makeRequest();

  if (response.status === 401) {
    try {
      const newAccessToken = await refreshAdminAccessToken();
      headers.Authorization = `Bearer ${newAccessToken}`;
      response = await makeRequest();
    } catch {
      getActiveAdminTokenStorage().clear();
      throw new Error("Session expired. Please login again.");
    }
  }

  if (!response.ok) {
    const payloadText = await response.text();
    let payload = {};
    try {
      payload = payloadText ? JSON.parse(payloadText) : {};
    } catch {
      payload = { message: payloadText || "API request failed" };
    }
    throw toApiError(payload, response.status, response.headers.get("retry-after"));
  }

  return response.blob();
};

const parseBlobOrJsonResponse = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return { kind: "json", data: await response.json().catch(() => ({})) };
  }

  const disposition = response.headers.get("content-disposition") || "";
  const fileNameMatch = disposition.match(/filename="?([^"]+)"?/i);
  return {
    kind: "blob",
    blob: await response.blob(),
    fileName: fileNameMatch?.[1] || "resource",
    contentType,
  };
};

const throwFetchApiError = async (response) => {
  const payloadText = await response.text();
  let payload = {};
  try {
    payload = payloadText ? JSON.parse(payloadText) : {};
  } catch {
    payload = { message: payloadText || "API request failed" };
  }
  throw toApiError(payload, response.status, response.headers.get("retry-after"));
};

export const apiBlobOrJsonRequest = async (path, options = {}) => {
  const headers = { ...(options.headers || {}) };
  const accessToken = tokenStorage.getAccess();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const makeRequest = () =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: "include",
      headers,
    });

  let response = await makeRequest();
  if (response.status === 401) {
    try {
      const newAccessToken = await refreshAccessToken();
      headers.Authorization = `Bearer ${newAccessToken}`;
      response = await makeRequest();
    } catch {
      tokenStorage.clear();
      throw new Error("Session expired. Please login again.");
    }
  }

  if (!response.ok) {
    await throwFetchApiError(response);
  }

  return parseBlobOrJsonResponse(response);
};

export const adminApiBlobOrJsonRequest = async (path, options = {}) => {
  const scopedPath = resolveAdminScopedPath(path);
  const headers = { ...(options.headers || {}) };
  const accessToken = getActiveAdminTokenStorage().getAccess();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const makeRequest = () =>
    fetch(`${API_BASE}${scopedPath}`, {
      ...options,
      credentials: "include",
      headers,
    });

  let response = await makeRequest();
  if (response.status === 401) {
    try {
      const newAccessToken = await refreshAdminAccessToken();
      headers.Authorization = `Bearer ${newAccessToken}`;
      response = await makeRequest();
    } catch {
      getActiveAdminTokenStorage().clear();
      throw new Error("Session expired. Please login again.");
    }
  }

  if (!response.ok) {
    await throwFetchApiError(response);
  }

  return parseBlobOrJsonResponse(response);
};

export const superAdminApiRequest = async (path, options = {}) => {
  const headers = {
    ...(options.headers || {}),
  };
  if (shouldAttachJsonContentType(options) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const accessToken = superAdminTokenStorage.getAccess();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const makeRequest = () =>
    performRequestWithDedupe({
      path: `super:${path}`,
      options,
      headers,
      requestFactory: () =>
        fetch(`${API_BASE}${path}`, {
          ...options,
          credentials: "include",
          headers,
        }),
    });

  let response = await makeRequest();

  if (response.status === 401 && !isLoginPath(path)) {
    try {
      const newAccessToken = await refreshSuperAdminAccessToken();
      headers.Authorization = `Bearer ${newAccessToken}`;
      response = await makeRequest();
    } catch {
      superAdminTokenStorage.clear();
      throw new Error("Session expired. Please login again.");
    }
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw toApiError(payload, response.status, response.headers.get("retry-after"));
  }

  return payload;
};

export const superAdminApiBlobRequest = async (path, options = {}) => {
  const headers = {
    ...(options.headers || {}),
  };

  const accessToken = superAdminTokenStorage.getAccess();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const makeRequest = () =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: "include",
      headers,
    });

  let response = await makeRequest();

  if (response.status === 401) {
    try {
      const newAccessToken = await refreshSuperAdminAccessToken();
      headers.Authorization = `Bearer ${newAccessToken}`;
      response = await makeRequest();
    } catch {
      superAdminTokenStorage.clear();
      throw new Error("Session expired. Please login again.");
    }
  }

  if (!response.ok) {
    const payloadText = await response.text();
    let payload = {};
    try {
      payload = payloadText ? JSON.parse(payloadText) : {};
    } catch {
      payload = { message: payloadText || "API request failed" };
    }
    throw toApiError(payload, response.status, response.headers.get("retry-after"));
  }

  return response.blob();
};

export const superAdminApiBlobOrJsonRequest = async (path, options = {}) => {
  const headers = { ...(options.headers || {}) };
  const accessToken = superAdminTokenStorage.getAccess();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const makeRequest = () =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: "include",
      headers,
    });

  let response = await makeRequest();
  if (response.status === 401) {
    try {
      const newAccessToken = await refreshSuperAdminAccessToken();
      headers.Authorization = `Bearer ${newAccessToken}`;
      response = await makeRequest();
    } catch {
      superAdminTokenStorage.clear();
      throw new Error("Session expired. Please login again.");
    }
  }

  if (!response.ok) {
    await throwFetchApiError(response);
  }

  return parseBlobOrJsonResponse(response);
};

export const api = {
  login: (body) => apiRequest("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  me: () => apiRequest("/auth/me"),
  logout: () =>
    apiRequest("/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  getDashboard: () => apiRequest("/dashboard/summary"),
  getOngoingTests: () => apiRequest("/tests/ongoing"),
  getUpcomingTests: () => apiRequest("/tests/upcoming"),
  startTest: (testId) => apiRequest(`/tests/${testId}/start`, { method: "POST", body: JSON.stringify({}) }),
  getSession: (testId) => apiRequest(`/tests/${testId}/session`),
  saveAnswer: (testId, body) =>
    apiRequest(`/tests/${testId}/answer`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  reportViolation: (testId, body) =>
    apiRequest(`/tests/${testId}/violation`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  submitTest: (testId, body) =>
    apiRequest(`/tests/${testId}/submit`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getReport: () => apiRequest("/reports/overview"),
  getLeaderboard: (params = "") => apiRequest(`/leaderboard${params}`),
  getEvents: (params = "") => apiRequest(`/events${params}`),
  getProfile: () => apiRequest("/profile"),
  getLearningResourceSubjects: (params = "") => apiRequest(`/resources/subjects${params}`),
  getLearningResources: (params = "") => apiRequest(`/resources${params}`),
  getLearningResource: (resourceId) => apiRequest(`/resources/${resourceId}`),
  getPopularLearningResources: (params = "") => apiRequest(`/resources/popular${params}`),
  downloadLearningResource: (resourceId) => apiBlobOrJsonRequest(`/resources/download/${resourceId}`),
  updateProfile: (body) => apiRequest("/profile", { method: "PATCH", body: JSON.stringify(body) }),
  changePassword: (body) =>
    apiRequest("/profile/password", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  updatePreferences: (body) =>
    apiRequest("/profile/preferences", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};

export const adminApi = {
  login: (body) => adminApiRequest("/admin/auth/login", { method: "POST", body: JSON.stringify(body) }),
  forgotPassword: (body) =>
    adminApiRequest("/admin/auth/forgot-password", { method: "POST", body: JSON.stringify(body) }),
  resetPassword: (body) =>
    adminApiRequest("/admin/auth/reset-password", { method: "POST", body: JSON.stringify(body) }),
  forgotCollegeAdminPassword: (body) =>
    adminApiRequest("/college-admin/auth/forgot-password", { method: "POST", body: JSON.stringify(body) }),
  resetCollegeAdminPassword: (body) =>
    adminApiRequest("/college-admin/auth/reset-password", { method: "POST", body: JSON.stringify(body) }),
  me: () => adminApiRequest("/admin/auth/me"),
  logout: () =>
    adminApiRequest("/admin/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  getDashboard: () => adminApiRequest("/admin/dashboard/summary"),
  getTests: (params = "") => adminApiRequest(`/admin/tests${params}`),
  getTestById: (testId) => adminApiRequest(`/admin/tests/${testId}`),
  getTestShareLink: (testId) => adminApiRequest(`/admin/tests/${testId}/share-link`),
  createTest: (body) => adminApiRequest("/admin/tests", { method: "POST", body: JSON.stringify(body) }),
  updateTest: (testId, body) => adminApiRequest(`/admin/tests/${testId}`, { method: "PATCH", body: JSON.stringify(body) }),
  transitionTestStatus: (testId, action) =>
    adminApiRequest(`/admin/tests/${testId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    }),
  getTestMonitoring: (testId) => adminApiRequest(`/admin/tests/${testId}/monitoring`),
  forceSubmitAttempt: (testId, body) => adminApiRequest(`/admin/tests/${testId}/monitoring/force-submit`, { method: "POST", body: JSON.stringify(body) }),
  extendAttemptTime: (testId, body) => adminApiRequest(`/admin/tests/${testId}/monitoring/extend-time`, { method: "POST", body: JSON.stringify(body) }),
  publishTest: (testId) => adminApiRequest(`/admin/tests/${testId}/publish`, { method: "POST", body: JSON.stringify({}) }),
  archiveTest: (testId) => adminApiRequest(`/admin/tests/${testId}/archive`, { method: "PATCH", body: JSON.stringify({}) }),
  deleteTest: (testId) => adminApiRequest(`/admin/tests/${testId}`, { method: "DELETE" }),
  getQuestionBank: (params = "") => adminApiRequest(`/admin/question-bank${params}`),
  getQuestionSubjects: () => adminApiRequest("/admin/subjects"),
  createQuestionSubject: (body) => adminApiRequest("/admin/subjects", { method: "POST", body: JSON.stringify(body) }),
  deleteQuestionSubject: (id) => adminApiRequest(`/admin/subjects/${id}`, { method: "DELETE" }),
  addQuestionBankItem: (body) => adminApiRequest("/admin/question-bank", { method: "POST", body: JSON.stringify(body) }),
  updateQuestionBankItem: (id, body) => adminApiRequest(`/admin/question-bank/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteQuestionBankItem: (id) => adminApiRequest(`/admin/question-bank/${id}`, { method: "DELETE" }),
  importQuestionBank: (body) => adminApiRequest("/admin/question-bank/import", { method: "POST", body: JSON.stringify(body) }),
  exportQuestionBank: () => adminApiRequest("/admin/question-bank/export"),
  getDepartments: () => adminApiRequest("/admin/departments"),
  createDepartment: (body) => adminApiRequest("/admin/departments", { method: "POST", body: JSON.stringify(body) }),
  updateDepartment: (departmentId, body) => adminApiRequest(`/admin/departments/${departmentId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteDepartment: (departmentId, body) => adminApiRequest(`/admin/departments/${departmentId}`, { method: "DELETE", body: JSON.stringify(body || {}) }),
  getManagedAdmins: (params = "") => adminApiRequest(`/admin/admins${params}`),
  createManagedAdmin: (body) => adminApiRequest("/admin/admins", { method: "POST", body: JSON.stringify(body) }),
  updateManagedAdmin: (adminId, body) => adminApiRequest(`/admin/admins/${adminId}`, { method: "PATCH", body: JSON.stringify(body) }),
  resetManagedAdminPassword: (adminId, body) => adminApiRequest(`/admin/admins/${adminId}/reset-password`, { method: "PATCH", body: JSON.stringify(body) }),
  deactivateManagedAdmin: (adminId, body) => adminApiRequest(`/admin/admins/${adminId}`, { method: "DELETE", body: JSON.stringify(body || {}) }),
  getCollegeAnalytics: () => adminApiRequest("/admin/analytics"),
  getBatches: () => adminApiRequest("/admin/batches"),
  getBatchDetail: (batchId) => adminApiRequest(`/admin/batches/${batchId}`),
  createBatch: (body) => adminApiRequest("/admin/batches", { method: "POST", body: JSON.stringify(body) }),
  bulkBatchStudents: (batchId, body) => adminApiRequest(`/admin/batches/${batchId}/students/bulk`, { method: "POST", body: JSON.stringify(body) }),
  removeBatchStudent: (batchId, studentId) => adminApiRequest(`/admin/batches/${batchId}/students/${studentId}`, { method: "DELETE" }),
  archiveBatch: (batchId) => adminApiRequest(`/admin/batches/${batchId}/archive`, { method: "PATCH", body: JSON.stringify({}) }),
  assignTestToBatch: (testId, body) => adminApiRequest(`/admin/tests/${testId}/assign-batch`, { method: "POST", body: JSON.stringify(body) }),
  assignTestToDepartment: (testId, body) => adminApiRequest(`/admin/tests/${testId}/assign-department`, { method: "POST", body: JSON.stringify(body) }),
  assignBatchStudents: (batchId, body) => adminApiRequest(`/admin/batches/${batchId}/students`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteBatch: (batchId) => adminApiRequest(`/admin/batches/${batchId}`, { method: "DELETE" }),
  getStudents: (params = "") => adminApiRequest(`/admin/students${params}`),
  createStudent: (body) => adminApiRequest("/admin/students", { method: "POST", body: JSON.stringify(body) }),
  getStudentProfile: (studentId) => adminApiRequest(`/admin/students/${studentId}`),
  bulkImportStudents: (body) => adminApiRequest("/admin/students/bulk-import", { method: "POST", body: JSON.stringify(body) }),
  promoteStudentsYear: (body) => adminApiRequest("/admin/students/promote-year", { method: "PATCH", body: JSON.stringify(body) }),
  getStudentImportJobStatus: (jobId) => adminApiRequest(`/admin/students/import-jobs/${jobId}`),
  assignStudentBatch: (studentId, body) => adminApiRequest(`/admin/students/${studentId}/assign-batch`, { method: "PATCH", body: JSON.stringify(body) }),
  getStudentPerformance: (studentId) => adminApiRequest(`/admin/students/${studentId}/performance`),
  getEvents: () => adminApiRequest("/admin/events"),
  getEventRegistrants: (eventId) => adminApiRequest(`/admin/events/${eventId}/registrants`),
  exportEventRegistrants: (eventId) => adminApiTextRequest(`/admin/events/${eventId}/export`),
  cancelEvent: (eventId, body) => adminApiRequest(`/admin/events/${eventId}/cancel`, { method: "PATCH", body: JSON.stringify(body) }),
  search: (query, options = {}) => adminApiRequest(`/admin/search?q=${encodeURIComponent(query)}`, options),
  createEvent: (body) =>
    adminApiRequest("/admin/events", {
      method: "POST",
      body: isFormDataBody(body) ? body : JSON.stringify(body),
    }),
  updateEvent: (eventId, body) =>
    adminApiRequest(`/admin/events/${eventId}`, {
      method: "PATCH",
      body: isFormDataBody(body) ? body : JSON.stringify(body),
    }),
  deleteEvent: (eventId) => adminApiRequest(`/admin/events/${eventId}`, { method: "DELETE" }),
  generateReport: (body) => adminApiRequest("/admin/reports/generate", { method: "POST", body: JSON.stringify(body) }),
  exportReport: (body) => adminApiRequest("/admin/reports/export", { method: "POST", body: JSON.stringify(body) }),
  getReportSummary: (params = "") => adminApiRequest(`/admin/reports/summary${params}`),
  getReportCharts: (params = "") => adminApiRequest(`/admin/reports/charts${params}`),
  getReportTable: (params = "") => adminApiRequest(`/admin/reports/table${params}`),
  getReportTests: (params = "") => adminApiRequest(`/admin/reports/tests${params}`),
  getReportItemAnalysis: (params = "") => adminApiRequest(`/admin/reports/item-analysis${params}`),
  getReportIntegrity: (params = "") => adminApiRequest(`/admin/reports/integrity${params}`),
  getReportTrends: (params = "") => adminApiRequest(`/admin/reports/trends${params}`),
  getReportAtRisk: (params = "") => adminApiRequest(`/admin/reports/at-risk${params}`),
  exportReportCsv: (params = "") => adminApiBlobRequest(`/admin/reports/export.csv${params}`),
  exportReportXlsx: (params = "") => adminApiBlobRequest(`/admin/reports/export.xlsx${params}`),
  getReportStudentDetail: (studentId, params = "") => adminApiRequest(`/admin/reports/student/${studentId}${params}`),
  getReportAnalytics: (params = "") => adminApiRequest(`/admin/reports/analytics${params}`),
  getPassoutCohorts: () => adminApiRequest("/admin/reports/passout-cohorts"),
  getReportJobs: () => adminApiRequest("/admin/reports"),
  getReportJobStatus: (reportJobId) => adminApiRequest(`/admin/reports/jobs/${reportJobId}/status`),
  getAdminJobStatus: (reportJobId) => adminApiRequest(`/admin/jobs/${reportJobId}/status`),
  downloadReport: (reportJobId) => adminApiBlobRequest(`/admin/reports/${reportJobId}/download`),
  regenerateReportLink: (reportJobId) => adminApiRequest(`/admin/reports/jobs/${reportJobId}/regenerate-link`, { method: "POST", body: JSON.stringify({}) }),
  reviewReportAnomaly: (body) => adminApiRequest("/admin/reports/anomalies/review", { method: "POST", body: JSON.stringify(body) }),
  getSettings: () => adminApiRequest("/admin/settings"),
  updateSettings: (body) => adminApiRequest("/admin/settings", { method: "PATCH", body: JSON.stringify(body) }),
  changePassword: (body) => adminApiRequest("/admin/settings/password", { method: "PATCH", body: JSON.stringify(body) }),
  getLearningResourceSubjects: (params = "") => adminApiRequest(`/admin/resources/subjects${params}`),
  createLearningResourceSubject: (body) => adminApiRequest("/admin/resources/subjects", { method: "POST", body: JSON.stringify(body) }),
  deleteLearningResourceSubject: (id) => adminApiRequest(`/admin/resources/subjects/${id}`, { method: "DELETE" }),
  getLearningResources: (params = "") => adminApiRequest(`/admin/resources${params}`),
  getLearningResource: (resourceId) => adminApiRequest(`/admin/resources/${resourceId}`),
  uploadLearningResource: (body) =>
    adminApiRequest("/admin/resources/upload", {
      method: "POST",
      body: isFormDataBody(body) ? body : JSON.stringify(body),
    }),
  updateLearningResource: (resourceId, body) =>
    adminApiRequest(`/admin/resources/${resourceId}`, {
      method: "PUT",
      body: isFormDataBody(body) ? body : JSON.stringify(body),
    }),
  deleteLearningResource: (resourceId) => adminApiRequest(`/admin/resources/${resourceId}`, { method: "DELETE" }),
  getLearningResourceAnalytics: (params = "") => adminApiRequest(`/admin/resources/analytics${params}`),
  getPopularLearningResources: (params = "") => adminApiRequest(`/admin/resources/popular${params}`),
  downloadLearningResource: (resourceId) => adminApiBlobOrJsonRequest(`/admin/resources/download/${resourceId}`),
};

export const superAdminApi = {
  login: (body) => superAdminApiRequest("/super-admin/auth/login", { method: "POST", body: JSON.stringify(body) }),
  forgotPassword: (body) =>
    superAdminApiRequest("/super-admin/auth/forgot-password", { method: "POST", body: JSON.stringify(body) }),
  resetPassword: (body) =>
    superAdminApiRequest("/super-admin/auth/reset-password", { method: "POST", body: JSON.stringify(body) }),
  me: () => superAdminApiRequest("/super-admin/auth/me"),
  logout: () =>
    superAdminApiRequest("/super-admin/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  getDashboard: () => superAdminApiRequest("/super-admin/dashboard/summary"),
  getSystemHealth: () => superAdminApiRequest("/super-admin/system/health"),
  getSystemAdmins: (params = "") => superAdminApiRequest(`/super-admin/system-admins${params}`),
  createSystemAdmin: (body) => superAdminApiRequest("/super-admin/system-admins", { method: "POST", body: JSON.stringify(body) }),
  updateSystemAdminStatus: (superAdminId, body) => superAdminApiRequest(`/super-admin/system-admins/${superAdminId}/status`, { method: "PATCH", body: JSON.stringify(body) }),
  resetSystemAdminPassword: (superAdminId, body) => superAdminApiRequest(`/super-admin/system-admins/${superAdminId}/reset-password`, { method: "PATCH", body: JSON.stringify(body) }),
  getColleges: (params = "") => superAdminApiRequest(`/super-admin/colleges${params}`),
  getCollege: (collegeId) => superAdminApiRequest(`/super-admin/colleges/${collegeId}`),
  createCollege: (body) => superAdminApiRequest("/super-admin/colleges", { method: "POST", body: JSON.stringify(body) }),
  updateCollege: (collegeId, body) => superAdminApiRequest(`/super-admin/colleges/${collegeId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deactivateCollege: (collegeId) => superAdminApiRequest(`/super-admin/colleges/${collegeId}`, { method: "DELETE" }),
  getAdmins: (params = "") => superAdminApiRequest(`/super-admin/admins${params}`),
  createAdmin: (body) => superAdminApiRequest("/super-admin/admins", { method: "POST", body: JSON.stringify(body) }),
  bulkImportAdmins: (body) => superAdminApiRequest("/super-admin/admins/bulk-import", { method: "POST", body: JSON.stringify(body) }),
  updateAdmin: (adminId, body) => superAdminApiRequest(`/super-admin/admins/${adminId}`, { method: "PATCH", body: JSON.stringify(body) }),
  resetAdminPassword: (adminId, body) => superAdminApiRequest(`/super-admin/admins/${adminId}/reset-password`, { method: "PATCH", body: JSON.stringify(body) }),
  deactivateAdmin: (adminId, body) => superAdminApiRequest(`/super-admin/admins/${adminId}`, { method: "DELETE", body: JSON.stringify(body || {}) }),
  getStudents: (params = "") => superAdminApiRequest(`/super-admin/students${params}`),
  createStudent: (body) => superAdminApiRequest("/super-admin/students", { method: "POST", body: JSON.stringify(body) }),
  bulkImportStudents: (body) => superAdminApiRequest("/super-admin/students/bulk-import", { method: "POST", body: JSON.stringify(body) }),
  getStudentImportJobStatus: (jobId) => superAdminApiRequest(`/super-admin/students/import-jobs/${jobId}`),
  promoteStudentsYear: (body) => superAdminApiRequest(`/super-admin/students/promote-year`, { method: "PATCH", body: JSON.stringify(body) }),
  updateStudentStatus: (studentId, body) => superAdminApiRequest(`/super-admin/students/${studentId}/status`, { method: "PATCH", body: JSON.stringify(body) }),
  resetStudentPassword: (studentId) => superAdminApiRequest(`/super-admin/students/${studentId}/reset-password`, { method: "PATCH", body: JSON.stringify({}) }),
  updateStudent: (studentId, body) => superAdminApiRequest(`/super-admin/students/${studentId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteStudent: (studentId, body) => superAdminApiRequest(`/super-admin/students/${studentId}`, { method: "DELETE", body: JSON.stringify(body || {}) }),
  getTests: (params = "") => superAdminApiRequest(`/super-admin/tests${params}`),
  getTestById: (testId) => superAdminApiRequest(`/super-admin/tests/${testId}`),
  getTestShareLink: (testId) => superAdminApiRequest(`/super-admin/tests/${testId}/share-link`),
  createGlobalTest: (body) => superAdminApiRequest("/super-admin/tests/global", { method: "POST", body: JSON.stringify(body) }),
  updateTest: (testId, body) => superAdminApiRequest(`/super-admin/tests/${testId}`, { method: "PATCH", body: JSON.stringify(body) }),
  transitionTestStatus: (testId, action) =>
    superAdminApiRequest(`/super-admin/tests/${testId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    }),
  getTestMonitoring: (testId) => superAdminApiRequest(`/super-admin/tests/${testId}/monitoring`),
  forceSubmitAttempt: (testId, body) => superAdminApiRequest(`/super-admin/tests/${testId}/monitoring/force-submit`, { method: "POST", body: JSON.stringify(body) }),
  extendAttemptTime: (testId, body) => superAdminApiRequest(`/super-admin/tests/${testId}/monitoring/extend-time`, { method: "POST", body: JSON.stringify(body) }),
  cloneTest: (testId, body) => superAdminApiRequest(`/super-admin/tests/${testId}/clone`, { method: "POST", body: JSON.stringify(body) }),
  deactivateTest: (testId) => superAdminApiRequest(`/super-admin/tests/${testId}`, { method: "DELETE" }),
  getBatches: (params = "") => superAdminApiRequest(`/super-admin/batches${params}`),
  createBatch: (body) => superAdminApiRequest("/super-admin/batches", { method: "POST", body: JSON.stringify(body) }),
  updateBatch: (batchId, body) => superAdminApiRequest(`/super-admin/batches/${batchId}`, { method: "PATCH", body: JSON.stringify(body) }),
  assignStudentsToBatch: (batchId, body) => superAdminApiRequest(`/super-admin/batches/${batchId}/students`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteBatch: (batchId, body) => superAdminApiRequest(`/super-admin/batches/${batchId}`, { method: "DELETE", body: JSON.stringify(body || {}) }),
  getDepartments: (params = "") => superAdminApiRequest(`/super-admin/departments${params}`),
  createDepartment: (body) => superAdminApiRequest("/super-admin/departments", { method: "POST", body: JSON.stringify(body) }),
  bulkImportDepartments: (body) => superAdminApiRequest("/super-admin/departments/bulk-import", { method: "POST", body: JSON.stringify(body) }),
  updateDepartment: (departmentId, body) => superAdminApiRequest(`/super-admin/departments/${departmentId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteDepartment: (departmentId, body) => superAdminApiRequest(`/super-admin/departments/${departmentId}`, { method: "DELETE", body: JSON.stringify(body || {}) }),
  assignTestToBatches: (body) => superAdminApiRequest("/super-admin/batches/assign-test", { method: "POST", body: JSON.stringify(body) }),
  getEvents: (params = "") => superAdminApiRequest(`/super-admin/events${params}`),
  createEvent: (body) =>
    superAdminApiRequest("/super-admin/events", {
      method: "POST",
      body: isFormDataBody(body) ? body : JSON.stringify(body),
    }),
  updateEvent: (eventId, body) =>
    superAdminApiRequest(`/super-admin/events/${eventId}`, {
      method: "PATCH",
      body: isFormDataBody(body) ? body : JSON.stringify(body),
    }),
  deleteEvent: (eventId) => superAdminApiRequest(`/super-admin/events/${eventId}`, { method: "DELETE" }),
  getReports: (params = "") => superAdminApiRequest(`/super-admin/reports${params}`),
  getPassoutCohorts: (params = "") => superAdminApiRequest(`/super-admin/reports/passout-cohorts${params}`),
  getReportAnalytics: (params = "") => superAdminApiRequest(`/super-admin/reports/analytics${params}`),
  getReportTests: (params = "") => superAdminApiRequest(`/super-admin/reports/tests${params}`),
  getReportTable: (params = "") => superAdminApiRequest(`/super-admin/reports/table${params}`),
  getReportItemAnalysis: (params = "") => superAdminApiRequest(`/super-admin/reports/item-analysis${params}`),
  getReportIntegrity: (params = "") => superAdminApiRequest(`/super-admin/reports/integrity${params}`),
  getReportTrends: (params = "") => superAdminApiRequest(`/super-admin/reports/trends${params}`),
  getReportAtRisk: (params = "") => superAdminApiRequest(`/super-admin/reports/at-risk${params}`),
  generateReport: (body) => superAdminApiRequest("/super-admin/reports/generate", { method: "POST", body: JSON.stringify(body) }),
  downloadReport: (reportJobId) => superAdminApiBlobRequest(`/super-admin/reports/${reportJobId}/download`),
  regenerateReportLink: (reportJobId) => superAdminApiRequest(`/super-admin/reports/jobs/${reportJobId}/regenerate-link`, { method: "POST", body: JSON.stringify({}) }),
  getEscalatedAnomalies: (params = "") => superAdminApiRequest(`/super-admin/reports/anomalies/escalations${params}`),
  getAnalytics: () => superAdminApiRequest("/super-admin/analytics"),
  getSettings: () => superAdminApiRequest("/super-admin/settings"),
  updateSettings: (body) => superAdminApiRequest("/super-admin/settings", { method: "PATCH", body: JSON.stringify(body) }),
  changePassword: (body) => superAdminApiRequest("/super-admin/settings/password", { method: "PATCH", body: JSON.stringify(body) }),
  getQuestionBank: (params = "") => superAdminApiRequest(`/super-admin/question-bank${params}`),
  getQuestionSubjects: () => superAdminApiRequest("/super-admin/subjects"),
  createQuestionSubject: (body) => superAdminApiRequest("/super-admin/subjects", { method: "POST", body: JSON.stringify(body) }),
  deleteQuestionSubject: (id) => superAdminApiRequest(`/super-admin/subjects/${id}`, { method: "DELETE" }),
  addQuestionBankItem: (body) => superAdminApiRequest("/super-admin/question-bank", { method: "POST", body: JSON.stringify(body) }),
  updateQuestionBankItem: (id, body) => superAdminApiRequest(`/super-admin/question-bank/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteQuestionBankItem: (id) => superAdminApiRequest(`/super-admin/question-bank/${id}`, { method: "DELETE" }),
  importQuestionBank: (body) => superAdminApiRequest("/super-admin/question-bank/import", { method: "POST", body: JSON.stringify(body) }),
  exportQuestionBank: () => superAdminApiRequest("/super-admin/question-bank/export"),
  getLearningResourceSubjects: (params = "") => superAdminApiRequest(`/super-admin/resources/subjects${params}`),
  createLearningResourceSubject: (body) => superAdminApiRequest("/super-admin/resources/subjects", { method: "POST", body: JSON.stringify(body) }),
  deleteLearningResourceSubject: (id) => superAdminApiRequest(`/super-admin/resources/subjects/${id}`, { method: "DELETE" }),
  getLearningResources: (params = "") => superAdminApiRequest(`/super-admin/resources${params}`),
  getLearningResource: (resourceId) => superAdminApiRequest(`/super-admin/resources/${resourceId}`),
  uploadLearningResource: (body) =>
    superAdminApiRequest("/super-admin/resources/upload", {
      method: "POST",
      body: isFormDataBody(body) ? body : JSON.stringify(body),
    }),
  updateLearningResource: (resourceId, body) =>
    superAdminApiRequest(`/super-admin/resources/${resourceId}`, {
      method: "PUT",
      body: isFormDataBody(body) ? body : JSON.stringify(body),
    }),
  deleteLearningResource: (resourceId) => superAdminApiRequest(`/super-admin/resources/${resourceId}`, { method: "DELETE" }),
  getLearningResourceAnalytics: (params = "") => superAdminApiRequest(`/super-admin/resources/analytics${params}`),
  getPopularLearningResources: (params = "") => superAdminApiRequest(`/super-admin/resources/popular${params}`),
  downloadLearningResource: (resourceId) => superAdminApiBlobOrJsonRequest(`/super-admin/resources/download/${resourceId}`),
};
