import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { heartbeatAttempt } from "@/features/Students/testSlice";

export const useAttemptHeartbeat = ({ attemptId, testId, onNotFound, onAlreadySubmitted }) => {
  const dispatch = useDispatch();
  const timeoutRef = useRef(null);
  const stoppedRef = useRef(false);
  const nextDelayRef = useRef(5000);

  // Callbacks are usually inline arrows recreated on every render. Holding them
  // in refs keeps the heartbeat effect OUT of their identity — otherwise the
  // effect tears down and reschedules on every render (the countdown re-renders
  // this page ~once per second, which is shorter than the 5s heartbeat delay),
  // so the heartbeat would never actually fire and the server would treat an
  // active student as disconnected and force auto-submit them.
  const onNotFoundRef = useRef(onNotFound);
  const onAlreadySubmittedRef = useRef(onAlreadySubmitted);
  useEffect(() => {
    onNotFoundRef.current = onNotFound;
    onAlreadySubmittedRef.current = onAlreadySubmitted;
  }, [onNotFound, onAlreadySubmitted]);

  useEffect(() => {
    if (!attemptId) {
      return undefined;
    }

    stoppedRef.current = false;
    nextDelayRef.current = 5000;

    const run = async () => {
      if (!attemptId || stoppedRef.current) {
        return;
      }

      try {
        const response = await dispatch(
          heartbeatAttempt({
            attempt_id: attemptId,
            test_id: testId,
          })
        ).unwrap();

        if (response?.autoSubmitted) {
          onAlreadySubmittedRef.current?.();
          return;
        }

        nextDelayRef.current = 5000;
      } catch (error) {
        if (Number(error?.status) === 404) {
          onNotFoundRef.current?.();
          return;
        }

        if (Number(error?.status) === 409) {
          onAlreadySubmittedRef.current?.();
          return;
        }

        if (Number(error?.status) === 429) {
          const retryAfterSeconds = Number(error?.retryAfterSeconds || 0);
          nextDelayRef.current = retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 10_000;
        } else {
          nextDelayRef.current = Math.min(20_000, nextDelayRef.current + 2000);
        }
      }

      if (stoppedRef.current) {
        return;
      }
      timeoutRef.current = window.setTimeout(run, nextDelayRef.current);
    };

    timeoutRef.current = window.setTimeout(run, nextDelayRef.current);

    return () => {
      stoppedRef.current = true;
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [attemptId, dispatch, testId]);
};
