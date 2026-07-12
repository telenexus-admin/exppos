import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { StaffManager } from "@/components/staff-manager";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const session = await requireCurrentTenant();
  if (!session.permissions.has("staff.view")) redirect("/app/dashboard");

  const [tenant, branches, users] = await Promise.all([
    db.tenant.findFirst({
      where: { id: session.tenantId },
      select: { code: true, subscription: { select: { plan: { select: { maxUsers: true } } } } },
    }),
    db.branch.findMany({
      where: { tenantId: session.tenantId, status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
    }),
    db.user.findMany({
      where: { tenantId: session.tenantId },
      select: {
        id: true,
        staffNumber: true,
        fullName: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        roles: { select: { role: { select: { code: true, name: true } } } },
        branches: { select: { branch: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!tenant) redirect("/login");

  const activeUsers = users.filter((user) => user.status === "ACTIVE").length;
  const maxUsers = tenant.subscription?.plan.maxUsers ?? users.length;
  const availableSlots = Math.max(0, maxUsers - users.length);

  return (
    <PortalShell title="Staff & access" role="Tenant Administrator" current="staff">
      <section className="staff-page-heading">
        <div><p className="eyebrow">TEAM MANAGEMENT</p><h3>Give every employee the right access</h3><p>Create secure staff logins, assign each person to a branch and control what they can do in the POS.</p></div>
        <StaffManager branches={branches} businessCode={tenant.code} canCreate={session.permissions.has("staff.create") && session.permissions.has("staff.assign_role") && availableSlots > 0} />
      </section>

      <div className="staff-summary-grid">
        <article><small>Total staff</small><strong>{users.length}</strong><span>Including administrators</span></article>
        <article><small>Active accounts</small><strong>{activeUsers}</strong><span>Can sign in now</span></article>
        <article><small>Active branches</small><strong>{branches.length}</strong><span>Available for assignment</span></article>
        <article><small>Available slots</small><strong>{availableSlots}</strong><span>Plan limit: {maxUsers}</span></article>
      </div>

      <article className="panel staff-directory">
        <div className="panel-head"><div><small>DIRECTORY</small><h3>Staff accounts</h3></div><span className="staff-count">{users.length} accounts</span></div>
        {users.length === 0 ? (
          <div className="empty-state"><span>0</span><h3>No staff accounts</h3><p>Add the first employee and assign their branch and role.</p></div>
        ) : (
          <div className="staff-table-wrap">
            <div className="staff-table staff-table-head"><span>Team member</span><span>Username</span><span>Role</span><span>Branch</span><span>Status</span></div>
            {users.map((user) => (
              <div className="staff-table" key={user.id}>
                <div className="staff-person"><span>{user.fullName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><strong>{user.fullName}</strong><small>{user.email}{user.phone ? ` · ${user.phone}` : ""}</small></div></div>
                <code>{user.staffNumber}</code>
                <span>{user.roles.map(({ role }) => role.name).join(", ") || "No role"}</span>
                <span>{user.branches.map(({ branch }) => branch.name).join(", ") || "Unassigned"}</span>
                <span className={`account-status ${user.status.toLowerCase()}`}>{user.status}</span>
              </div>
            ))}
          </div>
        )}
      </article>
    </PortalShell>
  );
}
