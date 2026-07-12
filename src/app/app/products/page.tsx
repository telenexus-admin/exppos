import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { requirePermission } from "@/server/security/context";
import { ProductManager } from "./product-manager";

export const dynamic = "force-dynamic";

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

export default async function ProductsPage() {
  const session = await requireCurrentTenant();
  requirePermission(session, "product.view");

  const [viewer, tenant, categories, branches, products] = await Promise.all([
    db.user.findFirst({
      where: { id: session.userId, tenantId: session.tenantId, status: "ACTIVE" },
      include: { roles: { include: { role: true } } },
    }),
    db.tenant.findUnique({
      where: { id: session.tenantId },
      include: { subscription: { include: { plan: true } } },
    }),
    db.category.findMany({
      where: { tenantId: session.tenantId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.branch.findMany({
      where: { tenantId: session.tenantId, status: "ACTIVE" },
      select: { id: true, name: true, code: true },
      orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
    }),
    db.product.findMany({
      where: { tenantId: session.tenantId },
      include: {
        category: true,
        inventories: { include: { branch: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!viewer || !tenant) redirect("/login");

  const roleLabel = viewer.roles.map(({ role }) => role.name).join(", ") || "Tenant user";
  const currency = tenant.currency || "KES";
  const maxProducts = tenant.subscription?.plan.maxProducts ?? products.length;
  const activeProducts = products.filter((product) => product.status === "active").length;
  const stockTracked = products.filter((product) => product.trackStock).length;
  const totalStock = products.reduce(
    (sum, product) => sum + product.inventories.reduce((inner, inventory) => inner + Number(inventory.quantity), 0),
    0,
  );

  return (
    <PortalShell title="Products" role={roleLabel} current="products" branchName={tenant.name}>
      <section className="catalog-page-heading">
        <div>
          <small>PRODUCT CATALOGUE</small>
          <h3>Products, prices and selling details</h3>
          <p>Create products here and allocate opening stock. Each item will become available to the Inventory tab and the assigned branch POS.</p>
        </div>
        <ProductManager
          branches={branches}
          categories={categories}
          canCreate={session.permissions.has("product.create")}
          currentProducts={products.length}
          maxProducts={maxProducts}
        />
      </section>

      <section className="catalog-summary-grid">
        <article><small>All products</small><strong>{products.length}</strong><span>Plan limit {maxProducts}</span></article>
        <article><small>Active products</small><strong>{activeProducts}</strong><span>Available for sale</span></article>
        <article><small>Stock-tracked</small><strong>{stockTracked}</strong><span>Physical inventory items</span></article>
        <article><small>Total units</small><strong>{totalStock.toLocaleString("en-KE", { maximumFractionDigits: 3 })}</strong><span>Across all branches</span></article>
      </section>

      <article className="panel catalog-data-panel">
        <div className="catalog-panel-heading">
          <div><small>LIVE CATALOGUE</small><h3>Product directory</h3><p>Prices and branch allocation are read directly from the tenant database.</p></div>
          <span>{products.length} item{products.length === 1 ? "" : "s"}</span>
        </div>

        {products.length === 0 ? (
          <div className="catalog-empty-state">
            <span>＋</span>
            <h3>No products yet</h3>
            <p>Use the Add product button to create the first item and opening stock.</p>
          </div>
        ) : (
          <div className="catalog-table-wrap">
            <div className="product-table product-table-head">
              <span>Product</span><span>Category</span><span>Cost / price</span><span>Stock allocation</span><span>Status</span>
            </div>
            {products.map((product) => {
              const units = product.inventories.reduce((sum, inventory) => sum + Number(inventory.quantity), 0);
              const branchNames = product.inventories.map((inventory) => inventory.branch.name).join(", ") || "Not allocated";
              return (
                <div className="product-table" key={product.id}>
                  <div className="catalog-product-cell"><span>{product.name.slice(0, 1).toUpperCase()}</span><div><strong>{product.name}</strong><small>SKU {product.sku}{product.barcode ? ` · ${product.barcode}` : ""}</small></div></div>
                  <div><strong>{product.category?.name ?? "Uncategorized"}</strong><small>{product.trackStock ? "Stock item" : "Service / unlimited"}</small></div>
                  <div><strong>{money(Number(product.sellingPrice), currency)}</strong><small>Cost {money(Number(product.costPrice), currency)} · Tax {(Number(product.taxRate) * 100).toFixed(2)}%</small></div>
                  <div><strong>{product.trackStock ? units.toLocaleString("en-KE", { maximumFractionDigits: 3 }) : "Unlimited"}</strong><small title={branchNames}>{branchNames}</small></div>
                  <span className={`catalog-status ${product.status === "active" ? "active" : "inactive"}`}>{product.status}</span>
                </div>
              );
            })}
          </div>
        )}
      </article>
    </PortalShell>
  );
}
