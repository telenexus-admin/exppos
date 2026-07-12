import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { requirePermission } from "@/server/security/context";
import { InventoryManager } from "./inventory-manager";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const session = await requireCurrentTenant();
  requirePermission(session, "inventory.view");

  const [viewer, tenant, branches, products, inventory] = await Promise.all([
    db.user.findFirst({
      where: { id: session.userId, tenantId: session.tenantId, status: "ACTIVE" },
      include: { roles: { include: { role: true } } },
    }),
    db.tenant.findUnique({ where: { id: session.tenantId } }),
    db.branch.findMany({
      where: { tenantId: session.tenantId, status: "ACTIVE" },
      select: { id: true, name: true, code: true },
      orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
    }),
    db.product.findMany({
      where: { tenantId: session.tenantId, status: "active" },
      select: { id: true, name: true, sku: true, trackStock: true },
      orderBy: { name: "asc" },
    }),
    db.branchInventory.findMany({
      where: {
        tenantId: session.tenantId,
        branch: { tenantId: session.tenantId, status: "ACTIVE" },
        product: { tenantId: session.tenantId, status: "active" },
      },
      include: {
        branch: true,
        product: { include: { category: true } },
      },
      orderBy: [{ branch: { name: "asc" } }, { product: { name: "asc" } }],
    }),
  ]);

  if (!viewer || !tenant) redirect("/login");

  const roleLabel = viewer.roles.map(({ role }) => role.name).join(", ") || "Tenant user";
  const trackedRows = inventory.filter((row) => row.product.trackStock);
  const totalUnits = trackedRows.reduce((sum, row) => sum + Number(row.quantity), 0);
  const lowStockRows = trackedRows.filter((row) => Number(row.quantity) <= Number(row.reorderLevel));
  const outOfStockRows = trackedRows.filter((row) => Number(row.quantity) <= 0);

  return (
    <PortalShell title="Inventory" role={roleLabel} current="inventory" branchName={tenant.name}>
      <section className="catalog-page-heading inventory-heading">
        <div>
          <small>LIVE BRANCH INVENTORY</small>
          <h3>Stock levels, reorder points and adjustments</h3>
          <p>Select any stock-tracked product, allocate it to a branch, and update quantities. Staff POS checkout reads these exact branch balances.</p>
        </div>
        <InventoryManager
          products={products}
          branches={branches}
          canAdjust={session.permissions.has("inventory.adjust")}
        />
      </section>

      <section className="catalog-summary-grid">
        <article><small>Stock products</small><strong>{products.filter((product) => product.trackStock).length}</strong><span>Selectable for adjustments</span></article>
        <article><small>Total units</small><strong>{totalUnits.toLocaleString("en-KE", { maximumFractionDigits: 3 })}</strong><span>Across active branches</span></article>
        <article><small>Low stock</small><strong>{lowStockRows.length}</strong><span>At or below reorder level</span></article>
        <article><small>Out of stock</small><strong>{outOfStockRows.length}</strong><span>Requires restocking</span></article>
      </section>

      <article className="panel catalog-data-panel">
        <div className="catalog-panel-heading">
          <div><small>BRANCH BALANCES</small><h3>Inventory register</h3><p>Every row is tenant-scoped and tied to one product and one branch.</p></div>
          <span>{inventory.length} allocation{inventory.length === 1 ? "" : "s"}</span>
        </div>

        {inventory.length === 0 ? (
          <div className="catalog-empty-state">
            <span>0</span>
            <h3>No stock allocations yet</h3>
            <p>Create a product with opening stock, or use Adjust stock to allocate an existing product to a branch.</p>
          </div>
        ) : (
          <div className="catalog-table-wrap">
            <div className="inventory-table inventory-table-head">
              <span>Product</span><span>Branch</span><span>Available</span><span>Reorder level</span><span>Stock status</span>
            </div>
            {inventory.map((row) => {
              const quantity = Number(row.quantity);
              const reorderLevel = Number(row.reorderLevel);
              const isService = !row.product.trackStock;
              const out = !isService && quantity <= 0;
              const low = !isService && !out && quantity <= reorderLevel;
              const status = isService ? "Unlimited" : out ? "Out of stock" : low ? "Low stock" : "In stock";
              const statusClass = isService ? "service" : out ? "danger" : low ? "warning" : "active";

              return (
                <div className="inventory-table" key={row.id}>
                  <div className="catalog-product-cell"><span>{row.product.name.slice(0, 1).toUpperCase()}</span><div><strong>{row.product.name}</strong><small>{row.product.sku} · {row.product.category?.name ?? "Uncategorized"}</small></div></div>
                  <div><strong>{row.branch.name}</strong><small>{row.branch.code}</small></div>
                  <div><strong>{isService ? "Unlimited" : quantity.toLocaleString("en-KE", { maximumFractionDigits: 3 })}</strong><small>{isService ? "Stock tracking disabled" : "Current balance"}</small></div>
                  <div><strong>{isService ? "—" : reorderLevel.toLocaleString("en-KE", { maximumFractionDigits: 3 })}</strong><small>Restock threshold</small></div>
                  <span className={`catalog-status ${statusClass}`}>{status}</span>
                </div>
              );
            })}
          </div>
        )}
      </article>
    </PortalShell>
  );
}
