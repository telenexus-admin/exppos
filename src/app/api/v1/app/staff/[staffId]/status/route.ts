import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { apiError, tenantContext } from "@/server/http";
import { requirePermission } from "@/server/security/context";

const schema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ staffId: string }> },
) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "staff.update");
    const { staffId } = await params;
    const body = schema.parse(await req.json());

    const target = await db.user.findFirst({
      where: { id: staffId, tenantId: ctx.tenantId },
      include: {
        roles: {
          where: { role: { tenantId: ctx.tenantId } },
          include: { role: true },
        },
      },
    });

    if (!target) throw new AppError("NOT_FOUND", "Staff account was not found", 404);
    if (target.id === ctx.userId) {
      throw new AppError("SELF_STATUS_CHANGE", "You cannot deactivate your own account", 409);
    }
    if (target.roles.some(({ role }) => role.code === "TENANT_ADMIN")) {
      throw new AppError("ADMIN_PROTECTED", "Tenant administrator accounts must be managed through the operator panel", 403);
    }

    if (body.status === "SUSPENDED") {
      const openShift = await db.shift.findFirst({
        where: { tenantId: ctx.tenantId, userId: target.id, status: "OPEN" },
        select: { id: true },
      });
      if (openShift) {
        throw new AppError(
          "OPEN_SHIFT",
          "Close this staff member's open shift before deactivating the account",
          409,
        );
      }
    }

    const previousStatus = target.status;
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: { status: body.status },
      });

      if (body.status === "SUSPENDED") {
        await tx.userSession.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await appendAudit(tx, ctx, {
        action: body.status === "SUSPENDED" ? "staff.deactivated" : "staff.reactivated",
        entityType: "user",
        entityId: target.id,
        oldValues: { status: previousStatus },
        newValues: { status: body.status, username: target.staffNumber, fullName: target.fullName },
        reason: body.status === "SUSPENDED" ? "Staff access deactivated by tenant administrator" : "Staff access restored by tenant administrator",
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
        deviceInfo: req.headers.get("user-agent") ?? undefined,
      });
    }, { maxWait: 10_000, timeout: 20_000 });

    return NextResponse.json({
      ok: true,
      staff: { id: target.id, fullName: target.fullName, status: body.status },
    });
  } catch (error) {
    return apiError(error);
  }
}
