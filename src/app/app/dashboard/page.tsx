import { redirect } from "next/navigation";
import { LiveDataRefresh } from "@/components/live-data-refresh";
import { PortalShell } from "@/components/portal-shell";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { normalizeTenantSettings } from "@/server/settings/tenant-settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function nairobiDayRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const start = new Date(`${values.year}-${values.month}-${values.day}T00:00:00+03:00`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

function money(value: number, currency: string) {
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

export default async function Dashboard() {
  const session = await requireCurrentTenant();
  const scope = await resolveTenantAccessScope(db, session);
  const { start, end } = nairobiDayRange();

  const user = await db.user.findFirst({
    where: { id: session.userId, tenantId: session.tenantId, status: "ACTIVE" },
    include: { tenant: { include: { settings: true } } },
  });
  if (!user) redirect("/login");

  const branchIds = scope.branchIds;
  const saleWhere = {
    tenantId: session.tenantId,
    branchId: { in: branchIds },
    status: "COMPLETED" as const,
  };

  const [todaySales, recentSales, activeShifts, inventoryRows, invoices] = await Promise.all([
    db.sale.findMany({
      where: { ...saleWhere, createdAt: { gte: start, lt: end } },
      include: {
        items: {
          select: { quantity: true, unitCost: true, total: true, tax: true },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.sale.findMany({
      where: saleWhere,
      include: {
        branch: { select: { id: true, name: true, code: true } },
        cashier: { select: { id: true, fullName: true, staffNumber: true } },
        payments: {
          where: { tenantId: session.tenantId, status: "COMPLETED" },
          select: { method: true, amount: true },
        },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
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
        balance: { gt: 0 },
        status: { notIn: ["CANCELLED", "VOIDED", "REFUNDED"] },
      },
      select: { balance: true },
    }),
  ]);

  const tenantSettings = normalizeTenantSettings(user.tenant.settings?.metadata);
  const currency = user.tenant.currency || "KES";
  const salesTotal = todaySales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const grossProfit = todaySales.reduce(
    (saleSum, sale) => saleSum + sale.items.reduce(
      (itemSum, item) => itemSum + Number(item.total) - Number(item.tax) - Number(item.unitCost) * Number(item.quantity),
      0,
    ),
    0,
  );
  const lowStock = tenantSettings.inventory.lowStockAlerts
    ? inventoryRows.filter((row) => row.quantity.lte(row.reorderLevel))
    : [];
  const receivables = invoices.reduce((sum, invoice) => sum + Number(invoice.balance), 0);
  const roleLabel = scope.roleNames.join(", ") || "Tenant user";
  const firstName = user.fullName.trim().split(/\s+/)[0] || user.fullName;

  const hourly = Array.from({ length: 12 }, () => 0);
  const hourFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: user.tenant.timezone,
    hour: "2-digit",
    hourCycle: "h23",
  });
  for (const sale of todaySales) {
    const hour = Number(hourFormatter.format(sale.createdAt));
    hourly[Math.min(11, Math.floor(hour / 2))] += Number(sale.total);
  }
  const maxHour = Math.max(...hourly, 0);

  const metrics = [
    ["Sales today", money(salesTotal, currency), `${todaySales.length} completed sale${todaySales.length === 1 ? "" : "s"}`],
    ["Gross profit", money(grossProfit, currency), "From completed sales"],
    ["Transactions", String(todaySales.length), "Today"],
    ["Active shifts", String(activeShifts), activeShifts ? "Currently open" : "No open shifts"],
    [
      "Low stock",
      String(lowStock.length),
      tenantSettings.inventory.lowStockAlerts
        ? lowStock.length ? "Needs attention" : "No alerts"
        : "Alerts disabled in Settings",
    ],
    ["Receivables", money(receivables, currency), `${invoices.length} outstanding invoice${invoices.length === 1 ? "" : "s"}`],
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
          <button className="chip" type="button" disabled>{scope.isTenantAdmin ? "All tenant branches" : "Assigned branches"}</button>
        </div>
        <LiveDataRefresh />
      </div>

      <div className="metrics">
        {metrics.map(([label, value, note]) => (
          <article className="metric" key={label}>
            <small>{label}</small><strong>{value}</strong><span>{note}</span>
          </article>
        ))}
      </div>

      <div className="grid">
        <article className="panel chart">
          <div className="panel-head">
            <div><small>PERFORMANCE</small><h3>Sales by hour</h3></div>
            <a className="notification-link" href="/app/sales">View sales</a>
          </div>
          {todaySales.length === 0 ? (
            <div className="empty-state">
              <span>0</span><h3>No sales recorded today</h3>
              <p>Completed staff POS sales for this account will appear automatically.</p>
            </div>
          ) : (
            <div className="bars" aria-label="Sales grouped into two-hour intervals">
              {hourly.map((amount, index) => (
                <i
                  key={index}
                  title={`${String(index * 2).padStart(2, "0")}:00 · ${money(amount, currency)}`}
                  style={{ height: maxHour > 0 && amount > 0 ? `${Math.max(4, Math.round(amount / maxHour * 100))}%` : "0%" }}
                />
              ))}
            </div>
          )}
        </article>

        <article className="panel">
          <div className="panel-head">
            <div><small>ATTENTION</small><h3>Inventory alerts</h3></div>
            <span className="badge">{lowStock.length} items</span>
          </div>
          {!tenantSettings.inventory.lowStockAlerts ? (
            <div className="empty-state"><span>—</span><h3>Low-stock alerts disabled</h3><p>Enable them from Settings → Inventory rules.</p></div>
          ) : lowStock.length === 0 ? (
            <div className="empty-state"><span>✓</span><h3>No low-stock alerts</h3><p>Stock alerts will appear here.</p></div>
          ) : lowStock.slice(0, 4).map((row) => (
            <div className="list-row" key={row.id}>
              <span className="product-icon">{row.product.name.slice(0, 1).toUpperCase()}</span>
              <div><strong>{row.product.name}</strong><small>{row.branch.name} · {Number(row.quantity).toLocaleString("en-KE")} remaining</small></div>
              <a className="notification-link" href="/app/inventory">View</a>
            </div>
          ))}
        </article>
      </div>

      <article className="panel dashboard-sales-panel">
        <div className="panel-head">
          <div>
            <small>LIVE SALES REGISTER</small><h3>Latest completed sales</h3>
            <p>Only sales belonging to {user.tenant.name} are included.</p>
          </div>
          <a className="notification-link" href="/app/sales">Open full sales register</a>
        </div>

        {recentSales.length === 0 ? (
          <div className="empty-state"><span>0</span><h3>No completed sales yet</h3><p>A completed staff checkout will appear here within 15 seconds.</p></div>
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
                <strong>{money(Number(sale.total), currency)}</strong>
                <time dateTime={sale.createdAt.toISOString()}>{sale.createdAt.toLocaleString("en-KE", { timeZone: user.tenant.timezone, dateStyle: "short", timeStyle: "short" })}</time>
              </div>
            ))}
          </div>
        )}
      </article>
    </PortalShell>
  );
}
