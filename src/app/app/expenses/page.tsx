import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { requirePermission } from "@/server/security/context";
import { ExpenseManager, ExpenseStatusButton } from "./expense-manager";

export const dynamic = "force-dynamic";

function money(value: number, currency: string) {
  try { return new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `${currency} ${value.toLocaleString("en-KE")}`; }
}

function periodStart(period: string) {
  const now = new Date();
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "quarter") return new Date(now.getFullYear(), now.getMonth() - 2, 1);
  if (period === "year") return new Date(now.getFullYear(), 0, 1);
  return undefined;
}

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ branch?: string; status?: string; period?: string }> }) {
  const session = await requireCurrentTenant();
  requirePermission(session, "expense.manage");
  const scope = await resolveTenantAccessScope(db, session);
  const query = await searchParams;
  const period = ["month", "quarter", "year", "all"].includes(query.period ?? "") ? query.period! : "month";
  const status = ["PAID", "PENDING", "VOIDED"].includes(query.status ?? "") ? query.status : "all";
  const branchId = scope.branchIds.includes(query.branch ?? "") ? query.branch : "all";

  const [viewer, tenant, branches] = await Promise.all([
    db.user.findFirst({ where: { id: session.userId, tenantId: session.tenantId, status: "ACTIVE" }, include: { roles: { include: { role: true } } } }),
    db.tenant.findUnique({ where: { id: session.tenantId } }),
    db.branch.findMany({ where: { tenantId: session.tenantId, id: { in: scope.branchIds }, status: "ACTIVE" }, select: { id: true, name: true, code: true }, orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }] }),
  ]);
  if (!viewer || !tenant) redirect("/login");

  const expenses = await db.expense.findMany({
    where: {
      tenantId: session.tenantId,
      branchId: branchId === "all" ? { in: scope.branchIds } : branchId,
      ...(status === "all" ? {} : { status }),
      ...(periodStart(period) ? { expenseDate: { gte: periodStart(period) } } : {}),
    },
    include: { branch: { select: { name: true, code: true } } },
    orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }], take: 500,
  });

  const active = expenses.filter((expense) => expense.status !== "VOIDED");
  const total = active.reduce((sum, expense) => sum + Number(expense.amount), 0);
  const paid = active.filter((expense) => expense.status === "PAID").reduce((sum, expense) => sum + Number(expense.amount), 0);
  const pending = active.filter((expense) => expense.status === "PENDING").reduce((sum, expense) => sum + Number(expense.amount), 0);
  const categoryTotals = new Map<string, number>();
  const branchTotals = new Map<string, number>();
  for (const expense of active) {
    categoryTotals.set(expense.category, (categoryTotals.get(expense.category) ?? 0) + Number(expense.amount));
    branchTotals.set(expense.branch.name, (branchTotals.get(expense.branch.name) ?? 0) + Number(expense.amount));
  }
  const categories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]);
  const topCategory = categories[0];
  const maxCategory = topCategory?.[1] ?? 1;
  const topBranch = [...branchTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const roleLabel = viewer.roles.map(({ role }) => role.name).join(", ") || "Tenant user";
  const currency = tenant.currency || "KES";

  return <PortalShell title="Expenses" role={roleLabel} current="expenses" branchName={tenant.name}>
    <section className="expense-hero"><div><small>EXPENSE CONTROL CENTRE</small><h3>Know where every shilling goes</h3><p>Record operational spending by branch, monitor unpaid commitments, and spot the categories consuming the most cash.</p></div><ExpenseManager branches={branches} /></section>

    <form className="expense-filters" method="get">
      <label>Branch<select name="branch" defaultValue={branchId}><option value="all">All branches</option>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name} ({branch.code})</option>)}</select></label>
      <label>Period<select name="period" defaultValue={period}><option value="month">This month</option><option value="quarter">Last 3 months</option><option value="year">This year</option><option value="all">All time</option></select></label>
      <label>Status<select name="status" defaultValue={status}><option value="all">All statuses</option><option value="PAID">Paid</option><option value="PENDING">Pending</option><option value="VOIDED">Voided</option></select></label>
      <button type="submit">Apply filters</button>
    </form>

    <section className="expense-metrics">
      <article><span className="expense-metric-icon total">↘</span><div><small>Recorded spend</small><strong>{money(total, currency)}</strong><em>{active.length} valid record{active.length === 1 ? "" : "s"}</em></div></article>
      <article><span className="expense-metric-icon paid">✓</span><div><small>Paid expenses</small><strong>{money(paid, currency)}</strong><em>Cash already out</em></div></article>
      <article><span className="expense-metric-icon pending">◷</span><div><small>Pending payment</small><strong>{money(pending, currency)}</strong><em>Upcoming obligation</em></div></article>
      <article><span className="expense-metric-icon average">≈</span><div><small>Average expense</small><strong>{money(active.length ? total / active.length : 0, currency)}</strong><em>Per valid entry</em></div></article>
    </section>

    <section className="expense-insight-grid">
      <article className="panel expense-category-card"><div className="expense-card-head"><div><small>SPENDING MIX</small><h3>Top categories</h3></div><span>{categories.length} categories</span></div>{categories.length === 0 ? <div className="expense-mini-empty">No spending data for this selection.</div> : <div className="expense-bars">{categories.slice(0, 6).map(([category, amount]) => <div key={category}><p><strong>{category}</strong><span>{money(amount, currency)}</span></p><i><b style={{ width: `${Math.max(5, amount / maxCategory * 100)}%` }} /></i></div>)}</div>}</article>
      <article className="panel expense-insight-card"><small>SMART INSIGHTS</small><h3>What needs attention</h3><div className="expense-insight-list"><div><span>01</span><p><strong>{topCategory ? `${topCategory[0]} leads spending` : "No dominant category yet"}</strong><small>{topCategory ? `${money(topCategory[1], currency)} · ${total ? Math.round(topCategory[1] / total * 100) : 0}% of selected spend` : "Record expenses to unlock category insights."}</small></p></div><div><span>02</span><p><strong>{pending > 0 ? `${money(pending, currency)} still unpaid` : "No pending obligations"}</strong><small>{pending > 0 ? "Review pending entries before their supplier due dates." : "All recorded commitments in this view are settled."}</small></p></div><div><span>03</span><p><strong>{topBranch ? `${topBranch[0]} has the highest spend` : "Branch comparison awaiting data"}</strong><small>{topBranch ? `${money(topBranch[1], currency)} in the selected period.` : "Use branch assignment to compare location costs."}</small></p></div></div></article>
    </section>

    <article className="panel expense-register"><div className="expense-card-head"><div><small>AUDIT-READY REGISTER</small><h3>Expense records</h3><p>Voided entries stay visible so the spending trail is never silently erased.</p></div><span>{expenses.length} entries</span></div>
      {expenses.length === 0 ? <div className="expense-empty"><span>＋</span><h3>No expenses found</h3><p>Record the first expense or change the filters above.</p></div> : <div className="expense-table-wrap"><div className="expense-table expense-table-head"><span>Expense</span><span>Branch</span><span>Date & payment</span><span>Amount</span><span>Status</span><span>Action</span></div>{expenses.map((expense) => <div className={`expense-table${expense.status === "VOIDED" ? " is-voided" : ""}`} key={expense.id}><div><strong>{expense.description}</strong><small>{expense.category}{expense.vendor ? ` · ${expense.vendor}` : ""}{expense.reference ? ` · Ref ${expense.reference}` : ""}</small></div><div><strong>{expense.branch.name}</strong><small>{expense.branch.code}</small></div><div><strong>{expense.expenseDate.toLocaleDateString("en-KE")}</strong><small>{expense.paymentMethod}</small></div><strong>{money(Number(expense.amount), currency)}</strong><span className={`expense-status ${expense.status.toLowerCase()}`}>{expense.status}</span><ExpenseStatusButton id={expense.id} status={expense.status} /></div>)}</div>}
    </article>
  </PortalShell>;
}
