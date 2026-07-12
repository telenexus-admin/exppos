import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashToken } from "@/server/security/tokens";

export async function GET(req: NextRequest) {
  const refreshToken = req.cookies.get("tenant_refresh")?.value;

  if (refreshToken) {
    await db.userSession.updateMany({
      where: { refreshTokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    }).catch((error) => console.error("Unable to revoke tenant session during logout", error));
  }

  const response = NextResponse.redirect(new URL("/login", req.url));
  response.cookies.set("tenant_session", "", { httpOnly: true, expires: new Date(0), path: "/" });
  response.cookies.set("tenant_refresh", "", { httpOnly: true, expires: new Date(0), path: "/" });
  response.cookies.set("tenant_refresh", "", { httpOnly: true, expires: new Date(0), path: "/api/v1/auth" });
  return response;
}
