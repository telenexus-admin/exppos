"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

type BranchOption = { id: string; name: string; code: string };

type CreatedCredentials = {
  fullName: string;
  businessCode: string;
  username: string;
  password: string;
  branch: string;
  role: string;
  loginUrl: string;
};

function createTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  const randomPart = Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
  return `${randomPart.slice(0, 4)}-${randomPart.slice(4, 8)}-${randomPart.slice(8)}7aA`;
}

export function AddStaffForm({
  branches,
  currentUsers,
  maxUsers,
}: {
  branches: BranchOption[];
  currentUsers: number;
  maxUsers: number;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState(() => createTemporaryPassword());
  const [credentials, setCredentials] = useState<CreatedCredentials | null>(null);
  const limitReached = currentUsers >= maxUsers;

  const usageLabel = useMemo(
    () => `${currentUsers} of ${maxUsers} user account${maxUsers === 1 ? "" : "s"} used`,
    [currentUsers, maxUsers],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCredentials(null);
    setLoading(true);

    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/v1/app/staff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: data.get("fullName"),
        username: data.get("username"),
        email: data.get("email"),
        phone: data.get("phone"),
        password,
        branchId: data.get("branchId"),
        roleCode: data.get("roleCode"),
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body?.error?.message ?? "Unable to create this staff account.");
      setLoading(false);
      return;
    }

    setCredentials({
      fullName: body.staff.fullName,
      businessCode: body.staff.businessCode,
      username: body.staff.username,
      password,
      branch: body.staff.branch,
      role: body.staff.role,
      loginUrl: `${window.location.origin}/login`,
    });

    form.reset();
    setPassword(createTemporaryPassword());
    setLoading(false);
    router.refresh();
  }

  async function copyCredentials() {
    if (!credentials) return;
    const text = [
      `Speedyhive POS login for ${credentials.fullName}`,
      `Login: ${credentials.loginUrl}`,
      `Business code: ${credentials.businessCode}`,
      `Username: ${credentials.username}`,
      `Temporary password: ${credentials.password}`,
      `Role: ${credentials.role}`,
      `Branch: ${credentials.branch}`,
    ].join("\n");
    await navigator.clipboard.writeText(text);
  }

  return (
    <article className="staff-form-panel">
      <div className="staff-form-panel-head">
        <div>
          <small>NEW ACCOUNT</small>
          <h3>Add staff member</h3>
          <p>Create login credentials and allocate one branch.</p>
        </div>
        <span className="staff-count-badge">{usageLabel}</span>
      </div>

      <form className="staff-form" onSubmit={submit}>
        <label>
          Full name
          <input name="fullName" placeholder="e.g. Mary Wanjiku" required minLength={2} autoComplete="off" disabled={limitReached} />
        </label>

        <div className="staff-form-grid">
          <label>
            Login username
            <input name="username" placeholder="e.g. mary.w" required minLength={3} pattern="[A-Za-z0-9._-]+" autoComplete="off" disabled={limitReached} />
          </label>
          <label>
            Phone number
            <input name="phone" placeholder="07..." autoComplete="off" disabled={limitReached} />
          </label>
        </div>

        <label>
          Email address <small>(optional)</small>
          <input name="email" type="email" placeholder="mary@business.com" autoComplete="off" disabled={limitReached} />
        </label>

        <div className="staff-form-grid">
          <label>
            Role
            <select name="roleCode" required defaultValue="CASHIER" disabled={limitReached}>
              <option value="CASHIER">Cashier</option>
              <option value="BRANCH_MANAGER">Branch Manager</option>
              <option value="INVENTORY_CLERK">Inventory Clerk</option>
              <option value="ACCOUNTANT">Accountant</option>
            </select>
          </label>
          <label>
            Assigned branch
            <select name="branchId" required defaultValue="" disabled={limitReached || branches.length === 0}>
              <option value="" disabled>Select branch</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>)}
            </select>
          </label>
        </div>

        <label>
          Temporary password
          <div className="password-field-row">
            <input value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required autoComplete="new-password" disabled={limitReached} />
            <button type="button" onClick={() => setPassword(createTemporaryPassword())} disabled={limitReached}>Generate</button>
          </div>
        </label>
        <p className="staff-form-note">The password must contain at least 12 characters, an uppercase letter, a lowercase letter, and a number.</p>

        {limitReached && <p className="staff-form-error">Your current subscription user limit has been reached.</p>}
        {branches.length === 0 && <p className="staff-form-error">Create an active branch before adding staff.</p>}
        {error && <p className="staff-form-error" role="alert">{error}</p>}

        <button className="primary" type="submit" disabled={loading || limitReached || branches.length === 0}>
          {loading ? "Creating secure account..." : "Create staff account"}
        </button>
      </form>

      {credentials && (
        <div className="staff-credentials" role="status">
          <h4>Credentials created</h4>
          <p>Copy and send these credentials securely. The temporary password is only displayed here.</p>
          <div className="staff-credential-row"><span>Login page</span><code>{credentials.loginUrl}</code></div>
          <div className="staff-credential-row"><span>Business code</span><code>{credentials.businessCode}</code></div>
          <div className="staff-credential-row"><span>Username</span><code>{credentials.username}</code></div>
          <div className="staff-credential-row"><span>Password</span><code>{credentials.password}</code></div>
          <div className="staff-credential-row"><span>Role</span><code>{credentials.role}</code></div>
          <div className="staff-credential-row"><span>Branch</span><code>{credentials.branch}</code></div>
          <button type="button" onClick={copyCredentials}>Copy credentials</button>
        </div>
      )}
    </article>
  );
}
