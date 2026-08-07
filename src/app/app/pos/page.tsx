import { redirect } from "next/navigation";
import { PosTerminal, type PosBehavior, type PosCustomer, type PosProduct } from "@/components/pos-terminal";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { requirePermission } from "@/server/security/context";
import { normalizeTenantSettings } from "@/server/settings/tenant-settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PosPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const session = await requireCurrentTenant();
  requirePermission(session, "product.view");
  requirePermission(session, "inventory.view");
  const scope = await resolveTenantAccessScope(db, session);
  const query = await searchParams;

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

  const [openShift, accessibleBranches, customerRows] = await Promise.all([
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
    db.customer.findMany({
      where: { tenantId: session.tenantId, status: "active", deletedAt: null },
      include: { invoices: { where: { balance: { gt: 0 }, status: { notIn: ["CANCELLED", "VOIDED", "REFUNDED"] } }, select: { balance: true } } },
      orderBy: { fullName: "asc" },
    }),
  ]);

  const requestedBranch = accessibleBranches.find((branch) => branch.id === query.branch);
  const activeBranch = openShift?.branch ?? requestedBranch ?? accessibleBranches[0] ?? null;
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
      imageData: row.product.imageData,
      category: row.product.category?.name ?? "Uncategorized",
      price: Number(row.product.sellingPrice),
      taxRate: Number(row.product.taxRate),
      quantity: Number(row.quantity),
      trackStock: row.product.trackStock,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const customers: PosCustomer[] = customerRows.map((customer) => ({
    id: customer.id,
    name: customer.fullName,
    number: customer.customerNumber,
    phone: customer.phone,
    creditLimit: Number(customer.creditLimit),
    outstandingBalance: customer.invoices.reduce((sum, invoice) => sum + Number(invoice.balance), 0),
  }));

  const settings = normalizeTenantSettings(user.tenant.settings?.metadata);
  const enabledPaymentMethods = [
    ...settings.payments.enabledMethods.filter((method) => method !== "Credit"),
    "Credit" as const,
  ];
  const behavior: PosBehavior = {
    enabledPaymentMethods: enabledPaymentMethods.length > 0 ? enabledPaymentMethods : ["Cash"],
    requireReferenceForNonCash: settings.payments.requireReferenceForNonCash,
    confirmBeforePayment: settings.pos.confirmBeforePayment,
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
      customers={customers}
      branchId={activeBranch?.id ?? null}
      branchName={activeBranch?.name ?? "No branch assigned"}
      shiftId={openShift?.id ?? null}
      cashierName={user.fullName}
      currency={user.tenant.currency || "KES"}
      canSell={session.permissions.has("sale.create") && session.permissions.has("payment.receive")}
      returnPath={scope.isTenantAdmin ? "/app/dashboard" : "/staff/dashboard"}
      behavior={behavior}
      branches={accessibleBranches.map((branch) => ({ id: branch.id, name: branch.name, code: branch.code }))}
      canSelectBranch={scope.isTenantAdmin && !openShift}
    />
  );
}
