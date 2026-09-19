import AdminPortalLayout from "@/components/Admin/AdminPortalLayout";

export default function CollegeAdminPortalLayout() {
  return (
    <AdminPortalLayout
      basePath="/college-admin"
      portalTitle="College Admin Portal"
      portalDescription="College-wide controls and analytics"
      logoutTitle="Logout from College Admin Portal"
      logoutDescription="You will be signed out from this college admin session and need to login again."
      workspaceLabel="College Admin Workspace"
    />
  );
}
