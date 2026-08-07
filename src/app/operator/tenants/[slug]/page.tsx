import { notFound } from "next/navigation";
import { DASHBOARD_MANAGER_ROLE_PREFIX, dashboardSectionsFromPermissions } from "@/lib/dashboard-access";
import { DeleteTenantButton } from "@/components/delete-tenant-button";
import { OperatorActionButton } from "@/components/operator-action-button";
import { OperatorShell } from "@/components/operator-shell";
import { ResetTenantAdminPassword } from "@/components/reset-tenant-admin-password";
import { db } from "@/lib/db";
import { OperatorAccessAccountForm } from "./access-account-form";

export const dynamic = "force-dynamic";

export default async function TenantDetails({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;

  const tenant = await db.tenant.findFirst({
    where: { slug, status: { not: "CANCELLED" } },
    include: {
      subscription: { include: { plan: true } },
      branches: {
        where: { status: "ACTIVE" },
        select: { id: true, name: true, code: true },
        orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
      },
      users: {
        where: {
          roles: {
            some: {
              role: {
                OR: [
                  { code: "TENANT_ADMIN" },
                  { code: { startsWith: DASHBOARD_MANAGER_ROLE_PREFIX } },
                ],
              },
            },
          },
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          staffNumber: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          roles: {
            select: {
              role: {
                select: {
                  code: true,
                  name: true,
                  rolePermissions: { select: { permission: { select: { code: true } } } },
                },
              },
            },
          },
          branches: { select: { branch: { select: { id: true, name: true, code: true } } } },
        },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { branches: true, users: true, sales: true } },
    },
  });

  if (!tenant) notFound();

  const admin = tenant.users.find((user) => user.roles.some(({ role }) => role.code === "TENANT_ADMIN")) ?? null;
  const status = tenant.status.replaceAll("_", " ");
  const maxUsers = tenant.subscription?.plan.maxUsers ?? 1;

  return (
    <OperatorShell title={tenant.name} current="tenants">
      {query.created && (
        <div className="operator-notice">
          ✓ POS client created successfully. Use the login details shown below for the first administrator.
        </div>
      )}

      <div className="tenant-hero">
        <span className="tenant-logo large">
          {tenant.name.split(" ").map((word) => word[0]).slice(0, 2)}
        </span>
        <div>
          <p>{tenant.code} · {tenant.slug}</p>
          <h2>{tenant.name}</h2>
          <span className={`tenant-status ${tenant.status.toLowerCase().replace("_", "-")}`}>{status}</span>
        </div>
        <div className="tenant-controls">
          {admin && <ResetTenantAdminPassword tenantId={tenant.id} adminName={admin.fullName} />}
          <OperatorActionButton label="Extend subscription" success="Subscription extension request prepared" />
          <DeleteTenantButton id={tenant.id} name={tenant.name} />
        </div>
      </div>

      <div className="operator-metrics tenant-metrics">
        {[
          ["Plan", tenant.subscription?.plan.name ?? "No plan", tenant.subscription?.expiresAt ? `Expires ${tenant.subscription.expiresAt.toLocaleDateString("en-KE")}` : "No expiry"],
          ["Branches", String(tenant._count.branches), "Plan usage"],
          ["Users", `${tenant._count.users} / ${maxUsers}`, "Created accounts"],
          ["Transactions", String(tenant._count.sales), "All time"],
        ].map(([label, value, note]) => (
          <article key={label}><small>{label}</small><strong>{value}</strong><span>{note}</span></article>
        ))}
      </div>

      <div className="operator-grid">
        <article className="operator-card wide operator-login-credentials-card">
          <div className="operator-card-head">
            <div><small>ADMIN LOGIN</small><h2>Primary administrator credentials</h2></div>
            <a className="manage-link" href={`/api/v1/operator/tenants/${tenant.id}/open-login`} target="_blank" rel="noreferrer">
              Open isolated client login →
            </a>
          </div>

          {admin ? (
            <>
              <dl className="client-details operator-login-details">
                <div><dt>Administrator email</dt><dd>{admin.email}</dd></div>
                <div><dt>Administrator username</dt><dd>{admin.staffNumber}</dd></div>
                <div><dt>Administrator phone</dt><dd>{admin.phone ?? "Not provided"}</dd></div>
                <div><dt>Account status</dt><dd>{admin.status.toLowerCase()}</dd></div>
              </dl>
              <div className="operator-login-instructions">
                <strong>How administrators and dashboard managers sign in</strong>
                <span>Use the normal client login page with username, email, or phone plus the password issued for that account.</span>
                <span>Additional administrators get the same full dashboard. Restricted branch managers get only their assigned branches and selected tabs.</span>
                <small>Open isolated client login still clears the previous tenant session before this client signs in.</small>
              </div>
            </>
          ) : (
            <div className="operator-error">
              <strong>No tenant administrator found.</strong>
              <span>This client needs an administrator account before the admin dashboard can be accessed.</span>
            </div>
          )}
        </article>

        <article className="operator-card wide">
          <div className="operator-card-head">
            <div><small>DASHBOARD ACCESS</small><h2>Administrators & branch managers</h2></div>
            <span className="staff-count-badge">{tenant.users.length} dashboard account{tenant.users.length === 1 ? "" : "s"}</span>
          </div>
          <p>These accounts use the business dashboard. Full administrators see the whole tenant; branch managers are limited to the branches and tabs assigned by the operator.</p>

          <div className="operator-access-users">
            {tenant.users.map((user) => {
              const roles = user.roles.map(({ role }) => role);
              const isAdministrator = roles.some((role) => role.code === "TENANT_ADMIN");
              const managerRole = roles.find((role) => role.code.startsWith(DASHBOARD_MANAGER_ROLE_PREFIX));
              const permissionCodes = managerRole?.rolePermissions.map(({ permission }) => permission.code) ?? [];
              const sections = dashboardSectionsFromPermissions(permissionCodes);
              const branchNames = user.branches.map(({ branch }) => branch.name);
              const hiddenEmail = user.email.endsWith(".dashboard.local");

              return (
                <div className="activity-item operator-access-user" key={user.id}>
                  <i />
                  <div>
                    <strong>{user.fullName}</strong>
                    <small>{isAdministrator ? "Administrator · Full dashboard" : "Branch Manager"}</small>
                    <span>Username: {user.staffNumber}{hiddenEmail ? "" : ` · ${user.email}`}</span>
                    <span>Branches: {isAdministrator ? "All active branches" : branchNames.join(", ") || "No branch assigned"}</span>
                    {!isAdministrator && <span>Tabs: {sections.map((section) => section.replaceAll("-", " ")).join(", ") || "Dashboard only"}</span>}
                    <span>Status: {user.status.toLowerCase()} · {user.lastLoginAt ? `Last login ${user.lastLoginAt.toLocaleString("en-KE")}` : "Never logged in"}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <OperatorAccessAccountForm
            tenantId={tenant.id}
            tenantName={tenant.name}
            branches={tenant.branches}
            currentUsers={tenant._count.users}
            maxUsers={maxUsers}
          />
        </article>

        <article className="operator-card wide">
          <div className="operator-card-head">
            <div><small>CLIENT PROFILE</small><h2>Business details</h2></div>
            <a className="manage-link" href={`/operator/tenants/${tenant.slug}/edit`}>Edit client →</a>
          </div>
          <dl className="client-details">
            <div><dt>Business code</dt><dd>{tenant.code}</dd></div>
            <div><dt>Business slug</dt><dd>{tenant.slug}</dd></div>
            <div><dt>Business email</dt><dd>{tenant.email}</dd></div>
            <div><dt>Primary phone</dt><dd>{tenant.phone}</dd></div>
            <div><dt>Currency</dt><dd>{tenant.currency}</dd></div>
            <div><dt>Timezone</dt><dd>{tenant.timezone}</dd></div>
          </dl>
        </article>

        <article className="operator-card">
          <div className="operator-card-head"><div><small>ACCOUNT</small><h2>Tenant state</h2></div></div>
          <div className="activity-item"><i /><div><strong>{status}</strong><small>Created {tenant.createdAt.toLocaleDateString("en-KE")}</small></div></div>
          {admin && (
            <div className="activity-item"><i /><div><strong>{admin.lastLoginAt ? "Administrator has logged in" : "Administrator has not logged in"}</strong><small>{admin.lastLoginAt ? admin.lastLoginAt.toLocaleString("en-KE") : "Waiting for first successful login"}</small></div></div>
          )}
        </article>
      </div>
    </OperatorShell>
  );
}
