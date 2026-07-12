import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { requirePermission } from "@/server/security/context";
import { BranchManager } from "./branch-manager";

export const dynamic = "force-dynamic";

export default async function BranchesPage() {
  const session = await requireCurrentTenant();
  requirePermission(session, "branch.view");

  const scope = await resolveTenantAccessScope(db, session);
  const [tenant, allBranchCount, branches] = await Promise.all([
    db.tenant.findUnique({
      where: { id: session.tenantId },
      include: { subscription: { include: { plan: true } } },
    }),
    db.branch.count({ where: { tenantId: session.tenantId } }),
    db.branch.findMany({
      where: {
        tenantId: session.tenantId,
        id: { in: scope.branchIds },
      },
      include: {
        _count: {
          select: {
            userAssignments: true,
            inventories: true,
            shifts: true,
            sales: true,
          },
        },
      },
      orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
    }),
  ]);

  if (!tenant) redirect("/login");

  const maxBranches = tenant.subscription?.plan.maxBranches ?? Math.max(1, allBranchCount);
  const activeBranches = branches.filter((branch) => branch.status === "ACTIVE").length;
  const totalStaffAssignments = branches.reduce((sum, branch) => sum + branch._count.userAssignments, 0);
  const totalSales = branches.reduce((sum, branch) => sum + branch._count.sales, 0);
  const roleLabel = scope.roleNames.join(", ") || "Tenant user";

  return (
    <PortalShell title="Branches" role={roleLabel} current="branches" branchName={`${tenant.name} · ${tenant.code}`}>
      <section className="branch-page-heading">
        <div>
          <small>BUSINESS LOCATIONS</small>
          <h3>Branches, teams, stock, and sales locations</h3>
          <p>Every branch belongs only to {tenant.name}. Staff, inventory, shifts, and completed sales are isolated by tenant and branch.</p>
        </div>
        <BranchManager
          canCreate={session.permissions.has("branch.create") && scope.isTenantAdmin}
          branchCount={allBranchCount}
          maxBranches={maxBranches}
          defaultTimezone={tenant.timezone}
        />
      </section>

      <section className="branch-summary-grid">
        <article><small>Total branches</small><strong>{allBranchCount}</strong><span>Plan limit {maxBranches}</span></article>
        <article><small>Active branches</small><strong>{activeBranches}</strong><span>Available for operations</span></article>
        <article><small>Staff allocations</small><strong>{totalStaffAssignments}</strong><span>Across visible branches</span></article>
        <article><small>Recorded sales</small><strong>{totalSales}</strong><span>Across visible branches</span></article>
      </section>

      {branches.length === 0 ? (
        <article className="panel branch-empty-state">
          <span>＋</span>
          <h3>No branch is visible</h3>
          <p>Create the first branch or ask the tenant administrator to assign your account to a branch.</p>
        </article>
      ) : (
        <section className="branch-card-grid">
          {branches.map((branch) => {
            const location = [branch.address, branch.town, branch.county].filter(Boolean).join(", ") || "Address not provided";
            return (
              <article className="branch-card" key={branch.id}>
                <div className="branch-card-head">
                  <span className="branch-mark">{branch.name.slice(0, 2).toUpperCase()}</span>
                  <div>
                    <small>{branch.code}</small>
                    <h3>{branch.name}</h3>
                  </div>
                  <span className={`branch-status ${branch.status.toLowerCase()}`}>{branch.status.toLowerCase()}</span>
                </div>

                <div className="branch-badges">
                  {branch.isHeadOffice && <span>Head office</span>}
                  <span>{branch.timezone}</span>
                </div>

                <dl className="branch-details">
                  <div><dt>Location</dt><dd>{location}</dd></div>
                  <div><dt>Phone</dt><dd>{branch.phone ?? "Not provided"}</dd></div>
                  <div><dt>Email</dt><dd>{branch.email ?? "Not provided"}</dd></div>
                </dl>

                <div className="branch-card-metrics">
                  <div><strong>{branch._count.userAssignments}</strong><small>staff</small></div>
                  <div><strong>{branch._count.inventories}</strong><small>stock lines</small></div>
                  <div><strong>{branch._count.shifts}</strong><small>shifts</small></div>
                  <div><strong>{branch._count.sales}</strong><small>sales</small></div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </PortalShell>
  );
}
