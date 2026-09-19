import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ACTIVITY_EVENTS = ["click", "keydown", "mousemove", "scroll", "touchstart", "visibilitychange"];

export default function IdleSessionTimeout({
  enabled,
  onLogout,
  timeoutMs = 30 * 60 * 1000,
  warningMs = 60 * 1000,
}) {
  const [warningOpen, setWarningOpen] = useState(false);
  const warningTimer = useRef(null);
  const logoutTimer = useRef(null);

  const clearTimers = useCallback(() => {
    window.clearTimeout(warningTimer.current);
    window.clearTimeout(logoutTimer.current);
  }, []);

  const scheduleTimers = useCallback(() => {
    clearTimers();
    if (!enabled) {
      setWarningOpen(false);
      return;
    }

    warningTimer.current = window.setTimeout(() => setWarningOpen(true), Math.max(0, timeoutMs - warningMs));
    logoutTimer.current = window.setTimeout(() => {
      setWarningOpen(false);
      onLogout?.();
    }, timeoutMs);
  }, [clearTimers, enabled, onLogout, timeoutMs, warningMs]);

  useEffect(() => {
    scheduleTimers();
    return clearTimers;
  }, [clearTimers, scheduleTimers]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const onActivity = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      setWarningOpen(false);
      scheduleTimers();
    };

    ACTIVITY_EVENTS.forEach((eventName) => window.addEventListener(eventName, onActivity, { passive: true }));
    return () => ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, onActivity));
  }, [enabled, scheduleTimers]);

  return (
    <Dialog open={warningOpen} onOpenChange={setWarningOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Session timeout</DialogTitle>
          <DialogDescription>
            Your session is about to expire because of inactivity.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onLogout}>Log out</Button>
          <Button onClick={scheduleTimers}>Stay signed in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
