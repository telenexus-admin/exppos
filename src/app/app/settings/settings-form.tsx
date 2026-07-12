"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { PAYMENT_METHODS, type TenantSettingsMetadata } from "@/server/settings/tenant-settings";

export type TenantSettingsInitial = {
  profile: {
    name: string;
    legalName: string;
    email: string;
    phone: string;
    currency: string;
    timezone: string;
    receiptName: string;
  };
  taxRatePercent: number;
  metadata: TenantSettingsMetadata;
};

function Toggle({ name, title, description, defaultChecked, disabled = false }: {
  name: string;
  title: string;
  description: string;
  defaultChecked: boolean;
  disabled?: boolean;
}) {
  return (
    <label className={`settings-toggle${disabled ? " disabled" : ""}`}>
      <span><strong>{title}</strong><small>{description}</small></span>
      <input name={name} type="checkbox" defaultChecked={defaultChecked} disabled={disabled} />
      <i aria-hidden="true" />
    </label>
  );
}

function Section({ id, number, title, description, children }: {
  id: string;
  number: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section" id={id}>
      <div className="settings-section-heading">
        <span>{number}</span>
        <div><small>ACCOUNT CONFIGURATION</small><h3>{title}</h3><p>{description}</p></div>
      </div>
      {children}
    </section>
  );
}

function isChecked(data: FormData, name: string) {
  return data.get(name) === "on";
}

export function SettingsForm({ initial }: { initial: TenantSettingsInitial }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    const data = new FormData(event.currentTarget);

    const payload = {
      profile: {
        name: data.get("name"),
        legalName: data.get("legalName"),
        email: data.get("email"),
        phone: data.get("phone"),
        currency: data.get("currency"),
        timezone: data.get("timezone"),
        receiptName: data.get("receiptName"),
      },
      taxRatePercent: data.get("taxRatePercent"),
      metadata: {
        business: {
          kraPin: data.get("kraPin"),
          registrationNumber: data.get("registrationNumber"),
          address: data.get("address"),
          town: data.get("town"),
          county: data.get("county"),
          language: data.get("language"),
        },
        pos: {
          allowDiscounts: isChecked(data, "allowDiscounts"),
          maximumDiscountPercent: data.get("maximumDiscountPercent"),
          allowPriceOverrides: isChecked(data, "allowPriceOverrides"),
          allowCreditSales: isChecked(data, "allowCreditSales"),
          requireCustomerForCredit: isChecked(data, "requireCustomerForCredit"),
          confirmBeforePayment: isChecked(data, "confirmBeforePayment"),
          autoPrintReceipt: isChecked(data, "autoPrintReceipt"),
        },
        payments: {
          enabledMethods: data.getAll("enabledMethods"),
          requireReferenceForNonCash: isChecked(data, "requireReferenceForNonCash"),
          allowSplitPayments: isChecked(data, "allowSplitPayments"),
          mpesaType: data.get("mpesaType"),
          mpesaNumber: data.get("mpesaNumber"),
          mpesaAccountInstructions: data.get("mpesaAccountInstructions"),
        },
        taxReceipt: {
          taxEnabled: isChecked(data, "taxEnabled"),
          pricesIncludeTax: isChecked(data, "pricesIncludeTax"),
          showTaxBreakdown: isChecked(data, "showTaxBreakdown"),
          receiptHeader: data.get("receiptHeader"),
          receiptFooter: data.get("receiptFooter"),
          paperSize: data.get("paperSize"),
          showBranch: isChecked(data, "showBranch"),
          showCashier: isChecked(data, "showCashier"),
          showPaymentMethod: isChecked(data, "showPaymentMethod"),
        },
        inventory: {
          defaultReorderLevel: data.get("defaultReorderLevel"),
          requireAdjustmentReason: isChecked(data, "requireAdjustmentReason"),
          allowNegativeStock: isChecked(data, "allowNegativeStock"),
          lowStockAlerts: isChecked(data, "lowStockAlerts"),
          autoDeductStock: true,
        },
        securityNotifications: {
          sessionTimeoutMinutes: data.get("sessionTimeoutMinutes"),
          failedLoginLimit: data.get("failedLoginLimit"),
          forcePasswordChange: isChecked(data, "forcePasswordChange"),
          notifyLowStock: isChecked(data, "notifyLowStock"),
          notifyVoids: isChecked(data, "notifyVoids"),
          notifyRefunds: isChecked(data, "notifyRefunds"),
          notifyStockAdjustments: isChecked(data, "notifyStockAdjustments"),
          notifyShiftClose: isChecked(data, "notifyShiftClose"),
          dailySalesSummary: isChecked(data, "dailySalesSummary"),
          channels: data.getAll("channels"),
        },
      },
    };

    try {
      const response = await authenticatedFetch("/api/v1/app/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body?.error?.message ?? "The settings could not be saved.");
        return;
      }
      setSuccess("Settings saved. The updated rules now apply to this POS account only.");
      router.refresh();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("The settings server could not be reached. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const { profile, metadata } = initial;

  return (
    <form className="tenant-settings-form" onSubmit={submit}>
      <aside className="settings-index">
        <strong>Settings menu</strong>
        <a href="#business">Business profile</a>
        <a href="#pos-rules">POS &amp; sales</a>
        <a href="#payments">Payments</a>
        <a href="#tax-receipts">Tax &amp; receipts</a>
        <a href="#inventory-rules">Inventory rules</a>
        <a href="#security-notifications">Security &amp; alerts</a>
        <small>All changes are isolated to this business account.</small>
      </aside>

      <div className="settings-content">
        {(error || success) && <div className={error ? "settings-message error" : "settings-message success"} role={error ? "alert" : "status"}>{error || success}</div>}

        <Section id="business" number="01" title="Business profile" description="Identity and contact details used across the dashboard, reports and receipts.">
          <div className="settings-grid">
            <label>Business name<input name="name" defaultValue={profile.name} minLength={2} maxLength={160} required /></label>
            <label>Legal business name<input name="legalName" defaultValue={profile.legalName} maxLength={200} /></label>
            <label>Business email<input name="email" type="email" defaultValue={profile.email} required /></label>
            <label>Business phone<input name="phone" defaultValue={profile.phone} required /></label>
            <label>KRA PIN<input name="kraPin" defaultValue={metadata.business.kraPin} placeholder="e.g. A001234567X" /></label>
            <label>Registration number<input name="registrationNumber" defaultValue={metadata.business.registrationNumber} /></label>
            <label className="settings-span-2">Physical address<input name="address" defaultValue={metadata.business.address} placeholder="Building, street or area" /></label>
            <label>Town<input name="town" defaultValue={metadata.business.town} /></label>
            <label>County<input name="county" defaultValue={metadata.business.county} /></label>
            <label>Currency<input name="currency" defaultValue={profile.currency} minLength={3} maxLength={3} required /></label>
            <label>Timezone<input name="timezone" defaultValue={profile.timezone} required /></label>
            <label>Language<select name="language" defaultValue={metadata.business.language}><option>English</option><option>Swahili</option></select></label>
            <label>Receipt business name<input name="receiptName" defaultValue={profile.receiptName} required /></label>
          </div>
        </Section>

        <Section id="pos-rules" number="02" title="POS and sales rules" description="Define what cashiers can do during checkout and when approval is required.">
          <div className="settings-toggle-grid">
            <Toggle name="allowDiscounts" title="Allow discounts" description="Cashiers may apply item discounts within the configured limit." defaultChecked={metadata.pos.allowDiscounts} />
            <Toggle name="allowPriceOverrides" title="Allow price overrides" description="Users still need the sale.override_price permission." defaultChecked={metadata.pos.allowPriceOverrides} />
            <Toggle name="allowCreditSales" title="Allow credit sales" description="Show Credit as an available payment method." defaultChecked={metadata.pos.allowCreditSales} />
            <Toggle name="requireCustomerForCredit" title="Customer required for credit" description="Credit transactions must be linked to a customer." defaultChecked={metadata.pos.requireCustomerForCredit} />
            <Toggle name="confirmBeforePayment" title="Confirm before payment" description="Show a final confirmation before recording the transaction." defaultChecked={metadata.pos.confirmBeforePayment} />
            <Toggle name="autoPrintReceipt" title="Auto-print receipt" description="Prepare the receipt automatically after a successful sale." defaultChecked={metadata.pos.autoPrintReceipt} />
          </div>
          <div className="settings-grid compact">
            <label>Maximum discount (%)<input name="maximumDiscountPercent" type="number" min="0" max="100" step="0.01" defaultValue={metadata.pos.maximumDiscountPercent} /></label>
            <label>Shift control<input value="An open shift is required" readOnly disabled /><small>This safety rule remains mandatory in version one.</small></label>
          </div>
        </Section>

        <Section id="payments" number="03" title="Payment methods" description="Choose the payment choices visible at checkout and configure M-Pesa collection details.">
          <div className="settings-choice-grid">
            {PAYMENT_METHODS.map((method) => (
              <label key={method} className="settings-choice"><input type="checkbox" name="enabledMethods" value={method} defaultChecked={metadata.payments.enabledMethods.includes(method)} /><span><strong>{method}</strong><small>{method === "Credit" ? "Requires credit sales to be enabled" : "Available at checkout"}</small></span></label>
            ))}
          </div>
          <div className="settings-toggle-grid">
            <Toggle name="requireReferenceForNonCash" title="Require payment reference" description="M-Pesa, card and bank payments need a transaction reference." defaultChecked={metadata.payments.requireReferenceForNonCash} />
            <Toggle name="allowSplitPayments" title="Allow split payments" description="Reserve support for combining two payment methods in one sale." defaultChecked={metadata.payments.allowSplitPayments} />
          </div>
          <div className="settings-grid">
            <label>M-Pesa collection type<select name="mpesaType" defaultValue={metadata.payments.mpesaType}><option>Till</option><option>Paybill</option></select></label>
            <label>Till / Paybill number<input name="mpesaNumber" defaultValue={metadata.payments.mpesaNumber} /></label>
            <label className="settings-span-2">Account instructions<input name="mpesaAccountInstructions" defaultValue={metadata.payments.mpesaAccountInstructions} placeholder="e.g. Use the sale number as account reference" /></label>
          </div>
        </Section>

        <Section id="tax-receipts" number="04" title="Tax and receipts" description="Set the default tax treatment and control the information printed on receipts.">
          <div className="settings-toggle-grid">
            <Toggle name="taxEnabled" title="Enable tax calculations" description="Apply product tax rates during checkout." defaultChecked={metadata.taxReceipt.taxEnabled} />
            <Toggle name="pricesIncludeTax" title="Prices include tax" description="Treat displayed selling prices as tax-inclusive." defaultChecked={metadata.taxReceipt.pricesIncludeTax} />
            <Toggle name="showTaxBreakdown" title="Show tax breakdown" description="Display tax separately in checkout totals and receipts." defaultChecked={metadata.taxReceipt.showTaxBreakdown} />
            <Toggle name="showBranch" title="Show branch" description="Print the selling branch on receipts." defaultChecked={metadata.taxReceipt.showBranch} />
            <Toggle name="showCashier" title="Show cashier" description="Print the staff member who completed the sale." defaultChecked={metadata.taxReceipt.showCashier} />
            <Toggle name="showPaymentMethod" title="Show payment method" description="Print how the customer paid." defaultChecked={metadata.taxReceipt.showPaymentMethod} />
          </div>
          <div className="settings-grid">
            <label>Default tax rate (%)<input name="taxRatePercent" type="number" min="0" max="100" step="0.01" defaultValue={initial.taxRatePercent} /></label>
            <label>Receipt paper size<select name="paperSize" defaultValue={metadata.taxReceipt.paperSize}><option value="58mm">58 mm thermal</option><option value="80mm">80 mm thermal</option><option value="A4">A4</option></select></label>
            <label className="settings-span-2">Receipt header<textarea name="receiptHeader" defaultValue={metadata.taxReceipt.receiptHeader} rows={2} /></label>
            <label className="settings-span-2">Receipt footer<textarea name="receiptFooter" defaultValue={metadata.taxReceipt.receiptFooter} rows={3} /></label>
          </div>
        </Section>

        <Section id="inventory-rules" number="05" title="Inventory rules" description="Control stock protection, default low-stock levels and inventory alerts.">
          <div className="settings-toggle-grid">
            <Toggle name="requireAdjustmentReason" title="Require adjustment reason" description="Every manual stock change must explain why it happened." defaultChecked={metadata.inventory.requireAdjustmentReason} />
            <Toggle name="allowNegativeStock" title="Allow negative stock" description="Permit a tracked item to be sold when its branch balance is insufficient." defaultChecked={metadata.inventory.allowNegativeStock} />
            <Toggle name="lowStockAlerts" title="Low-stock alerts" description="Show products at or below their reorder level on the dashboard." defaultChecked={metadata.inventory.lowStockAlerts} />
            <Toggle name="autoDeductStock" title="Automatically deduct stock" description="Completed POS sales always reduce the selling branch inventory." defaultChecked disabled />
          </div>
          <div className="settings-grid compact"><label>Default reorder level<input name="defaultReorderLevel" type="number" min="0" step="0.001" defaultValue={metadata.inventory.defaultReorderLevel} /></label></div>
        </Section>

        <Section id="security-notifications" number="06" title="Security and notifications" description="Set account protection preferences and choose which important events should raise alerts.">
          <div className="settings-grid compact">
            <label>Session timeout (minutes)<input name="sessionTimeoutMinutes" type="number" min="5" max="480" defaultValue={metadata.securityNotifications.sessionTimeoutMinutes} /></label>
            <label>Failed login limit<input name="failedLoginLimit" type="number" min="3" max="20" defaultValue={metadata.securityNotifications.failedLoginLimit} /></label>
          </div>
          <div className="settings-toggle-grid">
            <Toggle name="forcePasswordChange" title="Force first password change" description="New staff must replace their temporary password." defaultChecked={metadata.securityNotifications.forcePasswordChange} />
            <Toggle name="notifyLowStock" title="Low-stock notification" description="Alert administrators when stock reaches reorder level." defaultChecked={metadata.securityNotifications.notifyLowStock} />
            <Toggle name="notifyVoids" title="Voided sale notification" description="Alert administrators when a completed sale is voided." defaultChecked={metadata.securityNotifications.notifyVoids} />
            <Toggle name="notifyRefunds" title="Refund notification" description="Alert administrators whenever a refund is approved." defaultChecked={metadata.securityNotifications.notifyRefunds} />
            <Toggle name="notifyStockAdjustments" title="Stock adjustment notification" description="Alert administrators after manual inventory changes." defaultChecked={metadata.securityNotifications.notifyStockAdjustments} />
            <Toggle name="notifyShiftClose" title="Shift closing notification" description="Alert administrators when a cashier closes a shift." defaultChecked={metadata.securityNotifications.notifyShiftClose} />
            <Toggle name="dailySalesSummary" title="Daily sales summary" description="Prepare a daily summary for enabled notification channels." defaultChecked={metadata.securityNotifications.dailySalesSummary} />
          </div>
          <div className="settings-choice-grid channels">
            {["dashboard", "email", "whatsapp"].map((channel) => <label className="settings-choice" key={channel}><input type="checkbox" name="channels" value={channel} defaultChecked={metadata.securityNotifications.channels.includes(channel as "dashboard" | "email" | "whatsapp")} /><span><strong>{channel[0].toUpperCase() + channel.slice(1)}</strong><small>Notification delivery channel</small></span></label>)}
          </div>
        </Section>

        <div className="settings-save-bar">
          <div><strong>Save business settings</strong><span>Changes affect this tenant only and are recorded in the audit log.</span></div>
          <button className="primary" type="submit" disabled={loading}>{loading ? "Saving settings…" : "Save all changes"}</button>
        </div>
      </div>
    </form>
  );
}
