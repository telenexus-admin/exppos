import type { Prisma, PrismaClient } from "@prisma/client";
import type { OperatorContext, TenantContext } from "@/server/security/context";

type AuditClient = PrismaClient | Prisma.TransactionClient;
const secretKeys = /password|pin|secret|token|authorization/i;

function redact(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "[NULL]";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item) ?? null);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKeys.test(key) ? "[REDACTED]" : redact(item) ?? null]));
  }
  return String(value);
}

export async function appendAudit(client: AuditClient, ctx: TenantContext | OperatorContext, event: {
  action: string; entityType: string; entityId?: string; branchId?: string;
  oldValues?: unknown; newValues?: unknown; reason?: string; ipAddress?: string; deviceInfo?: string;
}) {
  return client.auditLog.create({ data: {
    tenantId: ctx.kind === "tenant" ? ctx.tenantId : null,
    branchId: event.branchId,
    actorUserId: ctx.userId,
    actorRole: ctx.kind === "operator" ? "PLATFORM_OPERATOR" : "TENANT_USER",
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    oldValues: redact(event.oldValues),
    newValues: redact(event.newValues),
    reason: event.reason,
    ipAddress: event.ipAddress,
    deviceInfo: event.deviceInfo,
    requestId: ctx.requestId,
  }});
}
