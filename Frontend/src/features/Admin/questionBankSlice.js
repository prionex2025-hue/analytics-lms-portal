import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { adminApi } from "@/services/api";

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

export const fetchQuestionSubjects = createAsyncThunk("questionBank/fetchSubjects", async () => {
  return adminApi.getQuestionSubjects();
});

export const createQuestionSubject = createAsyncThunk("questionBank/createSubject", async (payload) => {
  return adminApi.createQuestionSubject(payload);
});

export const deleteQuestionSubject = createAsyncThunk("questionBank/deleteSubject", async (id) => {
  await adminApi.deleteQuestionSubject(id);
  return { id };
});

export const fetchQuestionBankQuestions = createAsyncThunk(
  "questionBank/fetchQuestions",
  async ({ filters = {}, page = 1, limit = 20 } = {}) => {
    const query = toQueryString(filters, page, limit);
    return adminApi.getQuestionBank(query);
  }
);

export const createQuestionBankQuestion = createAsyncThunk("questionBank/createQuestion", async (payload) => {
  return adminApi.addQuestionBankItem(payload);
});

export const importQuestionBankQuestions = createAsyncThunk("questionBank/importQuestions", async (payload) => {
  return adminApi.importQuestionBank(payload);
});

export const updateQuestionBankQuestion = createAsyncThunk("questionBank/updateQuestion", async ({ id, payload }) => {
  return adminApi.updateQuestionBankItem(id, payload);
});

export const deleteQuestionBankQuestion = createAsyncThunk("questionBank/deleteQuestion", async (id) => {
  await adminApi.deleteQuestionBankItem(id);
  return { id };
});

const questionBankSlice = createSlice({
  name: "questionBank",
  initialState,
  reducers: {
    setQuestionBankFilters: (state, action) => {
      state.filters = {
        ...state.filters,
        ...(action.payload || {}),
      };
    },
    clearQuestionBankSelected: (state) => {
      state.selected = [];
    },
    toggleQuestionBankSelected: (state, action) => {
      const id = String(action.payload || "");
      if (!id) return;
      if (state.selected.includes(id)) {
        state.selected = state.selected.filter((item) => item !== id);
      } else {
        state.selected.push(id);
      }
    },
    setQuestionBankSelected: (state, action) => {
      state.selected = Array.isArray(action.payload) ? action.payload.map((item) => String(item)) : [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchQuestionSubjects.pending, (state) => {
        state.loadingSubjects = true;
      })
      .addCase(fetchQuestionSubjects.fulfilled, (state, action) => {
        state.loadingSubjects = false;
        state.subjects = Array.isArray(action.payload) ? action.payload : [];
      })
      .addCase(fetchQuestionSubjects.rejected, (state, action) => {
        state.loadingSubjects = false;
        state.error = action.error.message;
      })
      .addCase(createQuestionSubject.fulfilled, (state, action) => {
        state.subjects = [action.payload, ...state.subjects];
      })
      .addCase(deleteQuestionSubject.fulfilled, (state, action) => {
        state.subjects = state.subjects.filter((item) => item.id !== action.payload.id);
        if (state.filters.subjectId === action.payload.id) {
          state.filters.subjectId = "";
        }
      })
      .addCase(fetchQuestionBankQuestions.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchQuestionBankQuestions.fulfilled, (state, action) => {
        state.loading = false;
        state.questions = action.payload?.data || [];
        state.pagination = action.payload?.pagination || state.pagination;
      })
      .addCase(fetchQuestionBankQuestions.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      .addCase(createQuestionBankQuestion.fulfilled, (state, action) => {
        state.questions = [action.payload, ...state.questions];
      })
      .addCase(importQuestionBankQuestions.fulfilled, () => {
        // caller refetches list after import
      })
      .addCase(updateQuestionBankQuestion.fulfilled, (state, action) => {
        state.questions = state.questions.map((item) => (item.id === action.payload.id ? action.payload : item));
      })
      .addCase(deleteQuestionBankQuestion.fulfilled, (state, action) => {
        state.questions = state.questions.filter((item) => item.id !== action.payload.id);
        state.selected = state.selected.filter((item) => item !== action.payload.id);
      });
  },
});

export const {
  setQuestionBankFilters,
  clearQuestionBankSelected,
  toggleQuestionBankSelected,
  setQuestionBankSelected,
} = questionBankSlice.actions;

export default questionBankSlice.reducer;
