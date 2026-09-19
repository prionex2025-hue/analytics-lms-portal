import { useEffect, useRef, useState } from "react";

/**
 * Exam countdown that runs on SERVER time, not the student's device clock.
 *
 * `clockOffsetMs` is (serverTime - clientTime) captured when the attempt
 * payload arrived. Without it, a device clock running fast would fire
 * `onExpired` (and the auto-submit UI) before the server deadline, ending the
 * exam early; a slow clock would display minutes the server will not honour.
 */
export const useAttemptTimer = ({ serverEndTime, clockOffsetMs = 0, onExpired }) => {
  const offset = Number.isFinite(Number(clockOffsetMs)) ? Number(clockOffsetMs) : 0;
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, Number(serverEndTime || 0) - (Date.now() + offset)));
  const intervalRef = useRef(null);
  const expiryTriggeredRef = useRef(false);
  const onExpiredRef = useRef(onExpired);

  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    expiryTriggeredRef.current = false;
  }, [serverEndTime]);

  useEffect(() => {
    const end = Number(serverEndTime || 0);
    if (!end) {
      setRemainingMs((current) => (current === 0 ? current : 0));
      return undefined;
    }

    const serverNow = () => Date.now() + offset;

    const tick = () => {
      const nextRemaining = Math.max(0, end - serverNow());
      setRemainingMs((current) => (current === nextRemaining ? current : nextRemaining));

      if (nextRemaining <= 0) {
        if (!expiryTriggeredRef.current) {
          expiryTriggeredRef.current = true;
          onExpiredRef.current?.();
        }
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };

    tick();
    intervalRef.current = setInterval(tick, Math.min(1000, Math.max(25, end - serverNow())));

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [serverEndTime, offset]);

  return {
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
  };
};
