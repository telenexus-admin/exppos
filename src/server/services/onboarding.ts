import type { PrismaClient } from "@prisma/client";
import { hashSecret } from "@/server/security/passwords";
import { appendAudit } from "@/server/audit/audit";
import type { OperatorContext } from "@/server/security/context";

export type OnboardTenantInput = {
  code: string; slug: string; name: string; legalName?: string; email: string; phone: string;
  currency: string; timezone: string; receiptName: string; planId: string;
  trialEndsAt?: Date; branch: { code: string; name: string; email?: string; phone?: string; address?: string };
  admin: { fullName: string; email: string; phone?: string; temporaryPassword: string; pin: string };
};

export async function onboardTenant(db: PrismaClient, ctx: OperatorContext, input: OnboardTenantInput) {
  const [passwordHash, pinHash] = await Promise.all([hashSecret(input.admin.temporaryPassword), hashSecret(input.admin.pin)]);
  return db.$transaction(async (tx) => {
    const plan = await tx.subscriptionPlan.findFirstOrThrow({ where: { id: input.planId, active: true } });
    const tenant = await tx.tenant.create({ data: {
      code: input.code, slug: input.slug, name: input.name, legalName: input.legalName,
      email: input.email, phone: input.phone, currency: input.currency, timezone: input.timezone,
    }});
    await tx.tenantSubscription.create({ data: { tenantId: tenant.id, planId: plan.id, status: "TRIAL", trialStartsAt: new Date(), trialEndsAt: input.trialEndsAt } });
    await tx.tenantSetting.create({ data: { tenantId: tenant.id, receiptName: input.receiptName } });
    const branch = await tx.branch.create({ data: { tenantId: tenant.id, code: input.branch.code, name: input.branch.name, email: input.branch.email, phone: input.branch.phone, address: input.branch.address, timezone: input.timezone, isHeadOffice: true } });
    const role = await tx.role.create({ data: { tenantId: tenant.id, code: "TENANT_ADMIN", name: "Tenant Administrator", isSystem: true } });
    const permissionCodes = ["tenant.view","tenant.update","branch.view","branch.create","branch.update","staff.view","staff.create","staff.update","staff.assign_role","customer.view","customer.create","customer.update","customer.archive","product.view","product.create","product.update","inventory.view","inventory.adjust","inventory.transfer","sale.create","sale.view","sale.discount","sale.override_price","sale.void","sale.refund","shift.open","shift.close","shift.review","payment.receive","purchase.create","purchase.approve","expense.manage","report.view","report.financial","accounting.manage","settings.manage","audit.view","manager.approve"];
    await tx.permission.createMany({ data: permissionCodes.map((code) => ({ tenantId: tenant.id, code, description: code })) });
    const permissions = await tx.permission.findMany({ where: { tenantId: tenant.id }, select: { id: true } });
    await tx.rolePermission.createMany({ data: permissions.map(({ id }) => ({ roleId: role.id, permissionId: id })) });
    const admin = await tx.user.create({ data: { tenantId: tenant.id, staffNumber: "STAFF-000001", fullName: input.admin.fullName, email: input.admin.email.toLowerCase(), phone: input.admin.phone, passwordHash, pinHash, forcePasswordChange: true } });
    await tx.userRole.create({ data: { userId: admin.id, roleId: role.id } });
    await tx.userBranchAssignment.create({ data: { userId: admin.id, branchId: branch.id } });
    await tx.category.createMany({ data: ["General", "Services"].map((name) => ({ tenantId: tenant.id, name })) });
    await tx.numberSequence.createMany({ data: [
      { tenantId: tenant.id, key: "sale", prefix: "SALE" }, { tenantId: tenant.id, key: "invoice", prefix: "INV" },
      { tenantId: tenant.id, key: "purchase", prefix: "PO" }, { tenantId: tenant.id, key: "customer", prefix: "CUST" },
    ] });
    await appendAudit(tx, ctx, { action: "tenant.created", entityType: "tenant", entityId: tenant.id, newValues: { name: tenant.name, slug: tenant.slug, adminId: admin.id, branchId: branch.id } });
    return { tenant, branch, admin: { id: admin.id, email: admin.email }, limits: { branches: plan.maxBranches, users: plan.maxUsers, products: plan.maxProducts } };
  }, { isolationLevel: "Serializable" });
}
