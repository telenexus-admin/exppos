import { TenantStatus } from "@prisma/client";
import { OperatorShell } from "@/components/operator-shell";
import { prisma } from "@/lib/prisma";

const labels: Record<TenantStatus, string> = {
  TRIAL: "Trial",
  ACTIVE: "Active",
  GRACE_PERIOD: "Grace period",
  EXPIRED: "Expired",
  SUSPENDED: "Suspended",
  CANCELLED: "Cancelled",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; plan?: string; removed?: string }> }) {
  const query = await searchParams;
  const tenants = await prisma.tenant.findMany({
    where: {
      status: { not: TenantStatus.CANCELLED },
      ...(query.q ? { OR: [
        { name: { contains: query.q, mode: "insensitive" } },
        { code: { contains: query.q, mode: "insensitive" } },
        { slug: { contains: query.q, mode: "insensitive" } },
      ] } : {}),
      ...(query.status && query.status !== "all" ? { status: query.status.toUpperCase().replace(" ", "_") as TenantStatus } : {}),
      ...(query.plan && query.plan !== "all" ? { subscription: { plan: { name: query.plan } } } : {}),
    },
    include: {
      subscription: { include: { plan: true } },
      _count: { select: { branches: true, users: true } },
      sales: { select: { total: true }, where: { createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return <OperatorShell title="POS clients" current="tenants">
    {query.removed && <div className="operator-notice">✓ POS client removed from the active list. The record remains recoverable.</div>}
    <form className="operator-toolbar" method="get">
      <div className="operator-search"><input name="q" defaultValue={query.q} placeholder="Search business, code or tenant slug…"/><button type="submit">Search</button></div>
      <select name="status" defaultValue={query.status ?? "all"}><option value="all">All statuses</option><option>Active</option><option>Trial</option><option>Grace period</option><option>Suspended</option></select>
      <select name="plan" defaultValue={query.plan ?? "all"}><option value="all">All plans</option><option>Starter</option><option>Growth</option><option>Business</option></select>
      <button type="submit">Apply filters</button>
    </form>
    <article className="operator-card tenant-table">
      <div className="operator-table-row operator-table-head"><span>Business</span><span>Plan</span><span>Usage</span><span>Sales volume</span><span>Subscription</span><span>Status</span></div>
      {tenants.map(t => {
        const sales = t.sales.reduce((sum, sale) => sum + Number(sale.total), 0);
        return <a className="operator-table-row" href={`/operator/tenants/${t.slug}`} key={t.id}>
          <span className="business-cell"><i>{t.name.split(" ").map(x => x[0]).slice(0,2)}</i><span><strong>{t.name}</strong><small>{t.code} · {t.slug}</small></span></span>
          <span>{t.subscription?.plan.name ?? "No plan"}</span>
          <span>{t._count.branches} branches<br/><small>{t._count.users} users</small></span>
          <strong>KES {sales.toLocaleString()}</strong>
          <span>{t.subscription?.expiresAt?.toLocaleDateString("en-KE") ?? t.subscription?.trialEndsAt?.toLocaleDateString("en-KE") ?? "Not set"}</span>
          <em className={`tenant-status ${labels[t.status].toLowerCase().replace(" ", "-")}`}>{labels[t.status]}</em>
        </a>;
      })}
      {tenants.length === 0 && <div className="operator-empty">No POS clients match these filters. <a href="/operator/tenants">Clear filters</a></div>}
    </article>
  </OperatorShell>;
}
