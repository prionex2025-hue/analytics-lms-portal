import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { superAdminApi } from "@/services/api";

const initialState = {
  subjects: [],
  questions: [],
  selected: [],
  filters: {
    subjectId: "",
    difficulty: "all",
    type: "all",
    category: "all",
    search: "",
    fromDate: "",
    toDate: "",
  },
  pagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  },
  loading: false,
  loadingSubjects: false,
  error: null,
};

const toQueryString = (filters = {}, page = 1, limit = 20) => {
  const params = new URLSearchParams();
  if (filters.subjectId) params.set("subjectId", filters.subjectId);
  if (filters.difficulty && filters.difficulty !== "all") params.set("difficulty", filters.difficulty);
  if (filters.type && filters.type !== "all") params.set("type", filters.type);
  if (filters.category && filters.category !== "all") params.set("category", filters.category);
  if (filters.search) params.set("search", filters.search);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  params.set("page", String(page));
  params.set("limit", String(limit));
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
};

export const fetchSuperQuestionSubjects = createAsyncThunk("superQuestionBank/fetchSubjects", async () => {
  return superAdminApi.getQuestionSubjects();
});

export const createSuperQuestionSubject = createAsyncThunk("superQuestionBank/createSubject", async (payload) => {
  return superAdminApi.createQuestionSubject(payload);
});

export const deleteSuperQuestionSubject = createAsyncThunk("superQuestionBank/deleteSubject", async (id) => {
  await superAdminApi.deleteQuestionSubject(id);
  return { id };
});

export const fetchSuperQuestionBankQuestions = createAsyncThunk(
  "superQuestionBank/fetchQuestions",
  async ({ filters = {}, page = 1, limit = 20 } = {}) => {
    const query = toQueryString(filters, page, limit);
    return superAdminApi.getQuestionBank(query);
  }
);

export const createSuperQuestionBankQuestion = createAsyncThunk("superQuestionBank/createQuestion", async (payload) => {
  return superAdminApi.addQuestionBankItem(payload);
});

export const importSuperQuestionBankQuestions = createAsyncThunk("superQuestionBank/importQuestions", async (payload) => {
  return superAdminApi.importQuestionBank(payload);
});

export const updateSuperQuestionBankQuestion = createAsyncThunk("superQuestionBank/updateQuestion", async ({ id, payload }) => {
  return superAdminApi.updateQuestionBankItem(id, payload);
});

export const deleteSuperQuestionBankQuestion = createAsyncThunk("superQuestionBank/deleteQuestion", async (id) => {
  await superAdminApi.deleteQuestionBankItem(id);
  return { id };
});

const superQuestionBankSlice = createSlice({
  name: "superQuestionBank",
  initialState,
  reducers: {
    setSuperQuestionBankFilters: (state, action) => {
      state.filters = {
        ...state.filters,
        ...(action.payload || {}),
      };
    },
    clearSuperQuestionBankSelected: (state) => {
      state.selected = [];
    },
    toggleSuperQuestionBankSelected: (state, action) => {
      const id = String(action.payload || "");
      if (!id) return;
      if (state.selected.includes(id)) {
        state.selected = state.selected.filter((item) => item !== id);
      } else {
        state.selected.push(id);
      }
    },
    setSuperQuestionBankSelected: (state, action) => {
      state.selected = Array.isArray(action.payload) ? action.payload.map((item) => String(item)) : [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSuperQuestionSubjects.pending, (state) => {
        state.loadingSubjects = true;
      })
      .addCase(fetchSuperQuestionSubjects.fulfilled, (state, action) => {
        state.loadingSubjects = false;
        state.subjects = Array.isArray(action.payload) ? action.payload : [];
      })
      .addCase(fetchSuperQuestionSubjects.rejected, (state, action) => {
        state.loadingSubjects = false;
        state.error = action.error.message;
      })
      .addCase(createSuperQuestionSubject.fulfilled, (state, action) => {
        state.subjects = [action.payload, ...state.subjects];
      })
      .addCase(deleteSuperQuestionSubject.fulfilled, (state, action) => {
        state.subjects = state.subjects.filter((item) => item.id !== action.payload.id);
        if (state.filters.subjectId === action.payload.id) {
          state.filters.subjectId = "";
        }
      })
      .addCase(fetchSuperQuestionBankQuestions.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchSuperQuestionBankQuestions.fulfilled, (state, action) => {
        state.loading = false;
        state.questions = action.payload?.data || [];
        state.pagination = action.payload?.pagination || state.pagination;
      })
      .addCase(fetchSuperQuestionBankQuestions.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      .addCase(createSuperQuestionBankQuestion.fulfilled, (state, action) => {
        state.questions = [action.payload, ...state.questions];
      })
      .addCase(importSuperQuestionBankQuestions.fulfilled, () => {
        // caller refetches list after import
      })
      .addCase(updateSuperQuestionBankQuestion.fulfilled, (state, action) => {
        state.questions = state.questions.map((item) => (item.id === action.payload.id ? action.payload : item));
      })
      .addCase(deleteSuperQuestionBankQuestion.fulfilled, (state, action) => {
        state.questions = state.questions.filter((item) => item.id !== action.payload.id);
        state.selected = state.selected.filter((item) => item !== action.payload.id);
      });
  },
});

export const {
  setSuperQuestionBankFilters,
  clearSuperQuestionBankSelected,
  toggleSuperQuestionBankSelected,
  setSuperQuestionBankSelected,
} = superQuestionBankSlice.actions;

export default superQuestionBankSlice.reducer;
