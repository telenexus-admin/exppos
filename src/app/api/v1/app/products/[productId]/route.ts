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
  costPrice: z.coerce.number().finite().min(0, "Cost price cannot be negative"),
  sellingPrice: z.coerce.number().finite().min(0, "Selling price cannot be negative"),
  taxPercent: z.coerce.number().finite().min(0).max(100),
  trackStock: z.boolean(),
  status: z.enum(["active", "inactive"]),
});

type ProductSnapshot = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryId: string | null;
  costPrice: string;
  sellingPrice: string;
  taxRate: string;
  trackStock: boolean;
  status: string;
};

function isKnownPrismaError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "product.update");

    const { productId } = await params;
    const body = schema.parse(await req.json());
    const barcode = body.barcode?.trim() || null;
    const categoryId = body.categoryId?.trim() || null;

    const result = await db.$transaction(async (tx) => {
      const existing = await tx.product.findFirst({
        where: { id: productId, tenantId: ctx.tenantId },
      });

      if (!existing) {
        throw new AppError("PRODUCT_NOT_FOUND", "The product could not be found", 404);
      }

      if (categoryId) {
        const category = await tx.category.findFirst({
          where: { id: categoryId, tenantId: ctx.tenantId },
          select: { id: true },
        });
        if (!category) {
          throw new AppError("INVALID_CATEGORY", "The selected category is unavailable", 400);
        }
      }

      const oldValues: ProductSnapshot = {
        id: existing.id,
        name: existing.name,
        sku: existing.sku,
        barcode: existing.barcode,
        categoryId: existing.categoryId,
        costPrice: existing.costPrice.toString(),
        sellingPrice: existing.sellingPrice.toString(),
        taxRate: existing.taxRate.toString(),
        trackStock: existing.trackStock,
        status: existing.status,
      };

      const product = await tx.product.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          sku: body.sku,
          barcode,
          categoryId,
          costPrice: new Prisma.Decimal(body.costPrice),
          sellingPrice: new Prisma.Decimal(body.sellingPrice),
          taxRate: new Prisma.Decimal(body.taxPercent).div(100),
          trackStock: body.trackStock,
          status: body.status,
        },
      });

      const newValues: ProductSnapshot = {
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        categoryId: product.categoryId,
        costPrice: product.costPrice.toString(),
        sellingPrice: product.sellingPrice.toString(),
        taxRate: product.taxRate.toString(),
        trackStock: product.trackStock,
        status: product.status,
      };

      return { product, oldValues, newValues };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });

    try {
      await appendAudit(db, ctx, {
        action: "product.updated",
        entityType: "product",
        entityId: result.product.id,
        oldValues: result.oldValues,
        newValues: result.newValues,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
        deviceInfo: req.headers.get("user-agent") ?? undefined,
      });
    } catch (auditError) {
      console.error("Product updated but audit logging failed", {
        productId: result.product.id,
        auditError,
      });
    }

    return NextResponse.json({
      ok: true,
      product: {
        id: result.product.id,
        name: result.product.name,
        sku: result.product.sku,
        barcode: result.product.barcode,
        categoryId: result.product.categoryId,
        costPrice: result.product.costPrice.toString(),
        sellingPrice: result.product.sellingPrice.toString(),
        taxPercent: result.product.taxRate.mul(100).toString(),
        trackStock: result.product.trackStock,
        status: result.product.status,
      },
    });
  } catch (error) {
    if (isKnownPrismaError(error)) {
      if (error.code === "P2002") {
        return apiError(new AppError("DUPLICATE_PRODUCT", "That SKU or barcode is already in use", 409));
      }
      if (error.code === "P2028") {
        return apiError(new AppError("DATABASE_TIMEOUT", "The database took too long to update the product. Please try again.", 503));
      }
      if (error.code === "P2034") {
        return apiError(new AppError("DATABASE_BUSY", "The product changed from another device. Refresh and try again.", 409));
      }
    }

    return apiError(error);
  }
}
