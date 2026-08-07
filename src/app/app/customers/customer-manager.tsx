"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

export function CustomerManager({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError(""); setSuccess("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await authenticatedFetch("/api/v1/app/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: data.get("fullName"), companyName: data.get("companyName"), phone: data.get("phone"), email: data.get("email"), creditLimit: data.get("creditLimit") }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body?.error?.message ?? "The customer could not be created."); return; }
      setSuccess(`${body.customer.fullName} was added and is now available at checkout.`);
      form.reset(); setOpen(false); router.refresh();
    } catch { setError("The server could not be reached. Check the connection and try again."); }
    finally { setLoading(false); }
  }

  return <>
    <button className="primary customer-add-button" type="button" disabled={!canCreate} onClick={() => { setError(""); setOpen(true); }}>＋ Add customer</button>
    {success && <div className="customer-success" role="status"><strong>Customer created</strong><span>{success}</span><button type="button" onClick={() => setSuccess("")}>×</button></div>}
    {open && <div className="customer-modal" role="dialog" aria-modal="true" aria-labelledby="customer-form-title">
      <button className="customer-modal-backdrop" type="button" aria-label="Close" onClick={() => !loading && setOpen(false)} />
      <form className="customer-form-card" onSubmit={submit}>
        <div className="customer-form-heading"><div><small>NEW CUSTOMER</small><h3 id="customer-form-title">Add a customer</h3><p>This customer will immediately become available for Customer — Pay Later sales.</p></div><button type="button" onClick={() => setOpen(false)}>×</button></div>
        <div className="customer-form-grid">
          <label>Customer name<input name="fullName" required minLength={2} placeholder="e.g. Jane Wanjiku" /></label>
          <label>Company <small>(optional)</small><input name="companyName" placeholder="Business or organisation" /></label>
          <label>Phone number<input name="phone" type="tel" placeholder="07xx xxx xxx" /></label>
          <label>Email <small>(optional)</small><input name="email" type="email" placeholder="customer@example.com" /></label>
          <label className="customer-span-2">Credit limit <small>(0 means no fixed limit)</small><input name="creditLimit" type="number" min="0" step="0.01" defaultValue="0" required /></label>
        </div>
        {error && <p className="customer-form-error" role="alert">{error}</p>}
        <div className="customer-form-actions"><button type="button" onClick={() => setOpen(false)}>Cancel</button><button className="primary" type="submit" disabled={loading}>{loading ? "Adding customer…" : "Add customer"}</button></div>
      </form>
    </div>}
  </>;
}

export function CustomerEditButton({ customer, canEdit }: {
  customer: { id: string; fullName: string; companyName: string | null; phone: string | null; email: string | null; creditLimit: number };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await authenticatedFetch("/api/v1/app/customers", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: customer.id, fullName: data.get("fullName"), companyName: data.get("companyName"), phone: data.get("phone"), email: data.get("email"), creditLimit: data.get("creditLimit") }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body?.error?.message ?? "The customer could not be updated."); return; }
      setOpen(false); router.refresh();
    } catch { setError("The server could not be reached. Check the connection and try again."); }
    finally { setLoading(false); }
  }

  if (!canEdit) return null;
  return <>
    <button className="customer-edit-button" type="button" onClick={() => { setError(""); setOpen(true); }}>Edit client</button>
    {open && <div className="customer-modal" role="dialog" aria-modal="true" aria-labelledby={`customer-edit-${customer.id}`}>
      <button className="customer-modal-backdrop" type="button" aria-label="Close" onClick={() => !loading && setOpen(false)} />
      <form className="customer-form-card" onSubmit={submit}>
        <div className="customer-form-heading"><div><small>CLIENT PROFILE</small><h3 id={`customer-edit-${customer.id}`}>Edit client</h3><p>Update contact information and the customer credit limit.</p></div><button type="button" onClick={() => setOpen(false)}>×</button></div>
        <div className="customer-form-grid">
          <label>Customer name<input name="fullName" required minLength={2} defaultValue={customer.fullName} /></label>
          <label>Company <small>(optional)</small><input name="companyName" defaultValue={customer.companyName ?? ""} /></label>
          <label>Phone number<input name="phone" type="tel" defaultValue={customer.phone ?? ""} /></label>
          <label>Email <small>(optional)</small><input name="email" type="email" defaultValue={customer.email ?? ""} /></label>
          <label className="customer-span-2">Credit limit <small>(0 means no fixed limit)</small><input name="creditLimit" type="number" min="0" step="0.01" defaultValue={customer.creditLimit} required /></label>
        </div>
        {error && <p className="customer-form-error" role="alert">{error}</p>}
        <div className="customer-form-actions"><button type="button" onClick={() => setOpen(false)}>Cancel</button><button className="primary" type="submit" disabled={loading}>{loading ? "Saving…" : "Save changes"}</button></div>
      </form>
    </div>}
  </>;
}
