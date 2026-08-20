import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isDashboardManagerRoleCode } from "@/lib/dashboard-access";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError } from "@/server/http";
import { sendAdminLoginOtpEmail } from "@/server/notifications/admin-login-otp-email";
import {
  ADMIN_OTP_TTL_MS,
  adminOtpEnabled,
  getAdminOtpChallenge,
  isDeliverableAdminEmail,
  maskEmail,
  prepareAdminOtpResend,
  rollbackAdminOtpResend,
} from "@/server/security/admin-otp";

const schema = z.object({
  challengeId: z.string().uuid("Invalid verification request"),
});
const activeTenantStatuses = ["TRIAL", "ACTIVE", "GRACE_PERIOD"] as const;

export async function POST(req: NextRequest) {
  try {
    if (!adminOtpEnabled()) throw new AppError("OTP_DISABLED", "Administrator OTP verification is not enabled.", 409);
    const body = schema.parse(await req.json());
    const challenge = await getAdminOtpChallenge(body.challengeId);
    const now = new Date();
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) {
      throw new AppError("OTP_EXPIRED", "This verification request has expired. Sign in again to get a new code.", 410);
    }

    const user = await db.user.findFirst({
      where: {
        id: challenge.userId,
        tenantId: challenge.tenantId,
        status: "ACTIVE",
        tenant: { status: { in: [...activeTenantStatuses] } },
      },
      include: {
        tenant: true,
        roles: { include: { role: true } },
      },
    });
    if (!user) throw new AppError("ACCOUNT_UNAVAILABLE", "This administrator account is no longer available.", 403);

    const roleCodes = user.roles
      .filter((userRole) => userRole.role.tenantId === user.tenantId)
      .map((userRole) => userRole.role.code);
    const usesAdminDashboard = roleCodes.includes("TENANT_ADMIN") || roleCodes.some(isDashboardManagerRoleCode);
    if (!usesAdminDashboard) throw new AppError("WRONG_LOGIN_PORTAL", "This account no longer has administrator dashboard access.", 403);

    const verificationEmail = user.tenant.email;
    if (!isDeliverableAdminEmail(verificationEmail)) {
      throw new AppError("ADMIN_OTP_EMAIL_REQUIRED", "Add a real business email under Business Profile before using OTP verification.", 409);
    }

    const resend = await prepareAdminOtpResend(challenge.id);
    try {
      await sendAdminLoginOtpEmail({
        to: verificationEmail,
        code: resend.code,
        fullName: user.fullName,
        tenantName: user.tenant.name,
        expiresMinutes: Math.max(1, Math.ceil((resend.challenge.expiresAt.getTime() - Date.now()) / 60_000)),
      });
    } catch (error) {
      await rollbackAdminOtpResend(challenge.id, resend.newCodeHash, resend.previous);
      throw error;
    }

    const response = NextResponse.json({
      ok: true,
      maskedEmail: maskEmail(verificationEmail),
      expiresInSeconds: Math.max(0, Math.ceil((resend.challenge.expiresAt.getTime() - Date.now()) / 1000)),
      verificationWindowSeconds: Math.round(ADMIN_OTP_TTL_MS / 1000),
    });
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  } catch (error) {
    return apiError(error);
  }
}
