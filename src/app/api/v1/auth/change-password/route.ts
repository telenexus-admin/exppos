import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { apiError, tenantContext } from "@/server/http";
import { assertStrongPassword, hashSecret, verifySecret } from "@/server/security/passwords";

const schema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: z.string().min(12, "New password must be at least 12 characters"),
  confirmPassword: z.string().min(1, "Confirm your new password"),
}).superRefine((value, ctx) => {
  if (value.newPassword !== value.confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmPassword"],
      message: "The new password and confirmation do not match",
    });
  }
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    const body = schema.parse(await req.json());

    try {
      assertStrongPassword(body.newPassword);
    } catch (error) {
      throw new AppError(
        "WEAK_PASSWORD",
        error instanceof Error ? error.message : "Choose a stronger password",
        400,
      );
    }

    const user = await db.user.findFirst({
      where: {
        id: ctx.userId,
        tenantId: ctx.tenantId,
        status: "ACTIVE",
      },
      select: {
        id: true,
        passwordHash: true,
      },
    });

    if (!user) throw new AppError("USER_NOT_FOUND", "Your account could not be found", 404);

    const currentPasswordValid = await verifySecret(user.passwordHash, body.currentPassword);
    if (!currentPasswordValid) {
      throw new AppError("CURRENT_PASSWORD_INVALID", "Your current password is incorrect", 401);
    }

    const reusesCurrentPassword = await verifySecret(user.passwordHash, body.newPassword);
    if (reusesCurrentPassword) {
      throw new AppError("PASSWORD_UNCHANGED", "Your new password must be different from your current password", 400);
    }

    const passwordHash = await hashSecret(body.newPassword);
    const changedAt = new Date();

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          forcePasswordChange: false,
        },
      });

      await tx.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: changedAt },
      });

      await appendAudit(tx, ctx, {
        action: "account.password.changed",
        entityType: "User",
        entityId: user.id,
        newValues: { passwordChangedAt: changedAt.toISOString(), sessionsRevoked: true },
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined,
        deviceInfo: req.headers.get("user-agent") || undefined,
      });
    });

    const response = NextResponse.json({
      ok: true,
      message: "Password changed successfully. Sign in again with your new password.",
      reauthenticate: true,
    });

    response.headers.set("Cache-Control", "no-store, private");
    response.cookies.set("tenant_session", "", { httpOnly: true, expires: new Date(0), path: "/" });
    response.cookies.set("tenant_refresh", "", { httpOnly: true, expires: new Date(0), path: "/" });
    response.cookies.set("tenant_refresh", "", { httpOnly: true, expires: new Date(0), path: "/api/v1/auth" });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
