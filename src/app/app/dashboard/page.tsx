import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";

export const dynamic = "force-dynamic";

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
  const branchIds = [...session.branchIds];
  const { start, end } = nairobiDayRange();

  const user = await db.user.findFirst({
    where: {
      id: session.userId,
      tenantId: session.tenantId,
      status: "ACTIVE",
    },
    include: {
      tenant: true,
      roles: { include: { role: true } },
    },
  });

  if (!user) redirect("/login");

  const [sales, activeShifts, inventoryRows, outstandingInvoices] = await Promise.all([
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
        product: { status: "active" },
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
  const roleLabel = user.roles.map(({ role }) => role.name).join(", ") || "Team member";
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
    <PortalShell title={`Welcome, ${firstName}`} role={roleLabel}>
      <div className="filters">
        <button className="chip active" type="button">Today</button>
        <button className="chip" type="button" disabled>This week</button>
        <button className="chip" type="button" disabled>This month</button>
        <button className="chip" type="button" disabled>Assigned branches</button>
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
              <p>This chart will update automatically when this business completes its first sale.</p>
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
    </PortalShell>
  );
}
