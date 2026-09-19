import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { adminApi, superAdminApi } from "@/services/api";
import { connectTestSocket, disconnectTestSocket, joinTestRoom, leaveTestRoom } from "@/services/testSocket";
import usePermission from "@/hooks/usePermission";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import ViolationFeed from "@/components/Admin/ViolationFeed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const statusTone = {
  ONLINE: "text-success",
  UNSTABLE: "text-warning",
  OFFLINE: "text-text-secondary",
};

const formatLimiterLabel = (label) =>
  String(label || "unknown")
    .replace(/^student-exam-/, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const formatMetricTimestamp = (value) => (value ? new Date(value).toLocaleString() : "-");

const mergeStatusUpdate = (row, payload) => {
  const next = { ...row, ...payload };

  if (payload.expiresAt) {
    const expiresAtMs = new Date(payload.expiresAt).getTime();
    if (Number.isFinite(expiresAtMs)) {
      next.timeLeftSec = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
    }
  }

  if (typeof payload.violations === "undefined" && typeof payload.violationCount !== "undefined") {
    next.violations = payload.violationCount;
  }

  // The countdown baseline moves only when the payload carries fresh time
  // information; otherwise the previous baseline must survive the merge so the
  // local ticker keeps counting from the right instant.
  if (payload.expiresAt || typeof payload.timeLeftSec !== "undefined") {
    next._receivedAt = Date.now();
  }

  // A presence push means "heartbeat happened just now": reset the server-side
  // idle age and anchor it locally, so connection status derives from relative
  // elapsed time (immune to admin/server clock skew).
  if (payload.lastHeartbeatAt) {
    next.idleSeconds = 0;
    next._presenceAt = Date.now();
  }

  return next;
};

const stampRows = (rows = []) => {
  const receivedAt = Date.now();
  return rows.map((row) => ({ ...row, _receivedAt: receivedAt }));
};

export default function LiveMonitoringPage() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isSuperAdminRoute = location.pathname === "/super-admin" || location.pathname.startsWith("/super-admin/");
  const isCollegeAdminRoute = location.pathname === "/college-admin" || location.pathname.startsWith("/college-admin/");
  const basePath = isSuperAdminRoute ? "/super-admin" : isCollegeAdminRoute ? "/college-admin" : "/admin";
  const monitoringApi = isSuperAdminRoute ? superAdminApi : adminApi;
  const socketRole = isSuperAdminRoute ? "super-admin" : isCollegeAdminRoute ? "college-admin" : "admin";
  const canEditTest = usePermission(ADMIN_PERMISSIONS.EDIT_TEST);
  const parentRef = useRef(null);
  const [socketHealthy, setSocketHealthy] = useState(false);
  const [studentRows, setStudentRows] = useState([]);
  const [violationFeed, setViolationFeed] = useState([]);
  const [forceDialog, setForceDialog] = useState({ open: false, row: null, reason: "" });
  const [extendDialog, setExtendDialog] = useState({ open: false, row: null, minutes: 10 });

  const monitorQuery = useQuery({
    queryKey: [isSuperAdminRoute ? "super-admin-live-monitoring" : "admin-live-monitoring", testId],
    queryFn: () => monitoringApi.getTestMonitoring(testId),
    enabled: Boolean(testId),
    // Sockets only push on student ACTIONS (start/answer/violation/submit).
    // Heartbeats never reach the room, so an idle student's connection status
    // and remaining time would freeze without a slow keep-alive poll.
    refetchInterval: socketHealthy ? 30000 : 10000,
    staleTime: socketHealthy ? 5000 : 0,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: !socketHealthy,
  });

  useEffect(() => {
    if (!monitorQuery.data) return;
    setStudentRows(stampRows(monitorQuery.data.studentTable || []));
    setViolationFeed(monitorQuery.data.violationFeed || []);
  }, [monitorQuery.data]);

  // A socket update for an unknown submission means the roster changed under
  // us (a student started after this page loaded) — pull the full table.
  // Throttled so a burst of events triggers one refetch, not a storm.
  const rosterRefreshAtRef = useRef(0);
  const refetchMonitor = monitorQuery.refetch;
  const requestRosterRefresh = useCallback(() => {
    const now = Date.now();
    if (now - rosterRefreshAtRef.current < 4000) return;
    rosterRefreshAtRef.current = now;
    refetchMonitor();
  }, [refetchMonitor]);

  // Local ticker so the remaining-time column counts down between server
  // contacts instead of freezing at the last fetched value.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const displayTimeLeftSec = (row) => {
    const base = Number(row.timeLeftSec || 0);
    const elapsed = row._receivedAt ? Math.max(0, Math.floor((nowTick - row._receivedAt) / 1000)) : 0;
    return Math.max(0, base - elapsed);
  };

  // Presence pushes arrive ~every 5s per active student and zero the row's
  // server-computed idle age. Status derives from that age plus LOCAL elapsed
  // time (skew-free: both anchors are this machine's clock), with the same
  // thresholds the backend uses — so a student who stops heartbeating flips to
  // UNSTABLE/OFFLINE here without waiting for the next poll.
  const displayConnectionStatus = (row) => {
    const baseIdle = Number(row.idleSeconds);
    const anchor = row._presenceAt || row._receivedAt;
    if (!Number.isFinite(baseIdle) || !anchor) return row.connectionStatus || "OFFLINE";
    const idleSeconds = baseIdle + Math.max(0, (nowTick - anchor) / 1000);
    if (idleSeconds <= 45) return "ONLINE";
    if (idleSeconds <= 120) return "UNSTABLE";
    return "OFFLINE";
  };

  useEffect(() => {
    if (!testId) return undefined;

    const socket = connectTestSocket(socketRole);

    const onConnect = () => {
      setSocketHealthy(true);
      joinTestRoom(testId, socketRole);
    };
    const onDisconnect = () => {
      setSocketHealthy(false);
      toast.warning("Socket disconnected. Fallback polling activated.");
    };
    const onConnectError = () => {
      setSocketHealthy(false);
    };
    const onStatusUpdate = (payload) => {
      if (!payload || payload.testId !== testId) return;
      setStudentRows((prev) => {
        const index = prev.findIndex((item) => item.submissionId === payload.submissionId);
        if (index < 0) {
          // Unknown submission: a student started after this page loaded.
          // The push payload has no name/batch, so refetch the roster instead
          // of silently dropping the event.
          requestRosterRefresh();
          return prev;
        }
        const next = [...prev];
        next[index] = mergeStatusUpdate(next[index], payload);
        return next;
      });
    };
    const onViolationEvent = (payload) => {
      if (!payload || payload.testId !== testId) return;
      setStudentRows((prev) => {
        if (!prev.some((item) => item.submissionId === payload.submissionId)) {
          requestRosterRefresh();
        }
        return prev;
      });
      setViolationFeed((prev) => [
        { ...payload, id: `${payload.submissionId}-${payload.type || "event"}-${payload.at || Date.now()}` },
        ...prev,
      ].slice(0, 100));
    };
    const onTestStatusChange = (payload) => {
      if (!payload || payload.testId !== testId) return;
      if (payload.action === "FORCE_SUBMIT" || payload.action === "ATTEMPT_SUBMITTED") {
        setStudentRows((prev) => prev.filter((item) => item.submissionId !== payload.submissionId));
      }
    };
    const onTestRoomDenied = (payload) => {
      if (!payload || payload.testId !== testId) return;
      setSocketHealthy(false);
      toast.error("Live socket room access was denied. Fallback polling activated.");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("student_status_update", onStatusUpdate);
    socket.on("violation_event", onViolationEvent);
    socket.on("test_status_change", onTestStatusChange);
    socket.on("test_room_denied", onTestRoomDenied);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      leaveTestRoom(testId, socketRole);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("student_status_update", onStatusUpdate);
      socket.off("violation_event", onViolationEvent);
      socket.off("test_status_change", onTestStatusChange);
      socket.off("test_room_denied", onTestRoomDenied);
      disconnectTestSocket(socketRole);
    };
  }, [socketRole, testId, requestRosterRefresh]);

  const virtualized = studentRows.length > 50;
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns imperative helpers by design.
  const rowVirtualizer = useVirtualizer({
    count: virtualized ? studentRows.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
  });

  const activeStudents = useMemo(() => studentRows.length, [studentRows]);
  const canControlMonitoring = (isSuperAdminRoute || canEditTest) && Boolean(
    monitorQuery.data?.canAdminControl ?? monitorQuery.data?.test?.canAdminControl ?? true
  );
  const rateLimits = monitorQuery.data?.rateLimits || {
    totalBlocked: 0,
    topScopes: [],
    topRoutes: [],
    topActors: [],
    generatedAt: null,
    windowHours: 24,
    collegeScoped: true,
  };
  const hottestLimiter = rateLimits.topScopes?.[0] || null;
  const hottestActor = rateLimits.topActors?.[0] || null;

  const forceSubmit = async () => {
    if (!canControlMonitoring) return;
    if (!forceDialog.row?.submissionId || !forceDialog.reason.trim()) return;
    await monitoringApi.forceSubmitAttempt(testId, {
      submissionId: forceDialog.row.submissionId,
      reason: forceDialog.reason.trim(),
    });
    toast.success("Student attempt force-submitted.");
    setForceDialog({ open: false, row: null, reason: "" });
    monitorQuery.refetch();
  };

  const extendTime = async () => {
    if (!canControlMonitoring) return;
    if (!extendDialog.row?.submissionId) return;
    await monitoringApi.extendAttemptTime(testId, {
      submissionId: extendDialog.row.submissionId,
      minutes: Number(extendDialog.minutes || 0),
    });
    toast.success("Extra time granted.");
    setExtendDialog({ open: false, row: null, minutes: 10 });
    monitorQuery.refetch();
  };

  const renderRow = (row) => (
    <tr key={row.submissionId} className="border-b border-border">
      <td className="px-3 py-2">{row.name}</td>
      <td className="px-3 py-2">{row.department}</td>
      <td className="px-3 py-2">{row.progress}%</td>
      <td className="px-3 py-2">{Math.floor(displayTimeLeftSec(row) / 60)}m</td>
      <td className="px-3 py-2">{row.violations}</td>
      <td className={`px-3 py-2 font-medium ${statusTone[displayConnectionStatus(row)] || statusTone.OFFLINE}`}>{displayConnectionStatus(row)}</td>
      <td className="px-3 py-2 text-right">
        {canControlMonitoring ? (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setExtendDialog({ open: true, row, minutes: 10 })}>Extend Time</Button>
            <Button size="sm" variant="destructive" onClick={() => setForceDialog({ open: true, row, reason: "" })}>Force Submit</Button>
          </div>
        ) : (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-secondary">Read-only</span>
        )}
      </td>
    </tr>
  );

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Live Test Monitoring</h1>
          <p className="text-sm text-text-secondary">Socket-first real-time monitoring for active attempts.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${socketHealthy ? "text-success" : "text-warning"}`}>
            {socketHealthy ? "Socket Connected" : "Fallback Polling"}
          </span>
          {!canControlMonitoring && monitorQuery.data ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
              Read-only monitoring
            </span>
          ) : null}
          <Button variant="outline" onClick={() => navigate(`${basePath}/tests`)}>Back to Tests</Button>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-2xl border-border"><CardContent className="p-4"><p className="text-xs text-text-secondary">Active Students</p><p className="text-2xl font-semibold">{activeStudents}</p></CardContent></Card>
        <Card className="rounded-2xl border-border"><CardContent className="p-4"><p className="text-xs text-text-secondary">Test</p><p className="text-base font-semibold">{monitorQuery.data?.test?.title || "-"}</p></CardContent></Card>
        <Card className="rounded-2xl border-border"><CardContent className="p-4"><p className="text-xs text-text-secondary">Question Count</p><p className="text-2xl font-semibold">{monitorQuery.data?.test?.questionCount || 0}</p></CardContent></Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card className="rounded-2xl border-border">
          <CardHeader>
            <CardTitle>Exam API Pressure</CardTitle>
            <p className="text-sm text-text-secondary">
              {rateLimits.collegeScoped ? "College-scoped" : "Global"} blocked exam limiter hits in the last {rateLimits.windowHours || 24}h.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-border bg-background px-3 py-3">
                <p className="text-xs text-text-secondary">Blocked Requests</p>
                <p className="mt-1 text-2xl font-semibold text-text-primary">{Number(rateLimits.totalBlocked || 0)}</p>
              </div>
              <div className="rounded-xl border border-border bg-background px-3 py-3">
                <p className="text-xs text-text-secondary">Hottest Limiter</p>
                <p className="mt-1 text-sm font-semibold text-text-primary">{hottestLimiter ? formatLimiterLabel(hottestLimiter.label) : "No limiter pressure"}</p>
                <p className="text-xs text-text-secondary">{hottestLimiter ? `${hottestLimiter.blocked} blocked` : "No blocked requests recorded"}</p>
              </div>
              <div className="rounded-xl border border-border bg-background px-3 py-3">
                <p className="text-xs text-text-secondary">Last Updated</p>
                <p className="mt-1 text-sm font-semibold text-text-primary">{formatMetricTimestamp(rateLimits.generatedAt)}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-background px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Top Limiters</p>
                {rateLimits.topScopes?.length ? (
                  <div className="mt-3 space-y-2">
                    {rateLimits.topScopes.map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                        <span className="font-medium text-text-primary">{formatLimiterLabel(item.label)}</span>
                        <span className="text-text-secondary">{item.blocked}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-text-secondary">No exam limiter hits recorded for this window.</p>
                )}
              </div>

              <div className="rounded-xl border border-border bg-background px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Top Blocked Routes</p>
                {rateLimits.topRoutes?.length ? (
                  <div className="mt-3 space-y-2">
                    {rateLimits.topRoutes.map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                        <span className="font-mono text-xs text-text-primary">{item.label}</span>
                        <span className="text-text-secondary">{item.blocked}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-text-secondary">No blocked exam routes yet.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border">
          <CardHeader>
            <CardTitle>Blocked Clients</CardTitle>
            <p className="text-sm text-text-secondary">Anonymized actors with the highest blocked exam traffic.</p>
          </CardHeader>
          <CardContent>
            {rateLimits.topActors?.length ? (
              <div className="space-y-2">
                {rateLimits.topActors.map((item) => (
                  <div key={item.label} className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-mono text-xs text-warning">{item.label}</p>
                      <p className="text-sm font-semibold text-warning">{item.blocked}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">No blocked actors recorded for exam rate limits.</p>
            )}
            {hottestActor ? (
              <p className="mt-3 text-xs text-text-secondary">
                Highest blocked actor right now: {hottestActor.label} with {hottestActor.blocked} blocked requests.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Student Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div ref={parentRef} className={virtualized ? "max-h-112 overflow-y-auto" : ""}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-secondary">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2">Progress</th>
                  <th className="px-3 py-2">Time Left</th>
                  <th className="px-3 py-2">Violations</th>
                  <th className="px-3 py-2">Connection</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {virtualized ? rowVirtualizer.getVirtualItems().map((virtualRow) => renderRow(studentRows[virtualRow.index])) : studentRows.map((row) => renderRow(row))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ViolationFeed items={violationFeed} />

      <AlertDialog open={forceDialog.open} onOpenChange={(open) => setForceDialog((prev) => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force Submit Attempt</AlertDialogTitle>
            <AlertDialogDescription>This action is irreversible. Provide a reason.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={forceDialog.reason} onChange={(event) => setForceDialog((prev) => ({ ...prev, reason: event.target.value }))} placeholder="Reason for force submit" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!forceDialog.reason.trim()} onClick={forceSubmit}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={extendDialog.open} onOpenChange={(open) => setExtendDialog((prev) => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Extend Time</AlertDialogTitle>
            <AlertDialogDescription>Add extra minutes for this student attempt.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input type="number" min={1} max={120} value={extendDialog.minutes} onChange={(event) => setExtendDialog((prev) => ({ ...prev, minutes: Number(event.target.value) }))} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={extendTime}>Apply</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
