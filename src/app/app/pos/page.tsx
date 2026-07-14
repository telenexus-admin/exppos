import { redirect } from "next/navigation";
import { PosTerminal, type PosBehavior, type PosProduct } from "@/components/pos-terminal";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { requirePermission } from "@/server/security/context";
import { normalizeTenantSettings } from "@/server/settings/tenant-settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PosPage() {
  const session = await requireCurrentTenant();
  requirePermission(session, "product.view");
  requirePermission(session, "inventory.view");
  const scope = await resolveTenantAccessScope(db, session);

  const user = await db.user.findFirst({
    where: { id: session.userId, tenantId: session.tenantId, status: "ACTIVE" },
    include: {
      tenant: { include: { settings: true } },
      roles: {
        where: { role: { tenantId: session.tenantId } },
        include: { role: true },
      },
    },
  });

  if (!user) redirect("/login");

  const [openShift, accessibleBranches] = await Promise.all([
    db.shift.findFirst({
      where: {
        tenantId: session.tenantId,
        userId: session.userId,
        branchId: { in: scope.branchIds },
        status: "OPEN",
      },
      include: { branch: true },
      orderBy: { openedAt: "desc" },
    }),
    db.branch.findMany({
      where: {
        tenantId: session.tenantId,
        id: { in: scope.branchIds },
        status: "ACTIVE",
      },
      orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
    }),
  ]);

  const activeBranch = openShift?.branch ?? accessibleBranches[0] ?? null;
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

  const settings = normalizeTenantSettings(user.tenant.settings?.metadata);
  const enabledPaymentMethods = settings.payments.enabledMethods.filter(
    (method) => method !== "Credit" || settings.pos.allowCreditSales,
  );
  const canOverrideOutOfStock = session.permissions.has("manager.approve");
  const behavior: PosBehavior = {
    enabledPaymentMethods: enabledPaymentMethods.length > 0 ? enabledPaymentMethods : ["Cash"],
    requireReferenceForNonCash: settings.payments.requireReferenceForNonCash,
    confirmBeforePayment: settings.pos.confirmBeforePayment,
    allowNegativeStock: settings.inventory.allowNegativeStock || canOverrideOutOfStock,
    canOverrideOutOfStock,
    taxEnabled: settings.taxReceipt.taxEnabled,
    pricesIncludeTax: settings.taxReceipt.pricesIncludeTax,
    showTaxBreakdown: settings.taxReceipt.showTaxBreakdown,
    mpesaType: settings.payments.mpesaType,
    mpesaNumber: settings.payments.mpesaNumber,
    mpesaAccountInstructions: settings.payments.mpesaAccountInstructions,
  };

  return (
    <PosTerminal
      products={products}
      branchId={activeBranch?.id ?? null}
      branchName={activeBranch?.name ?? "No branch assigned"}
      shiftId={openShift?.id ?? null}
      cashierName={user.fullName}
      currency={user.tenant.currency || "KES"}
      canSell={session.permissions.has("sale.create") && session.permissions.has("payment.receive")}
      returnPath={scope.isTenantAdmin ? "/app/dashboard" : "/staff/dashboard"}
      behavior={behavior}
    />
  );
}
