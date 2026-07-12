"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteTenantButton({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function removeTenant() {
    if (!confirm(`Remove ${tenantName} from the POS client list? This is recoverable.`)) return;
    setBusy(true);
    const response = await fetch(`/api/v1/operator/tenants/${tenantId}/deactivate`, { method: "POST" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      alert(payload.error ?? "Unable to remove this POS client.");
      setBusy(false);
      return;
    }
    router.push("/operator/tenants?removed=1");
    router.refresh();
  }

  return <button type="button" className="operator-danger" onClick={removeTenant} disabled={busy}>{busy ? "Removing…" : "Delete POS client"}</button>;
}
