import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  dashboardManagerRoleCode,
  permissionCodesForDashboardSections,
  type DashboardSection,
} from "@/lib/dashboard-access";

export type DashboardAccountType = "ADMINISTRATOR" | "BRANCH_MANAGER";

export type ProvisionDashboardAccountInput = {
  tenantId: string;
  tenantSlug: string;
  accountType: DashboardAccountType;
  fullName: string;
  username: string;
  email?: string | null;
  phone?: string | null;
  passwordHash: string;
  branchIds: string[];
  sections?: DashboardSection[];
  forcePasswordChange: boolean;
};

export async function provisionDashboardAccount(
  tx: Prisma.TransactionClient,
  input: ProvisionDashboardAccountInput,
) {
  const username = input.username.trim().toLowerCase();
  const suppliedEmail = input.email?.trim().toLowerCase() || null;
  const loginEmail = suppliedEmail || `${username}@${input.tenantSlug}.dashboard.local`;

  const conflict = await tx.user.findFirst({
    where: {
      tenantId: input.tenantId,
      OR: [{ staffNumber: username }, { email: loginEmail }],
    },
    select: { staffNumber: true, email: true },
  });
  if (conflict) {
    const error = new Error(conflict.staffNumber === username ? "USERNAME_TAKEN" : "EMAIL_TAKEN");
    error.name = "DashboardAccountConflict";
    throw error;
  }

  let role: { id: string; code: string; name: string };
  let selectedSections: DashboardSection[] = [];

  if (input.accountType === "ADMINISTRATOR") {
    role = await tx.role.findUniqueOrThrow({
      where: { tenantId_code: { tenantId: input.tenantId, code: "TENANT_ADMIN" } },
      select: { id: true, code: true, name: true },
    });
  } else {
    const access = permissionCodesForDashboardSections(input.sections ?? ["dashboard"]);
    selectedSections = access.sections;

    await tx.permission.createMany({
      data: access.permissions.map((code) => ({
        tenantId: input.tenantId,
        code,
        description: code.startsWith("dashboard.section.")
          ? `Dashboard access: ${code.slice("dashboard.section.".length)}`
          : code,
        platformOnly: false,
      })),
      skipDuplicates: true,
    });

    const permissions = await tx.permission.findMany({
      where: {
        tenantId: input.tenantId,
        platformOnly: false,
        code: { in: access.permissions },
      },
      select: { id: true },
    });

    role = await tx.role.create({
      data: {
        tenantId: input.tenantId,
        code: dashboardManagerRoleCode(`${username}_${randomUUID().slice(0, 8)}`),
        name: `Branch Manager — ${input.fullName}`,
        isSystem: false,
      },
      select: { id: true, code: true, name: true },
    });

    if (permissions.length > 0) {
      await tx.rolePermission.createMany({
        data: permissions.map(({ id }) => ({ roleId: role.id, permissionId: id })),
        skipDuplicates: true,
      });
    }
  }

  const user = await tx.user.create({
    data: {
      tenantId: input.tenantId,
      staffNumber: username,
      fullName: input.fullName.trim(),
      email: loginEmail,
      phone: input.phone?.trim() || null,
      passwordHash: input.passwordHash,
      status: "ACTIVE",
      forcePasswordChange: input.forcePasswordChange,
    },
    select: { id: true, fullName: true, staffNumber: true, email: true, phone: true, status: true },
  });

  await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
  if (input.branchIds.length > 0) {
    await tx.userBranchAssignment.createMany({
      data: input.branchIds.map((branchId) => ({ userId: user.id, branchId })),
      skipDuplicates: true,
    });
  }

  return {
    user,
    publicEmail: suppliedEmail,
    role,
    sections: selectedSections,
  };
}
