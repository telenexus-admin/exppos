import { NextRequest, NextResponse } from "next/server";
import argon2 from "argon2";
import { Prisma, TenantStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const statusMap: Record<string, TenantStatus> = {
  Trial: TenantStatus.TRIAL,
  Active: TenantStatus.ACTIVE,
};

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const value = (name: string) => String(form.get(name) ?? "").trim();

  const businessName = value("businessName");
  const code = value("code").toUpperCase();
  const slug = value("slug").toLowerCase();
  const email = value("email").toLowerCase();
  const phone = value("phone");
  const adminEmail = value("adminEmail").toLowerCase();
  const temporaryPassword = value("temporaryPassword");
  const planName = value("plan") || "Starter";

  if (!businessName || !code || !slug || !email || !phone || !adminEmail || !temporaryPassword) {
    return NextResponse.json({ error: "Required onboarding fields are missing." }, { status: 400 });
  }

  const passwordHash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
  const tenantStatus = statusMap[value("status")] ?? TenantStatus.TRIAL;
  const trialEndsAt = value("trialEnd") ? new Date(value("trialEnd")) : null;

  try {
    const tenant = await prisma.$transaction(async (tx) => {
      const plan = await tx.subscriptionPlan.upsert({
        where: { name: planName },
        update: { active: true },
        create: {
          name: planName,
          monthlyPrice: planName === "Business" ? 10000 : planName === "Growth" ? 5000 : 2500,
          yearlyPrice: planName === "Business" ? 100000 : planName === "Growth" ? 50000 : 25000,
          maxBranches: planName === "Business" ? 20 : planName === "Growth" ? 5 : 1,
          maxUsers: planName === "Business" ? 100 : planName === "Growth" ? 25 : 5,
          maxProducts: planName === "Business" ? 50000 : planName === "Growth" ? 10000 : 1000,
          enabledFeatures: ["pos", "inventory", "customers", "reports"],
        },
      });

      const created = await tx.tenant.create({
        data: {
          code,
          slug,
          name: businessName,
          legalName: value("legalName") || null,
          email,
          phone,
          currency: "KES",
          timezone: value("timezone") || "Africa/Nairobi",
          status: tenantStatus,
          subscription: {
            create: {
              planId: plan.id,
              status: tenantStatus,
              trialStartsAt: tenantStatus === TenantStatus.TRIAL ? new Date() : null,
              trialEndsAt,
              startsAt: tenantStatus === TenantStatus.ACTIVE ? new Date() : null,
            },
          },
          settings: {
            create: { receiptName: value("receiptName") || businessName },
          },
        },
      });

      const branch = await tx.branch.create({
        data: {
          tenantId: created.id,
          code: value("branchCode") || "HQ",
          name: value("branchName") || "Head Office",
          email,
          phone,
          address: value("address") || null,
          town: value("town") || null,
          timezone: value("timezone") || "Africa/Nairobi",
          isHeadOffice: true,
        },
      });

      const role = await tx.role.create({
        data: { tenantId: created.id, code: "TENANT_ADMIN", name: "Tenant Administrator", isSystem: true },
      });

      const admin = await tx.user.create({
        data: {
          tenantId: created.id,
          staffNumber: "ADMIN-001",
          fullName: value("adminName") || "Tenant Administrator",
          email: adminEmail,
          phone: value("adminPhone") || null,
          passwordHash,
          roles: { create: { roleId: role.id } },
          branches: { create: { branchId: branch.id } },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: created.id,
          branchId: branch.id,
          actorRole: "PLATFORM_OPERATOR",
          action: "TENANT_CREATED",
          entityType: "Tenant",
          entityId: created.id,
          newValues: { code, slug, plan: planName, adminUserId: admin.id },
          requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
          ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        },
      });

      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.redirect(new URL(`/operator/tenants/${tenant.slug}?created=1`, request.url), 303);
  } catch (error) {
    const message = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
      ? "A tenant with this code, slug, or email already exists."
      : "Tenant onboarding failed. No partial tenant records were saved.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
