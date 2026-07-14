import { OperatorShell } from "@/components/operator-shell";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DAY_MS = 86_400_000;

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function compactMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
  }
}

function subscriptionAlert(tenant: {
  status: string;
  subscription: {
    status: string;
    trialEndsAt: Date | null;
    expiresAt: Date | null;
  } | null;
}, now: Date) {
  if (tenant.status === "SUSPENDED") return "Tenant suspended";
  if (tenant.status === "EXPIRED") return "Subscription expired";
  if (tenant.status === "GRACE_PERIOD") return "Grace period active";

  const isTrial = tenant.status === "TRIAL" || tenant.subscription?.status === "TRIAL";
  const endDate = isTrial
    ? tenant.subscription?.trialEndsAt
    : tenant.subscription?.expiresAt;

  if (!endDate) return isTrial ? "Trial account requires review" : "Subscription requires review";

  const days = Math.ceil((endDate.getTime() - now.getTime()) / DAY_MS);
  const label = isTrial ? "Trial" : "Subscription";

  if (days < 0) return `${label} expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  if (days === 0) return `${label} ends today`;
  return `${label} ends in ${days} day${days === 1 ? "" : "s"}`;
}

export default async function Page() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const alertThreshold = new Date(now.getTime() + 30 * DAY_MS);

  const [
    totalClients,
    activeClients,
    trialClients,
    newClientsThisMonth,
    monthlyTransactions,
    totalBranches,
    totalUsers,
    portfolioTenants,
    attentionTenants,
  ] = await Promise.all([
    db.tenant.count({ where: { status: { not: "CANCELLED" } } }),
    db.tenant.count({ where: { status: "ACTIVE" } }),
    db.tenant.count({ where: { status: "TRIAL" } }),
    db.tenant.count({
      where: { status: { not: "CANCELLED" }, createdAt: { gte: monthStart } },
    }),
    db.sale.count({
      where: {
        status: "COMPLETED",
        createdAt: { gte: monthStart },
        tenant: { status: { not: "CANCELLED" } },
      },
    }),
    db.branch.count({ where: { tenant: { status: { not: "CANCELLED" } } } }),
    db.user.count({ where: { tenant: { status: { not: "CANCELLED" } } } }),
    db.tenant.findMany({
      where: { status: { not: "CANCELLED" } },
      select: {
        id: true,
        name: true,
        code: true,
        slug: true,
        status: true,
        currency: true,
        subscription: { select: { plan: { select: { name: true } } } },
        _count: { select: { branches: true, users: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 4,
    }),
    db.tenant.findMany({
      where: {
        status: { not: "CANCELLED" },
        OR: [
          { status: { in: ["GRACE_PERIOD", "SUSPENDED", "EXPIRED"] } },
          { subscription: { is: { expiresAt: { lte: alertThreshold } } } },
          { subscription: { is: { trialEndsAt: { lte: alertThreshold } } } },
        ],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        subscription: {
          select: { status: true, trialEndsAt: true, expiresAt: true },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 5,
    }),
  ]);

  const portfolioIds = portfolioTenants.map((tenant) => tenant.id);
  const portfolioSales = portfolioIds.length
    ? await db.sale.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: portfolioIds }, status: "COMPLETED" },
        _sum: { total: true },
      })
    : [];
  const salesByTenant = new Map(
    portfolioSales.map((row) => [row.tenantId, Number(row._sum.total ?? 0)]),
  );

  const activePercentage = totalClients > 0
    ? ((activeClients / totalClients) * 100).toFixed(1)
    : "0.0";

  const metrics = [
    ["Total POS clients", String(totalClients), `${newClientsThisMonth} onboarded this month`],
    ["Active tenants", String(activeClients), `${activePercentage}% of current clients`],
    ["Trial tenants", String(trialClients), `${trialClients} currently on trial`],
    ["Monthly transactions", monthlyTransactions.toLocaleString("en-KE"), "Completed sales this month"],
    ["Tenant branches", totalBranches.toLocaleString("en-KE"), "Across real client accounts"],
    ["Platform users", totalUsers.toLocaleString("en-KE"), "Administrators and staff"],
  ];

  return (
    <OperatorShell title="Platform overview" current="dashboard">
      <div className="operator-metrics">
        {metrics.map(([label, value, note]) => (
          <article key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
            <span>{note}</span>
          </article>
        ))}
      </div>

      <div className="operator-grid">
        <article className="operator-card wide">
          <div className="operator-card-head">
            <div><small>PORTFOLIO</small><h2>Client activity</h2></div>
            <a href="/operator/tenants">View all clients</a>
          </div>

          <div className="tenant-list">
            {portfolioTenants.map((tenant) => (
              <a href={`/operator/tenants/${tenant.slug}`} key={tenant.id}>
                <span className="tenant-logo">
                  {tenant.name.split(" ").map((word) => word[0]).slice(0, 2)}
                </span>
                <div>
                  <strong>{tenant.name}</strong>
                  <small>
                    {tenant.subscription?.plan.name ?? "No plan"} · {tenant._count.branches} branch{tenant._count.branches === 1 ? "" : "es"} · {tenant._count.users} user{tenant._count.users === 1 ? "" : "s"}
                  </small>
                </div>
                <b>{compactMoney(salesByTenant.get(tenant.id) ?? 0, tenant.currency)}</b>
                <em className={`tenant-status ${tenant.status.toLowerCase().replaceAll("_", "-")}`}>
                  {statusLabel(tenant.status)}
                </em>
              </a>
            ))}

            {portfolioTenants.length === 0 && (
              <div className="operator-empty">
                No real POS clients have been onboarded yet. <a href="/operator/tenants/new">Onboard the first client</a>
              </div>
            )}
          </div>
        </article>

        <article className="operator-card">
          <div className="operator-card-head">
            <div><small>REQUIRES ATTENTION</small><h2>Subscription alerts</h2></div>
          </div>

          {attentionTenants.map((tenant) => (
            <a className="operator-alert" href={`/operator/tenants/${tenant.slug}`} key={tenant.id}>
              <span>!</span>
              <div>
                <strong>{tenant.name}</strong>
                <small>{subscriptionAlert(tenant, now)}</small>
              </div>
            </a>
          ))}

          {attentionTenants.length === 0 && (
            <div className="operator-empty">No real client subscriptions require attention.</div>
          )}
        </article>
      </div>
    </OperatorShell>
  );
}
