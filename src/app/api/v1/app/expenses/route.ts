import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { resolveTenantAccessScope } from "@/server/auth/tenant-access-scope";
import { apiError, tenantContext } from "@/server/http";
import { requirePermission } from "@/server/security/context";

const expenseSchema = z.object({
  branchId: z.string().trim().min(1, "Select a branch"),
  category: z.string().trim().min(2, "Select an expense category").max(80),
  description: z.string().trim().min(3, "Describe the expense").max(220),
  vendor: z.string().trim().max(160).optional(),
  amount: z.coerce.number().finite().positive("Amount must be greater than zero").max(1_000_000_000),
  paymentMethod: z.enum(["Cash", "Mobile Money", "Card", "Bank Transfer", "Credit"]),
  reference: z.string().trim().max(120).optional(),
  status: z.enum(["PAID", "PENDING"]).default("PAID"),
  expenseDate: z.coerce.date(),
  notes: z.string().trim().max(500).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "expense.manage");
    const scope = await resolveTenantAccessScope(db, ctx);
    const rows = await db.expense.findMany({
      where: { tenantId: ctx.tenantId, branchId: { in: scope.branchIds } },
      include: { branch: { select: { id: true, name: true, code: true } } },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    return NextResponse.json({ data: rows.map((row) => ({ ...row, amount: row.amount.toString() })) });
  } catch (error) { return apiError(error); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "expense.manage");
    const scope = await resolveTenantAccessScope(db, ctx);
    const body = expenseSchema.parse(await req.json());
    if (!scope.branchIds.includes(body.branchId)) throw new AppError("BRANCH_FORBIDDEN", "You cannot record expenses for this branch", 403);

    const expense = await db.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: body.branchId, tenantId: ctx.tenantId, status: "ACTIVE" } });
      if (!branch) throw new AppError("INVALID_BRANCH", "The selected branch is unavailable", 400);
      const created = await tx.expense.create({ data: {
        tenantId: ctx.tenantId,
        branchId: branch.id,
        category: body.category,
        description: body.description,
        vendor: body.vendor?.trim() || null,
        amount: new Prisma.Decimal(body.amount),
        paymentMethod: body.paymentMethod,
        reference: body.reference?.trim() || null,
        status: body.status,
        expenseDate: body.expenseDate,
        notes: body.notes?.trim() || null,
        createdBy: ctx.userId,
      } });
      await appendAudit(tx, ctx, {
        action: "expense.created", entityType: "expense", entityId: created.id, branchId: branch.id,
        newValues: { category: created.category, description: created.description, amount: created.amount.toString(), paymentMethod: created.paymentMethod, status: created.status, expenseDate: created.expenseDate.toISOString() },
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(), deviceInfo: req.headers.get("user-agent") ?? undefined,
      });
      return created;
    });

    return NextResponse.json({ ok: true, expense: { ...expense, amount: expense.amount.toString() } }, { status: 201 });
  } catch (error) { return apiError(error); }
}
