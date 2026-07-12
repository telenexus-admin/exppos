import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { db } from "@/lib/db";
import { requireCurrentTenant } from "@/server/auth/current-tenant";
import { requirePermission } from "@/server/security/context";
import { normalizeTenantSettings } from "@/server/settings/tenant-settings";
import { SettingsForm, type TenantSettingsInitial } from "./settings-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SettingsPage() {
  const session = await requireCurrentTenant();
  requirePermission(session, "settings.manage");

  const [viewer, tenant] = await Promise.all([
    db.user.findFirst({
      where: { id: session.userId, tenantId: session.tenantId, status: "ACTIVE" },
      include: {
        roles: {
          where: { role: { tenantId: session.tenantId } },
          include: { role: true },
        },
      },
    }),
    db.tenant.findUnique({
      where: { id: session.tenantId },
      include: { settings: true },
    }),
  ]);

  if (!viewer || !tenant) redirect("/login");

  const metadata = normalizeTenantSettings(tenant.settings?.metadata);
  const initial: TenantSettingsInitial = {
    profile: {
      name: tenant.name,
      legalName: tenant.legalName ?? "",
      email: tenant.email,
      phone: tenant.phone,
      currency: tenant.currency,
      timezone: tenant.timezone,
      receiptName: tenant.settings?.receiptName ?? tenant.name,
    },
    taxRatePercent: Number(tenant.settings?.taxRate ?? 0) * 100,
    metadata,
  };
  const roleLabel = viewer.roles.map(({ role }) => role.name).join(", ") || "Tenant administrator";

  return (
    <PortalShell title="Settings" role={roleLabel} current="settings" branchName={tenant.name}>
      <div className="settings-hero">
        <div>
          <small>TENANT CONFIGURATION</small>
          <h3>Control how {tenant.name} operates</h3>
          <p>Business details, checkout rules, payments, tax, inventory protection and notifications are managed here.</p>
        </div>
        <span>{tenant.code}</span>
      </div>
      <div className="settings-scope-notice">
        <strong>Private account settings</strong>
        <span>Changes on this page apply only to {tenant.name}. They do not affect any other POS client.</span>
      </div>
      <SettingsForm initial={initial} />
    </PortalShell>
  );
}
