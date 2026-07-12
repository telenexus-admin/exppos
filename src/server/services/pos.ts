import { Prisma, type PrismaClient } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { requirePermission, type TenantContext } from "@/server/security/context";
import { normalizeTenantSettings } from "@/server/settings/tenant-settings";
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
      where: { tenantId_idempotencyKey: { tenantId: ctx.tenantId, idempotencyKey: input.idempotencyKey } },
    });
    if (duplicate) return duplicate;

    const tenantSetting = await tx.tenantSetting.findUnique({ where: { tenantId: ctx.tenantId } });
    const settings = normalizeTenantSettings(tenantSetting?.metadata);
    const enabledPayments = new Set(settings.payments.enabledMethods);

    if (!settings.payments.allowSplitPayments && input.payments.length > 1) {
      throw new AppError("SPLIT_PAYMENT_DISABLED", "Split payments are disabled in this business settings", 409);
    }
    for (const payment of input.payments) {
      if (!enabledPayments.has(payment.method as never)) {
        throw new AppError("PAYMENT_METHOD_DISABLED", `${payment.method} is disabled in this business settings`, 409);
      }
      if (payment.method === "Credit" && !settings.pos.allowCreditSales) {
        throw new AppError("CREDIT_SALES_DISABLED", "Credit sales are disabled in this business settings", 409);
      }
      if (payment.method !== "Cash" && settings.payments.requireReferenceForNonCash && !payment.externalReference?.trim()) {
        throw new AppError("PAYMENT_REFERENCE_REQUIRED", `Enter the ${payment.method} transaction reference`, 422);
      }
    }

    const usesCredit = input.payments.some((payment) => payment.method === "Credit");
    if (usesCredit && settings.pos.requireCustomerForCredit && !input.customerId) {
      throw new AppError("CREDIT_CUSTOMER_REQUIRED", "Select a customer before completing a credit sale", 422);
    }

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
      !(await tx.customer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId, deletedAt: null } }))
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
      const gross = unitPrice.mul(quantity);
      if (itemDiscount.lt(0) || itemDiscount.gt(gross)) {
        throw new AppError("INVALID_DISCOUNT", `The discount for ${product.name} is invalid`, 422);
      }
      if (itemDiscount.gt(0)) {
        if (!settings.pos.allowDiscounts) {
          throw new AppError("DISCOUNTS_DISABLED", "Discounts are disabled in this business settings", 409);
        }
        const percentage = gross.isZero() ? new Prisma.Decimal(0) : itemDiscount.div(gross).mul(100);
        if (percentage.gt(settings.pos.maximumDiscountPercent)) {
          throw new AppError(
            "DISCOUNT_LIMIT_EXCEEDED",
            `Discount for ${product.name} exceeds the ${settings.pos.maximumDiscountPercent}% business limit`,
            409,
          );
        }
      }

      if (unitPrice.lt(product.sellingPrice)) {
        if (!settings.pos.allowPriceOverrides) {
          throw new AppError("PRICE_OVERRIDE_DISABLED", "Price overrides are disabled in this business settings", 409);
        }
        requirePermission(ctx, "sale.override_price");
      }

      const net = gross.minus(itemDiscount);
      let itemTax = new Prisma.Decimal(0);
      let itemTotal = net;
      if (settings.taxReceipt.taxEnabled && product.taxRate.gt(0)) {
        if (settings.taxReceipt.pricesIncludeTax) {
          itemTax = net.minus(net.div(product.taxRate.plus(1)));
        } else {
          itemTax = net.mul(product.taxRate);
          itemTotal = net.plus(itemTax);
        }
      }

      if (product.trackStock) {
        if (settings.inventory.allowNegativeStock) {
          await tx.branchInventory.upsert({
            where: {
              tenantId_branchId_productId: {
                tenantId: ctx.tenantId,
                branchId: input.branchId,
                productId: product.id,
              },
            },
            update: { quantity: { decrement: quantity } },
            create: {
              tenantId: ctx.tenantId,
              branchId: input.branchId,
              productId: product.id,
              quantity: quantity.negated(),
              reorderLevel: new Prisma.Decimal(settings.inventory.defaultReorderLevel),
            },
          });
        } else {
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
      }

      subtotal = subtotal.plus(gross);
      discount = discount.plus(itemDiscount);
      tax = tax.plus(itemTax);
      items.push({
        productId: product.id,
        quantity,
        unitPrice,
        unitCost: product.costPrice,
        discount: itemDiscount,
        tax: itemTax,
        total: itemTotal,
        trackStock: product.trackStock,
      });
    }

    const netSales = subtotal.minus(discount);
    const total = settings.taxReceipt.pricesIncludeTax ? netSales : netSales.plus(tax);
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
        items: { create: items.map(({ trackStock: _trackStock, ...item }) => item) },
        payments: {
          create: input.payments.map((payment) => ({
            tenantId: ctx.tenantId,
            method: payment.method,
            amount: new Prisma.Decimal(payment.amount),
            externalReference: payment.externalReference?.trim() || null,
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
    const cost = items.reduce((sum, item) => sum.plus(item.unitCost.mul(item.quantity)), new Prisma.Decimal(0));
    await tx.journalEntry.create({
      data: {
        tenantId: ctx.tenantId,
        referenceType: "sale",
        referenceId: sale.id,
        description: sale.saleNumber,
        lines: { create: [
          { accountCode: "1000", debit: total, credit: 0 },
          { accountCode: "4000", debit: 0, credit: revenue },
          { accountCode: "2100", debit: 0, credit: tax },
          { accountCode: "5000", debit: cost, credit: 0 },
          { accountCode: "1200", debit: 0, credit: cost },
        ] },
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
