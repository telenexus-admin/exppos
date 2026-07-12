import { notFound, redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { requirePermission } from "@/server/security/context";
import { ProductEditForm, type EditableProduct } from "./product-edit-form";

export const dynamic = "force-dynamic";

export default async function ProductEditPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const session = await requireCurrentTenant();
  requirePermission(session, "product.view");
  requirePermission(session, "product.update");

  const { productId } = await params;
  const [viewer, tenant, categories, product] = await Promise.all([
    db.user.findFirst({
      where: { id: session.userId, tenantId: session.tenantId, status: "ACTIVE" },
      include: { roles: { include: { role: true } } },
    }),
    db.tenant.findUnique({ where: { id: session.tenantId } }),
    db.category.findMany({
      where: { tenantId: session.tenantId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.product.findFirst({
      where: { id: productId, tenantId: session.tenantId },
      include: {
        inventories: {
          include: { branch: true },
          orderBy: { branch: { name: "asc" } },
        },
      },
    }),
  ]);

  if (!viewer || !tenant) redirect("/login");
  if (!product) notFound();

  const roleLabel = viewer.roles.map(({ role }) => role.name).join(", ") || "Tenant user";
  const editableProduct: EditableProduct = {
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    categoryId: product.categoryId,
    costPrice: Number(product.costPrice),
    sellingPrice: Number(product.sellingPrice),
    taxPercent: Number(product.taxRate) * 100,
    trackStock: product.trackStock,
    status: product.status === "inactive" ? "inactive" : "active",
  };

  const inventory = product.inventories
    .filter((row) => row.branch.tenantId === session.tenantId)
    .map((row) => ({
      id: row.id,
      branchName: row.branch.name,
      branchCode: row.branch.code,
      quantity: Number(row.quantity),
      reorderLevel: Number(row.reorderLevel),
    }));

  return (
    <PortalShell title={`Edit ${product.name}`} role={roleLabel} current="products" branchName={tenant.name}>
      <section className="product-edit-heading">
        <div>
          <a href="/app/products">← Back to products</a>
          <small>PRODUCT EDITOR</small>
          <h3>Update product information</h3>
          <p>Changes are reflected in the admin catalogue, Inventory and every branch POS that sells this item.</p>
        </div>
      </section>

      <ProductEditForm
        product={editableProduct}
        categories={categories}
        inventory={inventory}
        currency={tenant.currency || "KES"}
      />
    </PortalShell>
  );
}
