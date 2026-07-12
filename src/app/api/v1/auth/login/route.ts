import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError } from "@/server/http";
import { verifySecret } from "@/server/security/passwords";
import { newRefreshToken, signAccessToken } from "@/server/security/tokens";
import { AppError } from "@/lib/errors";
import type { Permission } from "@/server/security/context";

const schema = z.object({
  tenantSlug: z.string().trim().min(2),
  identifier: z.string().trim().min(3),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const businessKey = body.tenantSlug.trim();
    const normalizedIdentifier = body.identifier.trim().toLowerCase();
    const identifierHash = createHash("sha256").update(normalizedIdentifier).digest("hex");

    const recent = await db.loginAttempt.count({
      where: {
        identifierHash,
        createdAt: { gt: new Date(Date.now() - 15 * 60_000) },
        succeeded: false,
      },
    });
    if (recent >= 5) throw new AppError("RATE_LIMITED", "Too many login attempts", 429);

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

    const valid = user ? await verifySecret(user.passwordHash, body.password) : false;
    await db.loginAttempt.create({
      data: {
        tenantSlug: businessKey,
        identifierHash,
        ipAddress: ip,
        succeeded: valid,
      },
    });

    if (!user || !valid) {
      throw new AppError(
        "INVALID_CREDENTIALS",
        "Incorrect business code, username/email/phone, or password",
        401,
      );
    }

    const permissions = new Set(
      user.roles.flatMap((userRole) =>
        userRole.role.rolePermissions.map((rolePermission) => rolePermission.permission.code as Permission),
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
    await db.userSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: refresh.hash,
        ipAddress: ip,
        deviceInfo: req.headers.get("user-agent"),
        expiresAt: new Date(Date.now() + 30 * 86400_000),
      },
    });

    const roleCodes = user.roles.map((userRole) => userRole.role.code);
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

    const secure = process.env.APP_URL?.startsWith("https://") ?? false;
    response.cookies.set("tenant_session", accessToken, {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/",
      maxAge: 15 * 60,
    });
    response.cookies.set("tenant_refresh", refresh.raw, {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/api/v1/auth",
      maxAge: 30 * 86400,
    });

    return response;
  } catch (error) {
    return apiError(error);
  }
}
