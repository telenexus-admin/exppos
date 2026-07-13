import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError } from "@/server/http";
import { verifySecret } from "@/server/security/passwords";
import { newRefreshToken, signAccessToken } from "@/server/security/tokens";
import { normalizeTenantSettings } from "@/server/settings/tenant-settings";
import type { Permission } from "@/server/security/context";

const schema = z.object({
  identifier: z.string().trim().min(3, "Enter your username, email address, or phone number"),
  password: z.string().min(1, "Enter your password"),
});
const activeTenantStatuses = ["TRIAL", "ACTIVE", "GRACE_PERIOD"] as const;
const userInclude = {
  tenant: { include: { settings: true } },
  branches: true,
  roles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
} satisfies Prisma.UserInclude;

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

function isKnownPrismaError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.AUTH_SECRET) {
      throw new AppError("AUTH_NOT_CONFIGURED", "Login is temporarily unavailable. Contact support.", 503);
    }

    const body = schema.parse(await req.json());
    const rawIdentifier = body.identifier.trim();
    const normalizedIdentifier = rawIdentifier.toLowerCase();
    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const identifierHash = loginAttemptHash(rawIdentifier);

    const candidates = await db.user.findMany({
      where: {
        status: "ACTIVE",
        tenant: { status: { in: [...activeTenantStatuses] } },
        OR: [
          { email: normalizedIdentifier },
          { phone: { in: phoneCandidates(rawIdentifier) } },
          { staffNumber: { equals: rawIdentifier, mode: "insensitive" } },
        ],
      },
      include: userInclude,
      orderBy: { createdAt: "asc" },
      take: 26,
    });

    const defaultSecurity = normalizeTenantSettings(undefined).securityNotifications;
    const failedLoginLimit = candidates.length > 0
      ? Math.min(...candidates.map((candidate) => normalizeTenantSettings(candidate.tenant.settings?.metadata).securityNotifications.failedLoginLimit))
      : defaultSecurity.failedLoginLimit;
    const recentFailures = await db.loginAttempt.count({
      where: {
        identifierHash,
        createdAt: { gt: new Date(Date.now() - 15 * 60_000) },
        succeeded: false,
      },
    });
    if (recentFailures >= failedLoginLimit) {
      throw new AppError("RATE_LIMITED", "Too many failed attempts. Wait 15 minutes and try again.", 429);
    }

    if (candidates.length > 25) {
      await recordLoginAttempt({ tenantKey: "ambiguous", identifierHash, ipAddress, succeeded: false });
      throw new AppError(
        "AMBIGUOUS_IDENTIFIER",
        "This username is used by several business accounts. Sign in with your unique email address or phone number.",
        409,
      );
    }

    const checked = await Promise.all(candidates.map(async (candidate) => {
      try {
        return { candidate, valid: await verifySecret(candidate.passwordHash, body.password) };
      } catch (error) {
        console.error("Password verification failed", { userId: candidate.id, error });
        return { candidate, valid: false };
      }
    }));
    const matches = checked.filter(({ valid }) => valid).map(({ candidate }) => candidate);

    if (matches.length === 0) {
      await recordLoginAttempt({ tenantKey: "global", identifierHash, ipAddress, succeeded: false });
      throw new AppError("INVALID_CREDENTIALS", "Incorrect username, email, phone number, or password", 401);
    }
    if (matches.length > 1) {
      await recordLoginAttempt({ tenantKey: "ambiguous", identifierHash, ipAddress, succeeded: false });
      throw new AppError(
        "AMBIGUOUS_IDENTIFIER",
        "These credentials match more than one business account. Use a unique email address or phone number, or ask an administrator to change the duplicate username.",
        409,
      );
    }

    const user = matches[0];
    const security = normalizeTenantSettings(user.tenant.settings?.metadata).securityNotifications;
    const roleCodes = user.roles.map((userRole) => userRole.role.code);
    if (roleCodes.length === 0) {
      throw new AppError("ACCOUNT_NOT_READY", "This account has no role assigned. Ask the administrator or operator to update it.", 409);
    }

    const permissions = new Set(
      user.roles.flatMap((userRole) => userRole.role.rolePermissions.map((rolePermission) => rolePermission.permission.code as Permission)),
    );
    const requestId = randomUUID();
    const accessToken = await signAccessToken({
      kind: "tenant",
      userId: user.id,
      tenantId: user.tenantId,
      branchIds: user.branches.map((branch) => branch.branchId),
      permissions,
      requestId,
    }, security.sessionTimeoutMinutes);
    const refresh = newRefreshToken();

    try {
      await db.$transaction([
        db.userSession.create({
          data: {
            userId: user.id,
            refreshTokenHash: refresh.hash,
            ipAddress,
            deviceInfo: req.headers.get("user-agent"),
            expiresAt: new Date(Date.now() + 30 * 86400_000),
          },
        }),
        db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      ]);
    } catch (error) {
      console.error("Login session creation failed", { userId: user.id, error });
      if (isKnownPrismaError(error) && error.code === "P2028") {
        throw new AppError("LOGIN_TIMEOUT", "The server took too long to open your session. Try again.", 503);
      }
      throw new AppError("SESSION_CREATE_FAILED", "Your credentials are correct, but the session could not be opened. Try again.", 503);
    }

    await recordLoginAttempt({ tenantKey: user.tenantId, identifierHash, ipAddress, succeeded: true });
    const destination = roleCodes.includes("TENANT_ADMIN") ? "/app/dashboard" : "/staff/dashboard";
    const response = NextResponse.json({
      ok: true,
      destination,
      forcePasswordChange: user.forcePasswordChange,
      user: { id: user.id, name: user.fullName, tenant: user.tenant.name, roles: roleCodes },
    });

    const forwardedProtocol = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const secure = forwardedProtocol === "https" || req.nextUrl.protocol === "https:" || process.env.APP_URL?.startsWith("https://") === true;
    response.headers.set("Cache-Control", "no-store, private");
    response.cookies.set("tenant_session", accessToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: security.sessionTimeoutMinutes * 60,
    });
    response.cookies.set("tenant_refresh", refresh.raw, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 86400,
    });
    response.cookies.set("tenant_refresh", "", {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/api/v1/auth",
      expires: new Date(0),
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
