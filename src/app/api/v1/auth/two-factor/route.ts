import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { apiError, tenantContext } from "@/server/http";
import { adminOtpEnabled, isDeliverableAdminEmail } from "@/server/security/admin-otp";
import { verifySecret } from "@/server/security/passwords";

const schema = z.object({
  enabled: z.boolean(),
  currentPassword: z.string().min(1, "Enter your current password"),
});

function otpDeliveryConfigured() {
  return adminOtpEnabled()
    && Boolean(process.env.RESEND_API_KEY?.trim())
    && Boolean(process.env.RESEND_FROM_EMAIL?.trim());
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    const body = schema.parse(await req.json());

    const user = await db.user.findFirst({
      where: {
        id: ctx.userId,
        tenantId: ctx.tenantId,
        status: "ACTIVE",
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        emailOtp2faEnabled: true,
        roles: {
          where: { role: { tenantId: ctx.tenantId } },
          select: { role: { select: { code: true } } },
        },
      },
    });

    if (!user) throw new AppError("USER_NOT_FOUND", "Your account could not be found", 404);
    if (!user.roles.some(({ role }) => role.code === "TENANT_ADMIN")) {
      throw new AppError("ADMIN_REQUIRED", "Only tenant administrators can manage this 2FA setting", 403);
    }

    const currentPasswordValid = await verifySecret(user.passwordHash, body.currentPassword);
    if (!currentPasswordValid) {
      throw new AppError("CURRENT_PASSWORD_INVALID", "Your current password is incorrect", 401);
    }

    if (body.enabled) {
      if (!otpDeliveryConfigured()) {
        throw new AppError(
          "TWO_FACTOR_UNAVAILABLE",
          "Email OTP is not available on this server right now. Contact the platform operator.",
          503,
        );
      }
      if (!isDeliverableAdminEmail(user.email)) {
        throw new AppError(
          "TWO_FACTOR_EMAIL_REQUIRED",
          "Add a real email address to this administrator account before enabling email OTP 2FA.",
          409,
        );
      }
    }

    if (user.emailOtp2faEnabled === body.enabled) {
      return NextResponse.json({
        ok: true,
        enabled: user.emailOtp2faEnabled,
        message: user.emailOtp2faEnabled
          ? "Two-factor authentication is already enabled."
          : "Two-factor authentication is already disabled.",
      });
    }

    const changedAt = new Date();
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { emailOtp2faEnabled: body.enabled },
      });

      await appendAudit(tx, ctx, {
        action: body.enabled ? "account.2fa.enabled" : "account.2fa.disabled",
        entityType: "User",
        entityId: user.id,
        oldValues: { emailOtp2faEnabled: user.emailOtp2faEnabled },
        newValues: {
          emailOtp2faEnabled: body.enabled,
          method: "EMAIL_OTP",
          changedAt: changedAt.toISOString(),
        },
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined,
        deviceInfo: req.headers.get("user-agent") || undefined,
      });
    });

    const response = NextResponse.json({
      ok: true,
      enabled: body.enabled,
      message: body.enabled
        ? "Two-factor authentication enabled. Your next admin login will require a password and email OTP."
        : "Two-factor authentication disabled. Your next admin login will use your password only.",
    });
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  } catch (error) {
    return apiError(error);
  }
}
