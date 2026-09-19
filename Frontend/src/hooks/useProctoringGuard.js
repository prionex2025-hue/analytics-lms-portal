import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import { incrementViolationCounter, reportAttemptViolation } from "@/features/Students/testSlice";
import { connectTestSocket } from "@/services/testSocket";

const GLOBAL_VIOLATION_COOLDOWN_MS = 1200;
const TYPE_VIOLATION_COOLDOWN_MS = 5000;
const CLIPBOARD_CASCADE_SUPPRESSION_MS = 1800;
const WINDOW_BLUR_CONFIRMATION_MS = 200;
const INITIAL_FOCUS_SIGNAL_GRACE_MS = 1500;
const VIOLATION_TOAST_ID = "student-proctoring-violation";
const THRESHOLD_WARNING_TOAST_ID = "student-proctoring-threshold-warning";

const isLikelyMobileDevice = () => {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const touchCapable = navigator.maxTouchPoints > 0;
  const coarsePointer = typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)").matches : false;
  const narrowViewport = Number(window.innerWidth || 0) > 0 && Number(window.innerWidth || 0) < 900;

  return Boolean((touchCapable || coarsePointer) && narrowViewport);
};

const getFullscreenElement = () =>
  document.fullscreenElement
  || document.webkitFullscreenElement
  || document.mozFullScreenElement
  || document.msFullscreenElement
  || null;

const requestFullscreen = async (element) => {
  if (!element) {
    throw new Error("Missing fullscreen target");
  }

  if (typeof element.requestFullscreen === "function") {
    return element.requestFullscreen();
  }
  if (typeof element.webkitRequestFullscreen === "function") {
    return element.webkitRequestFullscreen();
  }
  if (typeof element.mozRequestFullScreen === "function") {
    return element.mozRequestFullScreen();
  }
  if (typeof element.msRequestFullscreen === "function") {
    return element.msRequestFullscreen();
  }

  throw new Error("Fullscreen API unavailable");
};

const toCounterType = (raw) => {
  const type = String(raw || "").toLowerCase();
  if (type.includes("tab")) return "tab_switch";
  if (type.includes("copy")) return "copy";
  if (type.includes("paste")) return "paste";
  if (type.includes("right")) return "right_click";
  if (type.includes("fullscreen")) return "fullscreen_exit";
  if (type.includes("screenshot") || type.includes("print_screen")) return "screenshot_attempt";
  if (type.includes("devtools")) return "devtools_open";
  if (type.includes("blur")) return "window_blur";
  return "window_blur";
};

const toBackendViolationType = (raw) => {
  const type = String(raw || "").toLowerCase();
  if (type.includes("tab")) return "TAB_SWITCH";
  if (type.includes("copy") || type.includes("paste") || type.includes("cut")) return "COPY_PASTE";
  if (type.includes("right") || type.includes("context")) return "RIGHT_CLICK";
  if (type.includes("fullscreen")) return "FULLSCREEN_EXIT";
  if (type.includes("screenshot") || type.includes("print_screen")) return "SCREENSHOT_ATTEMPT";
  if (type.includes("devtools")) return "DEVTOOLS_OPEN";
  return "WINDOW_BLUR";
};

const isDevtoolsShortcut = (event) => {
  const key = String(event.key || "").toLowerCase();
  const ctrlOrMeta = event.ctrlKey || event.metaKey;
  const shift = event.shiftKey;
  const alt = event.altKey;

  if (key === "f12") {
    return true;
  }

  if (ctrlOrMeta && shift && ["i", "j", "c"].includes(key)) {
    return true;
  }

  if (ctrlOrMeta && alt && key === "i") {
    return true;
  }

  return false;
};

export const useProctoringGuard = ({
  attemptId,
  testId,
  enabled,
  paused = false,
  threshold,
  fullscreenRequired = false,
  tabSwitchMode = "monitored",
  copyPasteMode = "monitored",
  windowBlurEnabled = true,
  screenshotDetectionEnabled = false,
  rightClickDisabled = true,
  devtoolsDetectionEnabled = true,
  onThresholdExceeded,
}) => {
  const dispatch = useDispatch();
  const violationsTotal = useSelector((state) => state.test.violations.total);
  const [fullscreenBlocked, setFullscreenBlocked] = useState(false);
  const lockRef = useRef(false);
  const lastViolationAtRef = useRef(0);
  const lastViolationByTypeRef = useRef(new Map());
  const suppressFocusSignalsUntilRef = useRef(0);
  const focusSignalGraceUntilRef = useRef(0);
  const pendingBlurTimeoutRef = useRef(null);
  const isLikelyMobileRef = useRef(isLikelyMobileDevice());
  const thresholdTriggeredRef = useRef(false);
  const thresholdWarningShownForCountRef = useRef(-1);
  const hasEnteredFullscreenRef = useRef(false);
  const onThresholdExceededRef = useRef(onThresholdExceeded);

  const socket = useMemo(() => connectTestSocket(), []);

  useEffect(() => {
    onThresholdExceededRef.current = onThresholdExceeded;
  }, [onThresholdExceeded]);

  const triggerThresholdExceeded = useCallback(() => {
    if (thresholdTriggeredRef.current) {
      return;
    }

    thresholdTriggeredRef.current = true;
    onThresholdExceededRef.current?.();
  }, []);

  useEffect(() => {
    if (!enabled || paused || !attemptId || !testId) {
      setFullscreenBlocked(false);
      return undefined;
    }

    focusSignalGraceUntilRef.current = Date.now() + INITIAL_FOCUS_SIGNAL_GRACE_MS;
    isLikelyMobileRef.current = isLikelyMobileDevice();

    const registerViolation = (type, metadata = {}) => {
      if (lockRef.current || paused) {
        return;
      }

      const now = Date.now();
      const normalizedType = String(type || "").toLowerCase();

      if (normalizedType === "window_blur" || normalizedType === "tab_switch") {
        if (now < suppressFocusSignalsUntilRef.current) {
          return;
        }
      }

      if (now - lastViolationAtRef.current < GLOBAL_VIOLATION_COOLDOWN_MS) {
        return;
      }

      const previousForType = Number(lastViolationByTypeRef.current.get(normalizedType) || 0);
      if (now - previousForType < TYPE_VIOLATION_COOLDOWN_MS) {
        return;
      }

      if (normalizedType === "copy" || normalizedType === "paste" || normalizedType === "cut") {
        suppressFocusSignalsUntilRef.current = now + CLIPBOARD_CASCADE_SUPPRESSION_MS;
      }

      lastViolationAtRef.current = now;
      lastViolationByTypeRef.current.set(normalizedType, now);

      lockRef.current = true;
      window.setTimeout(() => {
        lockRef.current = false;
      }, 250);

      const counterType = toCounterType(type);
      const backendType = toBackendViolationType(type);
      dispatch(incrementViolationCounter(counterType));

      dispatch(
        reportAttemptViolation({
          attempt_id: attemptId,
          test_id: testId,
          type: backendType,
          metadata,
        })
      )
        .unwrap()
        .then((payload) => {
          const serverCount = Number(payload?.violationCount);
          const numericThreshold = Math.max(1, Number(threshold || 3));
          if (payload?.autoSubmitted || (Number.isFinite(serverCount) && serverCount >= numericThreshold)) {
            triggerThresholdExceeded();
          }
        })
        .catch(() => null);

      socket?.emit("violation", {
        attempt_id: attemptId,
        type,
        metadata,
      });

      toast.error(`Violation detected: ${type.replaceAll("_", " ")}`, {
        id: VIOLATION_TOAST_ID,
        dismissible: false,
        duration: 3000,
      });
    };

    const onVisibility = () => {
      if (tabSwitchMode === "monitored" && document.hidden) {
        registerViolation("tab_switch", { at: Date.now() });
      }
    };

    const onBlur = () => {
      if (!windowBlurEnabled) {
        return;
      }

      const now = Date.now();

      if (now < focusSignalGraceUntilRef.current || now < suppressFocusSignalsUntilRef.current) {
        return;
      }

      if (pendingBlurTimeoutRef.current) {
        window.clearTimeout(pendingBlurTimeoutRef.current);
      }

      pendingBlurTimeoutRef.current = window.setTimeout(() => {
        const visibilityState = String(document.visibilityState || "visible").toLowerCase();
        const isHidden = Boolean(document.hidden || visibilityState !== "visible");
        const hasFocus = typeof document.hasFocus === "function" ? document.hasFocus() : true;

        if (isLikelyMobileRef.current) {
          if (!isHidden) {
            return;
          }
        } else if (!isHidden && hasFocus) {
          return;
        }

        registerViolation("window_blur", {
          at: Date.now(),
          confirmed_after_ms: WINDOW_BLUR_CONFIRMATION_MS,
          hidden: isHidden,
          had_focus: hasFocus,
        });
      }, WINDOW_BLUR_CONFIRMATION_MS);
    };

    const onCopy = (event) => {
      if (copyPasteMode !== "monitored") {
        return;
      }
      event.preventDefault();
      registerViolation("copy", { at: Date.now() });
    };

    const onPaste = (event) => {
      if (copyPasteMode !== "monitored") {
        return;
      }
      event.preventDefault();
      registerViolation("paste", { at: Date.now() });
    };

    const onCut = (event) => {
      if (copyPasteMode !== "monitored") {
        return;
      }
      event.preventDefault();
      registerViolation("cut", { at: Date.now() });
    };

    const onContext = (event) => {
      if (!rightClickDisabled) {
        return;
      }
      event.preventDefault();
      registerViolation("right_click", { at: Date.now() });
    };

    const onKey = (event) => {
      if (screenshotDetectionEnabled && event.key === "PrintScreen") {
        registerViolation("screenshot_attempt", { at: Date.now(), key: event.key });
      }

      if (devtoolsDetectionEnabled && isDevtoolsShortcut(event)) {
        event.preventDefault();
        registerViolation("devtools_open", { at: Date.now(), key: event.key });
      }
    };

    const onFullscreenChange = () => {
      if (!fullscreenRequired) {
        setFullscreenBlocked(false);
        return;
      }

      const active = Boolean(getFullscreenElement());
      setFullscreenBlocked(!active);

      if (!active && hasEnteredFullscreenRef.current) {
        registerViolation("fullscreen_exit", { at: Date.now() });
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("cut", onCut);
    document.addEventListener("contextmenu", onContext);
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreenChange);

    if (fullscreenRequired) {
      const active = Boolean(getFullscreenElement());
      hasEnteredFullscreenRef.current = active;
      setFullscreenBlocked(!active);
    } else {
      setFullscreenBlocked(false);
    }

    return () => {
      if (pendingBlurTimeoutRef.current) {
        window.clearTimeout(pendingBlurTimeoutRef.current);
        pendingBlurTimeoutRef.current = null;
      }

      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("contextmenu", onContext);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [
    attemptId,
    copyPasteMode,
    devtoolsDetectionEnabled,
    dispatch,
    enabled,
    fullscreenRequired,
    paused,
    rightClickDisabled,
    screenshotDetectionEnabled,
    socket,
    tabSwitchMode,
    testId,
    threshold,
    triggerThresholdExceeded,
    windowBlurEnabled,
  ]);

  useEffect(() => {
    if (!enabled || paused) {
      thresholdTriggeredRef.current = false;
      thresholdWarningShownForCountRef.current = -1;
      return;
    }

    const numericThreshold = Math.max(1, Number(threshold || 3));
    const warningAtCount = Math.max(1, numericThreshold - 1);

    if (
      violationsTotal >= warningAtCount &&
      violationsTotal < numericThreshold &&
      thresholdWarningShownForCountRef.current !== violationsTotal
    ) {
      thresholdWarningShownForCountRef.current = violationsTotal;
      toast.warning("One more violation will auto-submit your test.", {
        id: THRESHOLD_WARNING_TOAST_ID,
        dismissible: false,
        duration: 3000,
      });
    }

    if (violationsTotal < numericThreshold) {
      thresholdTriggeredRef.current = false;
      return;
    }

    if (!thresholdTriggeredRef.current) {
      triggerThresholdExceeded();
    }
  }, [enabled, paused, threshold, triggerThresholdExceeded, violationsTotal]);

  const reEnterFullscreen = async () => {
    if (!enabled || !fullscreenRequired) {
      setFullscreenBlocked(false);
      return;
    }

    try {
      await requestFullscreen(document.documentElement);
      hasEnteredFullscreenRef.current = true;
      setFullscreenBlocked(false);
    } catch {
      setFullscreenBlocked(true);
      toast.error("Fullscreen is required for this test. Allow fullscreen and try again.");
    }
  };

  return {
    fullscreenBlocked,
    reEnterFullscreen,
  };
};
