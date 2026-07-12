import { redirect } from "next/navigation";
import { LiveDataRefresh } from "@/components/live-data-refresh";
import { PortalShell } from "@/components/portal-shell";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NAIROBI_TIMEZONE = "Africa/Nairobi";

function nairobiDayRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NAIROBI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const start = new Date(`${values.year}-${values.month}-${values.day}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start, end };
}

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

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-KE", { maximumFractionDigits: 3 }).format(value);
}

export default async function Dashboard() {
  const session = await requireCurrentTenant();
  const scope = await resolveTenantAccessScope(db, session);
  const branchIds = scope.branchIds;
  const { start, end } = nairobiDayRange();

  const user = await db.user.findFirst({
    where: {
      id: session.userId,
      tenantId: session.tenantId,
      status: "ACTIVE",
    },
    include: {
      tenant: true,
      roles: {
        where: { role: { tenantId: session.tenantId } },
        include: { role: true },
      },
    },
  });

  if (!user) redirect("/login");

  const [sales, activeShifts, inventoryRows, outstandingInvoices, recentSales] = await Promise.all([
    db.sale.findMany({
      where: {
        tenantId: session.tenantId,
        branchId: { in: branchIds },
        status: "COMPLETED",
        createdAt: { gte: start, lt: end },
      },
      select: {
        createdAt: true,
        total: true,
        items: {
          select: {
            quantity: true,
            unitCost: true,
            total: true,
            tax: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.shift.count({
      where: {
        tenantId: session.tenantId,
        branchId: { in: branchIds },
        status: "OPEN",
      },
    }),
    db.branchInventory.findMany({
      where: {
        tenantId: session.tenantId,
        branchId: { in: branchIds },
        product: { tenantId: session.tenantId, status: "active" },
      },
      include: {
        product: { select: { name: true } },
        branch: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    db.invoice.findMany({
      where: {
        tenantId: session.tenantId,
        branchId: { in: branchIds },
        balance: { gt: 0 },
        status: { notIn: ["CANCELLED", "VOIDED", "REFUNDED"] },
      },
      select: { balance: true },
    }),
    db.sale.findMany({
      where: {
        tenantId: session.tenantId,
        branchId: { in: branchIds },
        status: "COMPLETED",
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        cashier: { select: { id: true, fullName: true, staffNumber: true, tenantId: true } },
        payments: {
          where: { tenantId: session.tenantId, status: "COMPLETED" },
          select: { method: true, amount: true },
        },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const salesToday = sales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const grossProfit = sales.reduce(
    (saleSum, sale) =>
      saleSum +
      sale.items.reduce(
        (itemSum, item) =>
          itemSum +
          Number(item.total) -
          Number(item.tax) -
          Number(item.unitCost) * Number(item.quantity),
        0,
      ),
    0,
  );

  const lowStockRows = inventoryRows.filter((row) => row.quantity.lte(row.reorderLevel));
  const outstandingBalance = outstandingInvoices.reduce(
    (sum, invoice) => sum + Number(invoice.balance),
    0,
  );

  const salesByTwoHours = Array.from({ length: 12 }, () => 0);
  const hourFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: NAIROBI_TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23",
  });

  for (const sale of sales) {
    const hour = Number(hourFormatter.format(sale.createdAt));
    const bucket = Math.min(11, Math.floor(hour / 2));
    salesByTwoHours[bucket] += Number(sale.total);
  }

  const maximumBucket = Math.max(...salesByTwoHours, 0);
  const firstName = user.fullName.trim().split(/\s+/)[0] || user.fullName;
  const roleLabel = scope.roleNames.join(", ") || "Team member";
  const currency = user.tenant.currency || "KES";

  const metrics = [
    [
      "Sales today",
      formatMoney(salesToday, currency),
      sales.length ? `${sales.length} completed sale${sales.length === 1 ? "" : "s"}` : "No sales recorded",
    ],
    ["Gross profit", formatMoney(grossProfit, currency), sales.length ? "From completed sales" : "No sales recorded"],
    ["Transactions", String(sales.length), "Today"],
    ["Active shifts", String(activeShifts), activeShifts ? "Currently open" : "No open shifts"],
    ["Low stock", String(lowStockRows.length), lowStockRows.length ? "Needs attention" : "No alerts"],
    [
      "Receivables",
      formatMoney(outstandingBalance, currency),
      `${outstandingInvoices.length} outstanding invoice${outstandingInvoices.length === 1 ? "" : "s"}`,
    ],
  ];

  return (
    <PortalShell
      title={`Welcome, ${firstName}`}
      role={roleLabel}
      branchName={`${user.tenant.name} · ${user.tenant.code}`}
    >
      <div className="dashboard-live-row">
        <div className="filters">
          <button className="chip active" type="button">Today</button>
          <button className="chip" type="button" disabled>This week</button>
          <button className="chip" type="button" disabled>This month</button>
          <button className="chip" type="button" disabled>{scope.isTenantAdmin ? "All tenant branches" : "Assigned branches"}</button>
        </div>
        <LiveDataRefresh />
      </div>

      <div className="metrics">
        {metrics.map(([name, value, detail]) => (
          <article className="metric" key={name}>
            <small>{name}</small>
            <strong>{value}</strong>
            <span>{detail}</span>
          </article>
        ))}
      </div>

      <div className="grid">
        <article className="panel chart">
          <div className="panel-head">
            <div>
              <small>PERFORMANCE</small>
              <h3>Sales by hour</h3>
            </div>
            <a className="notification-link" href="/app/sales">View sales</a>
          </div>

          {sales.length === 0 ? (
            <div className="empty-state">
              <span>0</span>
              <h3>No sales recorded today</h3>
              <p>Completed staff POS sales for this account will appear here automatically.</p>
            </div>
          ) : (
            <div className="bars" aria-label="Sales grouped into two-hour intervals">
              {salesByTwoHours.map((amount, index) => (
                <i
                  key={index}
                  title={`${String(index * 2).padStart(2, "0")}:00–${String(index * 2 + 1).padStart(2, "0")}:59: ${formatMoney(amount, currency)}`}
                  style={{
                    height:
                      maximumBucket > 0 && amount > 0
                        ? `${Math.max(4, Math.round((amount / maximumBucket) * 100))}%`
                        : "0%",
                  }}
                />
              ))}
            </div>
          )}
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <small>ATTENTION</small>
              <h3>Inventory alerts</h3>
            </div>
            <span className="badge">{lowStockRows.length} items</span>
          </div>

          {lowStockRows.length === 0 ? (
            <div className="empty-state">
              <span>✓</span>
              <h3>No low-stock alerts</h3>
              <p>Products will appear here when their stock reaches the configured reorder level.</p>
            </div>
          ) : (
            lowStockRows.slice(0, 4).map((row) => (
              <div className="list-row" key={row.id}>
                <span className="product-icon">{row.product.name.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{row.product.name}</strong>
                  <small>{row.branch.name} · {formatQuantity(Number(row.quantity))} remaining</small>
                </div>
                <a className="notification-link" href="/app/inventory">View</a>
              </div>
            ))
          )}
        </article>
      </div>

      <article className="panel dashboard-sales-panel">
        <div className="panel-head">
          <div>
            <small>LIVE SALES REGISTER</small>
            <h3>Latest completed sales</h3>
            <p>Sales are isolated to {user.tenant.name} and the branches this account is allowed to view.</p>
          </div>
          <a className="notification-link" href="/app/sales">Open full sales register</a>
        </div>

        {recentSales.length === 0 ? (
          <div className="empty-state">
            <span>0</span>
            <h3>No completed sales yet</h3>
            <p>When a staff member completes checkout, the sale will appear here within 15 seconds.</p>
          </div>
        ) : (
          <div className="dashboard-sales-table-wrap">
            <div className="dashboard-sales-row dashboard-sales-head">
              <span>Sale</span><span>Branch</span><span>Cashier</span><span>Payment</span><span>Total</span><span>Time</span>
            </div>
            {recentSales.map((sale) => (
              <div className="dashboard-sales-row" key={sale.id}>
                <div><strong>{sale.saleNumber}</strong><small>{sale._count.items} item{sale._count.items === 1 ? "" : "s"}</small></div>
                <div><strong>{sale.branch.name}</strong><small>{sale.branch.code}</small></div>
                <div><strong>{sale.cashier.fullName}</strong><small>@{sale.cashier.staffNumber}</small></div>
                <div><strong>{sale.payments.map((payment) => payment.method).join(", ") || "Unspecified"}</strong><small>{sale.payments.length} payment{sale.payments.length === 1 ? "" : "s"}</small></div>
                <strong>{formatMoney(Number(sale.total), currency)}</strong>
                <time dateTime={sale.createdAt.toISOString()}>{sale.createdAt.toLocaleString("en-KE", { timeZone: user.tenant.timezone, dateStyle: "short", timeStyle: "short" })}</time>
              </div>
            ))}
          </div>
        )}
      </article>
    </PortalShell>
  );
}
