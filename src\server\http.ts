import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { verifyAccessToken } from "@/server/security/tokens";
import type { Permission, TenantContext } from "@/server/security/context";

export async function tenantContext(req: NextRequest): Promise<TenantContext> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
  try {
    const payload = await verifyAccessToken(header.slice(7));
    if (payload.kind !== "tenant" || !payload.sub || typeof payload.tenantId !== "string") throw new Error();
    return { kind: "tenant", userId: payload.sub, tenantId: payload.tenantId, branchIds: Array.isArray(payload.branchIds) ? payload.branchIds.filter((x): x is string => typeof x === "string") : [], permissions: new Set((Array.isArray(payload.permissions) ? payload.permissions : []) as Permission[]), requestId: req.headers.get("x-request-id") ?? randomUUID() };
  } catch { throw new AppError("UNAUTHENTICATED", "Session is invalid or expired", 401); }
}
export function apiError(error: unknown) {
  const err = error instanceof AppError ? error : new AppError("INTERNAL_ERROR", "Unexpected server error", 500);
  return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
}
