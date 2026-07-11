import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { AppError } from "@/lib/errors";
import type { TenantContext } from "@/server/security/context";
import { requireBranch } from "@/server/security/context";
import { hashToken } from "@/server/security/tokens";
import { verifySecret } from "@/server/security/passwords";
import { appendAudit } from "@/server/audit/audit";

export async function issueManagerApproval(db: PrismaClient, ctx: TenantContext, input: { branchId: string; managerId: string; pin: string; action: string; entityId?: string }) {
  requireBranch(ctx, input.branchId);
  return db.$transaction(async (tx) => {
    const manager = await tx.user.findFirst({ where: { id: input.managerId, tenantId: ctx.tenantId, status: "ACTIVE", branches: { some: { branchId: input.branchId } }, roles: { some: { role: { rolePermissions: { some: { permission: { code: "manager.approve" } } } } } } } });
    if (!manager?.pinHash || !await verifySecret(manager.pinHash, input.pin)) throw new AppError("INVALID_MANAGER_APPROVAL", "Manager approval failed", 403);
    const raw = randomBytes(32).toString("base64url");
    const approval = await tx.managerApprovalToken.create({ data: { tenantId: ctx.tenantId, branchId: input.branchId, requesterId: ctx.userId, approverId: manager.id, action: input.action, entityId: input.entityId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 2 * 60_000) } });
    await appendAudit(tx, ctx, { action: "manager.approval.issued", entityType: "managerApproval", entityId: approval.id, branchId: input.branchId, newValues: { action: input.action, approverId: manager.id } });
    return { token: raw, expiresAt: approval.expiresAt };
  });
}

export async function consumeManagerApproval(db: PrismaClient, ctx: TenantContext, token: string, expected: { branchId: string; action: string; entityId?: string }) {
  const now = new Date();
  const used = await db.managerApprovalToken.updateMany({ where: { tenantId: ctx.tenantId, branchId: expected.branchId, requesterId: ctx.userId, action: expected.action, entityId: expected.entityId, tokenHash: hashToken(token), usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
  if (used.count !== 1) throw new AppError("INVALID_APPROVAL_TOKEN", "Approval token is invalid, expired, or already used", 403);
}
