"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type BranchOption = { id: string; name: string };

export function ShiftStarter({ branches, currency }: { branches: BranchOption[]; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/staff/shifts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branchId: form.get("branchId"), openingCash: form.get("openingCash") }),
    });
    const body = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setError(body?.error?.message ?? "The shift could not be opened.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (branches.length === 0) return <p className="form-error">No active branch is assigned to this account.</p>;

  return (
    <>
      <button className="primary" type="button" onClick={() => setOpen(true)}>Open my shift</button>
      {open && (
        <div className="staff-modal" role="dialog" aria-modal="true" aria-labelledby="shift-title">
          <button className="staff-modal-backdrop" type="button" aria-label="Close shift form" onClick={() => setOpen(false)} />
          <form className="shift-start-card" onSubmit={submit}>
            <div className="staff-form-heading"><div><small>START WORK</small><h3 id="shift-title">Open a POS shift</h3><p>Select your assigned branch and enter the cash currently in your till.</p></div><button className="modal-close" type="button" onClick={() => setOpen(false)}>×</button></div>
            <label>Branch<select name="branchId" required defaultValue={branches[0].id}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            <label>Opening cash ({currency})<input name="openingCash" type="number" min="0" step="0.01" defaultValue="0" required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="staff-form-actions"><button type="button" onClick={() => setOpen(false)}>Cancel</button><button className="primary" type="submit" disabled={loading}>{loading ? "Opening shift..." : "Open shift"}</button></div>
          </form>
        </div>
      )}
    </>
  );
}
