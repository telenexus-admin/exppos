import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/server/audit/audit";
import { apiError, tenantContext } from "@/server/http";
import { requirePermission } from "@/server/security/context";

const channelSchema = z.enum(["dashboard", "email", "whatsapp"]);
const paymentMethodSchema = z.enum(["Cash", "Mobile Money", "Card", "Bank", "Credit"]);
const timezoneSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
      return true;
    } catch {
      return false;
    }
  }, "Enter a valid timezone such as Africa/Nairobi");

const schema = z.object({
  profile: z.object({
    name: z.string().trim().min(2).max(160),
    legalName: z.string().trim().max(200).optional().default(""),
    email: z.string().trim().email().max(200),
    phone: z.string().trim().min(7).max(40),
    currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
    timezone: timezoneSchema,
    receiptName: z.string().trim().min(2).max(160),
  }),
  taxRatePercent: z.coerce.number().finite().min(0).max(100),
  metadata: z.object({
    business: z.object({
      kraPin: z.string().trim().max(40),
      registrationNumber: z.string().trim().max(80),
      address: z.string().trim().max(240),
      town: z.string().trim().max(100),
      county: z.string().trim().max(100),
      language: z.string().trim().min(2).max(40),
    }),
    pos: z.object({
      allowDiscounts: z.boolean(),
      maximumDiscountPercent: z.coerce.number().finite().min(0).max(100),
      allowPriceOverrides: z.boolean(),
      allowCreditSales: z.boolean(),
      requireCustomerForCredit: z.boolean(),
      confirmBeforePayment: z.boolean(),
      autoPrintReceipt: z.boolean(),
    }),
    payments: z.object({
      enabledMethods: z.array(paymentMethodSchema).min(1, "Enable at least one payment method"),
      requireReferenceForNonCash: z.boolean(),
      allowSplitPayments: z.boolean(),
      mpesaType: z.enum(["Till", "Paybill"]),
      mpesaNumber: z.string().trim().max(40),
      mpesaAccountInstructions: z.string().trim().max(180),
    }),
    taxReceipt: z.object({
      taxEnabled: z.boolean(),
      pricesIncludeTax: z.boolean(),
      showTaxBreakdown: z.boolean(),
      receiptHeader: z.string().trim().max(240),
      receiptFooter: z.string().trim().max(500),
      paperSize: z.enum(["58mm", "80mm", "A4"]),
      showBranch: z.boolean(),
      showCashier: z.boolean(),
      showPaymentMethod: z.boolean(),
    }),
    inventory: z.object({
      defaultReorderLevel: z.coerce.number().finite().min(0).max(1_000_000_000),
      requireAdjustmentReason: z.boolean(),
      allowNegativeStock: z.boolean(),
      lowStockAlerts: z.boolean(),
      autoDeductStock: z.literal(true),
    }),
    securityNotifications: z.object({
      sessionTimeoutMinutes: z.coerce.number().int().min(5).max(480),
      failedLoginLimit: z.coerce.number().int().min(3).max(20),
      forcePasswordChange: z.boolean(),
      notifyLowStock: z.boolean(),
      notifyVoids: z.boolean(),
      notifyRefunds: z.boolean(),
      notifyStockAdjustments: z.boolean(),
      notifyShiftClose: z.boolean(),
      dailySalesSummary: z.boolean(),
      channels: z.array(channelSchema).min(1, "Select at least one notification channel"),
    }),
  }),
});

function jsonObject(value: Prisma.JsonValue | null | undefined): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Prisma.JsonObject
    : {};
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    requirePermission(ctx, "settings.manage");
    const body = schema.parse(await req.json());
    const taxRate = new Prisma.Decimal(body.taxRatePercent).div(100);

    const result = await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: ctx.tenantId },
        include: { settings: { select: { metadata: true } } },
      });
      if (!tenant) throw new AppError("NOT_FOUND", "Business account was not found", 404);

      const metadata = {
        ...jsonObject(tenant.settings?.metadata),
        ...body.metadata,
      } as unknown as Prisma.InputJsonValue;

      const updatedTenant = await tx.tenant.update({
        where: { id: ctx.tenantId },
        data: {
          name: body.profile.name,
          legalName: body.profile.legalName || null,
          email: body.profile.email.toLowerCase(),
          phone: body.profile.phone,
          currency: body.profile.currency,
          timezone: body.profile.timezone,
        },
      });

      const setting = await tx.tenantSetting.upsert({
        where: { tenantId: ctx.tenantId },
        update: { receiptName: body.profile.receiptName, taxRate, metadata },
        create: { tenantId: ctx.tenantId, receiptName: body.profile.receiptName, taxRate, metadata },
      });

      await appendAudit(tx, ctx, {
        action: "settings.updated",
        entityType: "tenant_setting",
        entityId: setting.id,
        oldValues: {
          businessName: tenant.name,
          email: tenant.email,
          phone: tenant.phone,
          currency: tenant.currency,
          timezone: tenant.timezone,
        },
        newValues: {
          businessName: updatedTenant.name,
          email: updatedTenant.email,
          phone: updatedTenant.phone,
          currency: updatedTenant.currency,
          timezone: updatedTenant.timezone,
          receiptName: setting.receiptName,
          taxRate: setting.taxRate.toString(),
          enabledPayments: body.metadata.payments.enabledMethods,
        },
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
        deviceInfo: req.headers.get("user-agent") ?? undefined,
      });

      return { tenant: updatedTenant, setting };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });

    return NextResponse.json({
      ok: true,
      settings: { businessName: result.tenant.name, updatedAt: result.setting.updatedAt },
    });
  } catch (error) {
    return apiError(error);
  }
}
