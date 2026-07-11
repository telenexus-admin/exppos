import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError } from "@/server/http";
import { verifySecret } from "@/server/security/passwords";
import { newRefreshToken, signAccessToken } from "@/server/security/tokens";
import { AppError } from "@/lib/errors";
import type { Permission } from "@/server/security/context";

const schema = z.object({ tenantSlug: z.string().min(2), identifier: z.string().min(3), password: z.string().min(1) });
export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json()); const ip = req.headers.get("x-forwarded-for")?.split(",")[0];
    const identifierHash = createHash("sha256").update(body.identifier.toLowerCase()).digest("hex");
    const recent = await db.loginAttempt.count({ where: { identifierHash, createdAt: { gt: new Date(Date.now() - 15 * 60_000) }, succeeded: false } });
    if (recent >= 5) throw new AppError("RATE_LIMITED", "Too many login attempts", 429);
    const user = await db.user.findFirst({ where: { tenant: { slug: body.tenantSlug, status: { in: ["TRIAL", "ACTIVE", "GRACE_PERIOD"] } }, OR: [{ email: body.identifier.toLowerCase() }, { phone: body.identifier }], status: "ACTIVE" }, include: { tenant: true, branches: true, roles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } } });
    const valid = user ? await verifySecret(user.passwordHash, body.password) : false;
    await db.loginAttempt.create({ data: { tenantSlug: body.tenantSlug, identifierHash, ipAddress: ip, succeeded: valid } });
    if (!user || !valid) throw new AppError("INVALID_CREDENTIALS", "Invalid credentials", 401);
    const permissions = new Set(user.roles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.code as Permission)));
    const requestId = randomUUID(); const accessToken = await signAccessToken({ kind: "tenant", userId: user.id, tenantId: user.tenantId, branchIds: user.branches.map((b) => b.branchId), permissions, requestId });
    const refresh = newRefreshToken(); await db.userSession.create({ data: { userId: user.id, refreshTokenHash: refresh.hash, ipAddress: ip, deviceInfo: req.headers.get("user-agent"), expiresAt: new Date(Date.now() + 30 * 86400_000) } });
    return NextResponse.json({ accessToken, refreshToken: refresh.raw, forcePasswordChange: user.forcePasswordChange, user: { id: user.id, name: user.fullName, tenant: user.tenant.name, permissions: [...permissions] } });
  } catch (error) { return apiError(error); }
}
