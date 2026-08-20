import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isDashboardManagerRoleCode } from "@/lib/dashboard-access";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError } from "@/server/http";
import { createTenantLoginSession, setTenantLoginCookies } from "@/server/auth/tenant-login-session";
import {
  ADMIN_OTP_MAX_ATTEMPTS,
  adminOtpCodeMatches,
  adminOtpEnabled,
  consumeAdminOtpChallenge,
  getAdminOtpChallenge,
  recordAdminOtpFailure,
} from "@/server/security/admin-otp";
import type { Permission } from "@/server/security/context";
import { normalizeTenantSettings } from "@/server/settings/tenant-settings";

const schema = z.object({
  challengeId: z.string().uuid("Invalid verification request"),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit verification code"),
});
const activeTenantStatuses = ["TRIAL", "ACTIVE", "GRACE_PERIOD"] as const;

export async function POST(req: NextRequest) {
  try {
    if (!adminOtpEnabled()) throw new AppError("OTP_DISABLED", "Administrator OTP verification is not enabled.", 409);
    const body = schema.parse(await req.json());
    const challenge = await getAdminOtpChallenge(body.challengeId);
    const now = new Date();

    if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) {
      throw new AppError("OTP_EXPIRED", "This verification code has expired. Sign in again to get a new code.", 410);
    }
    if (challenge.attemptCount >= ADMIN_OTP_MAX_ATTEMPTS) {
      throw new AppError("OTP_ATTEMPTS_EXCEEDED", "Too many incorrect codes. Sign in again to start a new verification.", 429);
    }

    const user = await db.user.findFirst({
      where: {
        id: challenge.userId,
        tenantId: challenge.tenantId,
        status: "ACTIVE",
        tenant: { status: { in: [...activeTenantStatuses] } },
      },
      include: {
        tenant: { include: { settings: true } },
        branches: true,
        roles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
      },
    });
    if (!user) throw new AppError("ACCOUNT_UNAVAILABLE", "This administrator account is no longer available.", 403);

    const tenantRoles = user.roles.filter((userRole) => userRole.role.tenantId === user.tenantId);
    const roleCodes = tenantRoles.map((userRole) => userRole.role.code);
    const usesAdminDashboard = roleCodes.includes("TENANT_ADMIN") || roleCodes.some(isDashboardManagerRoleCode);
    if (!usesAdminDashboard) throw new AppError("WRONG_LOGIN_PORTAL", "This account no longer has administrator dashboard access.", 403);

    if (!adminOtpCodeMatches(challenge.id, body.code, challenge.codeHash)) {
      const failed = await recordAdminOtpFailure(challenge.id);
      const attempts = failed?.attemptCount ?? challenge.attemptCount + 1;
      const remaining = Math.max(0, ADMIN_OTP_MAX_ATTEMPTS - attempts);
      if (remaining === 0) {
        throw new AppError("OTP_ATTEMPTS_EXCEEDED", "Too many incorrect codes. Sign in again to start a new verification.", 429);
      }
      throw new AppError("INVALID_OTP", `Incorrect verification code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`, 401);
    }

    const consumed = await consumeAdminOtpChallenge(challenge.id, challenge.codeHash);
    if (consumed !== 1) throw new AppError("OTP_ALREADY_USED", "This verification code has already been used or expired. Sign in again.", 409);

    const permissions = new Set(
      tenantRoles.flatMap((userRole) => userRole.role.rolePermissions.map((rolePermission) => rolePermission.permission.code as Permission)),
    );
    const security = normalizeTenantSettings(user.tenant.settings?.metadata).securityNotifications;
    const session = await createTenantLoginSession({
      req,
      user,
      permissions,
      sessionTimeoutMinutes: security.sessionTimeoutMinutes,
    });

    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    await db.loginAttempt.create({
      data: {
        tenantSlug: user.tenantId,
        identifierHash: challenge.identifierHash,
        ipAddress,
        succeeded: true,
      },
    }).catch((error) => console.error("OTP login success logging failed", { userId: user.id, error }));

    const response = NextResponse.json({
      ok: true,
      destination: "/app/dashboard",
      forcePasswordChange: user.forcePasswordChange,
      user: { id: user.id, name: user.fullName, tenant: user.tenant.name, roles: roleCodes },
    });
    setTenantLoginCookies(response, req, session, security.sessionTimeoutMinutes);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
