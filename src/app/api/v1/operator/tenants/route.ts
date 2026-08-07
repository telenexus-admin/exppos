import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { normalizeDashboardSections } from "@/lib/dashboard-access";
import { db } from "@/lib/db";
import { requireOperator } from "@/server/operator-auth";
import { onboardTenant } from "@/server/services/onboarding";
import { publicUrl } from "@/server/public-url";

const schema = z.object({
  businessName: z.string().min(2),
  legalName: z.string().optional(),
  email: z.string().email(),
  phone: z.string().min(7),
  town: z.string().min(2),
  address: z.string().min(3),
  currency: z.string(),
  timezone: z.string(),
  code: z.string().min(2),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  plan: z.enum(["Starter", "Growth", "Business"]),
  status: z.enum(["Trial", "Active"]),
  trialEnd: z.string().optional(),
  receiptName: z.string().min(2),
  adminName: z.string().min(2),
  adminEmail: z.string().email(),
  adminPhone: z.string().min(7),
  temporaryPassword: z.string().min(12),
  adminPin: z.string().regex(/^\d{4,8}$/),
  branchName: z.string().min(2),
  branchCode: z.string().min(2),
  extraAccountType: z.enum(["NONE", "ADMINISTRATOR", "BRANCH_MANAGER"]).default("NONE"),
  extraName: z.string().optional(),
  extraUsername: z.string().optional(),
  extraEmail: z.string().optional(),
  extraPhone: z.string().optional(),
  extraPassword: z.string().optional(),
});

const limits = {
  Starter: { monthlyPrice: 1500, yearlyPrice: 15000, maxBranches: 1, maxUsers: 5, maxProducts: 500 },
  Growth: { monthlyPrice: 4500, yearlyPrice: 45000, maxBranches: 5, maxUsers: 25, maxProducts: 5000 },
  Business: { monthlyPrice: 9000, yearlyPrice: 90000, maxBranches: 50, maxUsers: 100, maxProducts: 50000 },
} as const;

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOperator(req);
    const form = await req.formData();
    const raw = Object.fromEntries(form);
    const input = schema.parse(raw);
    const config = limits[input.plan];

    let additionalAccount: Parameters<typeof onboardTenant>[2]["additionalAccount"];
    if (input.extraAccountType !== "NONE") {
      const fullName = input.extraName?.trim() ?? "";
      const username = input.extraUsername?.trim().toLowerCase() ?? "";
      const email = input.extraEmail?.trim().toLowerCase() ?? "";
      const phone = input.extraPhone?.trim() ?? "";
      const password = input.extraPassword ?? "";

      if (fullName.length < 2) throw new Error("Enter the additional administrator or branch manager name.");
      if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) throw new Error("Additional account username must be 3-32 letters, numbers, dots, underscores, or hyphens.");
      if (email && !z.string().email().safeParse(email).success) throw new Error("Enter a valid email for the additional account.");
      if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
        throw new Error("Additional account password must have at least 12 characters, uppercase, lowercase, and a number.");
      }

      additionalAccount = {
        accountType: input.extraAccountType,
        fullName,
        username,
        email: email || undefined,
        phone: phone || undefined,
        temporaryPassword: password,
        sections: input.extraAccountType === "BRANCH_MANAGER"
          ? normalizeDashboardSections(form.getAll("extraSections").map(String))
          : undefined,
      };
    }

    const plan = await db.subscriptionPlan.upsert({
      where: { name: input.plan },
      create: { name: input.plan, ...config, enabledFeatures: ["pos", "inventory", "customers", "reports"] },
      update: { active: true },
    });

    const result = await onboardTenant(db, ctx, {
      code: input.code.toUpperCase(),
      slug: input.slug.toLowerCase(),
      name: input.businessName,
      legalName: input.legalName || undefined,
      email: input.email.toLowerCase(),
      phone: input.phone,
      currency: input.currency,
      timezone: input.timezone,
      receiptName: input.receiptName,
      planId: plan.id,
      status: input.status.toUpperCase() as "TRIAL" | "ACTIVE",
      trialEndsAt: input.trialEnd ? new Date(`${input.trialEnd}T23:59:59Z`) : undefined,
      branch: { code: input.branchCode.toUpperCase(), name: input.branchName, address: `${input.address}, ${input.town}` },
      admin: {
        fullName: input.adminName,
        email: input.adminEmail.toLowerCase(),
        phone: input.adminPhone,
        temporaryPassword: input.temporaryPassword,
        pin: input.adminPin,
      },
      additionalAccount,
    });

    return NextResponse.redirect(publicUrl(`/operator/tenants/${result.tenant.slug}?created=1`, req), 303);
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues[0]?.message
      : error instanceof Error && error.message
        ? error.message
        : "Unable to onboard client. Check that the tenant code, slug and administrator email are unique.";
    return NextResponse.redirect(publicUrl(`/operator/tenants/new?error=${encodeURIComponent(message)}`, req), 303);
  }
}
