import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { ShiftStarter } from "@/components/shift-starter";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";

export const dynamic = "force-dynamic";

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

export default async function StaffDashboard() {
  const session = await requireCurrentTenant();
  const user = await db.user.findFirst({
    where: { id: session.userId, tenantId: session.tenantId, status: "ACTIVE" },
    include: {
      tenant: { select: { currency: true } },
      roles: { include: { role: true } },
      branches: { include: { branch: true } },
    },
  });

  if (!user) redirect("/login");

  const openShift = await db.shift.findFirst({
    where: { tenantId: session.tenantId, userId: session.userId, status: "OPEN", branchId: { in: [...session.branchIds] } },
    include: {
      branch: true,
      sales: {
        where: { tenantId: session.tenantId, cashierId: session.userId, status: "COMPLETED" },
        include: { payments: { where: { tenantId: session.tenantId, status: "COMPLETED" } } },
      },
    },
    orderBy: { openedAt: "desc" },
  });

  const role = user.roles.map(({ role: assignedRole }) => assignedRole.name).join(", ") || "Staff member";
  const assignedBranches = user.branches.filter(({ branch }) => branch.status === "ACTIVE").map(({ branch }) => ({ id: branch.id, name: branch.name }));
  const branchName = openShift?.branch.name ?? assignedBranches[0]?.name ?? "No branch assigned";
  const currency = user.tenant.currency || "KES";
  const sales = openShift?.sales ?? [];
  const totalSales = sales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const payments = sales.flatMap((sale) => sale.payments);
  const paymentTotal = (names: string[]) => payments.filter((payment) => names.includes(payment.method.toLowerCase())).reduce((sum, payment) => sum + Number(payment.amount), 0);

  const metrics = [
    ["My sales", formatMoney(totalSales, currency)],
    ["Transactions", String(sales.length)],
    ["Cash", formatMoney(paymentTotal(["cash"]), currency)],
    ["Mobile money", formatMoney(paymentTotal(["mpesa", "m-pesa", "mobile_money", "mobile money"]), currency)],
    ["Card", formatMoney(paymentTotal(["card", "credit_card", "debit_card"]), currency)],
  ];

  return (
    <PortalShell title={`Welcome, ${user.fullName.split(/\s+/)[0]}`} role={role} basePath="/staff" current="dashboard" location={branchName}>
      {openShift ? (
        <div className="shift-banner"><div><span className="status-dot"/><small>SHIFT OPEN</small><h3>Started {new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }).format(openShift.openedAt)}</h3><p>{openShift.branch.name} · Opening cash {formatMoney(Number(openShift.openingCash), currency)}</p></div><a href="/app/pos" className="primary action-link">Go to POS checkout</a></div>
      ) : (
        <div className="panel staff-empty-shift"><span>○</span><div><small>SHIFT STATUS</small><h3>No open shift</h3><p>Open a shift before processing sales.</p><ShiftStarter branches={assignedBranches} currency={currency} /></div></div>
      )}
      <div className="metrics staff-metrics">{metrics.map(([label, value]) => <article className="metric" key={label}><small>{label}</small><strong>{value}</strong><span>{openShift ? "Current shift" : "No active shift"}</span></article>)}</div>
    </PortalShell>
  );
}
