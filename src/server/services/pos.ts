import { Prisma, type PrismaClient } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { requirePermission, type TenantContext } from "@/server/security/context";
import { nextNumber } from "./sequences";

type SaleInput = {
  branchId: string;
  shiftId: string;
  customerId?: string;
  idempotencyKey: string;
  items: Array<{ productId: string; quantity: string; unitPrice?: string; discount?: string }>;
  payments: Array<{ method: string; amount: string; externalReference?: string }>;
};

type PreparedSaleItem = {
  productId: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  discount: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
  trackStock: boolean;
};

export async function completeSale(db: PrismaClient, ctx: TenantContext, input: SaleInput) {
  requirePermission(ctx, "sale.create");
  requirePermission(ctx, "payment.receive");

  const scope = await resolveTenantAccessScope(db, ctx);
  if (!scope.branchIds.includes(input.branchId)) {
    throw new AppError("BRANCH_FORBIDDEN", "This account is not assigned to the selected branch", 403);
  }

  if (!input.items.length || !input.payments.length) {
    throw new AppError("INVALID_SALE", "Items and payment are required", 422);
  }

  return db.$transaction(async (tx) => {
    const duplicate = await tx.sale.findUnique({
      where: {
        tenantId_idempotencyKey: {
          tenantId: ctx.tenantId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (duplicate) return duplicate;

    const shift = await tx.shift.findFirst({
      where: {
        id: input.shiftId,
        tenantId: ctx.tenantId,
        branchId: input.branchId,
        userId: ctx.userId,
        status: "OPEN",
      },
    });
    if (!shift) throw new AppError("SHIFT_REQUIRED", "An open shift is required", 409);

    if (
      input.customerId &&
      !(await tx.customer.findFirst({
        where: { id: input.customerId, tenantId: ctx.tenantId, deletedAt: null },
      }))
    ) {
      throw new AppError("CUSTOMER_NOT_FOUND", "Customer not found", 404);
    }

    let subtotal = new Prisma.Decimal(0);
    let discount = new Prisma.Decimal(0);
    let tax = new Prisma.Decimal(0);
    const items: PreparedSaleItem[] = [];

    for (const item of input.items) {
      const product = await tx.product.findFirst({
        where: { id: item.productId, tenantId: ctx.tenantId, status: "active" },
      });
      if (!product) throw new AppError("PRODUCT_NOT_FOUND", "Product not found", 404);

      const quantity = new Prisma.Decimal(item.quantity);
      if (quantity.lte(0)) throw new AppError("INVALID_QUANTITY", "Quantity must be positive", 422);

      const unitPrice = item.unitPrice ? new Prisma.Decimal(item.unitPrice) : product.sellingPrice;
      const itemDiscount = new Prisma.Decimal(item.discount ?? 0);
      const net = unitPrice.mul(quantity).minus(itemDiscount);
      const itemTax = net.mul(product.taxRate);

      if (unitPrice.lt(product.sellingPrice)) requirePermission(ctx, "sale.override_price");

      if (product.trackStock) {
        const updated = await tx.branchInventory.updateMany({
          where: {
            tenantId: ctx.tenantId,
            branchId: input.branchId,
            productId: product.id,
            quantity: { gte: quantity },
          },
          data: { quantity: { decrement: quantity } },
        });
        if (updated.count !== 1) {
          throw new AppError("INSUFFICIENT_STOCK", `Insufficient stock for ${product.name}`, 409);
        }
      }

      subtotal = subtotal.plus(unitPrice.mul(quantity));
      discount = discount.plus(itemDiscount);
      tax = tax.plus(itemTax);
      items.push({
        productId: product.id,
        quantity,
        unitPrice,
        unitCost: product.costPrice,
        discount: itemDiscount,
        tax: itemTax,
        total: net.plus(itemTax),
        trackStock: product.trackStock,
      });
    }

    const total = subtotal.minus(discount).plus(tax);
    const paid = input.payments.reduce(
      (sum, payment) => sum.plus(payment.amount),
      new Prisma.Decimal(0),
    );
    if (paid.lt(total)) throw new AppError("PAYMENT_SHORT", "Payment does not cover sale total", 422);

    const saleNumber = await nextNumber(tx, ctx.tenantId, "sale", "SALE");
    const sale = await tx.sale.create({
      data: {
        tenantId: ctx.tenantId,
        branchId: input.branchId,
        cashierId: ctx.userId,
        customerId: input.customerId,
        shiftId: shift.id,
        saleNumber,
        idempotencyKey: input.idempotencyKey,
        subtotal,
        discount,
        tax,
        total,
        paid,
        items: {
          create: items.map(({ trackStock: _trackStock, ...item }) => item),
        },
        payments: {
          create: input.payments.map((payment) => ({
            tenantId: ctx.tenantId,
            method: payment.method,
            amount: new Prisma.Decimal(payment.amount),
            externalReference: payment.externalReference,
            receivedBy: ctx.userId,
          })),
        },
      },
    });

    const stockItems = items.filter((item) => item.trackStock);
    if (stockItems.length > 0) {
      await tx.stockMovement.createMany({
        data: stockItems.map((item) => ({
          tenantId: ctx.tenantId,
          branchId: input.branchId,
          productId: item.productId,
          type: "sale",
          quantity: item.quantity.negated(),
          referenceType: "sale",
          referenceId: sale.id,
          actorUserId: ctx.userId,
        })),
      });
    }

    const revenue = total.minus(tax);
    const cost = items.reduce(
      (sum, item) => sum.plus(item.unitCost.mul(item.quantity)),
      new Prisma.Decimal(0),
    );

    await tx.journalEntry.create({
      data: {
        tenantId: ctx.tenantId,
        referenceType: "sale",
        referenceId: sale.id,
        description: sale.saleNumber,
        lines: {
          create: [
            { accountCode: "1000", debit: total, credit: 0 },
            { accountCode: "4000", debit: 0, credit: revenue },
            { accountCode: "2100", debit: 0, credit: tax },
            { accountCode: "5000", debit: cost, credit: 0 },
            { accountCode: "1200", debit: 0, credit: cost },
          ],
        },
      },
    });

    await appendAudit(tx, ctx, {
      action: "sale.created",
      entityType: "sale",
      entityId: sale.id,
      branchId: input.branchId,
      newValues: { saleNumber, total: total.toString(), cashierId: ctx.userId },
    });

    return sale;
  }, { isolationLevel: "Serializable" });
}
