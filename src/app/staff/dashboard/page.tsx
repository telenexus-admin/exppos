import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { ShiftStarter } from "@/components/shift-starter";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";

export const dynamic = "force-dynamic";

type PaymentBucket = "cash" | "mobile" | "card" | "bank" | "other";

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

function paymentBucket(method: string): PaymentBucket {
  const normalized = method.trim().toLowerCase();
  if (normalized.includes("cash")) return "cash";
  if (normalized.includes("mpesa") || normalized.includes("m-pesa") || normalized.includes("mobile")) return "mobile";
  if (normalized.includes("card")) return "card";
  if (normalized.includes("bank")) return "bank";
  return "other";
}

export default async function StaffDashboard() {
  const session = await requireCurrentTenant();

  const user = await db.user.findFirst({
    where: { id: session.userId, tenantId: session.tenantId, status: "ACTIVE" },
    include: {
      tenant: true,
      roles: { include: { role: true } },
      branches: { include: { branch: true } },
    },
  });

  if (!user) redirect("/login");

  const openShift = await db.shift.findFirst({
    where: {
      tenantId: session.tenantId,
      userId: session.userId,
      branchId: { in: [...session.branchIds] },
      status: "OPEN",
    },
    include: {
      branch: true,
      sales: {
        where: { tenantId: session.tenantId, cashierId: session.userId, status: "COMPLETED" },
        include: { payments: { where: { tenantId: session.tenantId, status: "COMPLETED" } } },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { openedAt: "desc" },
  });

  const roleLabel = user.roles.map(({ role }) => role.name).join(", ") || "Staff member";
  const assignedBranches = user.branches
    .filter(({ branch }) => branch.status === "ACTIVE")
    .map(({ branch }) => ({ id: branch.id, name: branch.name }));
  const assignedBranch = openShift?.branch.name ?? assignedBranches[0]?.name ?? "No branch assigned";
  const currency = user.tenant.currency || "KES";
  const sales = openShift?.sales ?? [];
  const totalSales = sales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const paymentTotals: Record<PaymentBucket, number> = { cash: 0, mobile: 0, card: 0, bank: 0, other: 0 };

  for (const sale of sales) {
    for (const payment of sale.payments) {
      paymentTotals[paymentBucket(payment.method)] += Number(payment.amount);
    }
  }

  const metrics = [
    ["My sales", formatMoney(totalSales, currency)],
    ["Transactions", String(sales.length)],
    ["Cash", formatMoney(paymentTotals.cash, currency)],
    ["Mobile money", formatMoney(paymentTotals.mobile, currency)],
    ["Card", formatMoney(paymentTotals.card, currency)],
    ["Bank / other", formatMoney(paymentTotals.bank + paymentTotals.other, currency)],
  ];

  return (
    <PortalShell title={`Welcome, ${user.fullName.split(/\s+/)[0]}`} role={roleLabel} basePath="/staff" current="dashboard" branchName={assignedBranch}>
      {openShift ? (
        <div className="shift-banner">
          <div>
            <span className="status-dot" />
            <small>SHIFT OPEN</small>
            <h3>Started at {openShift.openedAt.toLocaleTimeString("en-KE", { timeZone: user.tenant.timezone, hour: "2-digit", minute: "2-digit" })}</h3>
            <small>{openShift.branch.name} · Opening cash {formatMoney(Number(openShift.openingCash), currency)}</small>
          </div>
          <a href="/app/pos" className="primary action-link">Go to POS checkout</a>
        </div>
      ) : (
        <div className="shift-banner shift-banner--empty">
          <div>
            <small>NO OPEN SHIFT</small>
            <h3>Your sales workspace is ready</h3>
            <small>Open your assigned branch shift before processing the first sale.</small>
          </div>
          <ShiftStarter branches={assignedBranches} currency={currency} />
        </div>
      )}

      <div className="metrics">
        {metrics.map(([label, value]) => (
          <article className="metric" key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
            <span>{openShift ? "Current shift" : "No open shift"}</span>
          </article>
        ))}
      </div>

      {sales.length === 0 && (
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="empty-state">
            <span>0</span>
            <h3>No sales in this shift</h3>
            <p>Completed sales will appear here and update the totals automatically.</p>
          </div>
        </article>
      )}
    </PortalShell>
  );
}
