import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { apiError, tenantContext } from "@/server/http";
import { requireBranch, requirePermission } from "@/server/security/context";

const schema = z.object({
  branchId: z.string().min(1),
  openingCash: z.coerce.number().min(0).max(100_000_000),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "shift.open");
    const input = schema.parse(await req.json());
    requireBranch(ctx, input.branchId);

    const shift = await db.$transaction(async (tx) => {
      const [branch, existing] = await Promise.all([
        tx.branch.findFirst({ where: { id: input.branchId, tenantId: ctx.tenantId, status: "ACTIVE" } }),
        tx.shift.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId, status: "OPEN" } }),
      ]);

      if (!branch) throw new AppError("INVALID_BRANCH", "The assigned branch is unavailable", 400);
      if (existing) throw new AppError("SHIFT_ALREADY_OPEN", "You already have an open shift", 409);

      const created = await tx.shift.create({
        data: { tenantId: ctx.tenantId, branchId: branch.id, userId: ctx.userId, openingCash: input.openingCash },
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

    return NextResponse.json({ ok: true, shift: { id: shift.id, openedAt: shift.openedAt } }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
