import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { adminApi, api, superAdminApi } from "@/services/api";

const roleClients = {
  student: api,
  admin: adminApi,
  super: superAdminApi,
};

const emptyRoleState = () => ({
  subjects: [],
  resources: [],
  popular: [],
  analytics: null,
  selectedResource: null,
  pagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
    nextCursor: null,
  },
  loading: false,
  loadingSubjects: false,
  uploading: false,
  analyticsLoading: false,
  error: null,
});

const initialState = {
  student: emptyRoleState(),
  admin: emptyRoleState(),
  super: emptyRoleState(),
};

const getClient = (role) => roleClients[role] || api;

const toQueryString = (filters = {}) => {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "" || value === "all") {
      return;
    }
    params.set(key, String(value));
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
};

const getRoleState = (state, role) => {
  if (!state[role]) {
    state[role] = emptyRoleState();
  }
  return state[role];
};

export const fetchLearningResourceSubjects = createAsyncThunk(
  "learningResources/fetchSubjects",
  async ({ role = "student", filters = {} } = {}) => {
    return {
      role,
      data: await getClient(role).getLearningResourceSubjects(toQueryString(filters)),
    };
  }
);

export const createLearningResourceSubject = createAsyncThunk(
  "learningResources/createSubject",
  async ({ role = "admin", payload }) => {
    return {
      role,
      data: await getClient(role).createLearningResourceSubject(payload),
    };
  }
);

export const deleteLearningResourceSubject = createAsyncThunk(
  "learningResources/deleteSubject",
  async ({ role = "admin", id }) => {
    await getClient(role).deleteLearningResourceSubject(id);
    return { role, id };
  }
);

export const fetchLearningResources = createAsyncThunk(
  "learningResources/fetchResources",
  async ({ role = "student", filters = {} } = {}) => {
    return {
      role,
      data: await getClient(role).getLearningResources(toQueryString(filters)),
    };
  }
);

export const fetchLearningResource = createAsyncThunk(
  "learningResources/fetchResource",
  async ({ role = "student", id }) => {
    return {
      role,
      data: await getClient(role).getLearningResource(id),
    };
  }
);

export const uploadLearningResource = createAsyncThunk(
  "learningResources/upload",
  async ({ role = "admin", payload }) => {
    return {
      role,
      data: await getClient(role).uploadLearningResource(payload),
    };
  }
);

export const updateLearningResource = createAsyncThunk(
  "learningResources/update",
  async ({ role = "admin", id, payload }) => {
    return {
      role,
      data: await getClient(role).updateLearningResource(id, payload),
    };
  }
);

export const deleteLearningResource = createAsyncThunk(
  "learningResources/delete",
  async ({ role = "admin", id }) => {
    await getClient(role).deleteLearningResource(id);
    return { role, id };
  }
);

export const fetchLearningResourceAnalytics = createAsyncThunk(
  "learningResources/fetchAnalytics",
  async ({ role = "admin", filters = {} } = {}) => {
    return {
      role,
      data: await getClient(role).getLearningResourceAnalytics(toQueryString(filters)),
    };
  }
);

export const fetchPopularLearningResources = createAsyncThunk(
  "learningResources/fetchPopular",
  async ({ role = "student", filters = {} } = {}) => {
    return {
      role,
      data: await getClient(role).getPopularLearningResources(toQueryString(filters)),
    };
  }
);

export const downloadLearningResource = createAsyncThunk(
  "learningResources/download",
  async ({ role = "student", id }) => {
    return {
      role,
      id,
      data: await getClient(role).downloadLearningResource(id),
    };
  }
);

const learningResourcesSlice = createSlice({
  name: "learningResources",
  initialState,
  reducers: {
    clearSelectedLearningResource: (state, action) => {
      const role = action.payload?.role || "student";
      getRoleState(state, role).selectedResource = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchLearningResourceSubjects.pending, (state, action) => {
        getRoleState(state, action.meta.arg?.role || "student").loadingSubjects = true;
      })
      .addCase(fetchLearningResourceSubjects.fulfilled, (state, action) => {
        const roleState = getRoleState(state, action.payload.role);
        roleState.loadingSubjects = false;
        roleState.subjects = Array.isArray(action.payload.data) ? action.payload.data : [];
      })
      .addCase(fetchLearningResourceSubjects.rejected, (state, action) => {
        const roleState = getRoleState(state, action.meta.arg?.role || "student");
        roleState.loadingSubjects = false;
        roleState.error = action.error.message;
      })
      .addCase(createLearningResourceSubject.fulfilled, (state, action) => {
        const roleState = getRoleState(state, action.payload.role);
        roleState.subjects = [action.payload.data, ...roleState.subjects];
      })
      .addCase(deleteLearningResourceSubject.fulfilled, (state, action) => {
        const roleState = getRoleState(state, action.payload.role);
        roleState.subjects = roleState.subjects.filter((subject) => subject.id !== action.payload.id);
      })
      .addCase(fetchLearningResources.pending, (state, action) => {
        const roleState = getRoleState(state, action.meta.arg?.role || "student");
        roleState.loading = true;
        roleState.error = null;
      })
      .addCase(fetchLearningResources.fulfilled, (state, action) => {
        const roleState = getRoleState(state, action.payload.role);
        roleState.loading = false;
        roleState.resources = action.payload.data?.data || [];
        roleState.pagination = action.payload.data?.pagination || roleState.pagination;
      })
      .addCase(fetchLearningResources.rejected, (state, action) => {
        const roleState = getRoleState(state, action.meta.arg?.role || "student");
        roleState.loading = false;
        roleState.error = action.error.message;
      })
      .addCase(fetchLearningResource.fulfilled, (state, action) => {
        getRoleState(state, action.payload.role).selectedResource = action.payload.data;
      })
      .addCase(uploadLearningResource.pending, (state, action) => {
        getRoleState(state, action.meta.arg?.role || "admin").uploading = true;
      })
      .addCase(uploadLearningResource.fulfilled, (state, action) => {
        const roleState = getRoleState(state, action.payload.role);
        roleState.uploading = false;
        roleState.resources = [action.payload.data, ...roleState.resources];
      })
      .addCase(uploadLearningResource.rejected, (state, action) => {
        const roleState = getRoleState(state, action.meta.arg?.role || "admin");
        roleState.uploading = false;
        roleState.error = action.error.message;
      })
      .addCase(updateLearningResource.fulfilled, (state, action) => {
        const roleState = getRoleState(state, action.payload.role);
        roleState.resources = roleState.resources.map((resource) =>
          resource.id === action.payload.data.id ? action.payload.data : resource
        );
        roleState.selectedResource = action.payload.data;
      })
      .addCase(deleteLearningResource.fulfilled, (state, action) => {
        const roleState = getRoleState(state, action.payload.role);
        roleState.resources = roleState.resources.filter((resource) => resource.id !== action.payload.id);
      })
      .addCase(fetchLearningResourceAnalytics.pending, (state, action) => {
        getRoleState(state, action.meta.arg?.role || "admin").analyticsLoading = true;
      })
      .addCase(fetchLearningResourceAnalytics.fulfilled, (state, action) => {
        const roleState = getRoleState(state, action.payload.role);
        roleState.analyticsLoading = false;
        roleState.analytics = action.payload.data;
      })
      .addCase(fetchLearningResourceAnalytics.rejected, (state, action) => {
        const roleState = getRoleState(state, action.meta.arg?.role || "admin");
        roleState.analyticsLoading = false;
        roleState.error = action.error.message;
      })
      .addCase(fetchPopularLearningResources.fulfilled, (state, action) => {
        getRoleState(state, action.payload.role).popular = Array.isArray(action.payload.data) ? action.payload.data : [];
      });
  },
});

export const { clearSelectedLearningResource } = learningResourcesSlice.actions;

export default learningResourcesSlice.reducer;
