import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/change-password-form";
import { PortalShell } from "@/components/portal-shell";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StaffSettingsPage() {
  const session = await requireCurrentTenant();

  const user = await db.user.findFirst({
    where: { id: session.userId, tenantId: session.tenantId, status: "ACTIVE" },
    include: {
      tenant: true,
      roles: { include: { role: true } },
      branches: { include: { branch: true } },
    },
  });

  if (!user) redirect("/staff/login");

  const roleLabel = user.roles.map(({ role }) => role.name).join(", ") || "Staff member";
  const branchName = user.branches.find(({ branch }) => branch.status === "ACTIVE")?.branch.name ?? user.tenant.name;

  return (
    <PortalShell title="Settings" role={roleLabel} current="settings" basePath="/staff" branchName={branchName}>
      <div className="settings-hero">
        <div>
          <small>MY ACCOUNT</small>
          <h3>Personal security settings</h3>
          <p>Manage the password for your own staff account without changing another user or business setting.</p>
        </div>
        <span>ME</span>
      </div>
      <div className="settings-scope-notice">
        <strong>Private account setting</strong>
        <span>This password change applies only to your signed-in staff account.</span>
      </div>
      <ChangePasswordForm loginPath="/staff/login" />
    </PortalShell>
  );
}
