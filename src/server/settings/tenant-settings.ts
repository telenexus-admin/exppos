export const PAYMENT_METHODS = ["Cash", "Mobile Money", "Card", "Bank", "Credit"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type TenantSettingsMetadata = {
  business: {
    kraPin: string;
    registrationNumber: string;
    address: string;
    town: string;
    county: string;
    language: string;
  };
  pos: {
    allowDiscounts: boolean;
    maximumDiscountPercent: number;
    allowPriceOverrides: boolean;
    allowCreditSales: boolean;
    requireCustomerForCredit: boolean;
    confirmBeforePayment: boolean;
    autoPrintReceipt: boolean;
  };
  payments: {
    enabledMethods: PaymentMethod[];
    requireReferenceForNonCash: boolean;
    allowSplitPayments: boolean;
    mpesaType: "Till" | "Paybill";
    mpesaNumber: string;
    mpesaAccountInstructions: string;
  };
  taxReceipt: {
    taxEnabled: boolean;
    pricesIncludeTax: boolean;
    showTaxBreakdown: boolean;
    receiptHeader: string;
    receiptFooter: string;
    paperSize: "58mm" | "80mm" | "A4";
    showBranch: boolean;
    showCashier: boolean;
    showPaymentMethod: boolean;
  };
  inventory: {
    defaultReorderLevel: number;
    requireAdjustmentReason: boolean;
    allowNegativeStock: boolean;
    lowStockAlerts: boolean;
    autoDeductStock: boolean;
  };
  securityNotifications: {
    sessionTimeoutMinutes: number;
    failedLoginLimit: number;
    forcePasswordChange: boolean;
    notifyLowStock: boolean;
    notifyVoids: boolean;
    notifyRefunds: boolean;
    notifyStockAdjustments: boolean;
    notifyShiftClose: boolean;
    dailySalesSummary: boolean;
    channels: Array<"dashboard" | "email" | "whatsapp">;
  };
};

export const DEFAULT_TENANT_SETTINGS: TenantSettingsMetadata = {
  business: {
    kraPin: "",
    registrationNumber: "",
    address: "",
    town: "",
    county: "",
    language: "English",
  },
  pos: {
    allowDiscounts: true,
    maximumDiscountPercent: 10,
    allowPriceOverrides: false,
    allowCreditSales: false,
    requireCustomerForCredit: true,
    confirmBeforePayment: true,
    autoPrintReceipt: false,
  },
  payments: {
    enabledMethods: ["Cash", "Mobile Money", "Card", "Bank"],
    requireReferenceForNonCash: false,
    allowSplitPayments: false,
    mpesaType: "Till",
    mpesaNumber: "",
    mpesaAccountInstructions: "",
  },
  taxReceipt: {
    taxEnabled: true,
    pricesIncludeTax: false,
    showTaxBreakdown: true,
    receiptHeader: "",
    receiptFooter: "Thank you for shopping with us.",
    paperSize: "80mm",
    showBranch: true,
    showCashier: true,
    showPaymentMethod: true,
  },
  inventory: {
    defaultReorderLevel: 5,
    requireAdjustmentReason: true,
    allowNegativeStock: false,
    lowStockAlerts: true,
    autoDeductStock: true,
  },
  securityNotifications: {
    sessionTimeoutMinutes: 15,
    failedLoginLimit: 5,
    forcePasswordChange: true,
    notifyLowStock: true,
    notifyVoids: true,
    notifyRefunds: true,
    notifyStockAdjustments: true,
    notifyShiftClose: true,
    dailySalesSummary: false,
    channels: ["dashboard"],
  },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function number(value: unknown, fallback: number, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

export function normalizeTenantSettings(metadata: unknown): TenantSettingsMetadata {
  const root = record(metadata);
  const business = record(root.business);
  const pos = record(root.pos);
  const payments = record(root.payments);
  const taxReceipt = record(root.taxReceipt);
  const inventory = record(root.inventory);
  const security = record(root.securityNotifications);

  const enabledMethods = Array.isArray(payments.enabledMethods)
    ? payments.enabledMethods.filter((method): method is PaymentMethod =>
        typeof method === "string" && PAYMENT_METHODS.includes(method as PaymentMethod),
      )
    : DEFAULT_TENANT_SETTINGS.payments.enabledMethods;

  const channels = Array.isArray(security.channels)
    ? security.channels.filter((channel): channel is "dashboard" | "email" | "whatsapp" =>
        channel === "dashboard" || channel === "email" || channel === "whatsapp",
      )
    : DEFAULT_TENANT_SETTINGS.securityNotifications.channels;

  return {
    business: {
      kraPin: text(business.kraPin, ""),
      registrationNumber: text(business.registrationNumber, ""),
      address: text(business.address, ""),
      town: text(business.town, ""),
      county: text(business.county, ""),
      language: text(business.language, "English"),
    },
    pos: {
      allowDiscounts: bool(pos.allowDiscounts, true),
      maximumDiscountPercent: number(pos.maximumDiscountPercent, 10, 0, 100),
      allowPriceOverrides: bool(pos.allowPriceOverrides, false),
      allowCreditSales: bool(pos.allowCreditSales, false),
      requireCustomerForCredit: bool(pos.requireCustomerForCredit, true),
      confirmBeforePayment: bool(pos.confirmBeforePayment, true),
      autoPrintReceipt: bool(pos.autoPrintReceipt, false),
    },
    payments: {
      enabledMethods: enabledMethods.length > 0 ? enabledMethods : ["Cash"],
      requireReferenceForNonCash: bool(payments.requireReferenceForNonCash, false),
      allowSplitPayments: bool(payments.allowSplitPayments, false),
      mpesaType: payments.mpesaType === "Paybill" ? "Paybill" : "Till",
      mpesaNumber: text(payments.mpesaNumber, ""),
      mpesaAccountInstructions: text(payments.mpesaAccountInstructions, ""),
    },
    taxReceipt: {
      taxEnabled: bool(taxReceipt.taxEnabled, true),
      pricesIncludeTax: bool(taxReceipt.pricesIncludeTax, false),
      showTaxBreakdown: bool(taxReceipt.showTaxBreakdown, true),
      receiptHeader: text(taxReceipt.receiptHeader, ""),
      receiptFooter: text(taxReceipt.receiptFooter, DEFAULT_TENANT_SETTINGS.taxReceipt.receiptFooter),
      paperSize: taxReceipt.paperSize === "58mm" || taxReceipt.paperSize === "A4" ? taxReceipt.paperSize : "80mm",
      showBranch: bool(taxReceipt.showBranch, true),
      showCashier: bool(taxReceipt.showCashier, true),
      showPaymentMethod: bool(taxReceipt.showPaymentMethod, true),
    },
    inventory: {
      defaultReorderLevel: number(inventory.defaultReorderLevel, 5, 0, 1_000_000_000),
      requireAdjustmentReason: bool(inventory.requireAdjustmentReason, true),
      allowNegativeStock: bool(inventory.allowNegativeStock, false),
      lowStockAlerts: bool(inventory.lowStockAlerts, true),
      autoDeductStock: true,
    },
    securityNotifications: {
      sessionTimeoutMinutes: number(security.sessionTimeoutMinutes, 15, 5, 480),
      failedLoginLimit: number(security.failedLoginLimit, 5, 3, 20),
      forcePasswordChange: bool(security.forcePasswordChange, true),
      notifyLowStock: bool(security.notifyLowStock, true),
      notifyVoids: bool(security.notifyVoids, true),
      notifyRefunds: bool(security.notifyRefunds, true),
      notifyStockAdjustments: bool(security.notifyStockAdjustments, true),
      notifyShiftClose: bool(security.notifyShiftClose, true),
      dailySalesSummary: bool(security.dailySalesSummary, false),
      channels: channels.length > 0 ? channels : ["dashboard"],
    },
  };
}
