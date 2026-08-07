import { redirect } from "next/navigation";
import { LiveDataRefresh } from "@/components/live-data-refresh";
import { PortalShell } from "@/components/portal-shell";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { requirePermission } from "@/server/security/context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SalesTab = "new-sale" | "history" | "returns" | "quotations" | "customer-list" | "credit-customers" | "loyalty-points" | "receive-payment" | "pending-payments" | "payment-methods" | "promotions" | "cash-open-close" | "cash-movements" | "daily-sales" | "sales-summary" | "profit-report" | "by-product" | "by-cashier";
const salesTabs: { key: SalesTab; label: string; group: string; href?: string }[] = [
  { key: "new-sale", label: "New Sale", group: "Sales", href: "/app/pos" },
  { key: "history", label: "Sales History", group: "Sales" },
  { key: "returns", label: "Returns & Refunds", group: "Sales" },
  { key: "quotations", label: "Quotations / Estimates", group: "Sales" },
  { key: "customer-list", label: "Customer List", group: "Customers" },
  { key: "credit-customers", label: "Credit Customers", group: "Customers" },
  { key: "loyalty-points", label: "Loyalty Points", group: "Customers" },
  { key: "receive-payment", label: "Receive Payment", group: "Payments" },
  { key: "pending-payments", label: "Pending Payments", group: "Payments" },
  { key: "payment-methods", label: "Payment Methods", group: "Payments" },
  { key: "promotions", label: "Promotions & Discounts", group: "Sales" },
  { key: "cash-open-close", label: "Open / Close Register", group: "Payments" },
  { key: "cash-movements", label: "Cash Movements", group: "Payments" },
  { key: "daily-sales", label: "Daily Sales", group: "Reports" },
  { key: "sales-summary", label: "Sales Summary", group: "Reports" },
  { key: "profit-report", label: "Profit Report", group: "Reports" },
  { key: "by-product", label: "Sales by Product", group: "Reports" },
  { key: "by-cashier", label: "Sales by Cashier", group: "Reports" },
];

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

export default async function SalesPage({ searchParams }: { searchParams?: Promise<{ tab?: string }> }) {
  const session = await requireCurrentTenant();
  requirePermission(session, "sale.view");
  const scope = await resolveTenantAccessScope(db, session);
  const requestedTab = (await searchParams)?.tab as SalesTab | undefined;
  const activeTab: SalesTab = salesTabs.some((tab) => tab.key === requestedTab) ? requestedTab! : "history";
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
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            product: { select: { id: true, name: true, sku: true, tenantId: true } },
          },
        },
        payments: {
          where: { tenantId: session.tenantId },
          select: { method: true, amount: true, status: true, externalReference: true },
        },
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
  const productSummary = new Map<string, { quantity: number; value: number }>();
  const cashierSummary = new Map<string, { count: number; value: number }>();
  completed.forEach((sale) => {
    const cashier = cashierSummary.get(sale.cashier.fullName) ?? { count: 0, value: 0 };
    cashier.count += 1; cashier.value += Number(sale.total); cashierSummary.set(sale.cashier.fullName, cashier);
    sale.items.forEach((item) => {
      const product = productSummary.get(item.product.name) ?? { quantity: 0, value: 0 };
      product.quantity += Number(item.quantity); product.value += Number(item.quantity) * Number(item.unitPrice);
      productSummary.set(item.product.name, product);
    });
  });

  return (
    <PortalShell title="Sales" role={roleLabel} current="sales" branchName={`${tenant.name} · ${tenant.code}`}>
      <section className="sales-page-heading">
        <div>
          <small>SALES WORKSPACE</small>
          <h3>{salesTabs.find((tab) => tab.key === activeTab)?.label}</h3>
          <p>Branch-scoped sales, customer, payment and reporting workflows for {tenant.name}.</p>
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
          <div><small>{activeTab === "history" ? "LIVE TRANSACTIONS" : "SELECTED SALES WORKFLOW"}</small><h3>{salesTabs.find((tab) => tab.key === activeTab)?.label}</h3></div>
          <span>{sales.length} record{sales.length === 1 ? "" : "s"}</span>
        </div>

        {activeTab !== "history" && <div className="sales-workflow-note">
          <strong>{salesTabs.find((tab) => tab.key === activeTab)?.label}</strong>
          <p>{activeTab === "returns" ? "Review return and refund activity without deleting the original sale." :
            activeTab === "quotations" ? "Create and convert estimates into sales while preserving the original quotation." :
            ["customer-list", "credit-customers", "loyalty-points"].includes(activeTab) ? "Use customer accounts for balances, credit sales and loyalty activity." :
            ["receive-payment", "pending-payments", "payment-methods"].includes(activeTab) ? "Review received, pending and split payments linked to sales." :
            activeTab === "promotions" ? "Manage promotions and discount rules independently from stored inventory." :
            ["cash-open-close", "cash-movements"].includes(activeTab) ? "Open and close cash sessions and review cash movements." :
            activeTab === "daily-sales" ? "Daily sales totals for the current Nairobi business day." :
            activeTab === "sales-summary" ? "Summary of completed sales in the visible branch scope." :
            activeTab === "profit-report" ? "Sales value is shown here; product cost data is used for profit calculations." :
            activeTab === "by-product" ? "Product quantities and sales values from completed transactions." :
            "Cashier transaction counts and sales values from completed transactions."}</p>
        </div>}

        {activeTab === "history" ? (sales.length === 0 ? (
          <div className="empty-state">
            <span>0</span>
            <h3>No sales recorded</h3>
            <p>A completed checkout by an assigned staff member will appear here automatically.</p>
          </div>
        ) : (
          <div className="sales-table-wrap">
            <div className="sales-table-row sales-table-head">
              <span>Sale / products</span><span>Branch</span><span>Cashier</span><span>Customer</span><span>Payment</span><span>Total</span><span>Status</span><span>Time</span>
            </div>
            {sales.map((sale) => {
              const paymentMethods = sale.payments.map((payment) => payment.method === "Credit" ? "Customer — Pay Later" : payment.method).join(", ") || "No payment";
              const productNames = sale.items
                .filter((item) => item.product.tenantId === session.tenantId)
                .map((item) => `${item.product.name} × ${Number(item.quantity).toLocaleString("en-KE", { maximumFractionDigits: 3 })}`)
                .join(", ");
              return (
                <div className="sales-table-row" key={sale.id}>
                  <div><strong>{sale.saleNumber}</strong><small title={productNames}>{productNames || "No product details"}</small></div>
                  <div><strong>{sale.branch.name}</strong><small>{sale.branch.code}</small></div>
                  <div><strong>{sale.cashier.fullName}</strong><small>@{sale.cashier.staffNumber}</small></div>
                  <div><strong>{sale.customer?.fullName ?? "Walk-in customer"}</strong><small>{sale.customer ? "Customer account" : "No customer selected"}</small></div>
                  <div><strong>{paymentMethods}</strong><small>{sale.payments.some((payment) => payment.status === "PENDING") ? "Outstanding" : formatMoney(sale.payments.reduce((sum, payment) => sum + Number(payment.amount), 0), currency)}</small></div>
                  <strong>{formatMoney(Number(sale.total), currency)}</strong>
                  <span className={`sales-status ${sale.status.toLowerCase()}`}>{sale.status.toLowerCase().replaceAll("_", " ")}</span>
                  <time dateTime={sale.createdAt.toISOString()}>{sale.createdAt.toLocaleString("en-KE", { timeZone: tenant.timezone, dateStyle: "short", timeStyle: "short" })}</time>
                </div>
              );
            })}
          </div>
        )) : ["daily-sales", "sales-summary", "profit-report", "by-product", "by-cashier"].includes(activeTab) ? (
          <div className="data-table">
            <div className="table-row table-head"><strong>{activeTab === "by-product" ? "Product" : activeTab === "by-cashier" ? "Cashier" : "Metric"}</strong><strong>Count</strong><strong>Value</strong><strong>Period</strong></div>
            {activeTab === "daily-sales" && <div className="table-row"><span>Sales today</span><span>{today.length}</span><strong>{formatMoney(todayTotal, currency)}</strong><span>Current business day</span></div>}
            {activeTab === "sales-summary" && <div className="table-row"><span>Completed sales</span><span>{completed.length}</span><strong>{formatMoney(allTotal, currency)}</strong><span>Latest 200 visible</span></div>}
            {activeTab === "profit-report" && <div className="table-row"><span>Gross sales value</span><span>{completed.length}</span><strong>{formatMoney(allTotal, currency)}</strong><span>Cost basis retained</span></div>}
            {activeTab === "by-product" && [...productSummary.entries()].map(([name, row]) => <div className="table-row" key={name}><span>{name}</span><span>{row.quantity}</span><strong>{formatMoney(row.value, currency)}</strong><span>Completed sales</span></div>)}
            {activeTab === "by-cashier" && [...cashierSummary.entries()].map(([name, row]) => <div className="table-row" key={name}><span>{name}</span><span>{row.count}</span><strong>{formatMoney(row.value, currency)}</strong><span>Completed sales</span></div>)}
            {activeTab === "by-product" && productSummary.size === 0 && <div className="empty-state"><h3>No product rows</h3><p>Completed sales will populate this report.</p></div>}
            {activeTab === "by-cashier" && cashierSummary.size === 0 && <div className="empty-state"><h3>No cashier rows</h3><p>Completed sales will populate this report.</p></div>}
          </div>
        ) : (
          <div className="data-table"><div className="table-row table-head"><strong>Workflow</strong><strong>Available data</strong><strong>Next action</strong></div>
            <div className="table-row"><span>{salesTabs.find((tab) => tab.key === activeTab)?.label}</span><span>{sales.length} related sales</span><span>Use the POS or management flow to create records</span></div>
          </div>
        )}
      </article>
    </PortalShell>
  );
}
