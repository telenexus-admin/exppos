import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError } from "@/server/http";
import { verifySecret } from "@/server/security/passwords";
import { newRefreshToken, signAccessToken } from "@/server/security/tokens";
import { AppError } from "@/lib/errors";
import type { Permission } from "@/server/security/context";

const schema = z.object({
  tenantSlug: z.string().trim().min(2, "Enter the business code or business slug"),
  identifier: z.string().trim().min(3, "Enter the staff username, email address, or phone number"),
  password: z.string().min(1, "Enter the password supplied by the administrator"),
});

function loginAttemptHash(businessKey: string, identifier: string) {
  return createHash("sha256")
    .update(`${businessKey.trim().toLowerCase()}:${identifier.trim().toLowerCase()}`)
    .digest("hex");
}

async function recordLoginAttempt({
  tenantSlug,
  identifierHash,
  ipAddress,
  succeeded,
}: {
  tenantSlug: string;
  identifierHash: string;
  ipAddress?: string;
  succeeded: boolean;
}) {
  try {
    await db.loginAttempt.create({
      data: { tenantSlug, identifierHash, ipAddress, succeeded },
    });
  } catch (error) {
    console.error("Login attempt logging failed", { tenantSlug, succeeded, error });
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
    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const businessKey = body.tenantSlug.trim();
    const normalizedIdentifier = body.identifier.trim().toLowerCase();
    const identifierHash = loginAttemptHash(businessKey, normalizedIdentifier);

    const recentFailures = await db.loginAttempt.count({
      where: {
        identifierHash,
        createdAt: { gt: new Date(Date.now() - 15 * 60_000) },
        succeeded: false,
      },
    });

    if (recentFailures >= 5) {
      throw new AppError("RATE_LIMITED", "Too many failed attempts. Wait 15 minutes and try again.", 429);
    }

    const user = await db.user.findFirst({
      where: {
        tenant: {
          OR: [{ slug: businessKey.toLowerCase() }, { code: businessKey.toUpperCase() }],
          status: { in: ["TRIAL", "ACTIVE", "GRACE_PERIOD"] },
        },
        OR: [
          { email: normalizedIdentifier },
          { phone: body.identifier.trim() },
          { staffNumber: { equals: body.identifier.trim(), mode: "insensitive" } },
        ],
        status: "ACTIVE",
      },
      include: {
        tenant: true,
        branches: true,
        roles: {
          include: {
            role: {
              include: {
                rolePermissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });

    let passwordValid = false;
    if (user) {
      try {
        passwordValid = await verifySecret(user.passwordHash, body.password);
      } catch (error) {
        console.error("Password verification failed", { userId: user.id, error });
      }
    }

    if (!user || !passwordValid) {
      await recordLoginAttempt({
        tenantSlug: businessKey,
        identifierHash,
        ipAddress,
        succeeded: false,
      });
      throw new AppError(
        "INVALID_CREDENTIALS",
        "Incorrect business code, username/email/phone, or password",
        401,
      );
    }

    const roleCodes = user.roles.map((userRole) => userRole.role.code);
    if (roleCodes.length === 0) {
      throw new AppError(
        "ACCOUNT_NOT_READY",
        "This staff account has no role assigned. Ask the administrator to update the staff account.",
        409,
      );
    }

    const permissions = new Set(
      user.roles.flatMap((userRole) =>
        userRole.role.rolePermissions.map(
          (rolePermission) => rolePermission.permission.code as Permission,
        ),
      ),
    );

    const requestId = randomUUID();
    const accessToken = await signAccessToken({
      kind: "tenant",
      userId: user.id,
      tenantId: user.tenantId,
      branchIds: user.branches.map((branch) => branch.branchId),
      permissions,
      requestId,
    });

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
        db.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        }),
      ]);
    } catch (error) {
      console.error("Login session creation failed", { userId: user.id, error });
      if (isKnownPrismaError(error) && error.code === "P2028") {
        throw new AppError("LOGIN_TIMEOUT", "The server took too long to open your session. Try again.", 503);
      }
      throw new AppError("SESSION_CREATE_FAILED", "Your credentials are correct, but the session could not be opened. Try again.", 503);
    }

    await recordLoginAttempt({
      tenantSlug: businessKey,
      identifierHash,
      ipAddress,
      succeeded: true,
    });

    const destination = roleCodes.includes("TENANT_ADMIN") ? "/app/dashboard" : "/staff/dashboard";
    const response = NextResponse.json({
      ok: true,
      destination,
      forcePasswordChange: user.forcePasswordChange,
      user: {
        id: user.id,
        name: user.fullName,
        tenant: user.tenant.name,
        roles: roleCodes,
      },
    });

    const forwardedProtocol = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const secure = forwardedProtocol === "https" || req.nextUrl.protocol === "https:" || process.env.APP_URL?.startsWith("https://") === true;

    response.headers.set("Cache-Control", "no-store, private");
    response.cookies.set("tenant_session", accessToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 15 * 60,
    });
    response.cookies.set("tenant_refresh", refresh.raw, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 86400,
    });

    // Remove the legacy narrow-path cookie so it cannot conflict with refresh rotation.
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
