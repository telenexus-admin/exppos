import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { apiError, tenantContext } from "@/server/http";
import { requirePermission } from "@/server/security/context";

const schema = z.object({
  productId: z.string().trim().min(1, "Select a product"),
  branchId: z.string().trim().min(1, "Select a branch"),
  mode: z.enum(["set", "add", "remove"]),
  quantity: z.coerce.number().finite().min(0, "Quantity cannot be negative"),
  reorderLevel: z.coerce.number().finite().min(0, "Reorder level cannot be negative"),
  reason: z.string().trim().min(3, "Enter a reason for this stock change").max(240),
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
    const inputQuantity = new Prisma.Decimal(body.quantity);
    const reorderLevel = new Prisma.Decimal(body.reorderLevel);

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
          select: { id: true, name: true, trackStock: true },
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
      let nextQuantity: Prisma.Decimal;

      if (body.mode === "set") nextQuantity = inputQuantity;
      else if (body.mode === "add") nextQuantity = previousQuantity.plus(inputQuantity);
      else nextQuantity = previousQuantity.minus(inputQuantity);

      if (nextQuantity.lt(0)) {
        throw new AppError(
          "INSUFFICIENT_STOCK",
          `Cannot remove ${inputQuantity.toString()}. Only ${previousQuantity.toString()} ${product.name} are available at ${branch.name}.`,
          409,
        );
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
        reason: body.reason,
        mode: body.mode,
      };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });

    try {
      await appendAudit(db, ctx, {
        action: "inventory.adjusted",
        entityType: "branch_inventory",
        entityId: result.inventoryId,
        branchId: result.branchId,
        oldValues: { quantity: result.previousQuantity },
        newValues: {
          quantity: result.quantity,
          delta: result.delta,
          reorderLevel: result.reorderLevel,
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
