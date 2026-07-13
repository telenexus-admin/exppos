import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { apiError } from "@/server/http";
import { requireOperator } from "@/server/operator-auth";
import { hashToken } from "@/server/security/tokens";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireOperator(req);
    const { id } = await params;

    const tenant = await db.tenant.findFirst({
      where: { id, status: { not: "CANCELLED" } },
      select: { id: true, code: true, slug: true, name: true },
    });

    if (!tenant) throw new AppError("NOT_FOUND", "POS client was not found", 404);

    const currentRefresh = req.cookies.get("tenant_refresh")?.value;
    if (currentRefresh) {
      await db.userSession.updateMany({
        where: {
          refreshTokenHash: hashToken(currentRefresh),
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      }).catch((error) => console.error("Unable to revoke previous tenant session", error));
    }

    await appendAudit(db, ctx, {
      action: "tenant.login_opened",
      entityType: "tenant",
      entityId: tenant.id,
      newValues: { code: tenant.code, slug: tenant.slug },
      reason: "Operator opened isolated tenant login",
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      deviceInfo: req.headers.get("user-agent") ?? undefined,
    }).catch((error) => console.error("Unable to audit tenant login switch", error));

    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("switch", "1");

    const response = NextResponse.redirect(loginUrl);
    response.headers.set("Cache-Control", "no-store, private");
    response.cookies.set("tenant_session", "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
    });
    response.cookies.set("tenant_refresh", "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
    });
    response.cookies.set("tenant_refresh", "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/v1/auth",
      expires: new Date(0),
    });

    return response;
  } catch (error) {
    return apiError(error);
  }
}
