import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { requirePermission } from "@/server/security/context";
import { CustomerEditButton, CustomerManager } from "./customer-manager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function money(value: number, currency: string) {
  try { return new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
}

export default async function CustomersPage() {
  const session = await requireCurrentTenant();
  requirePermission(session, "customer.view");
  const [viewer, tenant, customers] = await Promise.all([
    db.user.findFirst({ where: { id: session.userId, tenantId: session.tenantId, status: "ACTIVE" }, include: { roles: { include: { role: true } } } }),
    db.tenant.findUnique({ where: { id: session.tenantId }, select: { name: true, currency: true } }),
    db.customer.findMany({
      where: { tenantId: session.tenantId, deletedAt: null },
      include: {
        invoices: { where: { status: { notIn: ["CANCELLED", "VOIDED", "REFUNDED"] } }, orderBy: { createdAt: "desc" } },
        sales: { orderBy: { createdAt: "desc" }, take: 20, include: { branch: { select: { name: true } }, cashier: { select: { fullName: true } }, items: { include: { product: { select: { name: true, sku: true } } } }, payments: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!viewer || !tenant) redirect("/login");
  const currency = tenant.currency || "KES";
  const role = viewer.roles.map(({ role }) => role.name).join(", ") || "Tenant user";
  const outstanding = customers.reduce((sum, customer) => sum + customer.invoices.reduce((inner, invoice) => inner + Number(invoice.balance), 0), 0);
  const creditCustomers = customers.filter((customer) => customer.invoices.some((invoice) => Number(invoice.balance) > 0)).length;

  return <PortalShell title="Customers" role={role} current="customers" branchName={tenant.name}>
    <section className="customer-page-heading"><div><small>CUSTOMER ACCOUNTS</small><h3>Customers, purchases and pay-later balances</h3><p>Add customers here, then select them during checkout when they will pay later.</p></div><CustomerManager canCreate={session.permissions.has("customer.create")} /></section>
    <section className="customer-summary-grid"><article><small>Customers</small><strong>{customers.length}</strong><span>Active customer records</span></article><article><small>With balances</small><strong>{creditCustomers}</strong><span>Customers owing money</span></article><article><small>Total receivables</small><strong>{money(outstanding, currency)}</strong><span>Outstanding pay-later sales</span></article></section>
    <article className="panel customer-directory"><div className="customer-panel-heading"><div><small>LIVE DIRECTORY</small><h3>Customer accounts</h3></div><span>{customers.length} customer{customers.length === 1 ? "" : "s"}</span></div>
      {customers.length === 0 ? <div className="customer-empty"><span>＋</span><h3>No customers yet</h3><p>Add the first customer so staff can select them at checkout.</p></div> : customers.map((customer) => {
        const balance = customer.invoices.reduce((sum, invoice) => sum + Number(invoice.balance), 0);
        return <details className="customer-account" key={customer.id}><summary><div className="customer-identity"><span>{customer.fullName.slice(0,1).toUpperCase()}</span><div><strong>{customer.fullName}</strong><small>{customer.customerNumber} · {customer.phone || customer.email || "No contact details"}</small></div></div><div><small>Purchases</small><strong>{customer.sales.length}</strong></div><div><small>Pay-later balance</small><strong className={balance > 0 ? "customer-balance-due" : ""}>{money(balance, currency)}</strong></div><em>{customer.status}</em></summary>
          <div className="customer-history"><div className="customer-history-head"><div><h4>Purchase history</h4><p>Products purchased by this customer, including pay-later transactions.</p></div><div className="customer-history-actions"><span>Credit limit: {Number(customer.creditLimit) > 0 ? money(Number(customer.creditLimit), currency) : "No fixed limit"}</span><CustomerEditButton canEdit={session.permissions.has("customer.update")} customer={{ id: customer.id, fullName: customer.fullName, companyName: customer.companyName, phone: customer.phone, email: customer.email, creditLimit: Number(customer.creditLimit) }} /></div></div>
            {customer.sales.length === 0 ? <p className="customer-no-history">No purchases recorded for this customer.</p> : customer.sales.map((sale) => { const credit = sale.payments.some((payment) => payment.method === "Credit"); return <div className="customer-sale" key={sale.id}><div><strong>{sale.saleNumber}</strong><small>{sale.createdAt.toLocaleString("en-KE")} · {sale.branch.name} · {sale.cashier.fullName}</small></div><div className="customer-sale-items">{sale.items.map((item) => <span key={item.id}>{item.product.name} × {Number(item.quantity).toLocaleString("en-KE")} <small>{item.product.sku}</small></span>)}</div><div><strong>{money(Number(sale.total), currency)}</strong><em className={credit ? "pay-later" : "paid"}>{credit ? "Pay later" : "Paid"}</em></div></div>; })}
          </div>
        </details>;
      })}
    </article>
  </PortalShell>;
}
