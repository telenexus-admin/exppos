import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { verifyAccessToken } from "@/server/security/tokens";
import type { Permission, TenantContext } from "@/server/security/context";

export async function tenantContext(req: NextRequest): Promise<TenantContext> {
  const header = req.headers.get("authorization");
  const bearerToken = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const token = bearerToken ?? req.cookies.get("tenant_session")?.value;

  if (!token) throw new AppError("UNAUTHENTICATED", "Authentication required", 401);

  try {
    const payload = await verifyAccessToken(token);
    if (payload.kind !== "tenant" || !payload.sub || typeof payload.tenantId !== "string") throw new Error();

    return {
      kind: "tenant",
      userId: payload.sub,
      tenantId: payload.tenantId,
      branchIds: Array.isArray(payload.branchIds)
        ? payload.branchIds.filter((value): value is string => typeof value === "string")
        : [],
      permissions: new Set((Array.isArray(payload.permissions) ? payload.permissions : []) as Permission[]),
      requestId: req.headers.get("x-request-id") ?? randomUUID(),
    };
  } catch {
    throw new AppError("UNAUTHENTICATED", "Session is invalid or expired", 401);
  }
}

export function apiError(error: unknown) {
  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    const field = firstIssue?.path.join(".");
    const message = firstIssue?.message ?? "The submitted information is invalid";

    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: field ? `${field}: ${message}` : message,
          details: error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const err = error instanceof AppError ? error : new AppError("INTERNAL_ERROR", "Unexpected server error", 500);

  if (!(error instanceof AppError)) {
    console.error("Unhandled API error", error);
  }

  return NextResponse.json(
    { error: { code: err.code, message: err.message, details: err.details } },
    { status: err.status },
  );
}
