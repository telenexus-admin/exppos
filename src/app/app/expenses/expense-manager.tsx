"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

const categories = ["Rent & premises", "Utilities", "Stock transport", "Salaries & wages", "Marketing", "Repairs & maintenance", "Office supplies", "Licences & fees", "Meals & travel", "Other"];

export function ExpenseManager({ branches }: { branches: { id: string; name: string; code: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(""); setSuccess("");
    const form = event.currentTarget; const data = new FormData(form);
    try {
      const response = await authenticatedFetch("/api/v1/app/expenses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(data)) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body?.error?.message ?? "The expense could not be saved."); return; }
      setOpen(false); form.reset(); setSuccess("Expense recorded successfully."); router.refresh();
    } catch { setError("The server could not be reached. Try again."); }
    finally { setLoading(false); }
  }

  return <>
    <div className="expense-action"><button className="primary" type="button" disabled={branches.length === 0} onClick={() => { setError(""); setOpen(true); }}>+ Record expense</button><small>Every record is assigned to a branch</small></div>
    {success && <div className="expense-toast" role="status">{success}<button type="button" onClick={() => setSuccess("")}>×</button></div>}
    {open && <div className="expense-modal" role="dialog" aria-modal="true" aria-labelledby="expense-title"><button className="expense-backdrop" type="button" aria-label="Close" onClick={() => !loading && setOpen(false)} /><form className="expense-form" onSubmit={submit}>
      <div className="expense-form-head"><div><small>BUSINESS SPENDING</small><h3 id="expense-title">Record an expense</h3><p>Capture where the money was spent and which branch incurred it.</p></div><button type="button" onClick={() => setOpen(false)}>×</button></div>
      <div className="expense-form-grid">
        <label>Branch<select name="branchId" required defaultValue=""><option value="" disabled>Select branch</option>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name} ({branch.code})</option>)}</select></label>
        <label>Category<select name="category" required defaultValue=""><option value="" disabled>Select category</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label className="expense-span-2">Description<input name="description" required minLength={3} maxLength={220} placeholder="What was purchased or paid for?" /></label>
        <label>Amount<input name="amount" required type="number" min="0.01" step="0.01" placeholder="0.00" /></label>
        <label>Expense date<input name="expenseDate" required type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label>Payment method<select name="paymentMethod" defaultValue="Cash"><option>Cash</option><option>Mobile Money</option><option>Card</option><option>Bank Transfer</option><option>Credit</option></select></label>
        <label>Status<select name="status" defaultValue="PAID"><option value="PAID">Paid</option><option value="PENDING">Pending payment</option></select></label>
        <label>Vendor / payee<input name="vendor" maxLength={160} placeholder="Supplier or recipient" /></label>
        <label>Receipt / reference<input name="reference" maxLength={120} placeholder="Receipt, M-PESA or invoice no." /></label>
        <label className="expense-span-2">Notes<textarea name="notes" maxLength={500} rows={3} placeholder="Optional context for review" /></label>
      </div>
      {error && <p className="expense-error" role="alert">{error}</p>}
      <div className="expense-form-actions"><button type="button" onClick={() => setOpen(false)}>Cancel</button><button className="primary" disabled={loading} type="submit">{loading ? "Saving…" : "Save expense"}</button></div>
    </form></div>}
  </>;
}

export function ExpenseStatusButton({ id, status }: { id: string; status: string }) {
  const router = useRouter(); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  async function change(nextStatus: "PAID" | "VOIDED") {
    if (nextStatus === "VOIDED" && !window.confirm("Void this expense? It will remain visible for audit purposes.")) return;
    setLoading(true); setError("");
    const response = await authenticatedFetch(`/api/v1/app/expenses/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: nextStatus }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body?.error?.message ?? "Update failed."); else router.refresh();
    setLoading(false);
  }
  return <div className="expense-row-actions">{status === "PENDING" && <button type="button" disabled={loading} onClick={() => change("PAID")}>Mark paid</button>}{status !== "VOIDED" && <button className="expense-void" type="button" disabled={loading} onClick={() => change("VOIDED")}>Void</button>}{error && <small>{error}</small>}</div>;
}
