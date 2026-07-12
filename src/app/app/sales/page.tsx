import { redirect } from "next/navigation";
import { LiveDataRefresh } from "@/components/live-data-refresh";
import { PortalShell } from "@/components/portal-shell";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { requirePermission } from "@/server/security/context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function dayRange() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const start = new Date(`${values.year}-${values.month}-${values.day}T00:00:00+03:00`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export default async function SalesPage() {
  const session = await requireCurrentTenant();
  requirePermission(session, "sale.view");
  const scope = await resolveTenantAccessScope(db, session);
  const { start, end } = dayRange();

  const [tenant, sales] = await Promise.all([
    db.tenant.findUnique({ where: { id: session.tenantId } }),
    db.sale.findMany({
      where: {
        tenantId: session.tenantId,
        branchId: { in: scope.branchIds },
      },
      include: {
        branch: { select: { id: true, code: true, name: true, tenantId: true } },
        cashier: { select: { id: true, fullName: true, staffNumber: true, tenantId: true } },
        customer: { select: { id: true, fullName: true, tenantId: true } },
        payments: {
          where: { tenantId: session.tenantId },
          select: { method: true, amount: true, status: true, externalReference: true },
        },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  if (!tenant) redirect("/login");

  const completed = sales.filter((sale) => sale.status === "COMPLETED");
  const today = completed.filter((sale) => sale.createdAt >= start && sale.createdAt < end);
  const todayTotal = today.reduce((sum, sale) => sum + Number(sale.total), 0);
  const allTotal = completed.reduce((sum, sale) => sum + Number(sale.total), 0);
  const totalPaid = completed.reduce((sum, sale) => sum + Number(sale.paid), 0);
  const currency = tenant.currency || "KES";
  const roleLabel = scope.roleNames.join(", ") || "Tenant user";

  return (
    <PortalShell title="Sales" role={roleLabel} current="sales" branchName={`${tenant.name} · ${tenant.code}`}>
      <section className="sales-page-heading">
        <div>
          <small>TENANT SALES REGISTER</small>
          <h3>Completed staff POS sales</h3>
          <p>Only sales belonging to {tenant.name} and the branches this account can access are shown here.</p>
        </div>
        <LiveDataRefresh />
      </section>

      <section className="sales-summary-grid">
        <article><small>Sales today</small><strong>{formatMoney(todayTotal, currency)}</strong><span>{today.length} transaction{today.length === 1 ? "" : "s"}</span></article>
        <article><small>Completed sales</small><strong>{completed.length}</strong><span>Latest 200 records</span></article>
        <article><small>Completed value</small><strong>{formatMoney(allTotal, currency)}</strong><span>Visible branch scope</span></article>
        <article><small>Payments received</small><strong>{formatMoney(totalPaid, currency)}</strong><span>Across completed sales</span></article>
      </section>

      <article className="panel sales-register-panel">
        <div className="sales-register-heading">
          <div><small>LIVE TRANSACTIONS</small><h3>Sales history</h3></div>
          <span>{sales.length} record{sales.length === 1 ? "" : "s"}</span>
        </div>

        {sales.length === 0 ? (
          <div className="empty-state">
            <span>0</span>
            <h3>No sales recorded</h3>
            <p>A completed checkout by an assigned staff member will appear here automatically.</p>
          </div>
        ) : (
          <div className="sales-table-wrap">
            <div className="sales-table-row sales-table-head">
              <span>Sale</span><span>Branch</span><span>Cashier</span><span>Customer</span><span>Payment</span><span>Total</span><span>Status</span><span>Time</span>
            </div>
            {sales.map((sale) => {
              const paymentMethods = sale.payments.map((payment) => payment.method).join(", ") || "No payment";
              return (
                <div className="sales-table-row" key={sale.id}>
                  <div><strong>{sale.saleNumber}</strong><small>{sale._count.items} item{sale._count.items === 1 ? "" : "s"}</small></div>
                  <div><strong>{sale.branch.name}</strong><small>{sale.branch.code}</small></div>
                  <div><strong>{sale.cashier.fullName}</strong><small>@{sale.cashier.staffNumber}</small></div>
                  <div><strong>{sale.customer?.fullName ?? "Walk-in customer"}</strong><small>{sale.customer ? "Customer account" : "No customer selected"}</small></div>
                  <div><strong>{paymentMethods}</strong><small>{formatMoney(sale.payments.reduce((sum, payment) => sum + Number(payment.amount), 0), currency)}</small></div>
                  <strong>{formatMoney(Number(sale.total), currency)}</strong>
                  <span className={`sales-status ${sale.status.toLowerCase()}`}>{sale.status.toLowerCase().replaceAll("_", " ")}</span>
                  <time dateTime={sale.createdAt.toISOString()}>{sale.createdAt.toLocaleString("en-KE", { timeZone: tenant.timezone, dateStyle: "short", timeStyle: "short" })}</time>
                </div>
              );
            })}
          </div>
        )}
      </article>
    </PortalShell>
  );
}
