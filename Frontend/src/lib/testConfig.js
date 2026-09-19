export const TEST_TYPES = Object.freeze({
  STRICT: "STRICT",
  STANDARD: "STANDARD",
  OPEN: "OPEN",
});

export const PROCTORING_PRESETS = Object.freeze({
  STRICT_EXAM: "STRICT_EXAM",
  STANDARD_TEST: "STANDARD_TEST",
  OPEN_TEST: "OPEN_TEST",
});

export const PRESET_CONFIGS = Object.freeze({
  [PROCTORING_PRESETS.STRICT_EXAM]: Object.freeze({
    enabled: true,
    fullscreenRequired: true,
    tabSwitch: "monitored",
    copyPaste: "monitored",
    windowBlur: true,
    screenshotDetection: true,
    rightClickDisabled: true,
    devtoolsDetection: true,
    violationThreshold: 2,
    autoNextSingle: false,
    paragraphWordLimit: 250,
  }),
  [PROCTORING_PRESETS.STANDARD_TEST]: Object.freeze({
    enabled: true,
    fullscreenRequired: false,
    tabSwitch: "monitored",
    copyPaste: "monitored",
    windowBlur: true,
    screenshotDetection: false,
    rightClickDisabled: true,
    devtoolsDetection: true,
    violationThreshold: 3,
    autoNextSingle: false,
    paragraphWordLimit: 250,
  }),
  [PROCTORING_PRESETS.OPEN_TEST]: Object.freeze({
    enabled: true,
    fullscreenRequired: false,
    tabSwitch: "allowed",
    copyPaste: "allowed",
    windowBlur: false,
    screenshotDetection: false,
    rightClickDisabled: false,
    devtoolsDetection: false,
    violationThreshold: 8,
    autoNextSingle: false,
    paragraphWordLimit: 250,
  }),
});

// Assessment format axis (separate from proctoring `testType`).
export const ASSESSMENT_FORMATS = Object.freeze({
  OPEN_TEST: "OPEN_TEST",
  MODULE_TEST: "MODULE_TEST",
});

export const DEFAULT_ASSESSMENT_FORMAT = ASSESSMENT_FORMATS.OPEN_TEST;

// Fixed module set and order for MODULE_TEST (Quant -> Reasoning -> Verbal).
export const MODULE_DEFINITIONS = Object.freeze([
  Object.freeze({ key: "QUANT", name: "Quantitative Aptitude", order: 1, category: "Quantitative Aptitude" }),
  Object.freeze({ key: "REASONING", name: "Logical Reasoning", order: 2, category: "Logical Reasoning" }),
  Object.freeze({ key: "VERBAL", name: "Verbal", order: 3, category: "Verbal" }),
]);

export const ALLOWED_MODULE_CATEGORIES = Object.freeze(MODULE_DEFINITIONS.map((mod) => mod.category));
export const MODULE_MIN_DURATION_MINS = 1;
export const MODULE_MAX_DURATION_MINS = 300;

export const normalizeAssessmentFormat = (value, fallback = DEFAULT_ASSESSMENT_FORMAT) => {
  const normalized = String(value || "").trim().toUpperCase();
  return Object.values(ASSESSMENT_FORMATS).includes(normalized) ? normalized : fallback;
};

export const normalizeModuleCategory = (value) => {
  if (Array.isArray(value)) return null;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return ALLOWED_MODULE_CATEGORIES.find((category) => category.toLowerCase() === raw.toLowerCase()) || null;
};

// Build a default module-durations map keyed by module key.
export const createDefaultModuleDurations = () =>
  MODULE_DEFINITIONS.reduce((acc, mod) => {
    acc[mod.key] = "";
    return acc;
  }, {});

// Validate module durations + a parsed question list. Returns { errors, perCategoryCounts }.
// Mirrors the backend validateModuleAssessment so admins get feedback before submit.
export const validateModuleAssessment = ({ moduleDurations = {}, questions = [] } = {}) => {
  const errors = [];
  for (const mod of MODULE_DEFINITIONS) {
    const value = Number(moduleDurations?.[mod.key]);
    if (!Number.isFinite(value) || value < MODULE_MIN_DURATION_MINS) {
      errors.push({ field: `modules.${mod.key}`, code: "MODULE_DURATION_INVALID", message: `${mod.name} duration must be at least ${MODULE_MIN_DURATION_MINS} minute` });
    } else if (value > MODULE_MAX_DURATION_MINS) {
      errors.push({ field: `modules.${mod.key}`, code: "MODULE_DURATION_INVALID", message: `${mod.name} duration must not exceed ${MODULE_MAX_DURATION_MINS} minutes` });
    }
  }

  const counts = Object.fromEntries(ALLOWED_MODULE_CATEGORIES.map((c) => [c, 0]));
  (Array.isArray(questions) ? questions : []).forEach((question, index) => {
    const raw = question?.category;
    if (Array.isArray(raw)) {
      errors.push({ index, field: "category", code: "MODULE_CATEGORY_INVALID", message: `Question ${index + 1}: category must be a single string` });
      return;
    }
    if (raw == null || String(raw).trim() === "") {
      errors.push({ index, field: "category", code: "MODULE_CATEGORY_MISSING", message: `Question ${index + 1}: category is required` });
      return;
    }
    const normalized = normalizeModuleCategory(raw);
    if (!normalized) {
      errors.push({ index, field: "category", code: "MODULE_CATEGORY_INVALID", message: `Question ${index + 1}: invalid category "${raw}"` });
      return;
    }
    counts[normalized] += 1;
  });

  for (const mod of MODULE_DEFINITIONS) {
    if ((counts[mod.category] || 0) === 0) {
      errors.push({ field: `modules.${mod.key}`, code: "MODULE_EMPTY", message: `${mod.name} must contain at least one question` });
    }
  }

  return { errors, perCategoryCounts: counts };
};

export const sumModuleDurations = (moduleDurations = {}) =>
  MODULE_DEFINITIONS.reduce((sum, mod) => {
    const value = Number(moduleDurations?.[mod.key]);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

export const DEFAULT_TEST_TYPE = TEST_TYPES.STANDARD;
export const DEFAULT_PROCTORING_PRESET = PROCTORING_PRESETS.STANDARD_TEST;
export const DEFAULT_RESTRICTIONS = Object.freeze({
  ...PRESET_CONFIGS[DEFAULT_PROCTORING_PRESET],
});

const LEGACY_OPEN_PRESET = "OPEN_ASSIGNMENT";

const normalizeBoolean = (value, fallback) => (typeof value === "boolean" ? value : fallback);

const normalizeInteger = (value, { fallback, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(numeric)));
};

const normalizeMonitoringMode = (value, fallback) => {
  if (typeof value === "boolean") {
    return value ? "monitored" : "allowed";
  }

  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "allowed") return "allowed";
  if (normalized === "monitored") return "monitored";
  return fallback;
};

export const derivePresetFromTestType = (testType) => {
  const normalized = String(testType || "").trim().toUpperCase();
  if (normalized === TEST_TYPES.STRICT) return PROCTORING_PRESETS.STRICT_EXAM;
  if (normalized === TEST_TYPES.OPEN) return PROCTORING_PRESETS.OPEN_TEST;
  return PROCTORING_PRESETS.STANDARD_TEST;
};

export const deriveTestTypeFromPreset = (preset) => {
  const normalized = String(preset || "").trim().toUpperCase();
  if (normalized === PROCTORING_PRESETS.STRICT_EXAM) return TEST_TYPES.STRICT;
  if (normalized === PROCTORING_PRESETS.OPEN_TEST || normalized === LEGACY_OPEN_PRESET) return TEST_TYPES.OPEN;
  return TEST_TYPES.STANDARD;
};

export const normalizeTestType = (value, fallback = DEFAULT_TEST_TYPE) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (Object.values(TEST_TYPES).includes(normalized)) {
    return normalized;
  }
  if (normalized === LEGACY_OPEN_PRESET) {
    return TEST_TYPES.OPEN;
  }
  return fallback;
};

export const normalizeProctoringPreset = (value, fallback = DEFAULT_PROCTORING_PRESET) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === LEGACY_OPEN_PRESET) {
    return PROCTORING_PRESETS.OPEN_TEST;
  }
  if (Object.values(PROCTORING_PRESETS).includes(normalized)) {
    return normalized;
  }
  return fallback;
};

export const createDefaultRestrictions = (preset = DEFAULT_PROCTORING_PRESET) => ({
  ...(PRESET_CONFIGS[preset] || PRESET_CONFIGS[DEFAULT_PROCTORING_PRESET]),
});

export const normalizeRestrictions = (input = {}, { fallbackPreset = DEFAULT_PROCTORING_PRESET } = {}) => {
  const base = createDefaultRestrictions(fallbackPreset);

  return {
    enabled: normalizeBoolean(input.enabled, base.enabled),
    fullscreenRequired: normalizeBoolean(
      input.fullscreenRequired ?? input.fullscreen_required ?? input.fullscreen,
      base.fullscreenRequired
    ),
    tabSwitch: normalizeMonitoringMode(input.tabSwitch ?? input.tab_switch, base.tabSwitch),
    copyPaste: normalizeMonitoringMode(input.copyPaste ?? input.copy_paste, base.copyPaste),
    windowBlur: normalizeBoolean(input.windowBlur ?? input.window_blur, base.windowBlur),
    screenshotDetection: normalizeBoolean(
      input.screenshotDetection ?? input.screenshot_detection,
      base.screenshotDetection
    ),
    rightClickDisabled: normalizeBoolean(
      input.rightClickDisabled ?? input.right_click_disabled ?? input.rightClick,
      base.rightClickDisabled
    ),
    devtoolsDetection: normalizeBoolean(
      input.devtoolsDetection ?? input.devtools_detection,
      base.devtoolsDetection
    ),
    violationThreshold: normalizeInteger(
      input.violationThreshold ?? input.violation_threshold ?? input.threshold ?? input.violationLimit,
      {
        fallback: base.violationThreshold,
        min: 1,
        max: 20,
      }
    ),
    autoNextSingle: normalizeBoolean(
      input.autoNextSingle ?? input.auto_next_single,
      base.autoNextSingle
    ),
    paragraphWordLimit: normalizeInteger(
      input.paragraphWordLimit ?? input.paragraph_word_limit,
      {
        fallback: base.paragraphWordLimit,
        min: 10,
        max: 5000,
      }
    ),
  };
};

export const resolveIncomingTestConfig = (test = {}) => {
  const testType = normalizeTestType(test?.testType ?? test?.test_type);
  const proctoringPreset = normalizeProctoringPreset(
    test?.proctoringPreset ?? test?.proctoring_preset,
    derivePresetFromTestType(testType)
  );

  const restrictions = normalizeRestrictions(
    {
      ...(test?.proctoringConfig || {}),
      ...(test?.proctoring_config || {}),
      enabled: test?.proctoringEnabled ?? test?.proctoring_enabled,
      fullscreenRequired: test?.requireFullscreen ?? test?.require_fullscreen,
      tabSwitch:
        test?.restrictTabSwitch != null
          ? (test.restrictTabSwitch ? "monitored" : "allowed")
          : undefined,
      copyPaste:
        test?.restrictCopyPaste != null
          ? (test.restrictCopyPaste ? "monitored" : "allowed")
          : undefined,
      windowBlur: test?.monitorWindowBlur ?? test?.monitor_window_blur,
      screenshotDetection: test?.detectScreenshot ?? test?.detect_screenshot,
      rightClickDisabled: test?.restrictRightClick ?? test?.restrict_right_click,
      devtoolsDetection: test?.detectDevtools ?? test?.detect_devtools,
      violationThreshold: test?.violationLimit ?? test?.violation_limit,
      autoNextSingle: test?.autoNextSingle ?? test?.auto_next_single,
      paragraphWordLimit: test?.paragraphWordLimit ?? test?.paragraph_word_limit,
    },
    { fallbackPreset: proctoringPreset }
  );

  return {
    testType,
    proctoringPreset,
    restrictions,
  };
};

export const getDefaultFormPatchFromAdminSettings = (settings = {}) => {
  const defaults = settings?.defaultTestConfig || {};
  const testType = normalizeTestType(defaults?.testType, DEFAULT_TEST_TYPE);
  const proctoringPreset = normalizeProctoringPreset(
    defaults?.proctoringPreset,
    derivePresetFromTestType(testType)
  );

  return {
    durationMins: normalizeInteger(defaults?.durationMins, { fallback: 60, min: 5, max: 480 }),
    attemptsAllowed: normalizeInteger(defaults?.attemptsAllowed, { fallback: 1, min: 1, max: 10 }),
    evaluationRule: ["BEST_ATTEMPT", "LAST_ATTEMPT"].includes(String(defaults?.evaluationRule || "").toUpperCase())
      ? String(defaults.evaluationRule).toUpperCase()
      : "BEST_ATTEMPT",
    testType,
    proctoringPreset,
    restrictions: normalizeRestrictions(
      {
        violationThreshold: defaults?.violationThreshold,
      },
      { fallbackPreset: proctoringPreset }
    ),
  };
};
