import { studentApi } from "@/services/studentApi";

export const activeAttemptsQueryOptions = () => ({
  queryKey: ["student", "attempts", "active"],
  queryFn: studentApi.getActiveAttempts,
  staleTime: 15 * 1000,
  refetchOnWindowFocus: true,
});

export const upcomingTestsQueryOptions = () => ({
  queryKey: ["student", "tests", "upcoming"],
  queryFn: studentApi.getUpcomingTests,
  staleTime: 60 * 1000,
  refetchOnWindowFocus: true,
});

export const testSessionQueryOptions = (testId) => ({
  queryKey: ["student", "tests", "session", testId],
  queryFn: () => studentApi.getTestSession(testId),
  staleTime: 60 * 1000,
  refetchOnWindowFocus: false,
  retry: false,
});

export const attemptResultQueryOptions = (attemptId) => ({
  queryKey: ["student", "results", attemptId],
  queryFn: () => studentApi.getAttemptResult(attemptId),
  staleTime: 0,
  refetchOnWindowFocus: false,
  retry: false,
});

export const testAccessQueryOptions = (testId) => ({
  queryKey: ["student", "tests", "access", testId],
  queryFn: () => studentApi.getTestAccessDetails(testId),
  staleTime: 15 * 1000,
  refetchOnWindowFocus: true,
  retry: false,
});

export const leaderboardQueryOptions = (filters = {}) => ({
  queryKey: ["student", "leaderboard", filters],
  queryFn: () => studentApi.getLeaderboard(filters),
  staleTime: 60 * 1000,
  refetchOnWindowFocus: true,
});

export const reportsQueryOptions = (filters = {}) => ({
  queryKey: ["student", "reports", filters],
  queryFn: () => studentApi.getReports(filters),
  staleTime: 120 * 1000,
  refetchOnWindowFocus: true,
});

export const eventsQueryOptions = () => ({
  queryKey: ["student", "events"],
  queryFn: () => studentApi.getEvents(),
  staleTime: 60 * 1000,
  refetchOnWindowFocus: true,
});

export const profileQueryOptions = () => ({
  queryKey: ["student", "profile"],
  queryFn: () => studentApi.me(),
  staleTime: 120 * 1000,
  refetchOnWindowFocus: false,
});

export const settingsQueryOptions = () => ({
  queryKey: ["student", "settings"],
  queryFn: () => studentApi.me(),
  staleTime: 120 * 1000,
  refetchOnWindowFocus: false,
});
