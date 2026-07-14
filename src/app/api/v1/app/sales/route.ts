import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { apiError, tenantContext } from "@/server/http";
import { completeSale } from "@/server/services/pos";
import { requirePermission } from "@/server/security/context";

const schema = z.object({
  branchId: z.string(),
  shiftId: z.string(),
  customerId: z.string().optional(),
  allowOutOfStock: z.boolean().optional().default(false),
  idempotencyKey: z.string().min(8).max(100),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.string(),
    unitPrice: z.string().optional(),
    discount: z.string().optional(),
  })).min(1),
  payments: z.array(z.object({
    method: z.enum(["Cash", "Mobile Money", "Card", "Bank", "Credit"]),
    amount: z.string(),
    externalReference: z.string().optional(),
  })).min(1),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    const sale = await completeSale(db, ctx, schema.parse(await req.json()));
    return NextResponse.json(sale, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "sale.view");
    const scope = await resolveTenantAccessScope(db, ctx);

    const rows = await db.sale.findMany({
      where: {
        tenantId: ctx.tenantId,
        branchId: { in: scope.branchIds },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        branch: { select: { id: true, code: true, name: true, tenantId: true } },
        cashier: { select: { id: true, fullName: true, staffNumber: true, tenantId: true } },
        customer: { select: { id: true, fullName: true, tenantId: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, tenantId: true } },
          },
        },
        payments: { where: { tenantId: ctx.tenantId } },
      },
    });

    return NextResponse.json({ data: rows });
  } catch (error) {
    return apiError(error);
  }
}
