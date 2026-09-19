import LearningResourcesWorkspace from "@/components/LearningResources/LearningResourcesWorkspace";
import usePermission from "@/hooks/usePermission";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";

export default function AdminLearningResourcesPage() {
  const canManageResources = usePermission(ADMIN_PERMISSIONS.MANAGE_RESOURCES);
  const canViewAnalytics = usePermission(ADMIN_PERMISSIONS.VIEW_ANALYTICS) || canManageResources;

  return (
    <LearningResourcesWorkspace
      role="admin"
      title="Learning Resources"
      canManage={canManageResources}
      canViewAnalytics={canViewAnalytics}
    />
  );
}
