"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export type StaffBranchOption = { id: string; name: string; code: string };

const roleOptions = [
  { code: "CASHIER", name: "Cashier", description: "Process sales, receive payments and manage their shift." },
  { code: "BRANCH_MANAGER", name: "Branch Manager", description: "Supervise branch sales, stock, shifts and reports." },
  { code: "INVENTORY_CLERK", name: "Inventory Clerk", description: "Manage products, stock and purchase receiving." },
];

type Credentials = {
  fullName: string;
  businessCode: string;
  username: string;
  password: string;
  loginUrl: string;
  branch: string;
  role: string;
};

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

export function StaffManager({ branches, businessCode, canCreate }: { branches: StaffBranchOption[]; businessCode: string; canCreate: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const defaultBranch = useMemo(() => branches[0]?.id ?? "", [branches]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/app/staff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: form.get("fullName"),
        username: form.get("username"),
        email: form.get("email"),
        phone: form.get("phone"),
        password: form.get("password"),
        branchId: form.get("branchId"),
        roleCode: form.get("roleCode"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setError(body?.error?.message ?? "The staff account could not be created.");
      return;
    }
    setCredentials({
      fullName: body.staff.fullName,
      businessCode,
      username: body.credentials.username,
      password: String(form.get("password")),
      loginUrl: `${window.location.origin}/login`,
      branch: body.staff.branch,
      role: body.staff.role,
    });
    setOpen(false);
    setPassword("");
    event.currentTarget.reset();
    router.refresh();
  }

  async function copyCredentials() {
    if (!credentials) return;
    await navigator.clipboard.writeText(
      `Speedyhive POS login\nBusiness code: ${credentials.businessCode}\nUsername: ${credentials.username}\nPassword: ${credentials.password}\nLogin: ${credentials.loginUrl}`,
    );
  }

  return (
    <>
      <button className="primary staff-add-button" type="button" disabled={!canCreate || branches.length === 0} onClick={() => { setPassword(generatePassword()); setOpen(true); }}>
        <span>＋</span> Add staff member
      </button>
      {!canCreate && <p className="permission-note">Your account cannot create more staff under the current permissions or plan limit.</p>}
      {branches.length === 0 && <p className="permission-note">Create an active branch before adding staff.</p>}

      {open && (
        <div className="staff-modal" role="dialog" aria-modal="true" aria-labelledby="staff-form-title">
          <button className="staff-modal-backdrop" type="button" aria-label="Close staff form" onClick={() => setOpen(false)} />
          <form className="staff-form-card" onSubmit={submit}>
            <div className="staff-form-heading">
              <div><small>NEW TEAM MEMBER</small><h3 id="staff-form-title">Create staff login</h3><p>Assign a branch and access role. The username and temporary password work on the normal business login page.</p></div>
              <button className="modal-close" type="button" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </div>
            <div className="staff-form-grid">
              <label>Full name<input name="fullName" required minLength={2} placeholder="e.g. Jane Wanjiku" /></label>
              <label>Username<input name="username" required minLength={3} maxLength={30} pattern="[A-Za-z0-9._-]+" placeholder="e.g. JANE01" autoCapitalize="characters" /></label>
              <label>Email address<input name="email" type="email" required placeholder="jane@business.com" /></label>
              <label>Phone number<input name="phone" type="tel" placeholder="07..." /></label>
              <label>Assigned branch<select name="branchId" required defaultValue={defaultBranch}>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name} ({branch.code})</option>)}</select></label>
              <label>Staff role<select name="roleCode" required defaultValue="CASHIER">{roleOptions.map((role) => <option value={role.code} key={role.code}>{role.name}</option>)}</select></label>
              <label className="password-field">Temporary password<div><input name="password" type="text" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" onClick={() => setPassword(generatePassword())}>Generate</button></div></label>
            </div>
            <div className="role-help">{roleOptions.map((role) => <div key={role.code}><strong>{role.name}</strong><span>{role.description}</span></div>)}</div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="staff-form-actions"><button type="button" onClick={() => setOpen(false)}>Cancel</button><button className="primary" type="submit" disabled={loading}>{loading ? "Creating account..." : "Create staff account"}</button></div>
          </form>
        </div>
      )}

      {credentials && (
        <div className="credentials-modal" role="dialog" aria-modal="true" aria-labelledby="credentials-title">
          <button className="staff-modal-backdrop" type="button" aria-label="Close credentials" onClick={() => setCredentials(null)} />
          <article className="credentials-card">
            <span className="credentials-success">✓</span>
            <small>ACCOUNT CREATED</small>
            <h3 id="credentials-title">Login details for {credentials.fullName}</h3>
            <p>Share these credentials securely. The temporary password is displayed here only for handover.</p>
            <dl>
              <div><dt>Business code</dt><dd>{credentials.businessCode}</dd></div>
              <div><dt>Username</dt><dd>{credentials.username}</dd></div>
              <div><dt>Temporary password</dt><dd>{credentials.password}</dd></div>
              <div><dt>Role</dt><dd>{credentials.role}</dd></div>
              <div><dt>Branch</dt><dd>{credentials.branch}</dd></div>
              <div><dt>Login portal</dt><dd>{credentials.loginUrl}</dd></div>
            </dl>
            <div className="staff-form-actions"><button type="button" onClick={() => setCredentials(null)}>Done</button><button className="primary" type="button" onClick={copyCredentials}>Copy login details</button></div>
          </article>
        </div>
      )}
    </>
  );
}
