"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

function suggestedCode(name: string) {
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const compact = words.length > 1
    ? words.map((word) => word[0]).join("")
    : (words[0] ?? "BRANCH").replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return compact || "BRANCH";
}

export function BranchManager({
  canCreate,
  branchCount,
  maxBranches,
  defaultTimezone,
}: {
  canCreate: boolean;
  branchCount: number;
  maxBranches: number;
  defaultTimezone: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const limitReached = branchCount >= maxBranches;

  function close() {
    if (loading) return;
    setOpen(false);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const response = await authenticatedFetch("/api/v1/app/branches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          code: data.get("code"),
          email: data.get("email"),
          phone: data.get("phone"),
          address: data.get("address"),
          town: data.get("town"),
          county: data.get("county"),
          timezone: data.get("timezone"),
          isHeadOffice: data.get("isHeadOffice") === "on",
        }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body?.error?.message ?? "The branch could not be created.");
        return;
      }

      setSuccess(`${body.branch.name} (${body.branch.code}) was created successfully.`);
      form.reset();
      setName("");
      setCode("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("The server could not be reached. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="branch-action-group">
        <button
          className="primary branch-add-button"
          type="button"
          disabled={!canCreate || limitReached}
          onClick={() => {
            setError("");
            setSuccess("");
            setOpen(true);
          }}
        >
          <span aria-hidden="true">＋</span> Add branch
        </button>
        <small>{branchCount} of {maxBranches} branches used</small>
      </div>

      {!canCreate && <p className="branch-inline-warning">Your account does not have permission to create branches.</p>}
      {limitReached && <p className="branch-inline-warning">Your subscription branch limit has been reached.</p>}
      {success && <div className="branch-success" role="status"><strong>Branch created</strong><span>{success}</span><button type="button" onClick={() => setSuccess("")}>×</button></div>}

      {open && (
        <div className="branch-modal" role="dialog" aria-modal="true" aria-labelledby="branch-form-title">
          <button className="branch-modal-backdrop" type="button" aria-label="Close branch form" onClick={close} />
          <form className="branch-form-card" onSubmit={submit}>
            <div className="branch-form-heading">
              <div>
                <small>NEW BUSINESS LOCATION</small>
                <h3 id="branch-form-title">Add a branch</h3>
                <p>Create the location staff, stock, shifts, and sales will be assigned to.</p>
              </div>
              <button type="button" onClick={close} aria-label="Close">×</button>
            </div>

            <div className="branch-form-grid">
              <label className="branch-span-2">Branch name<input name="name" required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Westlands Branch" /></label>
              <label>Branch code<div className="branch-code-row"><input name="code" required minLength={2} maxLength={30} pattern="[A-Za-z0-9_-]+" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="WESTLANDS" /><button type="button" onClick={() => setCode(suggestedCode(name))}>Generate</button></div></label>
              <label>Phone <small>(optional)</small><input name="phone" type="tel" maxLength={30} placeholder="07xx xxx xxx" /></label>
              <label>Email <small>(optional)</small><input name="email" type="email" maxLength={160} placeholder="branch@business.com" /></label>
              <label>Town / city<input name="town" maxLength={100} placeholder="Nairobi" /></label>
              <label>County<input name="county" maxLength={100} placeholder="Nairobi" /></label>
              <label className="branch-span-2">Physical address<textarea name="address" maxLength={200} rows={3} placeholder="Building, street, floor, landmark" /></label>
              <label>Timezone<select name="timezone" defaultValue={defaultTimezone}><option value="Africa/Nairobi">Africa/Nairobi</option><option value={defaultTimezone}>{defaultTimezone}</option></select></label>
              <label className="branch-head-office-toggle"><input name="isHeadOffice" type="checkbox" /><span><strong>Make this the head office</strong><small>The previous head office will become a normal branch.</small></span></label>
            </div>

            {error && <p className="branch-form-error" role="alert">{error}</p>}

            <div className="branch-form-actions">
              <button type="button" onClick={close}>Cancel</button>
              <button className="primary" type="submit" disabled={loading}>{loading ? "Creating branch…" : "Create branch"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
