import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { apiError, tenantContext } from "@/server/http";
import { requirePermission } from "@/server/security/context";

const schema = z.object({
  branchId: z.string().min(1),
  openingCash: z.coerce.number().min(0).max(100_000_000),
});

const closeSchema = z.object({
  shiftId: z.string().min(1),
  closingCash: z.coerce.number().min(0).max(100_000_000),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "shift.open");
    const input = schema.parse(await req.json());
    const scope = await resolveTenantAccessScope(db, ctx);

    if (!scope.branchIds.includes(input.branchId)) {
      throw new AppError("BRANCH_FORBIDDEN", "This account is not assigned to the selected branch", 403);
    }

    const shift = await db.$transaction(async (tx) => {
      const [branch, existing] = await Promise.all([
        tx.branch.findFirst({
          where: { id: input.branchId, tenantId: ctx.tenantId, status: "ACTIVE" },
        }),
        tx.shift.findFirst({
          where: { tenantId: ctx.tenantId, userId: ctx.userId, status: "OPEN" },
        }),
      ]);

      if (!branch) throw new AppError("INVALID_BRANCH", "The assigned branch is unavailable", 400);
      if (existing) throw new AppError("SHIFT_ALREADY_OPEN", "You already have an open shift", 409);

      const created = await tx.shift.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: branch.id,
          userId: ctx.userId,
          openingCash: input.openingCash,
        },
      });

      await appendAudit(tx, ctx, {
        action: "shift.opened",
        entityType: "shift",
        entityId: created.id,
        branchId: branch.id,
        newValues: { openingCash: input.openingCash },
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
        deviceInfo: req.headers.get("user-agent") ?? undefined,
      });

      return created;
    }, { isolationLevel: "Serializable" });

    return NextResponse.json(
      { ok: true, shift: { id: shift.id, openedAt: shift.openedAt } },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "shift.close");
    const input = closeSchema.parse(await req.json());

    const result = await db.$transaction(async (tx) => {
      const shift = await tx.shift.findFirst({
        where: { id: input.shiftId, tenantId: ctx.tenantId, userId: ctx.userId, status: "OPEN" },
        include: { branch: { select: { id: true, name: true } } },
      });
      if (!shift) throw new AppError("SHIFT_NOT_FOUND", "The open shift could not be found or is already closed", 404);

      const cash = await tx.payment.aggregate({
        where: { tenantId: ctx.tenantId, method: "Cash", status: "COMPLETED", sale: { tenantId: ctx.tenantId, shiftId: shift.id } },
        _sum: { amount: true },
      });
      const expectedCash = Number(shift.openingCash) + Number(cash._sum.amount ?? 0);
      const variance = input.closingCash - expectedCash;
      const closedAt = new Date();

      await tx.shift.update({
        where: { id: shift.id },
        data: { status: "CLOSED", closingCash: input.closingCash, closedAt },
      });
      await appendAudit(tx, ctx, {
        action: "shift.closed",
        entityType: "shift",
        entityId: shift.id,
        branchId: shift.branchId,
        oldValues: { status: "OPEN", openingCash: shift.openingCash.toString() },
        newValues: { status: "CLOSED", closingCash: input.closingCash, expectedCash, variance, closedAt: closedAt.toISOString() },
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
        deviceInfo: req.headers.get("user-agent") ?? undefined,
      });

      return { id: shift.id, branch: shift.branch.name, closingCash: input.closingCash, expectedCash, variance, closedAt };
    }, { isolationLevel: "Serializable" });

    return NextResponse.json({ ok: true, shift: result });
  } catch (error) { return apiError(error); }
}
