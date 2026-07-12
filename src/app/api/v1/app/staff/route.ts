import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { apiError, tenantContext } from "@/server/http";
import { hashSecret } from "@/server/security/passwords";
import { requirePermission } from "@/server/security/context";

const schema = z.object({
  fullName: z.string().trim().min(2).max(100),
  username: z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9._-]+$/, "Username can only contain letters, numbers, dots, underscores and hyphens"),
  email: z.string().trim().email(),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  password: z.string().min(8).max(128),
  branchId: z.string().min(1),
  roleCode: z.enum(["CASHIER", "BRANCH_MANAGER", "INVENTORY_CLERK"]),
});

const rolePresets = {
  CASHIER: {
    name: "Cashier",
    permissions: ["customer.view", "customer.create", "product.view", "inventory.view", "sale.create", "sale.view", "payment.receive", "shift.open", "shift.close"],
  },
  BRANCH_MANAGER: {
    name: "Branch Manager",
    permissions: ["branch.view", "staff.view", "customer.view", "customer.create", "customer.update", "product.view", "product.create", "product.update", "inventory.view", "inventory.adjust", "inventory.transfer", "sale.create", "sale.view", "sale.discount", "sale.override_price", "sale.void", "sale.refund", "shift.open", "shift.close", "shift.review", "payment.receive", "purchase.create", "purchase.approve", "report.view", "manager.approve"],
  },
  INVENTORY_CLERK: {
    name: "Inventory Clerk",
    permissions: ["branch.view", "product.view", "product.create", "product.update", "inventory.view", "inventory.adjust", "inventory.transfer", "purchase.create"],
  },
} as const;

export async function POST(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "staff.create");
    requirePermission(ctx, "staff.assign_role");
    const input = schema.parse(await req.json());
    const username = input.username.toUpperCase();
    const email = input.email.toLowerCase();
    const preset = rolePresets[input.roleCode];
    const passwordHash = await hashSecret(input.password);

    const result = await db.$transaction(async (tx) => {
      const [branch, subscription, userCount, duplicate] = await Promise.all([
        tx.branch.findFirst({ where: { id: input.branchId, tenantId: ctx.tenantId, status: "ACTIVE" } }),
        tx.tenantSubscription.findUnique({ where: { tenantId: ctx.tenantId }, include: { plan: true } }),
        tx.user.count({ where: { tenantId: ctx.tenantId } }),
        tx.user.findFirst({ where: { tenantId: ctx.tenantId, OR: [{ staffNumber: username }, { email }] }, select: { id: true, staffNumber: true, email: true } }),
      ]);

      if (!branch) throw new AppError("INVALID_BRANCH", "Select a valid active branch", 400);
      if (!ctx.permissions.has("tenant.update") && !ctx.branchIds.includes(branch.id)) throw new AppError("FORBIDDEN", "You can only assign staff to your branches", 403);
      if (!subscription) throw new AppError("SUBSCRIPTION_REQUIRED", "This business has no active subscription plan", 409);
      if (userCount >= subscription.plan.maxUsers) throw new AppError("PLAN_LIMIT_REACHED", `Your plan allows a maximum of ${subscription.plan.maxUsers} staff accounts`, 409);
      if (duplicate?.staffNumber === username) throw new AppError("USERNAME_EXISTS", "That staff username is already in use", 409);
      if (duplicate?.email === email) throw new AppError("EMAIL_EXISTS", "That email address is already in use", 409);

      let role = await tx.role.findFirst({ where: { tenantId: ctx.tenantId, code: input.roleCode } });
      if (!role) {
        role = await tx.role.create({ data: { tenantId: ctx.tenantId, code: input.roleCode, name: preset.name, isSystem: true } });
        const permissions = await tx.permission.findMany({ where: { tenantId: ctx.tenantId, code: { in: [...preset.permissions] } }, select: { id: true } });
        await tx.rolePermission.createMany({ data: permissions.map(({ id }) => ({ roleId: role.id, permissionId: id })), skipDuplicates: true });
      }

      const user = await tx.user.create({
        data: {
          tenantId: ctx.tenantId,
          staffNumber: username,
          fullName: input.fullName,
          email,
          phone: input.phone || null,
          passwordHash,
          status: "ACTIVE",
          forcePasswordChange: true,
        },
      });

      await Promise.all([
        tx.userRole.create({ data: { userId: user.id, roleId: role.id } }),
        tx.userBranchAssignment.create({ data: { userId: user.id, branchId: branch.id } }),
      ]);

      await appendAudit(tx, ctx, {
        action: "staff.created",
        entityType: "user",
        entityId: user.id,
        branchId: branch.id,
        newValues: { fullName: user.fullName, username: user.staffNumber, email: user.email, roleCode: role.code, branchId: branch.id },
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
        deviceInfo: req.headers.get("user-agent") ?? undefined,
      });

      return { user, role, branch };
    }, { isolationLevel: "Serializable" });

    return NextResponse.json({
      ok: true,
      staff: { id: result.user.id, fullName: result.user.fullName, role: result.role.name, branch: result.branch.name },
      credentials: { username: result.user.staffNumber },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return apiError(new AppError("DUPLICATE_STAFF", "A staff account with those details already exists", 409));
    }
    return apiError(error);
  }
}
