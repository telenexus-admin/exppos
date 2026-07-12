import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { requirePermission } from "@/server/security/context";
import { AddStaffForm } from "./add-staff-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "ST";
}

export default async function StaffPage() {
  const session = await requireCurrentTenant();
  requirePermission(session, "staff.view");
  const scope = await resolveTenantAccessScope(db, session);

  const [tenant, branches, staff] = await Promise.all([
    db.tenant.findUnique({
      where: { id: session.tenantId },
      include: { subscription: { include: { plan: true } } },
    }),
    db.branch.findMany({
      where: {
        tenantId: session.tenantId,
        status: "ACTIVE",
        id: { in: scope.branchIds },
      },
      select: { id: true, name: true, code: true },
      orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
    }),
    db.user.findMany({
      where: {
        tenantId: session.tenantId,
        ...(scope.isTenantAdmin
          ? {}
          : {
              branches: {
                some: {
                  branchId: { in: scope.branchIds },
                  branch: { tenantId: session.tenantId },
                },
              },
            }),
      },
      include: {
        roles: {
          where: { role: { tenantId: session.tenantId } },
          include: { role: true },
        },
        branches: {
          where: { branch: { tenantId: session.tenantId } },
          include: { branch: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!tenant) redirect("/login");

  const viewerRole = scope.roleNames.join(", ") || "Tenant user";
  const maxUsers = tenant.subscription?.plan.maxUsers ?? 1;

  return (
    <PortalShell title="Staff management" role={viewerRole} current="staff" branchName={`${tenant.name} · ${tenant.code}`}>
      <div className="tenant-isolation-notice">
        <strong>{tenant.name}</strong>
        <span>Tenant code {tenant.code} · Only this account&apos;s staff and branch assignments are displayed.</span>
      </div>

      <div className="staff-layout">
        <article className="staff-panel">
          <div className="staff-panel-head">
            <div>
              <small>TEAM DIRECTORY</small>
              <h3>Staff accounts</h3>
              <p>Manage staff login usernames, roles, and branch allocation for {tenant.name}.</p>
            </div>
            <span className="staff-count-badge">{staff.length} / {maxUsers} users</span>
          </div>

          {staff.length === 0 ? (
            <div className="staff-empty-state">
              <span>ST</span>
              <h3>No staff accounts yet</h3>
              <p>Create the first staff login using the form.</p>
            </div>
          ) : (
            <>
              <div className="staff-table-head">
                <span>Staff member</span>
                <span>Role</span>
                <span>Branch</span>
                <span>Status</span>
              </div>
              {staff.map((member) => {
                const visibleEmail = member.email.endsWith(".staff.local") ? null : member.email;
                const roleNames = member.roles.map(({ role }) => role.name).join(", ") || "No role";
                const branchNames = member.branches.map(({ branch }) => branch.name).join(", ") || "No branch";

                return (
                  <div className="staff-table-row" key={member.id}>
                    <div className="staff-identity">
                      <span className="staff-avatar">{initials(member.fullName)}</span>
                      <div>
                        <strong>{member.fullName}</strong>
                        <small>@{member.staffNumber}{visibleEmail ? ` · ${visibleEmail}` : ""}</small>
                      </div>
                    </div>
                    <div className="staff-role-cell"><span>{roleNames}</span><small>Access level</small></div>
                    <div className="staff-branch-cell"><span>{branchNames}</span><small>Assigned location</small></div>
                    <span className={`staff-status ${member.status.toLowerCase()}`}>{member.status.toLowerCase()}</span>
                  </div>
                );
              })}
            </>
          )}
        </article>

        <AddStaffForm branches={branches} currentUsers={staff.length} maxUsers={maxUsers} />
      </div>
    </PortalShell>
  );
}
