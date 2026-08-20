import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Permission } from "@/server/security/context";
import { newRefreshToken, signAccessToken } from "@/server/security/tokens";

function isKnownPrismaError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

export async function createTenantLoginSession(input: {
  req: NextRequest;
  user: {
    id: string;
    tenantId: string;
    branches: Array<{ branchId: string }>;
  };
  permissions: ReadonlySet<Permission>;
  sessionTimeoutMinutes: number;
}) {
  const requestId = randomUUID();
  const accessToken = await signAccessToken({
    kind: "tenant",
    userId: input.user.id,
    tenantId: input.user.tenantId,
    branchIds: input.user.branches.map((branch) => branch.branchId),
    permissions: input.permissions,
    requestId,
  }, input.sessionTimeoutMinutes);
  const refresh = newRefreshToken();
  const ipAddress = input.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  try {
    await db.$transaction([
      db.userSession.create({
        data: {
          userId: input.user.id,
          refreshTokenHash: refresh.hash,
          ipAddress,
          deviceInfo: input.req.headers.get("user-agent"),
          expiresAt: new Date(Date.now() + 30 * 86400_000),
        },
      }),
      db.user.update({ where: { id: input.user.id }, data: { lastLoginAt: new Date() } }),
    ]);
  } catch (error) {
    console.error("Login session creation failed", { userId: input.user.id, error });
    if (isKnownPrismaError(error) && error.code === "P2028") {
      throw new AppError("LOGIN_TIMEOUT", "The server took too long to open your session. Try again.", 503);
    }
    throw new AppError("SESSION_CREATE_FAILED", "Your credentials are correct, but the session could not be opened. Try again.", 503);
  }

  return { accessToken, refreshToken: refresh.raw };
}

export function setTenantLoginCookies(
  response: NextResponse,
  req: NextRequest,
  session: { accessToken: string; refreshToken: string },
  sessionTimeoutMinutes: number,
) {
  const forwardedProtocol = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const secure = forwardedProtocol === "https" || req.nextUrl.protocol === "https:" || process.env.APP_URL?.startsWith("https://") === true;
  response.headers.set("Cache-Control", "no-store, private");
  response.cookies.set("tenant_session", session.accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: sessionTimeoutMinutes * 60,
  });
  response.cookies.set("tenant_refresh", session.refreshToken, {
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
}
