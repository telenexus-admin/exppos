import type { PrismaClient } from "@prisma/client";
import { AppError } from "@/lib/errors";
import type { TenantContext } from "@/server/security/context";

export type TenantAccessScope = {
  userId: string;
  tenantId: string;
  fullName: string;
  roleCodes: string[];
  roleNames: string[];
  isTenantAdmin: boolean;
  branchIds: string[];
};

/**
 * Resolve branch visibility from the current database state instead of trusting
 * branch IDs embedded in a potentially stale access token.
 */
export async function resolveTenantAccessScope(
  db: PrismaClient,
  ctx: TenantContext,
): Promise<TenantAccessScope> {
  const user = await db.user.findFirst({
    where: {
      id: ctx.userId,
      tenantId: ctx.tenantId,
      status: "ACTIVE",
    },
    select: {
      id: true,
      tenantId: true,
      fullName: true,
      roles: {
        where: { role: { tenantId: ctx.tenantId } },
        select: { role: { select: { code: true, name: true } } },
      },
      branches: {
        where: {
          branch: {
            tenantId: ctx.tenantId,
            status: "ACTIVE",
          },
        },
        select: { branchId: true },
      },
    },
  });

  if (!user) {
    throw new AppError("UNAUTHENTICATED", "The tenant account is no longer active", 401);
  }

  const roleCodes = user.roles.map(({ role }) => role.code);
  const roleNames = user.roles.map(({ role }) => role.name);
  const isTenantAdmin = roleCodes.includes("TENANT_ADMIN");

  const branchIds = isTenantAdmin
    ? (
        await db.branch.findMany({
          where: { tenantId: ctx.tenantId, status: "ACTIVE" },
          select: { id: true },
          orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
        })
      ).map(({ id }) => id)
    : user.branches.map(({ branchId }) => branchId);

  return {
    userId: user.id,
    tenantId: user.tenantId,
    fullName: user.fullName,
    roleCodes,
    roleNames,
    isTenantAdmin,
    branchIds,
  };
}
