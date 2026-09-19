import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { adminApi } from "@/services/api";

const DEFAULT_FILTERS = {
  testId: "",
  departmentId: "",
  batchId: "",
  studentSearch: "",
  dateRange: "30d",
  dateFrom: "",
  dateTo: "",
};

const DEFAULT_TABLE = {
  page: 1,
  limit: 10,
  sortBy: "score",
  sortDir: "desc",
  search: "",
};

const toQueryString = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") return;
    query.set(key, String(value));
  });
  const value = query.toString();
  return value ? `?${value}` : "";
};

export const fetchReportSummary = createAsyncThunk("reports/fetchSummary", async (filters) => {
  return adminApi.getReportSummary(toQueryString(filters));
});

export const fetchReportCharts = createAsyncThunk("reports/fetchCharts", async (filters) => {
  return adminApi.getReportCharts(toQueryString(filters));
});

export const fetchReportStudents = createAsyncThunk("reports/fetchStudents", async ({ filters, table }) => {
  return adminApi.getReportTable(toQueryString({ ...filters, ...table }));
});

export const fetchReportStudentDetail = createAsyncThunk("reports/fetchStudentDetail", async ({ studentId, filters }) => {
  return adminApi.getReportStudentDetail(studentId, toQueryString(filters));
});

const reportsSlice = createSlice({
  name: "reports",
  initialState: {
    filters: { ...DEFAULT_FILTERS },
    appliedFilters: { ...DEFAULT_FILTERS },
    table: { ...DEFAULT_TABLE },
    summary: null,
    charts: {
      scoreDistribution: [],
      performanceTrend: [],
      departmentPerformance: [],
      topPerformers: [],
    },
    students: {
      data: [],
      pagination: { page: 1, totalPages: 1, total: 0, limit: 10 },
    },
    studentDetail: null,
    selectedStudentId: "",
    loading: {
      summary: false,
      charts: false,
      students: false,
      studentDetail: false,
    },
    error: {
      summary: "",
      charts: "",
      students: "",
      studentDetail: "",
    },
  },
  reducers: {
    setReportFilter: (state, action) => {
      const { key, value } = action.payload;
      if (state.filters[key] === value) return;
      state.filters[key] = value;
    },
    setReportTable: (state, action) => {
      const nextTable = { ...state.table, ...action.payload };
      const hasChanged = Object.keys(nextTable).some((key) => state.table[key] !== nextTable[key]);
      if (!hasChanged) return;
      state.table = nextTable;
    },
    applyReportFilters: (state) => {
      const filtersChanged = Object.keys(state.filters).some((key) => state.filters[key] !== state.appliedFilters[key]);
      if (!filtersChanged && state.table.page === 1) return;
      state.appliedFilters = { ...state.filters };
      state.table.page = 1;
    },
    resetReportFilters: (state) => {
      state.filters = { ...DEFAULT_FILTERS };
      state.appliedFilters = { ...DEFAULT_FILTERS };
      state.table = { ...DEFAULT_TABLE };
      state.selectedStudentId = "";
      state.studentDetail = null;
    },
    setSelectedReportStudent: (state, action) => {
      state.selectedStudentId = action.payload;
      if (!action.payload) {
        state.studentDetail = null;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchReportSummary.pending, (state) => {
        state.loading.summary = true;
        state.error.summary = "";
      })
      .addCase(fetchReportSummary.fulfilled, (state, action) => {
        state.loading.summary = false;
        state.summary = action.payload;
      })
      .addCase(fetchReportSummary.rejected, (state, action) => {
        state.loading.summary = false;
        state.error.summary = action.error?.message || "Unable to load summary";
      })
      .addCase(fetchReportCharts.pending, (state) => {
        state.loading.charts = true;
        state.error.charts = "";
      })
      .addCase(fetchReportCharts.fulfilled, (state, action) => {
        state.loading.charts = false;
        state.charts = {
          scoreDistribution: action.payload?.scoreDistribution || [],
          performanceTrend: action.payload?.performanceTrend || [],
          departmentPerformance: action.payload?.departmentPerformance || [],
          topPerformers: action.payload?.topPerformers || [],
        };
      })
      .addCase(fetchReportCharts.rejected, (state, action) => {
        state.loading.charts = false;
        state.error.charts = action.error?.message || "Unable to load charts";
      })
      .addCase(fetchReportStudents.pending, (state) => {
        state.loading.students = true;
        state.error.students = "";
      })
      .addCase(fetchReportStudents.fulfilled, (state, action) => {
        state.loading.students = false;
        state.students = {
          data: action.payload?.data || [],
          pagination: action.payload?.pagination || { page: 1, totalPages: 1, total: 0, limit: 10 },
        };
      })
      .addCase(fetchReportStudents.rejected, (state, action) => {
        state.loading.students = false;
        state.error.students = action.error?.message || "Unable to load table data";
      })
      .addCase(fetchReportStudentDetail.pending, (state) => {
        state.loading.studentDetail = true;
        state.error.studentDetail = "";
      })
      .addCase(fetchReportStudentDetail.fulfilled, (state, action) => {
        state.loading.studentDetail = false;
        state.studentDetail = action.payload;
      })
      .addCase(fetchReportStudentDetail.rejected, (state, action) => {
        state.loading.studentDetail = false;
        state.error.studentDetail = action.error?.message || "Unable to load student detail";
      });
  },
});

export const {
  setReportFilter,
  setReportTable,
  applyReportFilters,
  resetReportFilters,
  setSelectedReportStudent,
} = reportsSlice.actions;

export default reportsSlice.reducer;
