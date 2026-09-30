import { Callout } from "@/components/common/page-kit";
import { ShieldAlert } from "lucide-react";

export default function PermissionDenied({ action = "perform this action" }) {
  return (
    <Callout tone="warning" icon={ShieldAlert} title="Access restricted">
      You no longer have permission to {action}. If this seems incorrect, contact a super admin.
    </Callout>
  );
}
