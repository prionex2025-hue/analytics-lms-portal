export default function PermissionDenied({ action = "perform this action" }) {
  return (
    <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
      You no longer have permission to {action}. If this seems incorrect, contact a super admin.
    </div>
  );
}
