import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { requirePermission } from "@/server/security/context";
import { PosTerminal, type PosProduct } from "@/components/pos-terminal";

export const dynamic = "force-dynamic";

export default async function PosPage() {
  const session = await requireCurrentTenant();
  requirePermission(session, "product.view");
  requirePermission(session, "inventory.view");

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
    include: { branch: true },
    orderBy: { openedAt: "desc" },
  });

  const assignedBranches = user.branches
    .map((assignment) => assignment.branch)
    .filter((branch) => branch.tenantId === session.tenantId && branch.status === "ACTIVE");
  const activeBranch = openShift?.branch ?? assignedBranches[0] ?? null;

  const inventory = activeBranch
    ? await db.branchInventory.findMany({
        where: {
          tenantId: session.tenantId,
          branchId: activeBranch.id,
          product: { tenantId: session.tenantId, status: "active" },
        },
        include: { product: { include: { category: true } } },
      })
    : [];

  const products: PosProduct[] = inventory
    .map((row) => ({
      id: row.product.id,
      name: row.product.name,
      sku: row.product.sku,
      barcode: row.product.barcode,
      category: row.product.category?.name ?? "Uncategorized",
      price: Number(row.product.sellingPrice),
      taxRate: Number(row.product.taxRate),
      quantity: Number(row.quantity),
      trackStock: row.product.trackStock,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const roleCodes = user.roles.map(({ role }) => role.code);
  const returnPath = roleCodes.includes("TENANT_ADMIN") ? "/app/dashboard" : "/staff/dashboard";
  const canSell = session.permissions.has("sale.create") && session.permissions.has("payment.receive");

  return (
    <PosTerminal
      products={products}
      branchId={activeBranch?.id ?? null}
      branchName={activeBranch?.name ?? "No branch assigned"}
      shiftId={openShift?.id ?? null}
      cashierName={user.fullName}
      currency={user.tenant.currency || "KES"}
      canSell={canSell}
      returnPath={returnPath}
    />
  );
}
