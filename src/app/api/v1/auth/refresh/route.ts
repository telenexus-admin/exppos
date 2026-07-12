import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashToken, newRefreshToken, signAccessToken } from "@/server/security/tokens";
import type { Permission } from "@/server/security/context";

const ACTIVE_TENANT_STATUSES = ["TRIAL", "ACTIVE", "GRACE_PERIOD"] as const;
const ACCESS_MAX_AGE_SECONDS = 15 * 60;
const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function safeNextPath(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get("next");
  if (!requested || !requested.startsWith("/") || requested.startsWith("//")) return "/app/dashboard";
  return requested;
}

function clearSessionCookies(response: NextResponse) {
  response.cookies.set("tenant_session", "", { httpOnly: true, expires: new Date(0), path: "/" });
  response.cookies.set("tenant_refresh", "", { httpOnly: true, expires: new Date(0), path: "/" });
  response.cookies.set("tenant_refresh", "", { httpOnly: true, expires: new Date(0), path: "/api/v1/auth" });
}

async function refreshSession(req: NextRequest, redirectAfterRefresh: boolean) {
  const rawRefreshToken = req.cookies.get("tenant_refresh")?.value;

  if (!rawRefreshToken) {
    const response = redirectAfterRefresh
      ? NextResponse.redirect(new URL("/login?reason=session-expired", req.url))
      : NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401 });
    clearSessionCookies(response);
    return response;
  }

  const session = await db.userSession.findFirst({
    where: {
      refreshTokenHash: hashToken(rawRefreshToken),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
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
      },
    },
  });

  const user = session?.user;
  const tenantIsActive = user && ACTIVE_TENANT_STATUSES.includes(user.tenant.status as (typeof ACTIVE_TENANT_STATUSES)[number]);

  if (!session || !user || user.status !== "ACTIVE" || !tenantIsActive) {
    if (session && !session.revokedAt) {
      await db.userSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } }).catch(() => undefined);
    }

    const response = redirectAfterRefresh
      ? NextResponse.redirect(new URL("/login?reason=session-expired", req.url))
      : NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Session is invalid or expired" } }, { status: 401 });
    clearSessionCookies(response);
    return response;
  }

  const permissions = new Set(
    user.roles.flatMap((userRole) =>
      userRole.role.rolePermissions.map((rolePermission) => rolePermission.permission.code as Permission),
    ),
  );
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const accessToken = await signAccessToken({
    kind: "tenant",
    userId: user.id,
    tenantId: user.tenantId,
    branchIds: user.branches.map((branch) => branch.branchId),
    permissions,
    requestId,
  });
  const nextRefreshToken = newRefreshToken();

  await db.userSession.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: nextRefreshToken.hash,
      expiresAt: new Date(Date.now() + REFRESH_MAX_AGE_SECONDS * 1000),
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      deviceInfo: req.headers.get("user-agent"),
    },
  });

  const response = redirectAfterRefresh
    ? NextResponse.redirect(new URL(safeNextPath(req), req.url))
    : NextResponse.json({ ok: true });
  const secure = process.env.APP_URL?.startsWith("https://") ?? false;

  response.headers.set("Cache-Control", "no-store");
  response.cookies.set("tenant_session", accessToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: ACCESS_MAX_AGE_SECONDS,
  });
  response.cookies.set("tenant_refresh", nextRefreshToken.raw, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: REFRESH_MAX_AGE_SECONDS,
  });
  response.cookies.set("tenant_refresh", "", {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/api/v1/auth",
    expires: new Date(0),
  });

  return response;
}

export async function POST(req: NextRequest) {
  try {
    return await refreshSession(req, false);
  } catch (error) {
    console.error("Tenant session refresh failed", error);
    const response = NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Session could not be renewed" } },
      { status: 401 },
    );
    clearSessionCookies(response);
    return response;
  }
}

export async function GET(req: NextRequest) {
  try {
    return await refreshSession(req, true);
  } catch (error) {
    console.error("Tenant session refresh redirect failed", error);
    const response = NextResponse.redirect(new URL("/login?reason=session-expired", req.url));
    clearSessionCookies(response);
    return response;
  }
}
