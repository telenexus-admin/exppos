import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError } from "@/server/http";
import { requireOperator } from "@/server/operator-auth";
import { hashSecret } from "@/server/security/passwords";
import { appendAudit } from "@/server/audit/audit";
import { AppError } from "@/lib/errors";

const schema = z.object({
  temporaryPassword: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/\d/, "Password must contain a number")
    .regex(/[^A-Za-z0-9]/, "Password must contain a special character"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireOperator(req);
    const { id } = await params;
    const body = schema.parse(await req.json());

    const tenant = await db.tenant.findFirst({
      where: { id, status: { not: "CANCELLED" } },
      select: { id: true, code: true, slug: true, name: true, email: true },
    });

    if (!tenant) {
      throw new AppError("NOT_FOUND", "POS client was not found", 404);
    }

    const admin = await db.user.findFirst({
      where: {
        tenantId: tenant.id,
        roles: {
          some: {
            role: { tenantId: tenant.id, code: "TENANT_ADMIN" },
          },
        },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        staffNumber: true,
        status: true,
      },
      orderBy: { createdAt: "asc" },
    });

    if (!admin) {
      throw new AppError(
        "ADMIN_NOT_FOUND",
        "This client does not have a tenant administrator account",
        404,
      );
    }

    const passwordHash = await hashSecret(body.temporaryPassword);
    const changedAt = new Date();

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: admin.id },
        data: {
          passwordHash,
          status: "ACTIVE",
          forcePasswordChange: true,
        },
      });

      await tx.userSession.updateMany({
        where: { userId: admin.id, revokedAt: null },
        data: { revokedAt: changedAt },
      });

      await appendAudit(tx, ctx, {
        action: "tenant_admin.password_reset",
        entityType: "user",
        entityId: admin.id,
        oldValues: { status: admin.status },
        newValues: {
          status: "ACTIVE",
          forcePasswordChange: true,
          sessionsRevoked: true,
        },
        reason: "Temporary password reset by platform operator",
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
        deviceInfo: req.headers.get("user-agent") ?? undefined,
      });
    });

    return NextResponse.json({
      ok: true,
      login: {
        businessCode: tenant.code,
        businessSlug: tenant.slug,
        businessEmail: tenant.email,
        adminName: admin.fullName,
        adminEmail: admin.email,
        adminUsername: admin.staffNumber,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
