import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { apiError, tenantContext } from "@/server/http";
import { requirePermission } from "@/server/security/context";
import { nextNumber } from "@/server/services/sequences";

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter the customer name").max(160),
  companyName: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.union([z.string().trim().email("Enter a valid email address"), z.literal("")]).optional(),
  creditLimit: z.coerce.number().finite().min(0, "Credit limit cannot be negative"),
});
const updateSchema = schema.extend({ id: z.string().trim().min(1) });

export async function GET(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "customer.view");
    const customers = await db.customer.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, status: "active" },
      orderBy: { fullName: "asc" },
      select: { id: true, customerNumber: true, fullName: true, companyName: true, phone: true, email: true, creditLimit: true },
    });
    return NextResponse.json({ data: customers });
  } catch (error) { return apiError(error); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "customer.create");
    const body = schema.parse(await req.json());
    const phone = body.phone?.trim() || null;

    const customer = await db.$transaction(async (tx) => {
      const customerNumber = await nextNumber(tx, ctx.tenantId, "customer", "CUST");
      return tx.customer.create({ data: {
        tenantId: ctx.tenantId,
        customerNumber,
        fullName: body.fullName,
        companyName: body.companyName?.trim() || null,
        phone,
        email: body.email?.trim().toLowerCase() || null,
        creditLimit: new Prisma.Decimal(body.creditLimit),
        createdBy: ctx.userId,
      } });
    }, { isolationLevel: "Serializable" });

    await appendAudit(db, ctx, {
      action: "customer.created",
      entityType: "customer",
      entityId: customer.id,
      newValues: { customerNumber: customer.customerNumber, fullName: customer.fullName, phone: customer.phone, creditLimit: customer.creditLimit.toString() },
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      deviceInfo: req.headers.get("user-agent") ?? undefined,
    }).catch((error) => console.error("Customer audit logging failed", error));

    return NextResponse.json({ ok: true, customer: { ...customer, creditLimit: customer.creditLimit.toString() } }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return apiError(new AppError("DUPLICATE_CUSTOMER", "A customer with that phone number already exists", 409));
    }
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "customer.update");
    const body = updateSchema.parse(await req.json());
    const existing = await db.customer.findFirst({ where: { id: body.id, tenantId: ctx.tenantId, deletedAt: null } });
    if (!existing) throw new AppError("NOT_FOUND", "Customer record was not found", 404);
    const customer = await db.customer.update({ where: { id: existing.id }, data: {
      fullName: body.fullName, companyName: body.companyName?.trim() || null, phone: body.phone?.trim() || null,
      email: body.email?.trim().toLowerCase() || null, creditLimit: new Prisma.Decimal(body.creditLimit),
    } });
    await appendAudit(db, ctx, {
      action: "customer.updated", entityType: "customer", entityId: customer.id,
      oldValues: { fullName: existing.fullName, companyName: existing.companyName, phone: existing.phone, email: existing.email, creditLimit: existing.creditLimit.toString() },
      newValues: { fullName: customer.fullName, companyName: customer.companyName, phone: customer.phone, email: customer.email, creditLimit: customer.creditLimit.toString() },
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(), deviceInfo: req.headers.get("user-agent") ?? undefined,
    }).catch((error) => console.error("Customer audit logging failed", error));
    return NextResponse.json({ ok: true, customer: { ...customer, creditLimit: customer.creditLimit.toString() } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return apiError(new AppError("DUPLICATE_CUSTOMER", "A customer with that phone number already exists", 409));
    return apiError(error);
  }
}
