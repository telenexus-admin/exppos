import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { ReportDatePicker } from "@/components/report-date-picker";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { requirePermission } from "@/server/security/context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Period = "daily" | "weekly" | "monthly" | "yearly";
const periods: Array<{ key: Period; label: string }> = [{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }, { key: "yearly", label: "Yearly" }];
const reportGroups: Array<{ label: string; items: Array<[string, string]> }> = [
  { label: "Sales Reports", items: [["daily-sales", "Daily Sales"], ["monthly-sales", "Monthly Sales"], ["sales-by-product", "Sales by Product"], ["sales-by-category", "Sales by Category"], ["sales-by-customer", "Sales by Customer"], ["sales-by-cashier", "Sales by Cashier"]] },
  { label: "Inventory Reports", items: [["stock-levels", "Stock Levels"], ["low-stock-items", "Low Stock Items"], ["out-of-stock-items", "Out of Stock Items"], ["stock-movement", "Stock Movement"], ["inventory-valuation", "Inventory Valuation"]] },
  { label: "Financial Reports", items: [["profit-loss", "Profit & Loss"], ["income", "Income Report"], ["expenses", "Expense Report"], ["cash-flow", "Cash Flow"], ["tax", "Tax Report"]] },
  { label: "Invoice Reports", items: [["paid-invoices", "Paid Invoices"], ["unpaid-invoices", "Unpaid Invoices"], ["overdue-invoices", "Overdue Invoices"], ["collections", "Collections Report"]] },
  { label: "Customer Reports", items: [["top-customers", "Top Customers"], ["customer-balances", "Customer Balances"], ["loyalty", "Loyalty Report"]] },
  { label: "Supplier Reports", items: [["supplier-purchases", "Supplier Purchases"], ["supplier-balances", "Supplier Balances"]] },
  { label: "Audit Reports", items: [["user-activity", "User Activity"], ["void-transactions", "Void Transactions"], ["returns-refunds", "Returns & Refunds"], ["system-logs", "System Logs"]] },
];
const reportViews = reportGroups.flatMap(({ items }) => items.map(([key]) => key));
const DAY = 86_400_000;

function nairobiDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value])) as Record<string, string>;
}

function normalizeReportDate(value?: string) {
  const fallbackParts = nairobiDateParts();
  const fallback = `${fallbackParts.year}-${fallbackParts.month}-${fallbackParts.day}`;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return fallback;
  return value;
}

function periodRange(period: Period, reportDate: string) {
  const [yearText, monthText] = reportDate.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const dayStart = new Date(`${reportDate}T00:00:00+03:00`);
  let start = dayStart;
  let end = new Date(start.getTime() + DAY);
  if (period === "weekly") {
    const dayOfWeek = new Date(`${reportDate}T12:00:00+03:00`).getUTCDay();
    start = new Date(dayStart.getTime() - ((dayOfWeek + 6) % 7) * DAY);
    end = new Date(start.getTime() + 7 * DAY);
  } else if (period === "monthly") {
    start = new Date(`${yearText}-${monthText}-01T00:00:00+03:00`);
    const nextMonth = month === 12 ? `${year + 1}-01` : `${yearText}-${String(month + 1).padStart(2, "0")}`;
    end = new Date(`${nextMonth}-01T00:00:00+03:00`);
  } else if (period === "yearly") {
    start = new Date(`${yearText}-01-01T00:00:00+03:00`);
    end = new Date(`${year + 1}-01-01T00:00:00+03:00`);
  }
  const duration = end.getTime() - start.getTime();
  return { start, end, previousStart: new Date(start.getTime() - duration), previousEnd: start };
}

function money(value: number, currency: string, compact = false) {
  try { return new Intl.NumberFormat("en-KE", { style: "currency", currency, notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 2 }).format(value); }
  catch { return `${currency} ${value.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`; }
}

function change(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}

function periodLabel(period: Period, start: Date, end: Date) {
  if (period === "daily") return start.toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "full" });
  if (period === "yearly") return start.toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", year: "numeric" });
  return `${start.toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short" })} – ${new Date(end.getTime() - 1).toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", year: "numeric" })}`;
}

function trendBuckets(period: Period, start: Date, end: Date) {
  if (period === "daily") return Array.from({ length: 12 }, (_, index) => ({ label: `${String(index * 2).padStart(2, "0")}:00`, value: 0 }));
  if (period === "weekly") return Array.from({ length: 7 }, (_, index) => { const date = new Date(start.getTime() + index * DAY); return { label: date.toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", weekday: "short" }), value: 0 }; });
  if (period === "monthly") return Array.from({ length: Math.round((end.getTime() - start.getTime()) / DAY) }, (_, index) => ({ label: String(index + 1), value: 0 }));
  return Array.from({ length: 12 }, (_, index) => ({ label: new Date(Date.UTC(2020, index, 1)).toLocaleDateString("en-KE", { month: "short" }), value: 0 }));
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string; view?: string; date?: string }> }) {
  const session = await requireCurrentTenant();
  requirePermission(session, "report.view");
  const query = await searchParams;
  const period: Period = periods.some(({ key }) => key === query.period) ? query.period as Period : "monthly";
  const activeView = reportViews.includes(query.view as typeof reportViews[number]) ? query.view : "dashboard";
  const selectedDate = normalizeReportDate(query.date);
  const range = periodRange(period, selectedDate);
  const scope = await resolveTenantAccessScope(db, session);
  const saleScope = { tenantId: session.tenantId, branchId: { in: scope.branchIds }, status: "COMPLETED" as const };

  const [tenant, viewer, sales, previousSales, inventory, staff, shifts, outstandingInvoices, reportInvoices, reportExpenses, purchaseOrders, customers, stockMovements, auditLogs] = await Promise.all([
    db.tenant.findUnique({ where: { id: session.tenantId }, select: { name: true, code: true, currency: true, timezone: true } }),
    db.user.findFirst({ where: { id: session.userId, tenantId: session.tenantId, status: "ACTIVE" } }),
    db.sale.findMany({ where: { ...saleScope, createdAt: { gte: range.start, lt: range.end } }, include: { branch: { select: { id: true, name: true } }, cashier: { select: { id: true, fullName: true } }, customer: { select: { fullName: true, companyName: true } }, items: { select: { quantity: true, unitCost: true, total: true, tax: true, product: { select: { name: true, category: { select: { name: true } } } } } }, payments: { select: { method: true, amount: true, status: true } } }, orderBy: { createdAt: "asc" } }),
    db.sale.findMany({ where: { ...saleScope, createdAt: { gte: range.previousStart, lt: range.previousEnd } }, select: { total: true } }),
    db.branchInventory.findMany({ where: { tenantId: session.tenantId, branchId: { in: scope.branchIds }, product: { status: "active" } }, include: { product: { select: { name: true, costPrice: true, sellingPrice: true, trackStock: true } }, branch: { select: { name: true } } } }),
    db.user.findMany({ where: { tenantId: session.tenantId, status: "ACTIVE" }, include: { roles: { where: { role: { tenantId: session.tenantId } }, include: { role: true } }, branches: { include: { branch: { select: { name: true } } } } }, orderBy: { fullName: "asc" } }),
    db.shift.findMany({ where: { tenantId: session.tenantId, branchId: { in: scope.branchIds }, openedAt: { gte: range.start, lt: range.end } }, select: { userId: true, openedAt: true, closedAt: true, status: true } }),
    db.invoice.aggregate({ where: { tenantId: session.tenantId, balance: { gt: 0 }, status: { notIn: ["CANCELLED", "VOIDED", "REFUNDED"] } }, _sum: { balance: true }, _count: true }),
    db.invoice.findMany({ where: { tenantId: session.tenantId, createdAt: { gte: range.start, lt: range.end } }, include: { customer: { select: { fullName: true, companyName: true } } }, orderBy: { createdAt: "desc" } }),
    db.expense.findMany({ where: { tenantId: session.tenantId, branchId: { in: scope.branchIds }, expenseDate: { gte: range.start, lt: range.end } }, include: { branch: { select: { name: true } } }, orderBy: { expenseDate: "desc" } }),
    db.purchaseOrder.findMany({ where: { tenantId: session.tenantId, branchId: { in: scope.branchIds }, createdAt: { gte: range.start, lt: range.end } }, include: { supplier: { select: { name: true } }, branch: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    db.customer.findMany({ where: { tenantId: session.tenantId, status: "active" }, select: { id: true, fullName: true, companyName: true, loyaltyPoints: true }, orderBy: { fullName: "asc" } }),
    db.stockMovement.findMany({ where: { tenantId: session.tenantId, branchId: { in: scope.branchIds }, createdAt: { gte: range.start, lt: range.end } }, include: { product: { select: { name: true } }, branch: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    db.auditLog.findMany({ where: { tenantId: session.tenantId, createdAt: { gte: range.start, lt: range.end } }, select: { actorRole: true, action: true, entityType: true, entityId: true, reason: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
  ]);
  if (!tenant || !viewer) redirect("/login");

  const currency = tenant.currency || "KES";
  const salesTotal = sales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const previousTotal = previousSales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const profit = sales.reduce((sum, sale) => sum + sale.items.reduce((inner, item) => inner + Number(item.total) - Number(item.tax) - Number(item.unitCost) * Number(item.quantity), 0), 0);
  const averageSale = sales.length ? salesTotal / sales.length : 0;
  const salesChange = change(salesTotal, previousTotal);

  const buckets = trendBuckets(period, range.start, range.end);
  const localHour = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, hour: "2-digit", hourCycle: "h23" });
  for (const sale of sales) {
    let index = 0;
    if (period === "daily") index = Math.min(11, Math.floor(Number(localHour.format(sale.createdAt)) / 2));
    else if (period === "weekly" || period === "monthly") index = Math.min(buckets.length - 1, Math.floor((sale.createdAt.getTime() - range.start.getTime()) / DAY));
    else index = Number(new Intl.DateTimeFormat("en-US", { timeZone: tenant.timezone, month: "numeric" }).format(sale.createdAt)) - 1;
    if (buckets[index]) buckets[index].value += Number(sale.total);
  }
  const peak = Math.max(...buckets.map(({ value }) => value), 0);
  const bestBucket = buckets.reduce((best, item) => item.value > best.value ? item : best, buckets[0] ?? { label: "—", value: 0 });

  const paymentMap = new Map<string, number>();
  for (const sale of sales) for (const payment of sale.payments) paymentMap.set(payment.method, (paymentMap.get(payment.method) ?? 0) + Number(payment.amount));
  const payments = [...paymentMap.entries()].sort((a, b) => b[1] - a[1]);
  const paymentTotal = payments.reduce((sum, [, value]) => sum + value, 0);
  let conicStart = 0;
  const palette = ["#116847", "#48b889", "#e1a12c", "#2e6faa", "#8d62bd"];
  const conic = payments.map(([, value], index) => { const start = conicStart; conicStart += paymentTotal ? value / paymentTotal * 100 : 0; return `${palette[index % palette.length]} ${start}% ${conicStart}%`; }).join(", ") || "#dfe8e4 0 100%";

  const branchMap = new Map<string, { name: string; sales: number; transactions: number }>();
  const staffMap = new Map<string, { name: string; sales: number; transactions: number }>();
  for (const sale of sales) {
    const branch = branchMap.get(sale.branch.id) ?? { name: sale.branch.name, sales: 0, transactions: 0 };
    branch.sales += Number(sale.total); branch.transactions += 1; branchMap.set(sale.branch.id, branch);
    const person = staffMap.get(sale.cashier.id) ?? { name: sale.cashier.fullName, sales: 0, transactions: 0 };
    person.sales += Number(sale.total); person.transactions += 1; staffMap.set(sale.cashier.id, person);
  }
  const branches = [...branchMap.values()].sort((a, b) => b.sales - a.sales);
  const staffPerformance = staff.map((person) => {
    const performance = staffMap.get(person.id) ?? { name: person.fullName, sales: 0, transactions: 0 };
    const personShifts = shifts.filter((shift) => shift.userId === person.id);
    const hours = personShifts.reduce((sum, shift) => sum + ((shift.closedAt?.getTime() ?? Date.now()) - shift.openedAt.getTime()) / 3_600_000, 0);
    return { ...performance, id: person.id, role: person.roles.map(({ role }) => role.name).join(", ") || "Staff", branch: person.branches.map(({ branch }) => branch.name).join(", ") || "Unassigned", shifts: personShifts.length, hours };
  }).sort((a, b) => b.sales - a.sales);

  const trackedInventory = inventory.filter((row) => row.product.trackStock);
  const stockUnits = trackedInventory.reduce((sum, row) => sum + Number(row.quantity), 0);
  const stockCost = trackedInventory.reduce((sum, row) => sum + Number(row.quantity) * Number(row.product.costPrice), 0);
  const stockRetail = trackedInventory.reduce((sum, row) => sum + Number(row.quantity) * Number(row.product.sellingPrice), 0);
  const lowStock = trackedInventory.filter((row) => row.quantity.lte(row.reorderLevel));
  const outOfStock = trackedInventory.filter((row) => row.quantity.lte(0));
  const creditSales = paymentMap.get("Credit") ?? 0;
  const topStaff = staffPerformance[0];
  const insights = sales.length === 0
    ? ["No completed sales were recorded in this period. Once staff checkouts begin, trends and performance insights will appear here.", `${trackedInventory.length} stock allocations are currently being monitored across accessible branches.`, lowStock.length ? `${lowStock.length} stock item${lowStock.length === 1 ? " is" : "s are"} at or below reorder level and need attention.` : "Current stock levels have no low-stock alerts."]
    : [
        `Sales are ${salesChange >= 0 ? "up" : "down"} ${Math.abs(salesChange).toFixed(1)}% compared with the previous equivalent period.`,
        `${bestBucket.label} was the strongest sales interval at ${money(bestBucket.value, currency)}.`,
        topStaff ? `${topStaff.name} led staff performance with ${money(topStaff.sales, currency)} from ${topStaff.transactions} transaction${topStaff.transactions === 1 ? "" : "s"}.` : "No staff sales ranking is available.",
        lowStock.length ? `${lowStock.length} stock item${lowStock.length === 1 ? " needs" : "s need"} replenishment; ${outOfStock.length} ${outOfStock.length === 1 ? "is" : "are"} already out of stock.` : "Inventory is healthy with no items at or below reorder level.",
        creditSales > 0 ? `${money(creditSales, currency)} was posted to Customer — Pay Later during this period.` : "No Customer — Pay Later sales were recorded in this period.",
      ];

  const cards = [
    ["Net sales", money(salesTotal, currency), `${salesChange >= 0 ? "+" : ""}${salesChange.toFixed(1)}% vs previous period`],
    ["Gross profit", money(profit, currency), salesTotal ? `${(profit / salesTotal * 100).toFixed(1)}% margin` : "No sales margin yet"],
    ["Transactions", sales.length.toLocaleString("en-KE"), `${money(averageSale, currency)} average sale`],
    ["Stock at cost", money(stockCost, currency), `${stockUnits.toLocaleString("en-KE", { maximumFractionDigits: 3 })} units`],
    ["Retail stock value", money(stockRetail, currency), `${trackedInventory.length} branch allocations`],
    ["Receivables", money(Number(outstandingInvoices._sum.balance ?? 0), currency), `${outstandingInvoices._count} outstanding invoice${outstandingInvoices._count === 1 ? "" : "s"}`],
  ];

  type DetailRow = { label: string; value: string; note: string };
  const detailRows: DetailRow[] = [];
  const addRow = (label: string, value: string, note = "") => detailRows.push({ label, value, note });
  const reportViewLabel = reportGroups.flatMap(({ items }) => items).reduce((label, [key, value]) => key === activeView ? value : label, "Report Overview");
  const productTotals = new Map<string, { quantity: number; sales: number; name: string }>();
  const categoryTotals = new Map<string, { quantity: number; sales: number }>();
  const customerTotals = new Map<string, { sales: number; transactions: number; name: string }>();
  for (const sale of sales) {
    const customerName = sale.customer?.companyName || sale.customer?.fullName || "Walk-in customer";
    const customer = customerTotals.get(customerName) ?? { sales: 0, transactions: 0, name: customerName };
    customer.sales += Number(sale.total); customer.transactions += 1; customerTotals.set(customerName, customer);
    for (const item of sale.items) {
      const product = productTotals.get(item.product.name) ?? { quantity: 0, sales: 0, name: item.product.name };
      product.quantity += Number(item.quantity); product.sales += Number(item.total); productTotals.set(item.product.name, product);
      const categoryName = item.product.category?.name || "Uncategorized";
      const category = categoryTotals.get(categoryName) ?? { quantity: 0, sales: 0 };
      category.quantity += Number(item.quantity); category.sales += Number(item.total); categoryTotals.set(categoryName, category);
    }
  }
  if (activeView === "daily-sales" || activeView === "monthly-sales") {
    for (const sale of sales) addRow(sale.saleNumber, money(Number(sale.total), currency), `${sale.cashier.fullName} · ${sale.branch.name} · ${sale.createdAt.toLocaleString("en-KE", { timeZone: tenant.timezone })}`);
  } else if (activeView === "sales-by-product") {
    for (const row of [...productTotals.values()].sort((a, b) => b.sales - a.sales)) addRow(row.name, money(row.sales, currency), `${row.quantity.toLocaleString("en-KE", { maximumFractionDigits: 3 })} units sold`);
  } else if (activeView === "sales-by-category") {
    for (const [name, row] of [...categoryTotals.entries()].sort((a, b) => b[1].sales - a[1].sales)) addRow(name, money(row.sales, currency), `${row.quantity.toLocaleString("en-KE", { maximumFractionDigits: 3 })} units sold`);
  } else if (activeView === "sales-by-customer" || activeView === "top-customers") {
    for (const row of [...customerTotals.values()].sort((a, b) => b.sales - a.sales)) addRow(row.name, money(row.sales, currency), `${row.transactions} transaction${row.transactions === 1 ? "" : "s"}`);
  } else if (activeView === "sales-by-cashier") {
    for (const row of staffPerformance) addRow(row.name, money(row.sales, currency), `${row.transactions} transactions · ${row.shifts} shifts`);
  } else if (activeView === "stock-levels" || activeView === "low-stock-items" || activeView === "out-of-stock-items" || activeView === "inventory-valuation") {
    const rows = activeView === "low-stock-items" ? lowStock : activeView === "out-of-stock-items" ? outOfStock : trackedInventory;
    for (const row of rows) addRow(row.product.name, activeView === "inventory-valuation" ? money(Number(row.quantity) * Number(row.product.costPrice), currency) : Number(row.quantity).toLocaleString("en-KE", { maximumFractionDigits: 3 }), `${row.branch.name} · Reorder at ${Number(row.reorderLevel).toLocaleString("en-KE", { maximumFractionDigits: 3 })}`);
  } else if (activeView === "stock-movement") {
    for (const row of stockMovements) addRow(row.product.name, `${row.type}: ${Number(row.quantity).toLocaleString("en-KE", { maximumFractionDigits: 3 })}`, `${row.branch.name} · ${row.createdAt.toLocaleString("en-KE", { timeZone: tenant.timezone })}`);
  } else if (activeView === "profit-loss" || activeView === "income" || activeView === "cash-flow" || activeView === "tax") {
    if (activeView === "profit-loss") { addRow("Sales income", money(salesTotal, currency)); addRow("Cost of goods sold", money(salesTotal - profit, currency)); addRow("Gross profit", money(profit, currency)); addRow("Expenses", money(reportExpenses.reduce((sum, row) => sum + Number(row.amount), 0), currency)); }
    else if (activeView === "tax") addRow("Sales tax collected", money(sales.reduce((sum, sale) => sum + Number(sale.tax), 0), currency), `${sales.length} completed sales`);
    else { addRow("Sales receipts", money(paymentTotal, currency), `${payments.length} payment methods`); addRow("Operating expenses", money(reportExpenses.reduce((sum, row) => sum + Number(row.amount), 0), currency), `${reportExpenses.length} expense records`); addRow("Net movement", money(paymentTotal - reportExpenses.reduce((sum, row) => sum + Number(row.amount), 0), currency)); }
  } else if (activeView === "expenses") {
    for (const row of reportExpenses) addRow(row.description, money(Number(row.amount), currency), `${row.category} · ${row.branch.name}`);
  } else if (activeView === "paid-invoices" || activeView === "unpaid-invoices" || activeView === "overdue-invoices" || activeView === "collections") {
    const now = new Date();
    const rows = reportInvoices.filter((invoice) => activeView === "paid-invoices" ? Number(invoice.balance) <= 0 : activeView === "overdue-invoices" ? Number(invoice.balance) > 0 && !!invoice.dueAt && invoice.dueAt < now : activeView === "unpaid-invoices" ? Number(invoice.balance) > 0 && (!invoice.dueAt || invoice.dueAt >= now) : Number(invoice.balance) > 0);
    for (const row of rows) addRow(row.number, activeView === "paid-invoices" ? money(Number(row.total), currency) : money(Number(row.balance), currency), `${row.customer.companyName || row.customer.fullName} · ${row.status}`);
  } else if (activeView === "customer-balances" || activeView === "loyalty") {
    for (const customer of customers) { const balance = reportInvoices.filter((invoice) => invoice.customerId === customer.id).reduce((sum, invoice) => sum + Number(invoice.balance), 0); addRow(customer.companyName || customer.fullName, activeView === "loyalty" ? `${customer.loyaltyPoints} points` : money(balance, currency), activeView === "loyalty" ? "Loyalty balance" : "Outstanding invoices"); }
  } else if (activeView === "supplier-purchases" || activeView === "supplier-balances") {
    const supplierTotals = new Map<string, number>();
    for (const order of purchaseOrders) supplierTotals.set(order.supplier.name, (supplierTotals.get(order.supplier.name) ?? 0) + Number(order.total));
    for (const [name, total] of [...supplierTotals.entries()].sort((a, b) => b[1] - a[1])) addRow(name, money(total, currency), `${purchaseOrders.filter((order) => order.supplier.name === name).length} purchase orders`);
  } else if (activeView === "user-activity" || activeView === "void-transactions" || activeView === "returns-refunds" || activeView === "system-logs") {
    const rows = auditLogs.filter((log) => activeView === "user-activity" ? true : activeView === "void-transactions" ? /void/i.test(log.action) : activeView === "returns-refunds" ? /return|refund/i.test(`${log.action} ${log.entityType}`) : true);
    for (const row of rows) addRow(row.action, row.entityType, `${row.actorRole} · ${row.createdAt.toLocaleString("en-KE", { timeZone: tenant.timezone })}${row.reason ? ` · ${row.reason}` : ""}`);
  }

  return <PortalShell title="Reports & Insights" role={scope.roleNames.join(", ") || "Tenant Administrator"} current="reports" branchName={`${tenant.name} · ${tenant.code}`}>
    <section className="report-heading"><div><small>BUSINESS INTELLIGENCE</small><h3>Performance command centre</h3><p>{periodLabel(period, range.start, range.end)} · {scope.isTenantAdmin ? "All tenant branches" : "Assigned branches"}</p></div><div className="report-date-controls"><ReportDatePicker selectedDate={selectedDate} activeView={activeView} /><div className="report-periods">{periods.map((item) => <a className={period === item.key ? "active" : ""} href={`/app/reports?period=${item.key}&date=${selectedDate}${activeView !== "dashboard" ? `&view=${activeView}` : ""}`} key={item.key}>{item.label}</a>)}</div></div></section>
    <section className="report-navigation" aria-label="Report categories">
      {reportGroups.map(({ label, items }) => <article className="report-nav-group" key={label}><h4>{label}</h4><div>{items.map(([key, itemLabel]) => { const tabPeriod = key === "daily-sales" ? "daily" : key === "monthly-sales" ? "monthly" : period; return <a className={activeView === key ? "active" : ""} href={`/app/reports?period=${tabPeriod}&date=${selectedDate}&view=${key}`} key={key}>{itemLabel}</a>; })}</div></article>)}
    </section>
    {activeView !== "dashboard" && <article className="report-card report-detail"><div className="report-card-head"><div><small>SELECTED REPORT</small><h3>{reportViewLabel}</h3><p>{periodLabel(period, range.start, range.end)}</p></div><strong>{detailRows.length} rows</strong></div>{detailRows.length ? <div className="report-detail-table">{detailRows.map((row) => <div className="report-detail-row" key={`${row.label}-${row.note}`}><strong>{row.label}</strong><b>{row.value}</b><small>{row.note}</small></div>)}</div> : <div className="report-empty compact"><span>0</span><h4>No data for this report</h4><p>There are no matching records in the selected period.</p></div>}</article>}
    <section className="report-metrics">{cards.map(([label, value, note]) => <article key={label}><small>{label}</small><strong>{value}</strong><span>{note}</span></article>)}</section>
    <section className="report-grid report-grid-primary"><article className="report-card report-trend"><div className="report-card-head"><div><small>SALES TREND</small><h3>{periods.find((item) => item.key === period)?.label} revenue movement</h3></div><strong>{money(salesTotal, currency)}</strong></div>{sales.length === 0 ? <div className="report-empty"><span>0</span><h4>No sales in this period</h4><p>Select another period or complete a POS transaction.</p></div> : <><div className={`report-bars ${period}`} aria-label="Sales trend">{buckets.map((bucket) => <div key={bucket.label} title={`${bucket.label}: ${money(bucket.value, currency)}`}><i style={{ height: peak && bucket.value ? `${Math.max(5, bucket.value / peak * 100)}%` : "0%" }} /><small>{bucket.label}</small></div>)}</div><div className="report-chart-scale"><span>{money(peak, currency, true)}</span><span>{money(peak / 2, currency, true)}</span><span>{money(0, currency, true)}</span></div></>}</article>
      <article className="report-card"><div className="report-card-head"><div><small>PAYMENT MIX</small><h3>How customers paid</h3></div></div><div className="report-payment-chart"><div className="report-donut" style={{ background: `conic-gradient(${conic})` }}><span><strong>{sales.length}</strong><small>sales</small></span></div><div className="report-payment-legend">{payments.length ? payments.map(([method, value], index) => <div key={method}><i style={{ background: palette[index % palette.length] }} /><span>{method === "Credit" ? "Customer — Pay Later" : method}</span><strong>{money(value, currency, true)}</strong><small>{paymentTotal ? (value / paymentTotal * 100).toFixed(1) : 0}%</small></div>) : <p>No payment activity.</p>}</div></div></article>
    </section>
    <section className="report-grid"><article className="report-card"><div className="report-card-head"><div><small>BRANCH PERFORMANCE</small><h3>Sales by location</h3></div></div>{branches.length ? <div className="report-ranking">{branches.map((branch, index) => <div key={branch.name}><span>{index + 1}</span><div><strong>{branch.name}</strong><small>{branch.transactions} transaction{branch.transactions === 1 ? "" : "s"}</small></div><b>{money(branch.sales, currency)}</b><i><em style={{ width: `${salesTotal ? branch.sales / salesTotal * 100 : 0}%` }} /></i></div>)}</div> : <div className="report-empty compact">No branch sales in this period.</div>}</article>
      <article className="report-card report-insights"><div className="report-card-head"><div><small>AUTOMATED INSIGHTS</small><h3>What deserves attention</h3></div><span>✦</span></div>{insights.map((insight, index) => <div className="report-insight" key={insight}><span>{index + 1}</span><p>{insight}</p></div>)}</article>
    </section>
    <article className="report-card report-staff"><div className="report-card-head"><div><small>STAFF PERFORMANCE</small><h3>Sales and shift contribution</h3></div><span>{staffPerformance.length} active staff</span></div><div className="report-table-wrap"><div className="report-staff-row head"><span>Staff member</span><span>Role / branch</span><span>Sales</span><span>Transactions</span><span>Shifts</span><span>Hours</span><span>Average sale</span></div>{staffPerformance.map((person, index) => <div className="report-staff-row" key={person.id}><div><i>{index + 1}</i><strong>{person.name}</strong></div><div><strong>{person.role}</strong><small>{person.branch}</small></div><strong>{money(person.sales, currency)}</strong><span>{person.transactions}</span><span>{person.shifts}</span><span>{person.hours.toFixed(1)}</span><strong>{money(person.transactions ? person.sales / person.transactions : 0, currency)}</strong></div>)}</div></article>
    <article className="report-card report-stock"><div className="report-card-head"><div><small>STOCK HEALTH</small><h3>Inventory requiring attention</h3></div><div className="report-stock-badges"><span>{lowStock.length} low stock</span><span>{outOfStock.length} out of stock</span></div></div>{lowStock.length ? <div className="report-stock-grid">{lowStock.slice(0, 12).map((row) => <a href="/app/inventory" key={row.id}><span>{row.product.name.slice(0,1).toUpperCase()}</span><div><strong>{row.product.name}</strong><small>{row.branch.name}</small></div><div><strong>{Number(row.quantity).toLocaleString("en-KE")}</strong><small>Reorder at {Number(row.reorderLevel).toLocaleString("en-KE")}</small></div></a>)}</div> : <div className="report-empty compact"><span>✓</span> Inventory levels are currently healthy.</div>}</article>
  </PortalShell>;
}
