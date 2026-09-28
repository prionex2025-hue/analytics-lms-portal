import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { connectNotificationSocket, disconnectNotificationSocket } from "@/services/testSocket";

// Every escalations query (the inbox list and the sidebar badge) lives under this
// prefix, so one invalidation refreshes them all.
export const SUPER_ESCALATIONS_QUERY_KEY = ["super-escalations"];

const formatAnomalyType = (type) => String(type || "anomaly").replace(/_/g, " ").toLowerCase();

// Mounted once in the super admin layout. College admins' escalations and other
// super admins' decisions arrive over the SUPER_ADMIN role room; both refresh the
// escalations queries, and a new escalation also raises a toast.
export default function useSuperAdminEscalationsRealtime() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    const socket = connectNotificationSocket("super-admin");
    const refresh = () => queryClient.invalidateQueries({ queryKey: SUPER_ESCALATIONS_QUERY_KEY });

    const onEscalated = (payload = {}) => {
      refresh();
      toast.warning("New escalation", {
        description: `${payload.adminName || "A college admin"} escalated a ${formatAnomalyType(payload.anomalyType)} anomaly.`,
        action: { label: "Review", onClick: () => navigate("/super-admin/escalations") },
      });
    };

    socket.on("report:anomaly_escalated", onEscalated);
    socket.on("report:anomaly_resolved", refresh);

    return () => {
      socket.off("report:anomaly_escalated", onEscalated);
      socket.off("report:anomaly_resolved", refresh);
      disconnectNotificationSocket("super-admin");
    };
  }, [queryClient, navigate]);
}
