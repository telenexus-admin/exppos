import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { apiError, tenantContext } from "@/server/http";
import { requirePermission } from "@/server/security/context";
import { normalizeTenantSettings } from "@/server/settings/tenant-settings";

const optionalNonNegativeNumber = z.preprocess(
  (value) => value === "" || value === null || value === undefined ? undefined : value,
  z.coerce.number().finite().min(0, "Value cannot be negative").optional(),
);

const schema = z.object({
  productId: z.string().trim().min(1, "Select a product"),
  branchId: z.string().trim().min(1, "Select a branch"),
  mode: z.enum(["set", "add", "remove"]),
  quantity: z.coerce.number().finite().min(0, "Quantity cannot be negative"),
  reorderLevel: optionalNonNegativeNumber,
  sellingPrice: optionalNonNegativeNumber,
  reason: z.string().trim().max(240).optional().default(""),
});

type AdjustmentResult = {
  inventoryId: string;
  productId: string;
  productName: string;
  branchId: string;
  branchName: string;
  previousQuantity: string;
  quantity: string;
  delta: string;
  reorderLevel: string;
  previousSellingPrice: string;
  sellingPrice: string;
  reason: string;
  mode: "set" | "add" | "remove";
};

function isKnownPrismaError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "inventory.adjust");

    const body = schema.parse(await req.json());
    if (body.sellingPrice !== undefined) requirePermission(ctx, "product.update");

    const tenantSetting = await db.tenantSetting.findUnique({
      where: { tenantId: ctx.tenantId },
      select: { metadata: true },
    });
    const inventorySettings = normalizeTenantSettings(tenantSetting?.metadata).inventory;
    const reason = body.reason.trim();

    if (inventorySettings.requireAdjustmentReason && reason.length < 3) {
      throw new AppError("ADJUSTMENT_REASON_REQUIRED", "Enter a reason for this stock change", 400);
    }

    const inputQuantity = new Prisma.Decimal(body.quantity);
    if (body.mode !== "set" && inputQuantity.lte(0)) {
      throw new AppError("INVALID_QUANTITY", "Enter a quantity greater than zero", 400);
    }

    const result = await db.$transaction(async (tx): Promise<AdjustmentResult> => {
      const [branch, product] = await Promise.all([
        tx.branch.findFirst({
          where: { id: body.branchId, tenantId: ctx.tenantId, status: "ACTIVE" },
          select: { id: true, name: true },
        }),
        tx.product.findFirst({
          where: { id: body.productId, tenantId: ctx.tenantId, status: "active" },
          select: { id: true, name: true, trackStock: true, sellingPrice: true },
        }),
      ]);

      if (!branch) throw new AppError("INVALID_BRANCH", "The selected branch is unavailable", 400);
      if (!product) throw new AppError("INVALID_PRODUCT", "The selected product is unavailable", 400);
      if (!product.trackStock) {
        throw new AppError("STOCK_NOT_TRACKED", `${product.name} is configured as a service or non-stock item`, 409);
      }

      const existing = await tx.branchInventory.findUnique({
        where: {
          tenantId_branchId_productId: {
            tenantId: ctx.tenantId,
            branchId: branch.id,
            productId: product.id,
          },
        },
      });

      const previousQuantity = existing?.quantity ?? new Prisma.Decimal(0);
      const reorderLevel = body.reorderLevel === undefined
        ? existing?.reorderLevel ?? new Prisma.Decimal(inventorySettings.defaultReorderLevel)
        : new Prisma.Decimal(body.reorderLevel);
      const previousSellingPrice = product.sellingPrice;
      const sellingPrice = body.sellingPrice === undefined
        ? previousSellingPrice
        : new Prisma.Decimal(body.sellingPrice);
      let nextQuantity: Prisma.Decimal;

      if (body.mode === "set") nextQuantity = inputQuantity;
      else if (body.mode === "add") nextQuantity = previousQuantity.plus(inputQuantity);
      else nextQuantity = previousQuantity.minus(inputQuantity);

      if (nextQuantity.lt(0) && !inventorySettings.allowNegativeStock) {
        throw new AppError(
          "INSUFFICIENT_STOCK",
          `Cannot remove ${inputQuantity.toString()}. Only ${previousQuantity.toString()} ${product.name} are available at ${branch.name}.`,
          409,
        );
      }

      if (!sellingPrice.equals(previousSellingPrice)) {
        await tx.product.update({
          where: { id: product.id },
          data: { sellingPrice },
        });
      }

      const delta = nextQuantity.minus(previousQuantity);
      const inventory = await tx.branchInventory.upsert({
        where: {
          tenantId_branchId_productId: {
            tenantId: ctx.tenantId,
            branchId: branch.id,
            productId: product.id,
          },
        },
        update: { quantity: nextQuantity, reorderLevel },
        create: {
          tenantId: ctx.tenantId,
          branchId: branch.id,
          productId: product.id,
          quantity: nextQuantity,
          reorderLevel,
        },
      });

      if (!delta.isZero()) {
        await tx.stockMovement.create({
          data: {
            tenantId: ctx.tenantId,
            branchId: branch.id,
            productId: product.id,
            type: `manual_${body.mode}`,
            quantity: delta,
            referenceType: "inventory_adjustment",
            referenceId: randomUUID(),
            actorUserId: ctx.userId,
          },
        });
      }

      return {
        inventoryId: inventory.id,
        productId: product.id,
        productName: product.name,
        branchId: branch.id,
        branchName: branch.name,
        previousQuantity: previousQuantity.toString(),
        quantity: nextQuantity.toString(),
        delta: delta.toString(),
        reorderLevel: reorderLevel.toString(),
        previousSellingPrice: previousSellingPrice.toString(),
        sellingPrice: sellingPrice.toString(),
        reason: reason || "Reason not required by business settings",
        mode: body.mode,
      };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });

    try {
      await appendAudit(db, ctx, {
        action: "inventory.adjusted",
        entityType: "branch_inventory",
        entityId: result.inventoryId,
        branchId: result.branchId,
        oldValues: {
          quantity: result.previousQuantity,
          sellingPrice: result.previousSellingPrice,
        },
        newValues: {
          quantity: result.quantity,
          delta: result.delta,
          reorderLevel: result.reorderLevel,
          sellingPrice: result.sellingPrice,
          productId: result.productId,
          mode: result.mode,
        },
        reason: result.reason,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
        deviceInfo: req.headers.get("user-agent") ?? undefined,
      });
    } catch (auditError) {
      console.error("Inventory adjusted but audit logging failed", { inventoryId: result.inventoryId, auditError });
    }

    return NextResponse.json({ ok: true, inventory: result }, { status: 200 });
  } catch (error) {
    if (isKnownPrismaError(error)) {
      if (error.code === "P2028") {
        return apiError(new AppError("DATABASE_TIMEOUT", "The database took too long to update stock. Please try again.", 503));
      }
      if (error.code === "P2034") {
        return apiError(new AppError("DATABASE_BUSY", "Stock changed at the same time from another device. Refresh and try again.", 409));
      }
    }
    return apiError(error);
  }
}
