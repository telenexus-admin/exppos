import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { apiError, tenantContext } from "@/server/http";
import { hashSecret } from "@/server/security/passwords";
import { requirePermission } from "@/server/security/context";

const roleTemplates = {
  CASHIER: {
    name: "Cashier",
    permissions: [
      "customer.view",
      "customer.create",
      "product.view",
      "inventory.view",
      "sale.create",
      "sale.view",
      "sale.discount",
      "shift.open",
      "shift.close",
      "payment.receive",
    ],
  },
  BRANCH_MANAGER: {
    name: "Branch Manager",
    permissions: [
      "branch.view",
      "staff.view",
      "staff.update",
      "customer.view",
      "customer.create",
      "customer.update",
      "customer.archive",
      "product.view",
      "product.create",
      "product.update",
      "inventory.view",
      "inventory.adjust",
      "inventory.transfer",
      "sale.create",
      "sale.view",
      "sale.discount",
      "sale.override_price",
      "sale.void",
      "sale.refund",
      "shift.open",
      "shift.close",
      "shift.review",
      "payment.receive",
      "purchase.create",
      "purchase.approve",
      "expense.manage",
      "report.view",
      "manager.approve",
    ],
  },
  INVENTORY_CLERK: {
    name: "Inventory Clerk",
    permissions: [
      "branch.view",
      "product.view",
      "product.create",
      "product.update",
      "inventory.view",
      "inventory.adjust",
      "inventory.transfer",
      "purchase.create",
      "report.view",
    ],
  },
  ACCOUNTANT: {
    name: "Accountant",
    permissions: [
      "customer.view",
      "sale.view",
      "payment.receive",
      "report.view",
      "report.financial",
      "accounting.manage",
    ],
  },
} as const;

type RoleCode = keyof typeof roleTemplates;

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter the staff member's full name").max(120),
  username: z
    .string()
    .trim()
    .min(3, "Username must have at least 3 characters")
    .max(32)
    .regex(/^[a-zA-Z0-9._-]+$/, "Use only letters, numbers, dots, underscores, or hyphens")
    .transform((value) => value.toLowerCase()),
  email: z.union([z.string().trim().email("Enter a valid email address"), z.literal("")]).optional(),
  phone: z.string().trim().max(30).optional(),
  password: z
    .string()
    .min(12, "Password must have at least 12 characters")
    .max(128)
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/\d/, "Password must contain a number"),
  branchId: z.string().trim().min(1, "Select a branch"),
  roleCode: z.enum(["CASHIER", "BRANCH_MANAGER", "INVENTORY_CLERK", "ACCOUNTANT"]),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "staff.create");
    requirePermission(ctx, "staff.assign_role");

    const body = schema.parse(await req.json());
    const passwordHash = await hashSecret(body.password);

    const result = await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: ctx.tenantId },
        include: { subscription: { include: { plan: true } } },
      });

      if (!tenant) throw new AppError("NOT_FOUND", "Business account was not found", 404);

      const currentUsers = await tx.user.count({ where: { tenantId: ctx.tenantId } });
      const maxUsers = tenant.subscription?.plan.maxUsers ?? 1;
      if (currentUsers >= maxUsers) {
        throw new AppError(
          "PLAN_LIMIT_REACHED",
          `Your current plan allows ${maxUsers} user${maxUsers === 1 ? "" : "s"}. Upgrade the plan before adding another staff member.`,
          409,
        );
      }

      const branch = await tx.branch.findFirst({
        where: { id: body.branchId, tenantId: ctx.tenantId, status: "ACTIVE" },
        select: { id: true, name: true },
      });
      if (!branch) throw new AppError("INVALID_BRANCH", "The selected branch is unavailable", 400);

      const suppliedEmail = body.email?.trim().toLowerCase();
      const loginEmail = suppliedEmail || `${body.username}@${tenant.slug}.staff.local`;

      const conflict = await tx.user.findFirst({
        where: {
          tenantId: ctx.tenantId,
          OR: [{ staffNumber: body.username }, { email: loginEmail }],
        },
        select: { staffNumber: true, email: true },
      });

      if (conflict?.staffNumber === body.username) {
        throw new AppError("USERNAME_TAKEN", "That username is already in use", 409);
      }
      if (conflict?.email === loginEmail) {
        throw new AppError("EMAIL_TAKEN", "That email address is already in use", 409);
      }

      const template = roleTemplates[body.roleCode as RoleCode];
      let role = await tx.role.findFirst({
        where: { tenantId: ctx.tenantId, code: body.roleCode },
      });

      if (!role) {
        role = await tx.role.create({
          data: {
            tenantId: ctx.tenantId,
            code: body.roleCode,
            name: template.name,
            isSystem: true,
          },
        });

        const permissions = await tx.permission.findMany({
          where: {
            tenantId: ctx.tenantId,
            code: { in: [...template.permissions] },
            platformOnly: false,
          },
          select: { id: true },
        });

        if (permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: permissions.map(({ id }) => ({ roleId: role!.id, permissionId: id })),
          });
        }
      }

      const user = await tx.user.create({
        data: {
          tenantId: ctx.tenantId,
          staffNumber: body.username,
          fullName: body.fullName,
          email: loginEmail,
          phone: body.phone || null,
          passwordHash,
          status: "ACTIVE",
          forcePasswordChange: true,
        },
      });

      await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
      await tx.userBranchAssignment.create({ data: { userId: user.id, branchId: branch.id } });

      await appendAudit(tx, ctx, {
        action: "staff.created",
        entityType: "user",
        entityId: user.id,
        branchId: branch.id,
        newValues: {
          fullName: user.fullName,
          username: user.staffNumber,
          email: suppliedEmail || null,
          roleCode: role.code,
          branchId: branch.id,
        },
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
        deviceInfo: req.headers.get("user-agent") ?? undefined,
      });

      return {
        id: user.id,
        fullName: user.fullName,
        username: user.staffNumber,
        email: suppliedEmail || null,
        role: role.name,
        branch: branch.name,
        businessCode: tenant.code,
      };
    }, { isolationLevel: "Serializable" });

    return NextResponse.json({ ok: true, staff: result }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return apiError(new AppError("DUPLICATE_STAFF", "The username or email is already in use", 409));
    }
    return apiError(error);
  }
}
