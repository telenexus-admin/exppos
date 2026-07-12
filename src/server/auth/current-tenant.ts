import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Permission, TenantContext } from "@/server/security/context";
import { verifyAccessToken } from "@/server/security/tokens";

export async function requireCurrentTenant(): Promise<TenantContext> {
  const cookieStore = await cookies();
  const token = cookieStore.get("tenant_session")?.value;

  if (!token) redirect("/login");

  try {
    const payload = await verifyAccessToken(token);

    if (payload.kind !== "tenant" || !payload.sub || typeof payload.tenantId !== "string") {
      throw new Error("Invalid tenant session");
    }

    const branchIds = Array.isArray(payload.branchIds)
      ? payload.branchIds.filter((value): value is string => typeof value === "string")
      : [];

    const permissions = new Set(
      (Array.isArray(payload.permissions) ? payload.permissions : []).filter(
        (value): value is Permission => typeof value === "string",
      ),
    );

    return {
      kind: "tenant",
      userId: payload.sub,
      tenantId: payload.tenantId,
      branchIds,
      permissions,
      requestId: typeof payload.jti === "string" ? payload.jti : crypto.randomUUID(),
    };
  } catch {
    redirect("/login");
  }
}
