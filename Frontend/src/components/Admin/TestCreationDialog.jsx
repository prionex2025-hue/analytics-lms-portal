import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useAdminAuthState } from "@/hooks/useAdminAuthState";
import {
  addQuestionsFromBank,
  addQuestionRow,
  clearTestCreationErrors,
  goToNextCreationStep,
  goToPreviousCreationStep,
  hydrateTestCreationDraft,
  increaseQuestionRenderLimit,
  openTestCreationDialog,
  removeQuestionRow,
  replaceQuestionsFromBulk,
  setDialogOpenState,
  setQuestionInputMode,
  setTestCreationErrors,
  setTestCreationStep,
  submitTestCreation,
  toggleBatchId,
  setTestCreationContext,
  updateQuestionRow,
  updateRestrictionsField,
  updateModuleDuration,
  updateTestCreationField,
  validateCurrentStep,
  createInitialTestCreationState,
} from "@/features/Admin/testCreationSlice";
import {
  ASSESSMENT_FORMATS,
  MODULE_DEFINITIONS,
  ALLOWED_MODULE_CATEGORIES,
  normalizeAssessmentFormat,
  sumModuleDurations,
} from "@/lib/testConfig";
import { fetchAdminTests, fetchBatches, fetchDepartments, fetchStudents } from "@/features/Admin/adminPanelSlice";
import { fetchSuperColleges } from "@/features/SuperAdmin/superAdminPanelSlice";
import { adminApi, superAdminApi } from "@/services/api";
import usePermission from "@/hooks/usePermission";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import {
  fetchQuestionBankQuestions,
  fetchQuestionSubjects,
  setQuestionBankFilters,
  toggleQuestionBankSelected,
} from "@/features/Admin/questionBankSlice";
import {
  fetchSuperQuestionBankQuestions,
  fetchSuperQuestionSubjects,
  setSuperQuestionBankFilters,
  toggleSuperQuestionBankSelected,
} from "@/features/SuperAdmin/superQuestionBankSlice";
import {
  PRESET_CONFIGS,
  PROCTORING_PRESETS,
  getDefaultFormPatchFromAdminSettings,
} from "@/lib/testConfig";

// Custom UI Components (Replacing Shadcn)
import { Button } from "@/components/ui/button"; 
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { X, FileText, Clock, Users, HelpCircle, ShieldCheck, Send, AlertTriangle, Eye, Rocket } from "lucide-react";

const ADMIN_DRAFT_KEY = "admin-test-creation-draft";
const SUPER_ADMIN_DRAFT_KEY = "super-admin-test-creation-draft";
const SUBJECT_OPTIONS = ["Quantitative aptitude", "Logical Reasoning", "Verbal", "Aptitude","other"];
const EVALUATION_RULE_OPTIONS = [
  { value: "BEST_ATTEMPT", label: "Best Attempt" },
  { value: "LAST_ATTEMPT", label: "Last Attempt" },
];
const PUBLISH_STATE_OPTIONS = [
  { value: "DRAFT", label: "Save as Draft" },
  { value: "UPCOMING", label: "Schedule as Upcoming" },
  { value: "PUBLISH", label: "Publish Immediately" },
];
const QUESTION_TYPE_OPTIONS = [
  { value: "mcq", label: "MCQ" },
  { value: "true_false", label: "True / False" },
  { value: "fill_blank", label: "Fill in the Blank" },
  { value: "paragraph", label: "Paragraph" },
];
const DIFFICULTY_OPTIONS = ["EASY", "MEDIUM", "HARD"];
const STUDENT_YEAR_OPTIONS = [
  { value: 1, label: "1 YEAR" },
  { value: 2, label: "2 YEAR" },
  { value: 3, label: "3 YEAR" },
  { value: 4, label: "4 YEAR" },
];
const ADMIN_STUDENTS_PAGE_LIMIT = 100;
const EMPTY_ARRAY = Object.freeze([]);
const DEFAULT_QB_STATE = Object.freeze({
  filters: {},
  subjects: [],
  questions: [],
  selected: [],
  loading: false,
  pagination: {
    page: 1,
    totalPages: 1,
    limit: 20,
  },
});

const resolveDepartmentId = (departmentRef) => {
  if (!departmentRef) return null;
  if (typeof departmentRef === "string" || typeof departmentRef === "number") {
    return departmentRef;
  }
  return departmentRef.id || departmentRef._id || departmentRef.departmentId || null;
};

const normalizeId = (value) => String(value ?? "");

export default function TestCreationDialog({ context = "admin", onCreated, hideTrigger = false }) {
  const dispatch = useDispatch();
  const isSuperAdminContext = context === "super_admin";
  const canManageBatches = usePermission(ADMIN_PERMISSIONS.MANAGE_BATCHES);
  const canViewBatches = usePermission(ADMIN_PERMISSIONS.VIEW_BATCHES);
  const canManageDepartments = usePermission(ADMIN_PERMISSIONS.MANAGE_DEPARTMENTS);
  const canManageStudents = usePermission(ADMIN_PERMISSIONS.MANAGE_STUDENTS);
  const canViewStudents = usePermission(ADMIN_PERMISSIONS.VIEW_STUDENTS);
  const canManageQuestions = usePermission(ADMIN_PERMISSIONS.MANAGE_QUESTIONS);
  const canViewQuestionBank = usePermission(ADMIN_PERMISSIONS.VIEW_QUESTION_BANK);
  const canLoadAdminBatches = canManageBatches || canViewBatches;
  const canLoadAdminDepartments = canLoadAdminBatches || canManageDepartments;
  const canLoadAdminStudents = canManageStudents || canViewStudents;
  const canLoadAdminQuestionSubjects = canManageQuestions || canViewQuestionBank;
  const fallbackTestCreation = useMemo(() => createInitialTestCreationState(), []);
  const testCreation = useSelector((state) => state.testCreation) || fallbackTestCreation;
  const sidebarCollapsed = useSelector((state) => state.adminUi?.sidebarCollapsed);
  const departments = useSelector((state) => state.adminPanel?.departments?.data ?? EMPTY_ARRAY);
  const batches = useSelector((state) => state.adminPanel?.batches?.data ?? EMPTY_ARRAY);
  const students = useSelector((state) => state.adminPanel?.students?.data ?? EMPTY_ARRAY);
  const studentUser = useSelector((state) => state.auth?.user || null);
  const adminUser = useAdminAuthState()?.admin || null;
  const superAdminUser = useSelector((state) => state.superAdminAuth?.superAdmin || null);
  const scopedUser = isSuperAdminContext ? superAdminUser : (adminUser || studentUser);
  const currentUserDeptId = resolveDepartmentId(scopedUser?.departmentId || scopedUser?.department);
  const colleges = useSelector((state) => state.superAdminPanel?.colleges ?? EMPTY_ARRAY);
  const qbState = useSelector((state) => (isSuperAdminContext ? state.superQuestionBank : state.questionBank));
  const qb = qbState || DEFAULT_QB_STATE;
  const selectedQuestionBankSubjectId = qb.filters?.subjectId || qb.subjects[0]?.id || "";
  const { form, open, step, stepTitles, errors, isSubmitting, questionRenderLimit, mode, editingTestStatus } = testCreation;
  const isEditMode = mode === "edit";
  // MODULE_TEST hides the test-level subject category and replaces the single
  // duration input with three per-module timers.
  const isModuleFormat = normalizeAssessmentFormat(form.assessmentFormat) === ASSESSMENT_FORMATS.MODULE_TEST;
  // A non-draft test (SCHEDULED / LIVE) can only have its settings edited —
  // questions and assignment scope are locked server-side after publishing.
  const isNonDraftEdit = isEditMode && Boolean(editingTestStatus) && editingTestStatus !== "DRAFT";
  const draftKey = isSuperAdminContext ? SUPER_ADMIN_DRAFT_KEY : ADMIN_DRAFT_KEY;
  const visibleDepartments = isSuperAdminContext
    ? departments
    : Array.isArray(departments)
    ? departments.filter((d) => String(d.id) === String(currentUserDeptId))
    : departments;
  const visibleStudents = isSuperAdminContext
    ? students
    : Array.isArray(students)
    ? students.filter((s) => String(s.departmentId) === String(currentUserDeptId))
    : students;
  const [bulkJson, setBulkJson] = useState("");
  const [quickEditIndex, setQuickEditIndex] = useState(null);
  const [publishDialog, setPublishDialog] = useState({ open: false, publishState: "PUBLISH" });
  const [isConfirmPublishing, setIsConfirmPublishing] = useState(false);
  const [externalDraftWarning, setExternalDraftWarning] = useState(false);
  const [qbPage, setQbPage] = useState(1);
  const [superDepartments, setSuperDepartments] = useState([]);
  const [superBatches, setSuperBatches] = useState([]);
  const [superDepartmentsLoaded, setSuperDepartmentsLoaded] = useState(false);
  const [superBatchesLoaded, setSuperBatchesLoaded] = useState(false);

  const qbSetFilters = isSuperAdminContext ? setSuperQuestionBankFilters : setQuestionBankFilters;
  const qbToggleSelected = isSuperAdminContext ? toggleSuperQuestionBankSelected : toggleQuestionBankSelected;
  const qbFetchSubjects = isSuperAdminContext ? fetchSuperQuestionSubjects : fetchQuestionSubjects;
  const qbFetchQuestions = isSuperAdminContext ? fetchSuperQuestionBankQuestions : fetchQuestionBankQuestions;

  const location = useLocation();
  const previousPathnameRef = useRef(location.pathname);

  const resetBodyInteractionLock = () => {
    document.body.style.overflow = "";
    document.body.style.pointerEvents = "";
  };

  // Persistence and Fetching
  useEffect(() => {
    dispatch(setTestCreationContext(context));
    if (!open || isEditMode) {
      return undefined;
    }

    let cancelled = false;

    const hydrateCreateDefaults = async () => {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        try {
          if (!cancelled) {
            dispatch(hydrateTestCreationDraft(JSON.parse(raw)));
          }
          return;
        } catch {
          localStorage.removeItem(draftKey);
        }
      }

      if (isSuperAdminContext) {
        return;
      }

      try {
        const response = await adminApi.getSettings();
        if (!cancelled) {
          dispatch(hydrateTestCreationDraft(getDefaultFormPatchFromAdminSettings(response?.settings)));
        }
      } catch {
        // Keep local defaults if settings fetch fails.
      }
    };

    hydrateCreateDefaults();

    return () => {
      cancelled = true;
    };
  }, [context, dispatch, draftKey, isEditMode, isSuperAdminContext, open]);

  useEffect(() => {
    if (!open || isEditMode) {
      return;
    }
    localStorage.setItem(draftKey, JSON.stringify(form));
  }, [draftKey, form, isEditMode, open]);

  useEffect(() => {
    if (open) {
      if (isSuperAdminContext) {
        dispatch(fetchSuperColleges());
        dispatch(qbFetchSubjects());
      } else {
        if (canLoadAdminDepartments) {
          dispatch(fetchDepartments());
        }
        if (canLoadAdminBatches) {
          dispatch(fetchBatches());
        }
        if (canLoadAdminStudents) {
          dispatch(fetchStudents(`?page=1&limit=${ADMIN_STUDENTS_PAGE_LIMIT}`));
        }
        if (canLoadAdminQuestionSubjects) {
          dispatch(qbFetchSubjects());
        }
      }
      document.body.style.overflow = "hidden"; // Prevent background scroll
    } else {
      document.body.style.overflow = ""; // Properly reset (not "unset" which cascades)
    }
  }, [canLoadAdminBatches, canLoadAdminDepartments, canLoadAdminQuestionSubjects, canLoadAdminStudents, dispatch, isSuperAdminContext, open, qbFetchSubjects]);

  useEffect(() => {
    if (!open || isSuperAdminContext) return;
    if (!currentUserDeptId) return;
    if (form.assignmentMethod === "everyone") {
      dispatch(updateTestCreationField({ key: "assignmentMethod", value: "department_wise" }));
    }
    if (String(form.departmentId || "") !== String(currentUserDeptId)) {
      dispatch(updateTestCreationField({ key: "departmentId", value: currentUserDeptId }));
    }
  }, [currentUserDeptId, dispatch, form.assignmentMethod, form.departmentId, isSuperAdminContext, open]);

  // Route-change guard: close dialog after real navigation to prevent UI/router state mismatch.
  useEffect(() => {
    if (previousPathnameRef.current === location.pathname) {
      return;
    }

    previousPathnameRef.current = location.pathname;
    if (open) {
      handleClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Cleanup on unmount: always restore body state
  useEffect(() => {
    return () => {
      resetBodyInteractionLock();
    };
  }, []);

  // Escape key closes dialog (accessibility)
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !publishDialog.open) {
        handleClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, publishDialog.open]);

  useEffect(() => {
    if (!isSuperAdminContext || !open) {
      setSuperDepartments([]);
      setSuperDepartmentsLoaded(false);
      return;
    }

    let cancelled = false;

    const loadSuperDepartments = async () => {
      setSuperDepartmentsLoaded(false);
      try {
        const firstPage = await superAdminApi.getDepartments("?page=1&limit=100");
        const firstItems = Array.isArray(firstPage?.data) ? firstPage.data : [];
        const totalPages = Number(firstPage?.pagination?.pages || 1);

        if (totalPages <= 1) {
          if (!cancelled) {
            setSuperDepartments(firstItems);
            setSuperDepartmentsLoaded(true);
          }
          return;
        }

        const pageRequests = [];
        for (let page = 2; page <= totalPages; page += 1) {
          pageRequests.push(superAdminApi.getDepartments(`?page=${page}&limit=100`));
        }

        const restPages = await Promise.all(pageRequests);
        const merged = [
          ...firstItems,
          ...restPages.flatMap((result) => (Array.isArray(result?.data) ? result.data : [])),
        ];
        const deduped = Array.from(new Map(merged.map((item) => [item.id, item])).values());
        if (!cancelled) {
          setSuperDepartments(deduped);
          setSuperDepartmentsLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setSuperDepartments([]);
          setSuperDepartmentsLoaded(true);
        }
      }
    };

    loadSuperDepartments();

    return () => {
      cancelled = true;
    };
  }, [isSuperAdminContext, open]);

  useEffect(() => {
    if (!isSuperAdminContext || !open) {
      setSuperBatches([]);
      setSuperBatchesLoaded(false);
      return;
    }

    let cancelled = false;

    const loadCollegeBatches = async (collegeId) => {
      const firstPage = await superAdminApi.getBatches(`?page=1&limit=100&collegeId=${collegeId}`);
      const firstItems = Array.isArray(firstPage?.data) ? firstPage.data : [];
      const totalPages = Number(firstPage?.pagination?.pages || 1);

      if (totalPages <= 1) {
        return firstItems;
      }

      const pageRequests = [];
      for (let page = 2; page <= totalPages; page += 1) {
        pageRequests.push(superAdminApi.getBatches(`?page=${page}&limit=100&collegeId=${collegeId}`));
      }

      const restPages = await Promise.all(pageRequests);
      return [
        ...firstItems,
        ...restPages.flatMap((result) => (Array.isArray(result?.data) ? result.data : [])),
      ];
    };

    const loadSuperBatches = async () => {
      setSuperBatchesLoaded(false);
      const scopedCollegeIds = form.allColleges
        ? (colleges || []).map((item) => item.id)
        : (Array.isArray(form.collegeIds) ? form.collegeIds : []);

      if (!scopedCollegeIds.length) {
        if (!cancelled) {
          setSuperBatches([]);
          setSuperBatchesLoaded(true);
        }
        return;
      }

      try {
        const responses = await Promise.all(
          scopedCollegeIds.map((collegeId) => loadCollegeBatches(collegeId))
        );
        const merged = responses.flatMap((result) => (Array.isArray(result) ? result : []));
        const deduped = Array.from(new Map(merged.map((item) => [item.id, item])).values());
        if (!cancelled) {
          setSuperBatches(deduped);
          setSuperBatchesLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setSuperBatches([]);
          setSuperBatchesLoaded(true);
        }
      }
    };

    loadSuperBatches();

    return () => {
      cancelled = true;
    };
  }, [colleges, form.allColleges, form.collegeIds, isSuperAdminContext, open]);

  useEffect(() => {
    if (!open || step !== 3 || form.questionInputMode !== "question_bank") {
      return;
    }

    if (!selectedQuestionBankSubjectId) {
      return;
    }

    const firstSubjectId = qb.subjects[0]?.id;
    if (!qb.filters?.subjectId && firstSubjectId) {
      dispatch(qbSetFilters({ subjectId: firstSubjectId }));
    }

    dispatch(
      qbFetchQuestions({
        filters: { ...qb.filters, subjectId: selectedQuestionBankSubjectId },
        page: qbPage,
        limit: qb.pagination.limit,
      })
    );
  }, [dispatch, form.questionInputMode, open, qb.filters, qb.pagination.limit, qb.subjects, qbPage, qbFetchQuestions, qbSetFilters, selectedQuestionBankSubjectId, step]);

  useEffect(() => {
    if (!open) return undefined;

    const onStorage = (event) => {
      if (event.key === draftKey && event.newValue && event.newValue !== JSON.stringify(form)) {
        setExternalDraftWarning(true);
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [draftKey, open, form]);

  const canProceed = useMemo(() => Object.keys(validateCurrentStep(testCreation)).length === 0, [testCreation]);

  const filteredBatches = useMemo(() => {
    if (!form.departmentId) return batches;
    return batches.filter((batch) => String(batch.departmentId || "") === String(form.departmentId));
  }, [batches, form.departmentId]);

  const scopedSuperDepartments = useMemo(() => {
    const selectedCollegeIds = form.allColleges
      ? (Array.isArray(colleges) ? colleges.map((college) => normalizeId(college.id)) : [])
      : (Array.isArray(form.collegeIds) ? form.collegeIds.map((collegeId) => normalizeId(collegeId)) : []);

    return superDepartments.filter((department) => {
      if (!form.allColleges && selectedCollegeIds.length > 0 && !selectedCollegeIds.includes(normalizeId(department.collegeId))) {
        return false;
      }
      return true;
    });
  }, [colleges, form.allColleges, form.collegeIds, superDepartments]);

  const hasSuperAdminCollegeScope = form.allColleges || (Array.isArray(form.collegeIds) && form.collegeIds.length > 0);

  const visibleSuperBatches = useMemo(() => {
    if (form.assignmentMethod !== "batch_wise") return [];
    const scopedCollegeIds = form.allColleges
      ? (Array.isArray(colleges) ? colleges.map((college) => normalizeId(college.id)) : [])
      : (Array.isArray(form.collegeIds) ? form.collegeIds.map((collegeId) => normalizeId(collegeId)) : []);

    if (scopedCollegeIds.length === 0) {
      return [];
    }
    return superBatches.filter((batch) => scopedCollegeIds.includes(normalizeId(batch.collegeId)));
  }, [colleges, form.allColleges, form.assignmentMethod, form.collegeIds, superBatches]);

  useEffect(() => {
    if (!isSuperAdminContext || !open) {
      return;
    }

    const scopedCollegeIds = form.allColleges
      ? (Array.isArray(colleges) ? colleges.map((college) => normalizeId(college.id)) : [])
      : (Array.isArray(form.collegeIds) ? form.collegeIds.map((collegeId) => normalizeId(collegeId)) : []);

    const scopedCollegeSet = new Set(scopedCollegeIds);
    const currentDepartmentIds = Array.isArray(form.departmentIds) ? form.departmentIds : [];

    if (superDepartmentsLoaded) {
      const scopedDepartments = superDepartments.filter((department) => {
        if (form.allColleges) return true;
        if (!scopedCollegeSet.size) return false;
        return scopedCollegeSet.has(department.collegeId);
      });
      const allowedDepartmentIds = new Set(scopedDepartments.map((department) => department.id));
      const nextDepartmentIds = currentDepartmentIds.filter((id) => allowedDepartmentIds.has(id));

      if (
        nextDepartmentIds.length !== currentDepartmentIds.length
        || nextDepartmentIds.some((id, index) => id !== currentDepartmentIds[index])
      ) {
        dispatch(updateTestCreationField({ key: "departmentIds", value: nextDepartmentIds }));
        return;
      }
    }

    const currentBatchIds = Array.isArray(form.batchIds) ? form.batchIds : [];

    if (form.assignmentMethod === "department_wise") {
      if (currentBatchIds.length > 0) {
        dispatch(updateTestCreationField({ key: "batchIds", value: [] }));
      }
      return;
    }

    if (!superBatchesLoaded) {
      return;
    }

    // For batch-wise assignment, only allow batches from selected colleges
    const allowedBatchIds = new Set(
      superBatches
        .filter((batch) => scopedCollegeSet.has(normalizeId(batch.collegeId)))
        .map((batch) => batch.id)
    );

    const nextBatchIds = currentBatchIds.filter((id) => allowedBatchIds.has(id));
    if (
      nextBatchIds.length !== currentBatchIds.length
      || nextBatchIds.some((id, index) => id !== currentBatchIds[index])
    ) {
      dispatch(updateTestCreationField({ key: "batchIds", value: nextBatchIds }));
    }
  }, [
    colleges,
    dispatch,
    form.allColleges,
    form.assignmentMethod,
    form.batchIds,
    form.collegeIds,
    form.departmentIds,
    isSuperAdminContext,
    open,
    superBatches,
    superBatchesLoaded,
    superDepartments,
    superDepartmentsLoaded,
  ]);

  const groupedDepartmentsByCollege = useMemo(() => {
    return scopedSuperDepartments.reduce((acc, department) => {
      const key = department.collegeId || "unknown";
      if (!acc[key]) {
        acc[key] = {
          collegeId: key,
          collegeName: department.college?.name || "Unknown college",
          items: [],
        };
      }
      acc[key].items.push(department);
      return acc;
    }, {});
  }, [scopedSuperDepartments]);

  const selectedYears = useMemo(
    () => [...new Set((Array.isArray(form.years) ? form.years : []).map(Number).filter((year) => year >= 1 && year <= 4))],
    [form.years]
  );

  const selectedYearSet = useMemo(() => new Set(selectedYears.map(String)), [selectedYears]);

  const toggleStudentYear = (year) => {
    const existing = selectedYears;
    const next = existing.includes(year)
      ? existing.filter((item) => item !== year)
      : [...existing, year].sort((a, b) => a - b);
    dispatch(updateTestCreationField({ key: "years", value: next }));
  };

  const normalizedQuestions = useMemo(() => {
    return form.questions.map((question, idx) => {
      const type = String(question.type || "mcq").toLowerCase();
      const text = String(question.question || "").trim();
      const options = Array.isArray(question.options) ? question.options.map((item) => String(item).trim()).filter(Boolean) : [];
      const correctAnswer = typeof question.correctAnswer === "string" ? question.correctAnswer.trim() : question.correctAnswer;
      const marks = Number(question.marks || 0);
      const difficulty = ["EASY", "MEDIUM", "HARD"].includes(String(question.difficulty || "").toUpperCase())
        ? String(question.difficulty).toUpperCase()
        : "MEDIUM";
      const topic = String(question.topic || "").trim();

      let hasError = !text || marks <= 0;
      if (type === "mcq") hasError = hasError || options.length < 2 || !options.includes(String(correctAnswer));
      if (type === "true_false") hasError = hasError || typeof correctAnswer !== "boolean";
      if (["fill_blank", "paragraph"].includes(type)) hasError = hasError || !String(correctAnswer || "").trim();

      return {
        index: idx,
        type,
        text,
        options,
        correctAnswer,
        marks,
        difficulty,
        topic,
        hasError,
      };
    });
  }, [form.questions]);

  const reviewSummary = useMemo(() => {
    const totalQuestions = normalizedQuestions.length;
    const totalMarks = normalizedQuestions.reduce((sum, item) => sum + item.marks, 0);
    const byType = normalizedQuestions.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {});
    const difficulty = normalizedQuestions.reduce((acc, item) => {
      acc[item.difficulty] = (acc[item.difficulty] || 0) + 1;
      return acc;
    }, { EASY: 0, MEDIUM: 0, HARD: 0 });
    const topic = normalizedQuestions.reduce((acc, item) => {
      const key = item.topic || "Untagged";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const avgMarks = totalQuestions ? Number((totalMarks / totalQuestions).toFixed(2)) : 0;
    const timePerQuestion = totalQuestions ? Number((Number(form.durationMins || 0) / totalQuestions).toFixed(2)) : 0;
    const invalidIndexes = normalizedQuestions.filter((item) => item.hasError).map((item) => item.index + 1);
    const warnings = [];
    if (timePerQuestion > 0 && timePerQuestion < 1) warnings.push("Too many questions for the configured duration.");
    if (normalizedQuestions.some((item) => !item.topic)) warnings.push("Some questions are missing topic tags.");
    if (form.shuffleQuestions && normalizedQuestions.some((item) => item.type === "true_false")) warnings.push("True/False with question shuffle can increase accidental mismatches.");
    if (form.restrictions.enabled && Number(form.restrictions.violationThreshold || 0) > 8) warnings.push("High violation threshold may allow repeated cheating behavior.");
    if (form.restrictions.enabled && form.restrictions.devtoolsDetection && /code|programming|algorithm/i.test(String(form.subject || ""))) {
      warnings.push("Devtools detection enabled for coding-oriented test. Verify policy intent.");
    }

    return {
      totalQuestions,
      totalMarks,
      byType,
      difficulty,
      topic,
      avgMarks,
      timePerQuestion,
      invalidIndexes,
      warnings,
    };
  }, [normalizedQuestions, form.durationMins, form.shuffleQuestions, form.restrictions.devtoolsDetection, form.restrictions.enabled, form.restrictions.violationThreshold, form.subject]);

  const assignedStudentsCount = useMemo(() => {
    const pool = isSuperAdminContext ? students : visibleStudents;
    if (!Array.isArray(pool) || pool.length === 0) return 0;
    const yearScopedPool = selectedYearSet.size > 0
      ? pool.filter((student) => selectedYearSet.has(String(student.year || "")))
      : pool;
    if (form.assignmentMethod === "batch_wise") {
      return yearScopedPool.filter((student) => {
        const studentBatchIds = [...new Set([
          ...(Array.isArray(student.batchIds) ? student.batchIds : []),
          student.batchId,
        ].filter(Boolean).map(String))];
        return studentBatchIds.some((batchId) => form.batchIds.includes(batchId));
      }).length;
    }
    if (isSuperAdminContext && Array.isArray(form.departmentIds) && form.departmentIds.length > 0) {
      return yearScopedPool.filter((student) => form.departmentIds.includes(student.departmentId)).length;
    }
    if (form.departmentId) {
      return yearScopedPool.filter((student) => student.departmentId === form.departmentId).length;
    }
    return yearScopedPool.length;
  }, [students, visibleStudents, isSuperAdminContext, selectedYearSet, form.assignmentMethod, form.batchIds, form.departmentId, form.departmentIds]);

  const publishChecklist = useMemo(() => {
    const scheduleValid = Boolean(form.startsAt && form.endsAt && new Date(form.endsAt).getTime() > new Date(form.startsAt).getTime());
    const yearsSelected = selectedYears.length > 0;
    const studentsAssigned = yearsSelected && (form.assignmentMethod === "batch_wise" ? form.batchIds.length > 0 : true);
    const noErrors = reviewSummary.invalidIndexes.length === 0;
    const proctoringSet = Number(form.restrictions.violationThreshold || 0) >= 1;
    return [
      { label: "Test name exists", done: Boolean(String(form.name || "").trim()) },
      { label: "Schedule valid", done: scheduleValid },
      { label: "Students assigned", done: studentsAssigned },
      { label: "Questions added", done: reviewSummary.totalQuestions > 0 },
      { label: "No question errors", done: noErrors },
      { label: "Proctoring set", done: proctoringSet },
    ];
  }, [form, reviewSummary.invalidIndexes.length, reviewSummary.totalQuestions, selectedYears.length]);

  const getFirstErrorMessage = (nextErrors) => Object.values(nextErrors || {}).find(Boolean) || "Please complete required fields";

  const applyCurrentStepValidation = () => {
    const nextErrors = validateCurrentStep(testCreation);
    dispatch(setTestCreationErrors(nextErrors));
    return nextErrors;
  };

  const validateAllSteps = (stateSnapshot = testCreation) => {
    const allErrors = {};
    for (let currentStep = 0; currentStep < stepTitles.length - 1; currentStep += 1) {
      Object.assign(allErrors, validateCurrentStep({ ...stateSnapshot, step: currentStep }));
    }
    return allErrors;
  };

  const handleClose = () => {
    dispatch(clearTestCreationErrors());
    dispatch(setDialogOpenState(false));
  };

  const handleStepJump = (targetStep) => {
    if (targetStep <= step) {
      dispatch(setTestCreationStep(targetStep));
      return;
    }

    const nextErrors = applyCurrentStepValidation();
    if (Object.keys(nextErrors).length) {
      toast.error(getFirstErrorMessage(nextErrors));
      return;
    }

    dispatch(clearTestCreationErrors());
    dispatch(setTestCreationStep(targetStep));
  };

  const handleContinue = () => {
    const nextErrors = applyCurrentStepValidation();
    if (Object.keys(nextErrors).length) {
      toast.error(getFirstErrorMessage(nextErrors));
      return;
    }

    dispatch(clearTestCreationErrors());
    dispatch(goToNextCreationStep());
  };

  const parseBulkQuestion = (question) => {
    const type = String(question?.type || "mcq").toLowerCase();
    const normalized = {
      type,
      question: String(question?.question || "").trim(),
      options: Array.isArray(question?.options)
        ? question.options.map((option) => String(option).trim()).filter(Boolean)
        : [],
      correctAnswer: question?.correctAnswer,
      marks: Number(question?.marks || 1),
      difficulty: ["EASY", "MEDIUM", "HARD"].includes(String(question?.difficulty || "").toUpperCase())
        ? String(question.difficulty).toUpperCase()
        : "MEDIUM",
      topic: String(question?.topic || "").trim(),
      explanationVideoUrl: String(question?.explanationVideoUrl || "").trim(),
      // MODULE_TEST grouping. Kept verbatim; validated on submit / step change.
      category: question?.category == null ? "" : String(question.category).trim(),
    };

    if (type === "mcq") {
      normalized.correctAnswer = String(question?.correctAnswer || "").trim();
      return normalized;
    }

    if (type === "true_false") {
      if (typeof question?.correctAnswer === "boolean") {
        normalized.correctAnswer = question.correctAnswer;
        return normalized;
      }
      normalized.correctAnswer = String(question?.correctAnswer).toLowerCase() === "true";
      return normalized;
    }

    normalized.correctAnswer = String(question?.correctAnswer || "").trim();
    return normalized;
  };

  const handleApplyBulkJson = () => {
    try {
      const parsed = JSON.parse(bulkJson);
      if (!Array.isArray(parsed)) {
        toast.error("Bulk JSON must be an array of questions");
        return;
      }

      const questions = parsed.map(parseBulkQuestion);
      dispatch(replaceQuestionsFromBulk(questions));
      dispatch(clearTestCreationErrors());
      toast.success(`Imported ${questions.length} questions`);
    } catch {
      toast.error("Invalid JSON format");
    }
  };

  const handleSubmit = async (formOverrides = {}, options = { allowAutoOverlapRetry: true }) => {
    const nextForm = { ...form, ...formOverrides };
    const nextState = { ...testCreation, form: nextForm };

    const allErrors = validateAllSteps(nextState);
    dispatch(setTestCreationErrors(allErrors));
    if (Object.keys(allErrors).length) {
      const firstInvalidStep = Array.from({ length: stepTitles.length - 1 }).find((candidateStep) =>
        Object.keys(validateCurrentStep({ ...nextState, step: candidateStep })).length
      );
      if (typeof firstInvalidStep === "number") {
        dispatch(setTestCreationStep(firstInvalidStep));
      }
      toast.error(getFirstErrorMessage(allErrors));
      return;
    }

    Object.entries(formOverrides).forEach(([key, value]) => {
      dispatch(updateTestCreationField({ key, value }));
    });

    try {
      await dispatch(submitTestCreation(nextState)).unwrap();
      if (isSuperAdminContext) {
        if (typeof onCreated === "function") {
          await onCreated();
        }
      } else {
        dispatch(fetchAdminTests());
      }
      if (!isEditMode) {
        localStorage.removeItem(draftKey);
      }
      toast.success(isEditMode ? "Test updated successfully" : "Test created successfully");
    } catch (error) {
      const message = String(error || (isEditMode ? "Failed to update test" : "Failed to create test"));
      if (message.includes("Overlapping active test detected")) {
        if (!nextForm.skipOverlapCheck && nextForm.publishState !== "DRAFT" && options.allowAutoOverlapRetry) {
          dispatch(updateTestCreationField({ key: "skipOverlapCheck", value: true }));
          toast.info("Overlapping active test detected. Retrying publish with overlap mode enabled...");
          await handleSubmit({ ...formOverrides, skipOverlapCheck: true }, { allowAutoOverlapRetry: false });
          return;
        }

        if (!nextForm.skipOverlapCheck) {
          dispatch(updateTestCreationField({ key: "skipOverlapCheck", value: true }));
        }
        dispatch(setTestCreationStep(1));
        toast.error("Overlapping active test detected. 'Allow overlapping active tests' is now enabled. Review schedule, then publish again if intentional.");
        return;
      }
      toast.error(message);
    }
  };

  const onPrevious = () => dispatch(goToPreviousCreationStep());

  const onNext = () => handleContinue();

  const onSubmit = async (publishState) => {
    if (isSubmitting) {
      return;
    }

    const checklistFailed = publishChecklist.some((item) => !item.done);
    if (publishState !== "DRAFT" && checklistFailed) {
      toast.error("Complete pre-publish checklist before publishing.");
      return;
    }

    if (publishState !== "DRAFT") {
      const nextForm = {
        ...form,
        publishState: publishState || form.publishState,
        skipOverlapCheck: Boolean(form.skipOverlapCheck),
      };
      const nextState = { ...testCreation, form: nextForm };
      const allErrors = validateAllSteps(nextState);
      dispatch(setTestCreationErrors(allErrors));
      if (Object.keys(allErrors).length) {
        const firstInvalidStep = Array.from({ length: stepTitles.length - 1 }).find((candidateStep) =>
          Object.keys(validateCurrentStep({ ...nextState, step: candidateStep })).length
        );
        if (typeof firstInvalidStep === "number") {
          dispatch(setTestCreationStep(firstInvalidStep));
        }
        toast.error(getFirstErrorMessage(allErrors));
        return;
      }

      setPublishDialog({ open: true, publishState: publishState || form.publishState });
      return;
    }

    const overrides = {};
    if (publishState && publishState !== form.publishState) {
      overrides.publishState = publishState;
    }
    if ((publishState || form.publishState) === "DRAFT") {
      overrides.skipOverlapCheck = true;
    }
    await handleSubmit(overrides);
  };

  const confirmPublish = async () => {
    if (isConfirmPublishing || isSubmitting) {
      return;
    }

    const selectedPublishState = publishDialog.publishState || form.publishState;
    setIsConfirmPublishing(true);

    try {
      setPublishDialog((prev) => ({ ...prev, open: false }));
      resetBodyInteractionLock();
      await handleSubmit({ publishState: selectedPublishState, skipOverlapCheck: Boolean(form.skipOverlapCheck) });
    } finally {
      setIsConfirmPublishing(false);
      resetBodyInteractionLock();
    }
  };

  const handleQuestionInputModeChange = (mode) => {
    dispatch(setQuestionInputMode(mode));
    if (mode === "bulk_json") {
      setBulkJson(JSON.stringify(form.questions, null, 2));
    }
  };

  const updateQuestionOption = (index, optionIndex, value) => {
    const options = [...(form.questions[index]?.options || [])];
    options[optionIndex] = value;
    dispatch(updateQuestionRow({ index, patch: { options } }));
  };

  const addQuestionOption = (index) => {
    const options = [...(form.questions[index]?.options || []), ""];
    dispatch(updateQuestionRow({ index, patch: { options } }));
  };

  const removeQuestionOption = (index, optionIndex) => {
    const options = (form.questions[index]?.options || []).filter((_, idx) => idx !== optionIndex);
    dispatch(updateQuestionRow({ index, patch: { options } }));
  };

  const resolvedPrimaryPublishState = form.publishState && form.publishState !== "DRAFT"
    ? form.publishState
    : "PUBLISH";

  if (!open && hideTrigger) {
    return null;
  }

  if (!open) return (
    <Button
      onClick={() => {
        dispatch(setTestCreationContext(context));
        dispatch(openTestCreationDialog());
      }}
      className="bg-primary hover:bg-primary-dark"
    >
      Create Test
    </Button>
  );

  return (
    // --- OVERLAY WRAPPER ---
    // pointer-events-none: allows sidebar (z-40) and other elements outside the modal
    // to remain clickable even though this overlay sits at z-100 visually.
    <div className="fixed inset-0 z-100 bg-primary-dark/40 backdrop-blur-sm animate-in fade-in duration-200 pointer-events-none">
      
      {/* --- MODAL CONTAINER: pointer-events-auto restores interactivity for the modal itself.
            Uses sidebar-aware left offset so the sidebar remains clickable underneath the overlay.
            On mobile (< lg) the sidebar is hidden, so the modal goes full-width. --- */}
      <div className={`fixed inset-y-0 right-0 flex flex-col overflow-hidden bg-muted pointer-events-auto transition-all duration-200 ${sidebarCollapsed ? "left-0 lg:left-16" : "left-0 lg:left-64"}`}>
        
        {/* Close Button */}
        <button 
          onClick={handleClose}
          className="absolute right-4 top-4 z-50 rounded-full p-2 text-text-secondary hover:bg-muted hover:text-text-secondary lg:right-6 lg:top-6"
        >
          <X size={20} />
        </button>

        <header className="border-b border-border bg-card px-5 py-5 sm:px-6 lg:px-8">
          <div className="pr-12">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight text-text-primary">{isEditMode ? "Edit Test" : "Create Test"}</h2>
                <p className="max-w-3xl text-sm text-text-secondary">
                  Build, review, and publish assessments from a full-page workspace with guided steps and live preview.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:min-w-95">
                <div className="rounded-xl border border-border bg-background px-4 py-3 shadow-sm transition-all duration-200 hover:shadow-md">
                  <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Current Step</p>
                  <p className="mt-1 text-sm font-semibold text-text-primary">
                    {step + 1} / {stepTitles.length}
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">{stepTitles[step]}</p>
                </div>
                <div className="rounded-xl border border-border bg-background px-4 py-3 shadow-sm transition-all duration-200 hover:shadow-md">
                  <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Questions</p>
                  <p className="mt-1 text-sm font-semibold text-text-primary">{form.questions.length}</p>
                  <p className="mt-1 text-xs text-text-secondary">Ready for assessment flow</p>
                </div>
                <div className="col-span-2 rounded-xl border border-border bg-background px-4 py-3 shadow-sm transition-all duration-200 hover:shadow-md sm:col-span-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Assigned Batches</p>
                  <p className="mt-1 text-sm font-semibold text-text-primary">{form.batchIds.length}</p>
                  <p className="mt-1 text-xs text-text-secondary">Audience currently selected</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-12">
          <aside className="order-1 hidden border-r border-border bg-card px-4 py-6 lg:col-span-2 lg:block">
            <div className="space-y-3">
              {stepTitles.map((title, index) => {
                const isActive = step === index;
                const isCompleted = index < step;

                return (
                  <button
                    key={title}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleStepJump(index)}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${
                      isActive
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:border-border hover:bg-card"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : isCompleted
                            ? "bg-success text-primary-foreground"
                            : "bg-card text-text-secondary"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium text-text-secondary">{title}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* --- RIGHT PREVIEW PANEL --- */}
          <aside className="order-3 border-t border-border bg-background/70 p-4 sm:p-6 lg:col-span-3 lg:order-3 lg:border-l lg:border-t-0 lg:p-6">
            <div className="lg:sticky lg:top-6">
              <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-text-primary">Live Preview</h2>
                    <p className="mt-1 text-sm text-text-secondary">A running summary of the test you are shaping.</p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    {stepTitles[step]}
                  </span>
                </div>

                <div className="mt-6 space-y-4">
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Test Name</p>
                    <p className="wrap-break-word text-base font-semibold text-text-primary">{form.name || "Untitled Test"}</p>
                  </div>

                  {isModuleFormat ? null : (
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Subject</p>
                    <p className="wrap-break-word text-sm text-text-secondary">{form.subject || "No subject selected"}</p>
                  </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border bg-background p-4 shadow-sm transition-all duration-200 hover:bg-card">
                      <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Duration</p>
                      <p className="mt-1 text-base font-semibold text-text-primary">{form.durationMins || 0} mins</p>
                    </div>
                    <div className="rounded-xl border border-border bg-background p-4 shadow-sm transition-all duration-200 hover:bg-card">
                      <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Total Questions</p>
                      <p className="mt-1 text-base font-semibold text-text-primary">{form.questions.length}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-background p-4 shadow-sm transition-all duration-200 hover:bg-card">
                      <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Assigned Batches</p>
                      <p className="mt-1 text-base font-semibold text-text-primary">{form.batchIds.length}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-background p-4 shadow-sm transition-all duration-200 hover:bg-card">
                      <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Publish Mode</p>
                      <p className="mt-1 text-base font-semibold text-text-primary">{form.publishState}</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-primary">Auto-save enabled</p>
                    <p className="mt-1 text-xs text-primary">Your progress is saved locally in this browser.</p>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          {/* --- RIGHT CONTENT AREA --- */}
          <main className="order-2 flex min-w-0 flex-1 flex-col overflow-hidden lg:col-span-7 lg:order-2">
            <header className="border-b border-border bg-card px-4 py-4 lg:hidden">
              <h3 className="text-lg font-semibold text-text-primary">{stepTitles[step]}</h3>
            </header>

          {/* Scrollable Form Body */}
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
            <div className="space-y-6">

              {isNonDraftEdit && (
                <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-text-primary">
                  <p className="font-semibold">
                    This test is {String(editingTestStatus || "").toLowerCase()} — settings-only edit
                  </p>
                  <p className="mt-1 text-text-secondary">
                    You can update the schedule, proctoring, attempts, marking and other settings.
                    Questions and batch/department assignments are locked after publishing and
                    any changes to them here will not be saved.
                  </p>
                </div>
              )}

              {/* Step 0: Basic Info */}
              {step === 0 && (
                <section className="space-y-6 rounded-xl border border-border bg-card p-5 shadow-xs animate-in slide-in-from-bottom-2 motion-reduce:animate-none lg:p-6">
                  <header className="space-y-2">
                    <h1 className="text-lg font-semibold text-text-primary">Basic Information</h1>
                    <p className="text-sm text-text-secondary">Define the core identity of your test.</p>
                  </header>
                  <div className="space-y-6">

                    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                      <div className="space-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Overview</h2>
                        <p className="text-sm text-text-secondary">Name your test and describe what it covers.</p>
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="test-name" className="text-sm text-text-secondary">Test Title <span className="text-danger">*</span></label>
                        <Input
                          id="test-name"
                          placeholder="e.g. End Semester Theory"
                          value={form.name}
                          onChange={(e) => dispatch(updateTestCreationField({ key: "name", value: e.target.value }))}
                        />
                        {errors.name ? <p className="text-xs text-danger">{errors.name}</p> : null}
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="test-description" className="text-sm text-text-secondary">Description</label>
                        <Textarea
                          id="test-description"
                          rows={4}
                          placeholder="Add a short overview or topic coverage for this test"
                          value={form.description}
                          onChange={(e) => dispatch(updateTestCreationField({ key: "description", value: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                      <div className="space-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Assessment Setup</h2>
                        <p className="text-sm text-text-secondary">Choose how the test is structured and what students see before they start.</p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm text-text-secondary">Assessment Format <span className="text-danger">*</span></label>
                        <Select
                          value={normalizeAssessmentFormat(form.assessmentFormat)}
                          onValueChange={(v) => dispatch(updateTestCreationField({ key: "assessmentFormat", value: normalizeAssessmentFormat(v) }))}
                        >
                          <SelectTrigger className="w-full" aria-label="Assessment Format"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ASSESSMENT_FORMATS.OPEN_TEST}>Open Test (single question set)</SelectItem>
                            <SelectItem value={ASSESSMENT_FORMATS.MODULE_TEST}>Module Test (Quant → Reasoning → Verbal)</SelectItem>
                          </SelectContent>
                        </Select>
                        {isModuleFormat ? (
                          <p className="text-xs text-text-secondary">
                            Imported questions must include a <code>category</code> field set to one of:{" "}
                            {ALLOWED_MODULE_CATEGORIES.join(", ")}. Each module runs on its own independent timer.
                          </p>
                        ) : null}
                      </div>

                      {isModuleFormat ? null : (
                        <div className="space-y-2">
                          <label className="text-sm text-text-secondary">Subject Category <span className="text-danger">*</span></label>
                          <Select value={form.subject} onValueChange={(v) => dispatch(updateTestCreationField({ key: "subject", value: v }))}>
                            <SelectTrigger className="w-full" aria-label="Subject Category"><SelectValue placeholder="Select a subject" /></SelectTrigger>
                            <SelectContent>
                              {SUBJECT_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {errors.subject ? <p className="text-xs text-danger">{errors.subject}</p> : null}
                        </div>
                      )}

                      <div className="space-y-2">
                        <label htmlFor="test-instructions" className="text-sm text-text-secondary">Student Instructions</label>
                        <Textarea
                          id="test-instructions"
                          rows={6}
                          placeholder="One instruction per line. Students must agree before starting."
                          value={form.instructions}
                          onChange={(e) => dispatch(updateTestCreationField({ key: "instructions", value: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                      <div className="space-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Scoring &amp; Timing</h2>
                        <p className="text-sm text-text-secondary">Set the marks budget and how long the test runs.</p>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <label htmlFor="test-total-marks" className="text-sm text-text-secondary">Total Marks <span className="text-danger">*</span></label>
                          <Input
                            id="test-total-marks"
                            type="number"
                            min={1}
                            value={form.totalMarks}
                            onChange={(e) => dispatch(updateTestCreationField({ key: "totalMarks", value: Number(e.target.value) }))}
                          />
                          {errors.totalMarks ? <p className="text-xs text-danger">{errors.totalMarks}</p> : null}
                        </div>
                        {isModuleFormat ? (
                          <div className="space-y-2">
                            <span className="text-sm text-text-secondary">Total Duration (Mins)</span>
                            <div className="flex h-10 items-center rounded-xl border border-border bg-muted px-3 text-sm font-medium text-text-secondary">
                              {sumModuleDurations(form.moduleDurations)} mins
                            </div>
                            <p className="text-xs text-text-secondary">Auto-calculated from the module durations below.</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <label htmlFor="test-duration-mins" className="text-sm text-text-secondary">Duration (Mins) <span className="text-danger">*</span></label>
                            <Input
                              id="test-duration-mins"
                              type="number"
                              min={5}
                              value={form.durationMins}
                              onChange={(e) => dispatch(updateTestCreationField({ key: "durationMins", value: Number(e.target.value) }))}
                            />
                            {errors.durationMins ? <p className="text-xs text-danger">{errors.durationMins}</p> : null}
                          </div>
                        )}
                      </div>

                      {isModuleFormat ? (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <h3 className="text-sm font-medium text-text-primary">Module Durations (minutes)</h3>
                            <p className="text-xs text-text-secondary">Each module runs on its own independent timer, in this order.</p>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            {MODULE_DEFINITIONS.map((mod) => (
                              <div key={mod.key} className="space-y-1">
                                <label htmlFor={`module-duration-${mod.key}`} className="text-xs text-text-secondary">{mod.order}. {mod.name}</label>
                                <Input
                                  id={`module-duration-${mod.key}`}
                                  type="number"
                                  min={1}
                                  value={form.moduleDurations?.[mod.key] ?? ""}
                                  onChange={(e) => dispatch(updateModuleDuration({ key: mod.key, value: e.target.value === "" ? "" : Number(e.target.value) }))}
                                />
                              </div>
                            ))}
                          </div>
                          {errors.moduleDurations ? <p className="text-xs text-danger">{errors.moduleDurations}</p> : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </section>
              )}

              {step === 1 && (
                <section className="space-y-6 rounded-xl border border-border bg-card p-5 shadow-xs animate-in slide-in-from-bottom-2 motion-reduce:animate-none lg:p-6">
                  <header className="space-y-2">
                    <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Clock className="h-5 w-5 text-primary" /> Timing & Attempts</h1>
                    <p className="text-sm text-text-secondary">Set schedule and attempt evaluation rules.</p>
                  </header>

                  <div className="space-y-6">
                    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                      <div className="space-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Schedule</h2>
                        <p className="text-sm text-text-secondary">When the test window opens and closes.</p>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <label htmlFor="test-starts-at" className="text-sm text-text-secondary">Starts At <span className="text-danger">*</span></label>
                          <Input
                            id="test-starts-at"
                            type="datetime-local"
                            value={form.startsAt}
                            onChange={(e) => dispatch(updateTestCreationField({ key: "startsAt", value: e.target.value }))}
                          />
                          {errors.startsAt ? <p className="text-xs text-danger">{errors.startsAt}</p> : null}
                        </div>
                        <div className="space-y-2">
                          <label htmlFor="test-ends-at" className="text-sm text-text-secondary">Ends At <span className="text-danger">*</span></label>
                          <Input
                            id="test-ends-at"
                            type="datetime-local"
                            value={form.endsAt}
                            onChange={(e) => dispatch(updateTestCreationField({ key: "endsAt", value: e.target.value }))}
                          />
                          {errors.endsAt ? <p className="text-xs text-danger">{errors.endsAt}</p> : null}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                      <div className="space-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Attempts &amp; Marking</h2>
                        <p className="text-sm text-text-secondary">How many times a student may sit the test, and how wrong answers are scored.</p>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <label htmlFor="test-attempts-allowed" className="text-sm text-text-secondary">Attempts Allowed <span className="text-danger">*</span></label>
                          <Input
                            id="test-attempts-allowed"
                            type="number"
                            min={1}
                            max={10}
                            value={form.attemptsAllowed}
                            onChange={(e) => dispatch(updateTestCreationField({ key: "attemptsAllowed", value: Number(e.target.value) }))}
                          />
                          {errors.attemptsAllowed ? <p className="text-xs text-danger">{errors.attemptsAllowed}</p> : null}
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm text-text-secondary">Evaluation Rule <span className="text-danger">*</span></label>
                          <Select
                            value={form.evaluationRule}
                            onValueChange={(value) => dispatch(updateTestCreationField({ key: "evaluationRule", value }))}
                          >
                            <SelectTrigger className="w-full" aria-label="Evaluation Rule"><SelectValue placeholder="Select rule" /></SelectTrigger>
                            <SelectContent>
                              {EVALUATION_RULE_OPTIONS.map((item) => (
                                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="flex items-center justify-between rounded-xl border border-border bg-muted px-4 py-3">
                          <span className="text-sm text-text-secondary">Negative Marking</span>
                          <Switch
                            checked={Boolean(form.negativeMarkingEnabled)}
                            onCheckedChange={(value) => dispatch(updateTestCreationField({ key: "negativeMarkingEnabled", value }))}
                          />
                        </label>
                        <div className="space-y-2">
                          <label htmlFor="test-negative-marks" className="text-sm text-text-secondary">Marks Deducted Per Wrong Answer</label>
                          <Input
                            id="test-negative-marks"
                            type="number"
                            min={0}
                            step="0.25"
                            disabled={!form.negativeMarkingEnabled}
                            value={form.negativeMarks}
                            onChange={(e) => dispatch(updateTestCreationField({ key: "negativeMarks", value: Number(e.target.value) }))}
                          />
                          {errors.negativeMarks ? <p className="text-xs text-danger">{errors.negativeMarks}</p> : null}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                      <div className="space-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Overlap Policy</h2>
                        <p className="text-sm text-text-secondary">Control whether this test may run alongside other active tests.</p>
                      </div>
                      <label className="flex items-center justify-between rounded-xl border border-warning/30 bg-warning/10/70 px-4 py-3 text-sm text-text-secondary">
                        <span>
                          Allow overlapping active tests
                          <span className="mt-1 block text-xs text-text-secondary">Use only if overlapping schedules are intentionally required.</span>
                        </span>
                        <Checkbox
                          checked={Boolean(form.skipOverlapCheck)}
                          onCheckedChange={(checked) => dispatch(updateTestCreationField({ key: "skipOverlapCheck", value: checked === true }))}
                        />
                      </label>
                    </div>
                  </div>
                </section>
              )}

              {step === 2 && (
                <section className="space-y-6 rounded-xl border border-border bg-card p-5 shadow-xs animate-in slide-in-from-bottom-2 motion-reduce:animate-none lg:p-6">
                  <header className="space-y-2">
                    <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Users className="h-5 w-5 text-primary" /> Assignment</h1>
                    <p className="text-sm text-text-secondary">Choose one audience method: all students in your department or batch-wise assignment.</p>
                  </header>

                  <div className="space-y-6">
                    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-1">
                          <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Student Year</h2>
                          <p className="text-sm text-text-secondary">Select one or more years before choosing department or batch assignment.</p>
                        </div>
                        <span className="text-xs font-medium text-text-secondary">{selectedYears.length} selected</span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-4">
                        {STUDENT_YEAR_OPTIONS.map((year) => (
                          <label
                            key={year.value}
                            className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition-all ${
                              selectedYearSet.has(String(year.value))
                                ? "border-primary bg-primary/10 text-text-primary"
                                : "border-border bg-card text-text-secondary hover:border-border"
                            }`}
                          >
                            <span>{year.label}</span>
                            <Checkbox
                              checked={selectedYearSet.has(String(year.value))}
                              onCheckedChange={() => toggleStudentYear(year.value)}
                            />
                          </label>
                        ))}
                      </div>
                      {errors.years ? <p className="text-xs text-danger">{errors.years}</p> : null}
                    </div>

                    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                      <div className="space-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Targeting Method</h2>
                        <p className="text-sm text-text-secondary">Pick how this test reaches students — everyone in a department, or specific batches.</p>
                      </div>

                      {isSuperAdminContext ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => {
                              dispatch(updateTestCreationField({ key: "assignmentMethod", value: "department_wise" }));
                              dispatch(updateTestCreationField({ key: "batchIds", value: [] }));
                            }}
                            className={`rounded-xl border px-4 py-3 text-left transition-all ${
                              form.assignmentMethod === "department_wise"
                                ? "border-primary bg-primary/15"
                                : "border-border bg-card hover:border-border"
                            }`}
                          >
                            <p className="text-sm font-semibold text-text-primary">Department-wise</p>
                            <p className="mt-1 text-xs text-text-secondary">Assign by department across selected colleges.</p>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              dispatch(updateTestCreationField({ key: "assignmentMethod", value: "batch_wise" }));
                              dispatch(updateTestCreationField({ key: "departmentIds", value: [] }));
                            }}
                            className={`rounded-xl border px-4 py-3 text-left transition-all ${
                              form.assignmentMethod === "batch_wise"
                                ? "border-primary bg-primary/15"
                                : "border-border bg-card hover:border-border"
                            }`}
                          >
                            <p className="text-sm font-semibold text-text-primary">Batch-wise</p>
                            <p className="mt-1 text-xs text-text-secondary">Assign to specific batches in selected colleges.</p>
                          </button>
                        </div>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => {
                              dispatch(updateTestCreationField({ key: "assignmentMethod", value: "department_wise" }));
                              dispatch(updateTestCreationField({ key: "batchIds", value: [] }));
                              if (currentUserDeptId) {
                                dispatch(updateTestCreationField({ key: "departmentId", value: currentUserDeptId }));
                              }
                            }}
                            className={`rounded-xl border px-4 py-3 text-left transition-all ${
                              form.assignmentMethod === "department_wise"
                                ? "border-primary bg-primary/10"
                                : "border-border bg-card hover:border-border"
                            }`}
                          >
                            <p className="text-sm font-semibold text-text-primary">All students in your department</p>
                            <p className="mt-1 text-xs text-text-secondary">Assign to every student within your department.</p>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              dispatch(updateTestCreationField({ key: "assignmentMethod", value: "batch_wise" }));
                              if (currentUserDeptId) {
                                dispatch(updateTestCreationField({ key: "departmentId", value: currentUserDeptId }));
                              }
                            }}
                            className={`rounded-xl border px-4 py-3 text-left transition-all ${
                              form.assignmentMethod === "batch_wise"
                                ? "border-primary bg-primary/10"
                                : "border-border bg-card hover:border-border"
                            }`}
                          >
                            <p className="text-sm font-semibold text-text-primary">Batch-wise assignment</p>
                            <p className="mt-1 text-xs text-text-secondary">Select specific batches in your department.</p>
                          </button>
                        </div>
                      )}
                    </div>

                    {isSuperAdminContext ? (
                      <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                        <div className="space-y-1">
                          <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Colleges, Departments &amp; Batches</h2>
                          <p className="text-sm text-text-secondary">Narrow the audience. Options update as you pick a targeting method above.</p>
                        </div>

                        <label className="flex items-center gap-2 text-sm text-text-primary">
                          <input
                            type="checkbox"
                            checked={Boolean(form.allColleges)}
                            onChange={(event) => dispatch(updateTestCreationField({ key: "allColleges", value: event.target.checked }))}
                          />
                          Assign to all colleges
                        </label>
                        {!form.allColleges ? (
                          <div className="space-y-2">
                            <label className="text-sm text-text-secondary">Select colleges</label>
                            <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-border bg-card p-3">
                              {colleges.map((college) => (
                                <label key={college.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm text-text-secondary">
                                  <span>{college.name}</span>
                                  <Checkbox
                                    checked={Array.isArray(form.collegeIds) && form.collegeIds.includes(college.id)}
                                    onCheckedChange={(checked) => {
                                      const existing = Array.isArray(form.collegeIds) ? form.collegeIds : [];
                                      const next = checked
                                        ? [...new Set([...existing, college.id])]
                                        : existing.filter((id) => id !== college.id);
                                      dispatch(updateTestCreationField({ key: "collegeIds", value: next }));
                                    }}
                                  />
                                </label>
                              ))}
                            </div>
                            {errors.collegeIds ? <p className="text-xs text-danger">{errors.collegeIds}</p> : null}
                          </div>
                        ) : null}

                        {form.assignmentMethod === "department_wise" && hasSuperAdminCollegeScope ? (
                          <div className="space-y-2">
                            <label className="text-sm text-text-secondary">Departments</label>
                            <div className="max-h-60 space-y-3 overflow-y-auto rounded-xl border border-border bg-card p-3">
                              {Object.values(groupedDepartmentsByCollege).map((group) => (
                                <div key={group.collegeId} className="space-y-2">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{group.collegeName}</p>
                                  {group.items.map((department) => (
                                    <label key={department.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm text-text-secondary">
                                      <span>{department.name} <span className="text-xs text-text-secondary">(Students: {department?._count?.students || 0})</span></span>
                                      <Checkbox
                                        checked={Array.isArray(form.departmentIds) && form.departmentIds.includes(department.id)}
                                        onCheckedChange={(checked) => {
                                          const existing = Array.isArray(form.departmentIds) ? form.departmentIds : [];
                                          const next = checked === true
                                            ? [...new Set([...existing, department.id])]
                                            : existing.filter((id) => id !== department.id);
                                          dispatch(updateTestCreationField({ key: "departmentIds", value: next }));
                                        }}
                                      />
                                    </label>
                                  ))}
                                </div>
                              ))}
                              {scopedSuperDepartments.length === 0 ? <p className="px-1 py-2 text-xs text-text-secondary">No departments available for current college scope.</p> : null}
                            </div>
                          </div>
                        ) : null}

                        {form.assignmentMethod === "batch_wise" ? (
                          <div className="space-y-2">
                            <label className="text-sm text-text-secondary">Batches</label>
                            {!hasSuperAdminCollegeScope ? (
                              <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                                Select at least one college above to view its batches.
                              </div>
                            ) : (
                              <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border border-border bg-card p-3">
                                {visibleSuperBatches.map((batch) => (
                                  <label key={batch.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm text-text-secondary">
                                    <span>{batch.name} <span className="text-xs text-text-secondary">(Students: {batch?._count?.students || 0})</span></span>
                                    <Checkbox
                                      checked={Array.isArray(form.batchIds) && form.batchIds.includes(batch.id)}
                                      onCheckedChange={(checked) => {
                                        const existing = Array.isArray(form.batchIds) ? form.batchIds : [];
                                        const next = checked === true
                                          ? [...new Set([...existing, batch.id])]
                                          : existing.filter((id) => id !== batch.id);
                                        dispatch(updateTestCreationField({ key: "batchIds", value: next }));
                                      }}
                                    />
                                  </label>
                                ))}
                                {visibleSuperBatches.length === 0 ? <p className="px-1 py-2 text-xs text-text-secondary">No batches found for selected colleges.</p> : null}
                              </div>
                            )}
                            {errors.batchIds ? <p className="text-xs text-danger">{errors.batchIds}</p> : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {!isSuperAdminContext ? (
                      <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                        <div className="space-y-1">
                          <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Audience</h2>
                          <p className="text-sm text-text-secondary">Confirm who this test is assigned to.</p>
                        </div>

                        {form.assignmentMethod === "department_wise" ? (
                          <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
                            This test will be assigned to all students in <strong>{visibleDepartments.find((department) => department.id === form.departmentId)?.name || "your department"}</strong>.
                          </div>
                        ) : null}

                        {form.assignmentMethod === "batch_wise" ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <label className="text-sm text-text-secondary">Batches</label>
                              <span className="text-xs font-medium text-text-secondary">{form.batchIds.length} selected</span>
                            </div>

                            <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl border border-border bg-card p-3">
                              {filteredBatches.length ? filteredBatches.map((batch) => (
                                <label key={batch.id} className="flex cursor-pointer items-center justify-between rounded-xl border border-border bg-background px-4 py-3 transition-all hover:border-primary/40">
                                  <div>
                                    <p className="text-sm font-medium text-text-primary">{batch.name}</p>
                                    <p className="text-xs text-text-secondary">Year {batch.year || "-"}</p>
                                  </div>
                                  <Checkbox
                                    checked={form.batchIds.includes(batch.id)}
                                    onCheckedChange={() => dispatch(toggleBatchId(batch.id))}
                                  />
                                </label>
                              )) : (
                                <p className="py-10 text-center text-sm text-text-secondary">No batches found for selected department.</p>
                              )}
                            </div>
                            {errors.batchIds ? <p className="text-xs text-danger">{errors.batchIds}</p> : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </section>
              )}

              {step === 3 && (
                    <section className="space-y-6 rounded-xl border border-border bg-card p-5 shadow-xs animate-in slide-in-from-bottom-2 motion-reduce:animate-none lg:p-6">
                      <header className="flex items-center justify-between">
                        <div>
                          <h1 className="text-lg font-semibold text-text-primary">Question Bank</h1>
                          <p className="text-sm text-text-secondary">Add questions manually or via JSON upload.</p>
                        </div>
                        <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-text-secondary">
                          {form.questions.length} Added
                        </span>
                      </header>
                      {errors.questions ? <p className="text-xs text-danger">{errors.questions}</p> : null}

                      <Tabs value={form.questionInputMode} onValueChange={handleQuestionInputModeChange}>
                        <TabsList className="h-auto w-full justify-start gap-2 rounded-xl bg-muted p-1">
                          <TabsTrigger className="h-10 flex-none rounded-lg px-4 data-active:bg-card data-active:text-text-primary data-active:shadow-sm" value="manual">Manual Entry</TabsTrigger>
                          <TabsTrigger className="h-10 flex-none rounded-lg px-4 data-active:bg-card data-active:text-text-primary data-active:shadow-sm" value="bulk_json">Bulk JSON</TabsTrigger>
                          <TabsTrigger className="h-10 flex-none rounded-lg px-4 data-active:bg-card data-active:text-text-primary data-active:shadow-sm" value="question_bank">Question Bank</TabsTrigger>
                        </TabsList>

                        <TabsContent value="manual" className="mt-6 space-y-4">
                          {form.questions.slice(0, questionRenderLimit).map((q, idx) => (
                            <div key={idx} className="group relative rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/30 sm:p-6">
                              <div className="mb-4 flex items-center justify-between">
                                <span className="text-xs font-bold uppercase tracking-widest text-primary">Question {idx + 1}</span>
                                <button onClick={() => dispatch(removeQuestionRow(idx))} className="text-text-secondary hover:text-danger">
                                  <X size={16} />
                                </button>
                              </div>
                              <div className="space-y-2">
                                <label htmlFor={`question-${idx}-prompt`} className="text-sm text-text-secondary">Question <span className="text-danger">*</span></label>
                                <Input
                                  id={`question-${idx}-prompt`}
                                  className="text-base font-medium"
                                  placeholder="Type your question here..."
                                  value={q.question}
                                  onChange={(e) => dispatch(updateQuestionRow({ index: idx, patch: { question: e.target.value } }))}
                                />
                              </div>

                              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                  <label className="text-sm text-text-secondary">Question Type <span className="text-danger">*</span></label>
                                  <Select
                                    value={q.type}
                                    onValueChange={(value) => dispatch(updateQuestionRow({ index: idx, patch: { type: value, options: value === "mcq" ? (q.options?.length ? q.options : ["", ""]) : [], correctAnswer: value === "true_false" ? false : "" } }))}
                                  >
                                    <SelectTrigger className="w-full" aria-label={`Question ${idx + 1} type`}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {QUESTION_TYPE_OPTIONS.map((item) => (
                                        <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div className="space-y-2">
                                  <label htmlFor={`question-${idx}-marks`} className="text-sm text-text-secondary">Marks <span className="text-danger">*</span></label>
                                  <Input
                                    id={`question-${idx}-marks`}
                                    type="number"
                                    min={1}
                                    value={q.marks}
                                    onChange={(e) => dispatch(updateQuestionRow({ index: idx, patch: { marks: Number(e.target.value) } }))}
                                  />
                                </div>
                              </div>

                              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                  <label className="text-sm text-text-secondary">Difficulty</label>
                                  <Select
                                    value={String(q.difficulty || "MEDIUM")}
                                    onValueChange={(value) => dispatch(updateQuestionRow({ index: idx, patch: { difficulty: value } }))}
                                  >
                                    <SelectTrigger className="w-full" aria-label={`Question ${idx + 1} difficulty`}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {DIFFICULTY_OPTIONS.map((item) => (
                                        <SelectItem key={`${idx}-${item}`} value={item}>{item}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-2">
                                  <label htmlFor={`question-${idx}-topic`} className="text-sm text-text-secondary">Topic Tag</label>
                                  <Input
                                    id={`question-${idx}-topic`}
                                    value={String(q.topic || "")}
                                    placeholder="e.g. Arrays"
                                    onChange={(e) => dispatch(updateQuestionRow({ index: idx, patch: { topic: e.target.value } }))}
                                  />
                                </div>
                                {isModuleFormat ? (
                                  <div className="space-y-2">
                                    <label className="text-sm text-text-secondary">Module Category <span className="text-danger">*</span></label>
                                    <Select
                                      value={String(q.category || "")}
                                      onValueChange={(value) => dispatch(updateQuestionRow({ index: idx, patch: { category: value } }))}
                                    >
                                      <SelectTrigger className="w-full" aria-label={`Question ${idx + 1} module category`}><SelectValue placeholder="Select category" /></SelectTrigger>
                                      <SelectContent>
                                        {ALLOWED_MODULE_CATEGORIES.map((category) => (
                                          <SelectItem key={category} value={category}>{category}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                ) : null}
                              </div>

                              <div className="mt-4 space-y-2">
                                <label htmlFor={`question-${idx}-video`} className="text-sm text-text-secondary">Explanation video (optional)</label>
                                <Input
                                  id={`question-${idx}-video`}
                                  type="url"
                                  value={String(q.explanationVideoUrl || "")}
                                  placeholder="https://youtube.com/watch?v=..."
                                  onChange={(e) => dispatch(updateQuestionRow({ index: idx, patch: { explanationVideoUrl: e.target.value } }))}
                                />
                                <p className="text-xs text-text-secondary">
                                  Students can open this video from their results page. Leave blank if there is no explanation.
                                </p>
                              </div>

                              {q.type === "mcq" && (
                                <div className="mt-4 space-y-3">
                                  <p className="text-sm text-text-secondary">Options <span className="text-danger">*</span></p>
                                  <div className="space-y-2">
                                    {(q.options || []).map((option, optionIndex) => (
                                      <div key={`${idx}-${optionIndex}`} className="flex gap-2">
                                        <Input
                                          value={option}
                                          placeholder={`Option ${optionIndex + 1}`}
                                          onChange={(e) => updateQuestionOption(idx, optionIndex, e.target.value)}
                                        />
                                        <Button
                                          type="button"
                                          variant="outline"
                                          onClick={() => removeQuestionOption(idx, optionIndex)}
                                          disabled={(q.options || []).length <= 2}
                                        >
                                          Remove
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                  <Button type="button" variant="outline" onClick={() => addQuestionOption(idx)}>+ Add Option</Button>

                                  <div className="space-y-2">
                                    <label className="text-sm text-text-secondary">Correct Answer <span className="text-danger">*</span></label>
                                    <Select
                                      value={String(q.correctAnswer || "")}
                                      onValueChange={(value) => dispatch(updateQuestionRow({ index: idx, patch: { correctAnswer: value } }))}
                                    >
                                      <SelectTrigger className="w-full" aria-label={`Question ${idx + 1} correct answer`}><SelectValue placeholder="Select correct option" /></SelectTrigger>
                                      <SelectContent>
                                        {(q.options || []).filter(Boolean).map((option) => (
                                          <SelectItem key={option} value={option}>{option}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                              )}

                              {q.type === "true_false" && (
                                <div className="mt-4 space-y-2">
                                  <label className="text-sm text-text-secondary">Correct Answer <span className="text-danger">*</span></label>
                                  <Select
                                    value={String(Boolean(q.correctAnswer))}
                                    onValueChange={(value) => dispatch(updateQuestionRow({ index: idx, patch: { correctAnswer: value === "true" } }))}
                                  >
                                    <SelectTrigger className="w-full" aria-label={`Question ${idx + 1} correct answer`}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="true">True</SelectItem>
                                      <SelectItem value="false">False</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}

                              {(q.type === "fill_blank" || q.type === "paragraph") && (
                                <div className="mt-4 space-y-2">
                                  <label htmlFor={`question-${idx}-answer`} className="text-sm text-text-secondary">Correct Answer <span className="text-danger">*</span></label>
                                  <Textarea
                                    id={`question-${idx}-answer`}
                                    rows={q.type === "paragraph" ? 4 : 2}
                                    placeholder="Add the expected answer"
                                    value={String(q.correctAnswer || "")}
                                    onChange={(e) => dispatch(updateQuestionRow({ index: idx, patch: { correctAnswer: e.target.value } }))}
                                  />
                                </div>
                              )}
                            </div>
                          ))}
                          <Button variant="outline" className="w-full border-dashed" onClick={() => dispatch(addQuestionRow())}>
                            + Add New Question
                          </Button>
                          {questionRenderLimit < form.questions.length ? (
                            <Button
                              variant="ghost"
                              className="w-full"
                              onClick={() => dispatch(increaseQuestionRenderLimit())}
                            >
                              Load More Questions
                            </Button>
                          ) : null}
                        </TabsContent>

                        <TabsContent value="bulk_json" className="mt-6 space-y-4">
                          <div className="rounded-xl border border-border bg-background p-4">
                            <div className="space-y-1">
                              <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Bulk Import</h2>
                              <p className="text-sm text-text-secondary">Paste an array of questions. Each item should include: type, question, options (for mcq), correctAnswer, marks.</p>
                              {isModuleFormat ? (
                                <p className="text-sm text-text-secondary">
                                  For Module Tests every question must also include a <code>category</code> of{" "}
                                  {ALLOWED_MODULE_CATEGORIES.map((c) => `"${c}"`).join(", ")}. All three modules must have at least one question.
                                </p>
                              ) : null}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label htmlFor="bulk-json-input" className="sr-only">Bulk question JSON</label>
                            <Textarea
                              id="bulk-json-input"
                              className="min-h-80 font-mono text-xs"
                              value={bulkJson}
                              onChange={(e) => setBulkJson(e.target.value)}
                              placeholder={
                                isModuleFormat
                                  ? '[{"type":"mcq","question":"2+2?","options":["3","4"],"correctAnswer":"4","marks":1,"category":"Quantitative Aptitude"}]'
                                  : '[{"type":"mcq","question":"2+2?","options":["3","4"],"correctAnswer":"4","marks":1}]'
                              }
                            />
                          </div>
                          <Button onClick={handleApplyBulkJson}>Apply JSON</Button>
                        </TabsContent>

                        <TabsContent value="question_bank" className="mt-6 space-y-4">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <label className="text-sm text-text-secondary">Subject</label>
                              <Select
                                value={qb.filters.subjectId || ""}
                                onValueChange={(value) => {
                                  setQbPage(1);
                                  dispatch(qbSetFilters({ subjectId: value }));
                                }}
                              >
                                <SelectTrigger className="w-full" aria-label="Question bank subject"><SelectValue placeholder="Select subject" /></SelectTrigger>
                                <SelectContent>
                                  {qb.subjects.map((subject) => (
                                    <SelectItem key={subject.id} value={subject.id}>{subject.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-2">
                              <label htmlFor="qb-search" className="text-sm text-text-secondary">Search</label>
                              <Input
                                id="qb-search"
                                placeholder="Search question"
                                value={qb.filters.search || ""}
                                onChange={(e) => dispatch(qbSetFilters({ search: e.target.value }))}
                              />
                            </div>

                            <div className="space-y-2">
                              <label className="text-sm text-text-secondary">Difficulty</label>
                              <Select
                                value={qb.filters.difficulty || "all"}
                                onValueChange={(value) => dispatch(qbSetFilters({ difficulty: value }))}
                              >
                                <SelectTrigger className="w-full" aria-label="Question bank difficulty"><SelectValue placeholder="Difficulty" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">All Difficulty</SelectItem>
                                  <SelectItem value="EASY">Easy</SelectItem>
                                  <SelectItem value="MEDIUM">Medium</SelectItem>
                                  <SelectItem value="HARD">Hard</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="flex items-end">
                              <Button
                                className="w-full"
                                variant="outline"
                                onClick={() => {
                                  const subjectId = qb.filters.subjectId || qb.subjects[0]?.id || "";
                                  if (!subjectId) return;
                                  dispatch(qbFetchQuestions({ filters: { ...qb.filters, subjectId }, page: 1, limit: qb.pagination.limit }));
                                }}
                              >
                                Apply
                              </Button>
                            </div>
                          </div>

                          <div className="max-h-96 space-y-2 overflow-y-auto rounded-xl border border-border p-3">
                            {qb.loading ? <p className="text-sm text-text-secondary">Loading question bank...</p> : null}
                            {qb.questions.map((item) => (
                              <label key={item.id} className="flex items-start gap-3 rounded-lg border border-border p-3 hover:bg-background">
                                <Checkbox checked={qb.selected.includes(item.id)} onCheckedChange={() => dispatch(qbToggleSelected(item.id))} />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-text-primary">{item.prompt}</p>
                                  <p className="mt-1 text-xs text-text-secondary">
                                    {String(item.type || "").toLowerCase()} | {item.difficulty} | {item.marks} marks
                                  </p>
                                </div>
                              </label>
                            ))}
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-text-secondary">Selected: {qb.selected.length}</p>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                disabled={qb.pagination.page <= 1}
                                onClick={() => {
                                  const next = Math.max(1, qb.pagination.page - 1);
                                  setQbPage(next);
                                  const subjectId = qb.filters.subjectId || qb.subjects[0]?.id || "";
                                  if (!subjectId) return;
                                  dispatch(qbFetchQuestions({ filters: { ...qb.filters, subjectId }, page: next, limit: qb.pagination.limit }));
                                }}
                              >
                                Prev
                              </Button>
                              <span className="text-xs text-text-secondary">{qb.pagination.page} / {qb.pagination.totalPages}</span>
                              <Button
                                variant="outline"
                                disabled={qb.pagination.page >= qb.pagination.totalPages}
                                onClick={() => {
                                  const next = qb.pagination.page + 1;
                                  setQbPage(next);
                                  const subjectId = qb.filters.subjectId || qb.subjects[0]?.id || "";
                                  if (!subjectId) return;
                                  dispatch(qbFetchQuestions({ filters: { ...qb.filters, subjectId }, page: next, limit: qb.pagination.limit }));
                                }}
                              >
                                Next
                              </Button>
                            </div>
                          </div>

                          <Button
                            onClick={() => {
                              const picked = qb.questions.filter((item) => qb.selected.includes(item.id));
                              if (picked.length === 0) {
                                toast.error("Select at least one question from bank");
                                return;
                              }
                              dispatch(addQuestionsFromBank(picked));
                              toast.success(`${picked.length} question(s) added to test`);
                            }}
                          >
                            Add to Test
                          </Button>
                        </TabsContent>
                      </Tabs>
                    </section>
                  )}

              {step === 4 && (
                <section className="space-y-6 rounded-xl border border-border bg-card p-5 shadow-xs animate-in slide-in-from-bottom-2 motion-reduce:animate-none lg:p-6">
                  <header className="space-y-2">
                    <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Eye className="h-5 w-5 text-primary" /> Review & Validation</h1>
                    <p className="text-sm text-text-secondary">Audit distribution, detect blockers, and quick-edit question metadata before proctoring setup.</p>
                  </header>

                  <div className="space-y-6">
                    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                      <div className="space-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Distribution</h2>
                        <p className="text-sm text-text-secondary">How the question bank is spread across types, difficulty and topics.</p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-border bg-card p-4">
                          <p className="text-xs uppercase tracking-wide text-text-secondary">Total Questions</p>
                          <p className="mt-1 text-xl font-semibold text-text-primary">{reviewSummary.totalQuestions}</p>
                        </div>
                        <div className="rounded-xl border border-border bg-card p-4">
                          <p className="text-xs uppercase tracking-wide text-text-secondary">Total Marks</p>
                          <p className="mt-1 text-xl font-semibold text-text-primary">{reviewSummary.totalMarks}</p>
                        </div>
                        <div className="rounded-xl border border-border bg-card p-4">
                          <p className="text-xs uppercase tracking-wide text-text-secondary">Avg Marks / Question</p>
                          <p className="mt-1 text-xl font-semibold text-text-primary">{reviewSummary.avgMarks}</p>
                        </div>
                        <div className="rounded-xl border border-border bg-card p-4">
                          <p className="text-xs uppercase tracking-wide text-text-secondary">Time Per Question</p>
                          <p className="mt-1 text-xl font-semibold text-text-primary">{reviewSummary.timePerQuestion} min</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-sm text-text-secondary">Question Type Mix</p>
                        <div className="flex flex-wrap gap-2 text-xs">
                          {Object.entries(reviewSummary.byType).map(([type, count]) => (
                            <span key={`type-${type}`} className="rounded-full border border-border bg-card px-2 py-1 text-text-secondary">{type.toUpperCase()}: {count}</span>
                          ))}
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
                          <p className="text-sm font-semibold text-text-primary">Difficulty Distribution</p>
                          <div className="space-y-1 text-sm text-text-secondary">
                            {Object.entries(reviewSummary.difficulty).map(([key, value]) => (
                              <p key={`diff-${key}`}>{key}: <span className="font-medium">{value}</span></p>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
                          <p className="text-sm font-semibold text-text-primary">Topic Grouping</p>
                          <div className="max-h-32 space-y-1 overflow-y-auto text-sm text-text-secondary">
                            {Object.entries(reviewSummary.topic).map(([key, value]) => (
                              <p key={`topic-${key}`}>{key}: <span className="font-medium">{value}</span></p>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-xl border border-border bg-background p-4">
                      <div className="space-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Validation</h2>
                        <p className="text-sm text-text-secondary">Blockers must be cleared before you can continue.</p>
                      </div>

                      {reviewSummary.invalidIndexes.length > 0 || reviewSummary.totalQuestions === 0 || reviewSummary.totalMarks === 0 ? (
                        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                          <p className="font-semibold">Blocking conditions found</p>
                          <ul className="mt-1 list-disc pl-5">
                            {reviewSummary.totalQuestions === 0 ? <li>No questions added.</li> : null}
                            {reviewSummary.totalMarks === 0 ? <li>Total marks is 0.</li> : null}
                            {reviewSummary.invalidIndexes.length > 0 ? <li>Fix Question {reviewSummary.invalidIndexes.join(", ")}.</li> : null}
                          </ul>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
                          All checks passed. You can continue to proctoring setup.
                        </div>
                      )}
                      {errors.review ? <p className="text-xs text-danger">{errors.review}</p> : null}

                      {reviewSummary.warnings.length > 0 ? (
                        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                          <p className="font-semibold">Warnings (non-blocking)</p>
                          <ul className="mt-1 list-disc pl-5">
                            {reviewSummary.warnings.map((item) => (<li key={item}>{item}</li>))}
                          </ul>
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-3 rounded-xl border border-border bg-background p-4">
                      <div className="space-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Inline Edit Questions</h2>
                        <p className="text-sm text-text-secondary">Click any question to quick edit marks, difficulty, topic, and answer.</p>
                      </div>
                      <div className="max-h-96 space-y-2 overflow-y-auto">
                        {form.questions.map((question, index) => (
                          <button
                            key={`review-inline-${index}`}
                            type="button"
                            onClick={() => setQuickEditIndex(index)}
                            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-left hover:border-primary/40 hover:bg-background"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-text-primary">Q{index + 1}. {question.question || "Untitled question"}</p>
                              <span className="text-xs text-text-secondary">{String(question.type || "mcq").toUpperCase()} • {question.marks || 0} marks</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {quickEditIndex != null && form.questions[quickEditIndex] ? (
                    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg border-l border-border bg-card p-6 shadow-2xl">
                      <div className="mb-4 flex items-center justify-between">
                        <h4 className="text-base font-semibold text-text-primary">Quick Edit Question {quickEditIndex + 1}</h4>
                        <Button variant="ghost" size="sm" onClick={() => setQuickEditIndex(null)}>Close</Button>
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label htmlFor="quick-edit-marks" className="text-sm text-text-secondary">Marks</label>
                          <Input id="quick-edit-marks" type="number" min={1} value={form.questions[quickEditIndex].marks || 1} onChange={(e) => dispatch(updateQuestionRow({ index: quickEditIndex, patch: { marks: Number(e.target.value) } }))} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm text-text-secondary">Difficulty</label>
                          <Select value={String(form.questions[quickEditIndex].difficulty || "MEDIUM")} onValueChange={(value) => dispatch(updateQuestionRow({ index: quickEditIndex, patch: { difficulty: value } }))}>
                            <SelectTrigger className="w-full" aria-label="Quick edit difficulty"><SelectValue /></SelectTrigger>
                            <SelectContent>{DIFFICULTY_OPTIONS.map((item) => <SelectItem key={`drawer-${item}`} value={item}>{item}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label htmlFor="quick-edit-topic" className="text-sm text-text-secondary">Topic</label>
                          <Input id="quick-edit-topic" value={String(form.questions[quickEditIndex].topic || "")} onChange={(e) => dispatch(updateQuestionRow({ index: quickEditIndex, patch: { topic: e.target.value } }))} />
                        </div>
                        {form.questions[quickEditIndex].type === "true_false" ? (
                          <div className="space-y-2">
                            <label className="text-sm text-text-secondary">Correct Answer</label>
                            <Select value={String(Boolean(form.questions[quickEditIndex].correctAnswer))} onValueChange={(value) => dispatch(updateQuestionRow({ index: quickEditIndex, patch: { correctAnswer: value === "true" } }))}>
                              <SelectTrigger className="w-full" aria-label="Quick edit correct answer"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="true">True</SelectItem>
                                <SelectItem value="false">False</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <label htmlFor="quick-edit-answer" className="text-sm text-text-secondary">Correct Answer</label>
                            <Input id="quick-edit-answer" value={String(form.questions[quickEditIndex].correctAnswer ?? "")} onChange={(e) => dispatch(updateQuestionRow({ index: quickEditIndex, patch: { correctAnswer: e.target.value } }))} />
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </section>
              )}

              {step === 5 && (
                <section className="space-y-6 rounded-xl border border-border bg-card p-5 shadow-xs animate-in slide-in-from-bottom-2 motion-reduce:animate-none lg:p-6">
                  <header className="space-y-2">
                    <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><ShieldCheck className="h-5 w-5 text-primary" /> Proctoring Config</h1>
                    <p className="text-sm text-text-secondary">Choose a persisted test type and fine-tune the exact student runtime behavior.</p>
                  </header>

                  <div className="space-y-6">
                    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                      <div className="space-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Selected Test Type</h2>
                        <p className="text-sm text-text-secondary">This value is saved with the test and returned back to students during the attempt.</p>
                      </div>

                      <div className="rounded-xl border border-border bg-card px-4 py-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Test Type</p>
                        <p className="mt-1 text-sm font-semibold text-text-primary">{String(form.testType || "STANDARD").replaceAll("_", " ")}</p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        {[
                          [PROCTORING_PRESETS.STRICT_EXAM, "Strict Exam"],
                          [PROCTORING_PRESETS.STANDARD_TEST, "Standard Test"],
                          [PROCTORING_PRESETS.OPEN_TEST, "Open Test"],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => {
                              dispatch(updateTestCreationField({ key: "proctoringPreset", value }));
                              Object.entries(PRESET_CONFIGS[value]).forEach(([key, presetValue]) => {
                                dispatch(updateRestrictionsField({ key, value: presetValue }));
                              });
                            }}
                            className={`rounded-xl border px-4 py-3 text-left transition-all ${form.proctoringPreset === value ? "border-primary bg-primary/10" : "border-border bg-card hover:border-border"}`}
                          >
                            <p className="text-sm font-semibold text-text-primary">{label}</p>
                            <p className="mt-1 text-xs text-text-secondary">Apply and then fine-tune controls below.</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                      <div className="space-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Runtime Controls</h2>
                        <p className="text-sm text-text-secondary">Fine-tune the exact behaviour enforced while a student is taking the test.</p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                          <span className="text-sm text-text-secondary">Proctoring Enabled</span>
                          <Switch checked={Boolean(form.restrictions.enabled)} onCheckedChange={(value) => dispatch(updateRestrictionsField({ key: "enabled", value }))} />
                        </label>
                        <label className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                          <span className="text-sm text-text-secondary">Fullscreen Required</span>
                          <Switch checked={Boolean(form.restrictions.fullscreenRequired)} onCheckedChange={(value) => dispatch(updateRestrictionsField({ key: "fullscreenRequired", value }))} />
                        </label>
                        <label className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                          <span className="text-sm text-text-secondary">Window Blur Detection</span>
                          <Switch checked={Boolean(form.restrictions.windowBlur)} onCheckedChange={(value) => dispatch(updateRestrictionsField({ key: "windowBlur", value }))} />
                        </label>
                        <label className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                          <span className="text-sm text-text-secondary">Screenshot Detection</span>
                          <Switch checked={Boolean(form.restrictions.screenshotDetection)} onCheckedChange={(value) => dispatch(updateRestrictionsField({ key: "screenshotDetection", value }))} />
                        </label>
                        <label className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                          <span className="text-sm text-text-secondary">Right Click Disabled</span>
                          <Switch checked={Boolean(form.restrictions.rightClickDisabled)} onCheckedChange={(value) => dispatch(updateRestrictionsField({ key: "rightClickDisabled", value }))} />
                        </label>
                        <label className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                          <span className="text-sm text-text-secondary">Devtools Detection</span>
                          <Switch checked={Boolean(form.restrictions.devtoolsDetection)} onCheckedChange={(value) => dispatch(updateRestrictionsField({ key: "devtoolsDetection", value }))} />
                        </label>
                        <label className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                          <span className="text-sm text-text-secondary">Auto Next Single-Select</span>
                          <Switch checked={Boolean(form.restrictions.autoNextSingle)} onCheckedChange={(value) => dispatch(updateRestrictionsField({ key: "autoNextSingle", value }))} />
                        </label>
                        <label className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                          <span className="text-sm text-text-secondary">Shuffle Questions</span>
                          <Switch checked={Boolean(form.shuffleQuestions)} onCheckedChange={(value) => dispatch(updateTestCreationField({ key: "shuffleQuestions", value }))} />
                        </label>
                        <label className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                          <span className="text-sm text-text-secondary">Shuffle Answers</span>
                          <Switch checked={Boolean(form.shuffleAnswers)} onCheckedChange={(value) => dispatch(updateTestCreationField({ key: "shuffleAnswers", value }))} />
                        </label>
                      </div>
                    </div>

                    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                      <div className="space-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Monitoring Rules</h2>
                        <p className="text-sm text-text-secondary">Set how input is treated and when the attempt is flagged.</p>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-sm text-text-secondary">Tab Switch</label>
                          <Select value={String(form.restrictions.tabSwitch || "monitored")} onValueChange={(value) => dispatch(updateRestrictionsField({ key: "tabSwitch", value }))}>
                            <SelectTrigger className="w-full" aria-label="Tab switch policy"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="monitored">Monitored</SelectItem>
                              <SelectItem value="allowed">Allowed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm text-text-secondary">Copy/Paste</label>
                          <Select value={String(form.restrictions.copyPaste || "monitored")} onValueChange={(value) => dispatch(updateRestrictionsField({ key: "copyPaste", value }))}>
                            <SelectTrigger className="w-full" aria-label="Copy paste policy"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="monitored">Monitored</SelectItem>
                              <SelectItem value="allowed">Allowed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label htmlFor="test-violation-threshold" className="text-sm text-text-secondary">Violation Threshold <span className="text-danger">*</span></label>
                          <Input id="test-violation-threshold" type="number" min={1} max={20} value={form.restrictions.violationThreshold} onChange={(e) => dispatch(updateRestrictionsField({ key: "violationThreshold", value: Number(e.target.value) }))} />
                          {errors.violationThreshold ? <p className="text-xs text-danger">{errors.violationThreshold}</p> : null}
                        </div>
                        <div className="space-y-2">
                          <label htmlFor="test-paragraph-word-limit" className="text-sm text-text-secondary">Paragraph Word Limit <span className="text-danger">*</span></label>
                          <Input id="test-paragraph-word-limit" type="number" min={10} max={5000} value={form.restrictions.paragraphWordLimit} onChange={(e) => dispatch(updateRestrictionsField({ key: "paragraphWordLimit", value: Number(e.target.value) }))} />
                          {errors.paragraphWordLimit ? <p className="text-xs text-danger">{errors.paragraphWordLimit}</p> : null}
                        </div>
                      </div>

                      {!form.restrictions.enabled ? (
                        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                          Proctoring is disabled. Students will still take the test, but runtime monitoring rules will not be enforced.
                        </p>
                      ) : null}
                      {form.restrictions.enabled && Number(form.restrictions.violationThreshold || 0) > 8 ? (
                        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                          Warning: very high violation threshold may reduce proctoring effectiveness.
                        </p>
                      ) : null}
                      {form.restrictions.enabled && form.restrictions.devtoolsDetection && /code|programming|algorithm/i.test(String(form.subject || "")) ? (
                        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                          Warning: devtools detection is enabled for a coding-oriented test. Confirm expected behavior.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </section>
              )}

              {step === 6 && (
                <section className="space-y-6 rounded-xl border border-border bg-card p-5 shadow-xs animate-in slide-in-from-bottom-2 motion-reduce:animate-none lg:p-6">
                  <header className="space-y-2">
                    <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Rocket className="h-5 w-5 text-primary" /> Publish Flow</h1>
                    <p className="text-sm text-text-secondary">Finalize status and verify readiness before publishing impact.</p>
                  </header>

                  {externalDraftWarning ? (
                    <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                      Concurrent edit detected: this draft changed in another tab/session.
                    </div>
                  ) : null}

                  <div className="space-y-6">
                    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                      <div className="space-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Publish Option</h2>
                        <p className="text-sm text-text-secondary">Choose how this test enters the student lifecycle.</p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm text-text-secondary">Publish Option <span className="text-danger">*</span></label>
                        <Select value={form.publishState} onValueChange={(value) => dispatch(updateTestCreationField({ key: "publishState", value }))}>
                          <SelectTrigger className="w-full" aria-label="Publish option"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PUBLISH_STATE_OPTIONS.map((item) => (
                              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary-dark">
                        Publishing this test will affect <span className="font-semibold">{assignedStudentsCount}</span> students.
                      </div>
                    </div>

                    <div className="space-y-3 rounded-xl border border-border bg-background p-4">
                      <div className="space-y-1">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Pre-publish Checklist</h2>
                        <p className="text-sm text-text-secondary">Every item must be green before the test can go live.</p>
                      </div>
                      <div className="space-y-2 text-sm">
                        {publishChecklist.map((item) => (
                          <p key={item.label} className={item.done ? "text-success" : "text-danger"}>
                            {item.done ? "✓" : "✕"} {item.label}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              )}

            </div>
          </div>

          {/* --- FOOTER ACTION BAR --- */}
          <footer className="sticky bottom-0 border-t border-border bg-card/95 px-5 py-4 backdrop-blur sm:px-6 lg:px-8">
            <div className="flex items-center justify-between gap-3">
              <Button 
                variant="outline" 
                onClick={onPrevious}
                disabled={step === 0 || isSubmitting}
              >
                Previous
              </Button>
              
              <div className="flex flex-wrap items-center justify-end gap-3">
                {step < stepTitles.length - 1 ? (
                  <Button 
                    className="bg-primary px-8 hover:bg-primary-dark" 
                    onClick={onNext}
                    disabled={!canProceed || isSubmitting}
                  >
                    Next
                  </Button>
                ) : (
                  <>
                    {!isNonDraftEdit ? (
                      <Button
                        variant="outline"
                        onClick={() => onSubmit("DRAFT")}
                        disabled={isSubmitting}
                      >
                        {isSubmitting && form.publishState === "DRAFT" ? "Saving..." : "Save as Draft"}
                      </Button>
                    ) : null}

                    <Button
                      className="bg-success px-8 hover:bg-success/90"
                      onClick={() => onSubmit(resolvedPrimaryPublishState)}
                      disabled={isSubmitting}
                    >
                      {isSubmitting && resolvedPrimaryPublishState !== "DRAFT"
                        ? "Saving..."
                        : isNonDraftEdit
                          ? "Save Settings"
                          : "Continue to Publish"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </footer>

          <AlertDialog
            open={publishDialog.open}
            onOpenChange={(open) => {
              setPublishDialog((prev) => ({ ...prev, open }));
              if (!open) {
                resetBodyInteractionLock();
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Publish</AlertDialogTitle>
                <AlertDialogDescription>
                  Publishing this test will affect {assignedStudentsCount} students. Continue?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isConfirmPublishing || isSubmitting}>Cancel</AlertDialogCancel>
                <Button onClick={confirmPublish} disabled={isConfirmPublishing || isSubmitting}>
                  {isConfirmPublishing || isSubmitting ? "Publishing..." : "Confirm Publish"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          </main>
        </div>
      </div>
    </div>
  );
}
