import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { apiError, tenantContext } from "@/server/http";
import { requirePermission } from "@/server/security/context";

const schema = z.object({ status: z.enum(["PAID", "PENDING", "VOIDED"]) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "expense.manage");
    const scope = await resolveTenantAccessScope(db, ctx);
    const { id } = await params;
    const body = schema.parse(await req.json());
    const existing = await db.expense.findFirst({ where: { id, tenantId: ctx.tenantId, branchId: { in: scope.branchIds } } });
    if (!existing) throw new AppError("NOT_FOUND", "Expense record was not found", 404);
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.expense.update({ where: { id }, data: { status: body.status } });
      await appendAudit(tx, ctx, {
        action: body.status === "VOIDED" ? "expense.voided" : "expense.status_changed", entityType: "expense", entityId: id, branchId: existing.branchId,
        oldValues: { status: existing.status }, newValues: { status: body.status },
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(), deviceInfo: req.headers.get("user-agent") ?? undefined,
      });
      return row;
    });
    return NextResponse.json({ ok: true, expense: { ...updated, amount: updated.amount.toString() } });
  } catch (error) { return apiError(error); }
}
