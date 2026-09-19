import { useMemo } from "react";
import { useAdminAuthState } from "@/hooks/useAdminAuthState";

export default function usePermission(permission) {
  const authState = useAdminAuthState();
  const permissionSet = useMemo(() => new Set(authState?.permissions || []), [authState]);
  return permissionSet.has(permission);
}
