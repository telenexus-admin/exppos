"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

export function StaffStatusControl({
  staffId,
  staffName,
  status,
  canManage,
  protectedAccount,
}: {
  staffId: string;
  staffName: string;
  status: "ACTIVE" | "SUSPENDED";
  canManage: boolean;
  protectedAccount: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (protectedAccount) return <span className="staff-protected-label">Protected account</span>;
  if (!canManage) return <span className="staff-protected-label">No permission</span>;

  const nextStatus = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  const actionLabel = status === "ACTIVE" ? "Deactivate" : "Reactivate";

  async function updateStatus() {
    setError("");
    if (nextStatus === "SUSPENDED" && !window.confirm(`Deactivate ${staffName}? They will be logged out and unable to sign in until reactivated.`)) return;

    setLoading(true);
    try {
      const response = await authenticatedFetch(`/api/v1/app/staff/${staffId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body?.error?.message ?? "The staff account could not be updated.");
        return;
      }
      router.refresh();
    } catch {
      setError("The server could not be reached. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="staff-action-cell">
      <button
        className={`staff-status-action ${nextStatus === "SUSPENDED" ? "deactivate" : "reactivate"}`}
        type="button"
        disabled={loading}
        onClick={updateStatus}
      >
        {loading ? "Updating…" : actionLabel}
      </button>
      {error && <span className="staff-action-error" role="alert">{error}</span>}
    </div>
  );
}
