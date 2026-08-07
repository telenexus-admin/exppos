import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { DASHBOARD_SECTION_SLUGS, normalizeDashboardSections } from "@/lib/dashboard-access";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError } from "@/server/http";
import { requireOperator } from "@/server/operator-auth";
import { hashSecret } from "@/server/security/passwords";
import { provisionDashboardAccount } from "@/server/services/dashboard-accounts";
import { normalizeTenantSettings } from "@/server/settings/tenant-settings";

const schema = z.object({
  accountType: z.enum(["ADMINISTRATOR", "BRANCH_MANAGER"]),
  fullName: z.string().trim().min(2).max(120),
  username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9._-]+$/).transform((value) => value.toLowerCase()),
  email: z.union([z.string().trim().email(), z.literal("")]).optional(),
  phone: z.string().trim().max(30).optional(),
  password: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/),
  branchIds: z.array(z.string().trim().min(1)).default([]),
  sections: z.array(z.enum(DASHBOARD_SECTION_SLUGS)).default([]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const operator = await requireOperator(req);
    const { id: tenantId } = await params;
    const body = schema.parse(await req.json());
    const passwordHash = await hashSecret(body.password);

    const result = await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        include: { subscription: { include: { plan: true } }, settings: true },
      });
      if (!tenant || tenant.status === "CANCELLED") throw new AppError("NOT_FOUND", "POS client was not found", 404);

      const currentUsers = await tx.user.count({ where: { tenantId } });
      const maxUsers = tenant.subscription?.plan.maxUsers ?? 1;
      if (currentUsers >= maxUsers) throw new AppError("PLAN_LIMIT_REACHED", `This plan allows ${maxUsers} user accounts. Upgrade the client before adding another account.`, 409);

      const activeBranches = await tx.branch.findMany({
        where: { tenantId, status: "ACTIVE" },
        select: { id: true, name: true, code: true },
        orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
      });
      if (activeBranches.length === 0) throw new AppError("BRANCH_REQUIRED", "The client needs an active branch before adding this account", 409);

      const requestedBranchIds = body.accountType === "ADMINISTRATOR"
        ? activeBranches.map(({ id }) => id)
        : [...new Set(body.branchIds)];
      if (body.accountType === "BRANCH_MANAGER" && requestedBranchIds.length === 0) {
        throw new AppError("BRANCH_REQUIRED", "Select at least one branch for the branch manager", 422);
      }
      const validBranchIds = new Set(activeBranches.map(({ id }) => id));
      if (requestedBranchIds.some((branchId) => !validBranchIds.has(branchId))) {
        throw new AppError("INVALID_BRANCH", "One of the selected branches is unavailable for this client", 422);
      }

      const sections = body.accountType === "BRANCH_MANAGER" ? normalizeDashboardSections(body.sections) : [];
      const account = await provisionDashboardAccount(tx, {
        tenantId,
        tenantSlug: tenant.slug,
        accountType: body.accountType,
        fullName: body.fullName,
        username: body.username,
        email: body.email || null,
        phone: body.phone || null,
        passwordHash,
        branchIds: requestedBranchIds,
        sections,
        forcePasswordChange: normalizeTenantSettings(tenant.settings?.metadata).securityNotifications.forcePasswordChange,
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: operator.userId,
          actorRole: "PLATFORM_OPERATOR",
          action: "dashboard_account.created",
          entityType: "user",
          entityId: account.user.id,
          newValues: {
            accountType: body.accountType,
            username: account.user.staffNumber,
            roleCode: account.role.code,
            branchIds: requestedBranchIds,
            sections: account.sections,
          },
          requestId: operator.requestId,
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
          deviceInfo: req.headers.get("user-agent") ?? undefined,
        },
      });

      return {
        user: account.user,
        publicEmail: account.publicEmail,
        role: account.role,
        branches: activeBranches.filter((branch) => requestedBranchIds.includes(branch.id)),
        sections: account.sections,
      };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });

    return NextResponse.json({
      ok: true,
      account: {
        id: result.user.id,
        fullName: result.user.fullName,
        username: result.user.staffNumber,
        email: result.publicEmail,
        phone: result.user.phone,
        role: result.role.name,
        roleCode: result.role.code,
        branches: result.branches,
        sections: result.sections,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "DashboardAccountConflict") {
      return apiError(new AppError(error.message === "USERNAME_TAKEN" ? "USERNAME_TAKEN" : "EMAIL_TAKEN", error.message === "USERNAME_TAKEN" ? "That username is already in use for this client" : "That email address is already in use for this client", 409));
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return apiError(new AppError("DUPLICATE_ACCOUNT", "That username, email, or dashboard role already exists", 409));
      if (error.code === "P2034") return apiError(new AppError("DATABASE_BUSY", "Another account update happened at the same time. Try again.", 409));
      if (error.code === "P2028") return apiError(new AppError("DATABASE_TIMEOUT", "The database took too long to create the account. Try again.", 503));
    }
    return apiError(error);
  }
}
