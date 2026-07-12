import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { apiError, tenantContext } from "@/server/http";
import { requirePermission } from "@/server/security/context";

const schema = z.object({
  name: z.string().trim().min(2, "Enter a branch name").max(120),
  code: z.string().trim().min(2, "Enter a branch code").max(30)
    .regex(/^[A-Za-z0-9_-]+$/, "Branch code may only contain letters, numbers, underscores, or hyphens")
    .transform((value) => value.toUpperCase()),
  email: z.union([z.string().trim().email("Enter a valid branch email"), z.literal("")]).optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(200).optional(),
  town: z.string().trim().max(100).optional(),
  county: z.string().trim().max(100).optional(),
  timezone: z.string().trim().min(2).max(80).default("Africa/Nairobi"),
  isHeadOffice: z.boolean().default(false),
});

function knownPrismaError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "branch.view");
    const scope = await resolveTenantAccessScope(db, ctx);

    const branches = await db.branch.findMany({
      where: { tenantId: ctx.tenantId, id: { in: scope.branchIds } },
      orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
      include: {
        _count: {
          select: { userAssignments: true, inventories: true, shifts: true, sales: true },
        },
      },
    });

    return NextResponse.json({ data: branches });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "branch.create");
    const scope = await resolveTenantAccessScope(db, ctx);
    if (!scope.isTenantAdmin) {
      throw new AppError("FORBIDDEN", "Only a tenant administrator can create a branch", 403);
    }

    const body = schema.parse(await req.json());
    const result = await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: ctx.tenantId },
        include: { subscription: { include: { plan: true } } },
      });
      if (!tenant) throw new AppError("NOT_FOUND", "Business account was not found", 404);
      if (!tenant.subscription?.plan) {
        throw new AppError("SUBSCRIPTION_REQUIRED", "An active plan is required before adding branches", 409);
      }

      const branchCount = await tx.branch.count({ where: { tenantId: ctx.tenantId } });
      if (branchCount >= tenant.subscription.plan.maxBranches) {
        throw new AppError(
          "PLAN_LIMIT_REACHED",
          `Your ${tenant.subscription.plan.name} plan allows ${tenant.subscription.plan.maxBranches} branch${tenant.subscription.plan.maxBranches === 1 ? "" : "es"}. Upgrade the plan before adding another branch.`,
          409,
        );
      }

      const isHeadOffice = body.isHeadOffice || branchCount === 0;
      if (isHeadOffice) {
        await tx.branch.updateMany({
          where: { tenantId: ctx.tenantId, isHeadOffice: true },
          data: { isHeadOffice: false },
        });
      }

      const branch = await tx.branch.create({
        data: {
          tenantId: ctx.tenantId,
          code: body.code,
          name: body.name,
          email: body.email?.trim() || null,
          phone: body.phone?.trim() || null,
          address: body.address?.trim() || null,
          town: body.town?.trim() || null,
          county: body.county?.trim() || null,
          timezone: body.timezone,
          isHeadOffice,
          status: "ACTIVE",
        },
      });

      const admins = await tx.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          status: "ACTIVE",
          roles: { some: { role: { tenantId: ctx.tenantId, code: "TENANT_ADMIN" } } },
        },
        select: { id: true },
      });
      if (admins.length > 0) {
        await tx.userBranchAssignment.createMany({
          data: admins.map(({ id }) => ({ userId: id, branchId: branch.id })),
          skipDuplicates: true,
        });
      }

      await appendAudit(tx, ctx, {
        action: "branch.created",
        entityType: "branch",
        entityId: branch.id,
        branchId: branch.id,
        newValues: {
          code: branch.code,
          name: branch.name,
          town: branch.town,
          county: branch.county,
          isHeadOffice: branch.isHeadOffice,
        },
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
        deviceInfo: req.headers.get("user-agent") ?? undefined,
      });

      return branch;
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });

    return NextResponse.json({
      ok: true,
      branch: {
        id: result.id,
        code: result.code,
        name: result.name,
        isHeadOffice: result.isHeadOffice,
      },
    }, { status: 201 });
  } catch (error) {
    if (knownPrismaError(error)) {
      if (error.code === "P2002") {
        return apiError(new AppError("DUPLICATE_BRANCH", "That branch code is already used by this business", 409));
      }
      if (error.code === "P2028") {
        return apiError(new AppError("DATABASE_TIMEOUT", "The database took too long to create the branch. Try again.", 503));
      }
      if (error.code === "P2034") {
        return apiError(new AppError("DATABASE_BUSY", "Another branch update happened at the same time. Try again.", 409));
      }
    }
    return apiError(error);
  }
}
