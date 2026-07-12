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
  name: z.string().trim().min(2, "Enter a product name").max(160),
  sku: z
    .string()
    .trim()
    .min(2, "Enter a SKU")
    .max(60)
    .regex(/^[A-Za-z0-9._-]+$/, "SKU may only contain letters, numbers, dots, underscores, or hyphens")
    .transform((value) => value.toUpperCase()),
  barcode: z.union([z.string().trim().max(100), z.literal("")]).optional(),
  categoryId: z.union([z.string().trim().min(1), z.literal("")]).optional(),
  branchId: z.string().trim().min(1, "Select a branch"),
  costPrice: z.coerce.number().finite().min(0, "Cost price cannot be negative"),
  sellingPrice: z.coerce.number().finite().min(0, "Selling price cannot be negative"),
  taxPercent: z.coerce.number().finite().min(0).max(100),
  trackStock: z.boolean(),
  initialStock: z.coerce.number().finite().min(0, "Opening stock cannot be negative"),
  reorderLevel: z.coerce.number().finite().min(0, "Reorder level cannot be negative"),
});

type ProductResult = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  branchId: string;
  branchName: string;
  initialStock: string;
};

function isKnownPrismaError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "product.create");

    const body = schema.parse(await req.json());
    const barcode = body.barcode?.trim() || null;
    const categoryId = body.categoryId?.trim() || null;
    const initialStock = new Prisma.Decimal(body.trackStock ? body.initialStock : 0);
    const reorderLevel = new Prisma.Decimal(body.trackStock ? body.reorderLevel : 0);

    const result = await db.$transaction(async (tx): Promise<ProductResult> => {
      const tenant = await tx.tenant.findUnique({
        where: { id: ctx.tenantId },
        include: { subscription: { include: { plan: true } } },
      });
      if (!tenant) throw new AppError("NOT_FOUND", "Business account was not found", 404);
      if (!tenant.subscription?.plan) {
        throw new AppError("SUBSCRIPTION_REQUIRED", "An active subscription plan is required before adding products", 409);
      }

      const productCount = await tx.product.count({ where: { tenantId: ctx.tenantId } });
      if (productCount >= tenant.subscription.plan.maxProducts) {
        throw new AppError(
          "PLAN_LIMIT_REACHED",
          `Your current plan allows ${tenant.subscription.plan.maxProducts} products. Upgrade the plan before adding another product.`,
          409,
        );
      }

      const branch = await tx.branch.findFirst({
        where: { id: body.branchId, tenantId: ctx.tenantId, status: "ACTIVE" },
        select: { id: true, name: true },
      });
      if (!branch) throw new AppError("INVALID_BRANCH", "The selected branch is unavailable", 400);

      if (categoryId) {
        const category = await tx.category.findFirst({ where: { id: categoryId, tenantId: ctx.tenantId }, select: { id: true } });
        if (!category) throw new AppError("INVALID_CATEGORY", "The selected category is unavailable", 400);
      }

      const product = await tx.product.create({
        data: {
          tenantId: ctx.tenantId,
          categoryId,
          sku: body.sku,
          barcode,
          name: body.name,
          costPrice: new Prisma.Decimal(body.costPrice),
          sellingPrice: new Prisma.Decimal(body.sellingPrice),
          taxRate: new Prisma.Decimal(body.taxPercent).div(100),
          trackStock: body.trackStock,
          status: "active",
        },
      });

      await tx.branchInventory.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: branch.id,
          productId: product.id,
          quantity: initialStock,
          reorderLevel,
        },
      });

      if (body.trackStock && initialStock.gt(0)) {
        await tx.stockMovement.create({
          data: {
            tenantId: ctx.tenantId,
            branchId: branch.id,
            productId: product.id,
            type: "opening_stock",
            quantity: initialStock,
            referenceType: "product_creation",
            referenceId: randomUUID(),
            actorUserId: ctx.userId,
          },
        });
      }

      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        branchId: branch.id,
        branchName: branch.name,
        initialStock: initialStock.toString(),
      };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });

    try {
      await appendAudit(db, ctx, {
        action: "product.created",
        entityType: "product",
        entityId: result.id,
        branchId: result.branchId,
        newValues: {
          name: result.name,
          sku: result.sku,
          barcode: result.barcode,
          branchId: result.branchId,
          initialStock: result.initialStock,
        },
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
        deviceInfo: req.headers.get("user-agent") ?? undefined,
      });
    } catch (auditError) {
      console.error("Product created but audit logging failed", { productId: result.id, auditError });
    }

    return NextResponse.json({ ok: true, product: result }, { status: 201 });
  } catch (error) {
    if (isKnownPrismaError(error)) {
      if (error.code === "P2002") {
        return apiError(new AppError("DUPLICATE_PRODUCT", "That SKU or barcode is already in use", 409));
      }
      if (error.code === "P2028") {
        return apiError(new AppError("DATABASE_TIMEOUT", "The database took too long to create the product. Please try again.", 503));
      }
      if (error.code === "P2034") {
        return apiError(new AppError("DATABASE_BUSY", "Another inventory update happened at the same time. Please try again.", 409));
      }
    }
    return apiError(error);
  }
}
