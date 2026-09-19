import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { activeAttemptsQueryOptions } from "@/services/studentQueries";

const getAttemptIdToResume = (items) => {
  if (!Array.isArray(items)) {
    return null;
  }

  const inProgress = items.find((item) => {
    const status = String(item?.latestSubmissionStatus || "").toUpperCase();
    return Boolean(item?.submissionId) && status === "IN_PROGRESS";
  });

  return inProgress?.submissionId || null;
};

export default function ResumeAttemptPage() {
  const navigate = useNavigate();
  const activeAttemptsQuery = useQuery(activeAttemptsQueryOptions());

  const attemptId = useMemo(
    () => getAttemptIdToResume(activeAttemptsQuery.data?.items),
    [activeAttemptsQuery.data?.items]
  );

  useEffect(() => {
    if (activeAttemptsQuery.isLoading) {
      return;
    }

    if (attemptId) {
      navigate(`/test/${attemptId}`, { replace: true });
      return;
    }

    navigate("/tests/ongoing", { replace: true });
  }, [activeAttemptsQuery.isLoading, attemptId, navigate]);

  if (activeAttemptsQuery.isError) {
    return <div className="grid min-h-[40vh] place-items-center text-text-secondary">Unable to check active test. Redirecting...</div>;
  }

  return <div className="grid min-h-[40vh] place-items-center text-text-secondary">Checking your active test session...</div>;
}
