import LearningResourcesWorkspace from "@/components/LearningResources/LearningResourcesWorkspace";

export default function SuperAdminLearningResourcesPage() {
  return (
    <LearningResourcesWorkspace
      role="super"
      title="Global Learning Resources"
      canManage
      canViewAnalytics
    />
  );
}
