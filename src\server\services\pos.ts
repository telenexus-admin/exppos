import { Prisma, type PrismaClient } from "@prisma/client";
import type { TenantContext } from "@/server/security/context";
import { requireBranch, requirePermission } from "@/server/security/context";
import { appendAudit } from "@/server/audit/audit";
import { nextNumber } from "./sequences";
import { AppError } from "@/lib/errors";

type SaleInput = { branchId: string; shiftId: string; customerId?: string; idempotencyKey: string; items: Array<{ productId: string; quantity: string; unitPrice?: string; discount?: string }>; payments: Array<{ method: string; amount: string; externalReference?: string }> };

export async function completeSale(db: PrismaClient, ctx: TenantContext, input: SaleInput) {
  requirePermission(ctx, "sale.create"); requirePermission(ctx, "payment.receive"); requireBranch(ctx, input.branchId);
  if (!input.items.length || !input.payments.length) throw new AppError("INVALID_SALE", "Items and payment are required", 422);
  return db.$transaction(async (tx) => {
    const duplicate = await tx.sale.findUnique({ where: { tenantId_idempotencyKey: { tenantId: ctx.tenantId, idempotencyKey: input.idempotencyKey } } });
    if (duplicate) return duplicate;
    const shift = await tx.shift.findFirst({ where: { id: input.shiftId, tenantId: ctx.tenantId, branchId: input.branchId, userId: ctx.userId, status: "OPEN" } });
    if (!shift) throw new AppError("SHIFT_REQUIRED", "An open shift is required", 409);
    if (input.customerId && !await tx.customer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId, deletedAt: null } })) throw new AppError("CUSTOMER_NOT_FOUND", "Customer not found", 404);
    let subtotal = new Prisma.Decimal(0), discount = new Prisma.Decimal(0), tax = new Prisma.Decimal(0);
    const items = [] as Array<{ productId: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; unitCost: Prisma.Decimal; discount: Prisma.Decimal; tax: Prisma.Decimal; total: Prisma.Decimal }>;
    for (const item of input.items) {
      const product = await tx.product.findFirst({ where: { id: item.productId, tenantId: ctx.tenantId, status: "active" } });
      if (!product) throw new AppError("PRODUCT_NOT_FOUND", "Product not found", 404);
      const quantity = new Prisma.Decimal(item.quantity); if (quantity.lte(0)) throw new AppError("INVALID_QUANTITY", "Quantity must be positive", 422);
      const unitPrice = item.unitPrice ? new Prisma.Decimal(item.unitPrice) : product.sellingPrice;
      const itemDiscount = new Prisma.Decimal(item.discount ?? 0); const net = unitPrice.mul(quantity).minus(itemDiscount); const itemTax = net.mul(product.taxRate);
      if (unitPrice.lt(product.sellingPrice)) requirePermission(ctx, "sale.override_price");
      const updated = await tx.branchInventory.updateMany({ where: { tenantId: ctx.tenantId, branchId: input.branchId, productId: product.id, quantity: { gte: quantity } }, data: { quantity: { decrement: quantity } } });
      if (product.trackStock && updated.count !== 1) throw new AppError("INSUFFICIENT_STOCK", `Insufficient stock for ${product.name}`, 409);
      subtotal = subtotal.plus(unitPrice.mul(quantity)); discount = discount.plus(itemDiscount); tax = tax.plus(itemTax);
      items.push({ productId: product.id, quantity, unitPrice, unitCost: product.costPrice, discount: itemDiscount, tax: itemTax, total: net.plus(itemTax) });
    }
    const total = subtotal.minus(discount).plus(tax); const paid = input.payments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
    if (paid.lt(total)) throw new AppError("PAYMENT_SHORT", "Payment does not cover sale total", 422);
    const saleNumber = await nextNumber(tx, ctx.tenantId, "sale", "SALE");
    const sale = await tx.sale.create({ data: { tenantId: ctx.tenantId, branchId: input.branchId, cashierId: ctx.userId, customerId: input.customerId, shiftId: shift.id, saleNumber, idempotencyKey: input.idempotencyKey, subtotal, discount, tax, total, paid, items: { create: items }, payments: { create: input.payments.map((p) => ({ tenantId: ctx.tenantId, method: p.method, amount: new Prisma.Decimal(p.amount), externalReference: p.externalReference, receivedBy: ctx.userId })) } } });
    await tx.stockMovement.createMany({ data: items.map((item) => ({ tenantId: ctx.tenantId, branchId: input.branchId, productId: item.productId, type: "sale", quantity: item.quantity.negated(), referenceType: "sale", referenceId: sale.id, actorUserId: ctx.userId })) });
    const revenue = total.minus(tax); const cost = items.reduce((s, i) => s.plus(i.unitCost.mul(i.quantity)), new Prisma.Decimal(0));
    await tx.journalEntry.create({ data: { tenantId: ctx.tenantId, referenceType: "sale", referenceId: sale.id, description: sale.saleNumber, lines: { create: [
      { accountCode: "1000", debit: total, credit: 0 }, { accountCode: "4000", debit: 0, credit: revenue }, { accountCode: "2100", debit: 0, credit: tax },
      { accountCode: "5000", debit: cost, credit: 0 }, { accountCode: "1200", debit: 0, credit: cost },
    ] } } });
    await appendAudit(tx, ctx, { action: "sale.created", entityType: "sale", entityId: sale.id, branchId: input.branchId, newValues: { saleNumber, total: total.toString() } });
    return sale;
  }, { isolationLevel: "Serializable" });
}
