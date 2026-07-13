import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, tenantContext } from "@/server/http";

export async function GET(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    const user = await db.user.findFirst({
      where: { id: ctx.userId, tenantId: ctx.tenantId, status: "ACTIVE" },
      select: {
        fullName: true,
        staffNumber: true,
        email: true,
        phone: true,
        tenant: { select: { name: true, code: true } },
        roles: {
          where: { role: { tenantId: ctx.tenantId } },
          select: { role: { select: { name: true } } },
        },
      },
    });

    if (!user) throw new AppError("UNAUTHENTICATED", "Authentication required", 401);

    const response = NextResponse.json({
      user: {
        fullName: user.fullName,
        username: user.staffNumber,
        email: user.email,
        phone: user.phone,
        tenantName: user.tenant.name,
        tenantCode: user.tenant.code,
        roles: user.roles.map(({ role }) => role.name),
      },
    });
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  } catch (error) {
    return apiError(error);
  }
}
