import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { isDashboardManagerRoleCode } from "@/lib/dashboard-access";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError } from "@/server/http";
import { createTenantLoginSession, setTenantLoginCookies } from "@/server/auth/tenant-login-session";
import { sendAdminLoginOtpEmail } from "@/server/notifications/admin-login-otp-email";
import { assertAdminOtpSendAllowed, invalidateAdminOtpChallenge } from "@/server/security/admin-otp-rate-limit";
import { verifySecret } from "@/server/security/passwords";
import {
  ADMIN_OTP_TTL_MS,
  adminOtpEnabled,
  createAdminOtpChallenge,
  isDeliverableAdminEmail,
  maskEmail,
} from "@/server/security/admin-otp";
import { normalizeTenantSettings } from "@/server/settings/tenant-settings";
import type { Permission } from "@/server/security/context";

const schema = z.object({
  identifier: z.string().trim().min(3, "Enter your username, email address, or phone number"),
  password: z.string().min(1, "Enter your password"),
  portal: z.enum(["admin", "staff"]).default("admin"),
});
const activeTenantStatuses = ["TRIAL", "ACTIVE", "GRACE_PERIOD"] as const;
const userInclude = {
  tenant: { include: { settings: true } },
  branches: true,
  roles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
} satisfies Prisma.UserInclude;

type LoginCandidate = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function phoneCandidates(value: string) {
  const raw = value.trim();
  const compact = raw.replace(/[\s()-]/g, "");
  const candidates = new Set<string>([raw, compact]);
  if (/^\+254\d{9}$/.test(compact)) {
    candidates.add(compact.slice(1));
    candidates.add(`0${compact.slice(4)}`);
  } else if (/^254\d{9}$/.test(compact)) {
    candidates.add(`+${compact}`);
    candidates.add(`0${compact.slice(3)}`);
  } else if (/^0\d{9}$/.test(compact)) {
    candidates.add(`254${compact.slice(1)}`);
    candidates.add(`+254${compact.slice(1)}`);
  }
  return [...candidates].filter(Boolean);
}

function normalizedAttemptIdentifier(value: string) {
  const compact = value.trim().replace(/[\s()-]/g, "").toLowerCase();
  if (/^\+254\d{9}$/.test(compact)) return compact.slice(1);
  if (/^0\d{9}$/.test(compact)) return `254${compact.slice(1)}`;
  return compact;
}

function loginAttemptHash(identifier: string) {
  return createHash("sha256").update(`tenant-login:${normalizedAttemptIdentifier(identifier)}`).digest("hex");
}

async function recordLoginAttempt({ tenantKey, identifierHash, ipAddress, succeeded }: {
  tenantKey: string;
  identifierHash: string;
  ipAddress?: string;
  succeeded: boolean;
}) {
  try {
    await db.loginAttempt.create({ data: { tenantSlug: tenantKey, identifierHash, ipAddress, succeeded } });
  } catch (error) {
    console.error("Login attempt logging failed", { tenantKey, succeeded, error });
  }
}

function mergeCandidates(...groups: LoginCandidate[][]) {
  const unique = new Map<string, LoginCandidate>();
  for (const candidate of groups.flat()) unique.set(candidate.id, candidate);
  return [...unique.values()].sort((left, right) => {
    const leftLogin = left.lastLoginAt?.getTime() ?? 0;
    const rightLogin = right.lastLoginAt?.getTime() ?? 0;
    if (leftLogin !== rightLogin) return rightLogin - leftLogin;
    return right.createdAt.getTime() - left.createdAt.getTime();
  });
}

async function matchingPasswordCandidates(candidates: LoginCandidate[], password: string) {
  const matches: LoginCandidate[] = [];
  for (const candidate of candidates) {
    try {
      if (await verifySecret(candidate.passwordHash, password)) matches.push(candidate);
    } catch (error) {
      console.error("Password verification failed", { userId: candidate.id, error });
    }
  }
  return matches;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.AUTH_SECRET) throw new AppError("AUTH_NOT_CONFIGURED", "Login is temporarily unavailable. Contact support.", 503);

    const body = schema.parse(await req.json());
    const rawIdentifier = body.identifier.trim();
    const normalizedIdentifier = rawIdentifier.toLowerCase();
    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const identifierHash = loginAttemptHash(rawIdentifier);

    const recentFailures = await db.loginAttempt.count({
      where: { identifierHash, createdAt: { gt: new Date(Date.now() - 15 * 60_000) }, succeeded: false },
    });
    const defaultSecurity = normalizeTenantSettings(undefined).securityNotifications;
    if (recentFailures >= defaultSecurity.failedLoginLimit) throw new AppError("RATE_LIMITED", "Too many failed attempts. Wait 15 minutes and try again.", 429);

    const [directCandidates, businessEmailAdminCandidates] = await Promise.all([
      db.user.findMany({
        where: {
          status: "ACTIVE",
          tenant: { status: { in: [...activeTenantStatuses] } },
          OR: [
            { email: { equals: normalizedIdentifier, mode: "insensitive" } },
            { phone: { in: phoneCandidates(rawIdentifier) } },
            { staffNumber: { equals: rawIdentifier, mode: "insensitive" } },
          ],
        },
        include: userInclude,
        orderBy: [{ lastLoginAt: "desc" }, { createdAt: "desc" }],
      }),
      db.user.findMany({
        where: {
          status: "ACTIVE",
          tenant: { status: { in: [...activeTenantStatuses] }, email: { equals: normalizedIdentifier, mode: "insensitive" } },
          roles: { some: { role: { code: "TENANT_ADMIN" } } },
        },
        include: userInclude,
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const candidates = mergeCandidates(directCandidates, businessEmailAdminCandidates);
    const failedLoginLimit = candidates.length > 0
      ? Math.min(defaultSecurity.failedLoginLimit, ...candidates.map((candidate) => normalizeTenantSettings(candidate.tenant.settings?.metadata).securityNotifications.failedLoginLimit))
      : defaultSecurity.failedLoginLimit;
    if (recentFailures >= failedLoginLimit) throw new AppError("RATE_LIMITED", "Too many failed attempts. Wait 15 minutes and try again.", 429);

    const matches = await matchingPasswordCandidates(candidates, body.password);
    if (matches.length === 0) {
      await recordLoginAttempt({ tenantKey: "global", identifierHash, ipAddress, succeeded: false });
      throw new AppError("INVALID_CREDENTIALS", "Incorrect username, email, phone number, or password", 401);
    }
    if (matches.length > 1) {
      await recordLoginAttempt({ tenantKey: "ambiguous", identifierHash, ipAddress, succeeded: false });
      throw new AppError("AMBIGUOUS_IDENTIFIER", "These credentials match more than one business account. Use a unique email address or phone number, or ask an administrator to change the duplicate username.", 409);
    }

    const user = matches[0];
    const security = normalizeTenantSettings(user.tenant.settings?.metadata).securityNotifications;
    const tenantRoles = user.roles.filter((userRole) => userRole.role.tenantId === user.tenantId);
    const roleCodes = tenantRoles.map((userRole) => userRole.role.code);
    if (roleCodes.length === 0) throw new AppError("ACCOUNT_NOT_READY", "This account has no role assigned. Ask the administrator or operator to update it.", 409);

    const usesAdminDashboard = roleCodes.includes("TENANT_ADMIN") || roleCodes.some(isDashboardManagerRoleCode);
    if (body.portal === "admin" && !usesAdminDashboard) throw new AppError("WRONG_LOGIN_PORTAL", "This is a staff account. Use the staff login page.", 403);
    if (body.portal === "staff" && usesAdminDashboard) throw new AppError("WRONG_LOGIN_PORTAL", "This account uses the business dashboard. Use the admin login page.", 403);

    const permissions = new Set(
      tenantRoles.flatMap((userRole) => userRole.role.rolePermissions.map((rolePermission) => rolePermission.permission.code as Permission)),
    );

    if (body.portal === "admin" && usesAdminDashboard && adminOtpEnabled()) {
      if (!isDeliverableAdminEmail(user.email)) {
        throw new AppError(
          "ADMIN_OTP_EMAIL_REQUIRED",
          "This administrator account needs a real email address before OTP verification can be used. Ask the platform operator to update the account email.",
          409,
        );
      }

      await assertAdminOtpSendAllowed(user.id);
      const challenge = await createAdminOtpChallenge({
        userId: user.id,
        tenantId: user.tenantId,
        identifierHash,
        ipAddress,
        deviceInfo: req.headers.get("user-agent"),
      });
      try {
        await sendAdminLoginOtpEmail({
          to: user.email,
          code: challenge.code,
          fullName: user.fullName,
          tenantName: user.tenant.name,
          expiresMinutes: Math.round(ADMIN_OTP_TTL_MS / 60_000),
        });
      } catch (error) {
        await invalidateAdminOtpChallenge(challenge.id);
        throw error;
      }

      const response = NextResponse.json({
        ok: true,
        otpRequired: true,
        challengeId: challenge.id,
        maskedEmail: maskEmail(user.email),
        expiresInSeconds: Math.round(ADMIN_OTP_TTL_MS / 1000),
      }, { status: 202 });
      response.headers.set("Cache-Control", "no-store, private");
      return response;
    }

    const session = await createTenantLoginSession({
      req,
      user,
      permissions,
      sessionTimeoutMinutes: security.sessionTimeoutMinutes,
    });

    await recordLoginAttempt({ tenantKey: user.tenantId, identifierHash, ipAddress, succeeded: true });
    const destination = body.portal === "admin" ? "/app/dashboard" : "/staff/dashboard";
    const response = NextResponse.json({
      ok: true,
      destination,
      forcePasswordChange: user.forcePasswordChange,
      user: { id: user.id, name: user.fullName, tenant: user.tenant.name, roles: roleCodes },
    });
    setTenantLoginCookies(response, req, session, security.sessionTimeoutMinutes);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
