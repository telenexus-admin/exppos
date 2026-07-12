import { NextRequest, NextResponse } from "next/server";
import { TenantStatus, UserStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await prisma.tenant.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "POS client not found." }, { status: 404 });

  if (existing.status === TenantStatus.CANCELLED) {
    return NextResponse.json({ ok: true, alreadyRemoved: true });
  }

  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({ where: { id }, data: { status: TenantStatus.CANCELLED } });
    await tx.tenantSubscription.updateMany({ where: { tenantId: id }, data: { status: TenantStatus.CANCELLED } });
    await tx.user.updateMany({ where: { tenantId: id }, data: { status: UserStatus.SUSPENDED } });
    await tx.auditLog.create({
      data: {
        tenantId: id,
        actorRole: "PLATFORM_OPERATOR",
        action: "TENANT_REMOVED_FROM_ACTIVE_LIST",
        entityType: "Tenant",
        entityId: id,
        oldValues: { status: existing.status },
        newValues: { status: TenantStatus.CANCELLED },
        reason: "Removed from the POS client list. This action is recoverable.",
        requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
