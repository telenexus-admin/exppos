"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { DASHBOARD_SECTION_OPTIONS, type DashboardSection } from "@/lib/dashboard-access";

type BranchOption = { id: string; name: string; code: string };
type AccountType = "ADMINISTRATOR" | "BRANCH_MANAGER";

type CreatedAccount = {
  fullName: string;
  username: string;
  email: string | null;
  password: string;
  role: string;
  branches: string[];
  sections: DashboardSection[];
};

const managerDefaults = new Set<DashboardSection>(["dashboard", "pos", "inventory", "customers", "sales", "reports"]);

function createTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const values = new Uint32Array(12);
  crypto.getRandomValues(values);
  const random = Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
  return `${random.slice(0, 4)}-${random.slice(4, 8)}-${random.slice(8)}7aA`;
}

export function OperatorAccessAccountForm({
  tenantId,
  tenantName,
  branches,
  currentUsers,
  maxUsers,
}: {
  tenantId: string;
  tenantName: string;
  branches: BranchOption[];
  currentUsers: number;
  maxUsers: number;
}) {
  const router = useRouter();
  const [accountType, setAccountType] = useState<AccountType>("BRANCH_MANAGER");
  const [password, setPassword] = useState(() => createTemporaryPassword());
  const [selectedBranches, setSelectedBranches] = useState<string[]>(() => branches[0]?.id ? [branches[0].id] : []);
  const [selectedSections, setSelectedSections] = useState<DashboardSection[]>(() => DASHBOARD_SECTION_OPTIONS.filter(({ slug }) => managerDefaults.has(slug)).map(({ slug }) => slug));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const limitReached = currentUsers >= maxUsers;

  const usage = useMemo(() => `${currentUsers} of ${maxUsers} user accounts used`, [currentUsers, maxUsers]);

  function toggleBranch(branchId: string) {
    setSelectedBranches((current) => current.includes(branchId) ? current.filter((id) => id !== branchId) : [...current, branchId]);
  }

  function toggleSection(section: DashboardSection) {
    if (section === "dashboard") return;
    setSelectedSections((current) => current.includes(section) ? current.filter((item) => item !== section) : [...current, section]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCreated(null);

    if (accountType === "BRANCH_MANAGER" && selectedBranches.length === 0) {
      setError("Select at least one branch for this manager.");
      return;
    }

    const form = event.currentTarget;
    const data = new FormData(form);
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/operator/tenants/${tenantId}/access-users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountType,
          fullName: data.get("fullName"),
          username: data.get("username"),
          email: data.get("email"),
          phone: data.get("phone"),
          password,
          branchIds: accountType === "BRANCH_MANAGER" ? selectedBranches : [],
          sections: accountType === "BRANCH_MANAGER" ? selectedSections : [],
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body?.error?.message ?? "Unable to create this dashboard account.");
        return;
      }

      setCreated({
        fullName: body.account.fullName,
        username: body.account.username,
        email: body.account.email ?? null,
        password,
        role: body.account.role,
        branches: (body.account.branches ?? []).map((branch: BranchOption) => branch.name),
        sections: body.account.sections ?? [],
      });
      form.reset();
      setPassword(createTemporaryPassword());
      setAccountType("BRANCH_MANAGER");
      setSelectedBranches(branches[0]?.id ? [branches[0].id] : []);
      setSelectedSections(DASHBOARD_SECTION_OPTIONS.filter(({ slug }) => managerDefaults.has(slug)).map(({ slug }) => slug));
      router.refresh();
    } catch {
      setError("The server could not be reached. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyCredentials() {
    if (!created) return;
    const lines = [
      `${tenantName} — SHV POS dashboard login`,
      `Login: ${window.location.origin}/login`,
      `Name: ${created.fullName}`,
      `Username: ${created.username}`,
      ...(created.email ? [`Email: ${created.email}`] : []),
      `Temporary password: ${created.password}`,
      `Role: ${created.role}`,
      `Branches: ${created.branches.join(", ") || "All active branches"}`,
      ...(created.sections.length ? [`Dashboard tabs: ${created.sections.join(", ")}`] : ["Dashboard tabs: Full administrator access"]),
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
  }

  return (
    <div className="operator-access-create">
      <div className="operator-card-head">
        <div><small>ADD DASHBOARD ACCOUNT</small><h2>Administrator or branch manager</h2></div>
        <span className="tenant-status active">{usage}</span>
      </div>
      <p>Create another administrator with full business access, or a branch manager whose branches and dashboard tabs are selected by the operator.</p>

      <form className="onboard-form operator-access-form" onSubmit={submit}>
        <section>
          <div className="form-grid">
            <label>Account type
              <select value={accountType} onChange={(event) => setAccountType(event.target.value as AccountType)} disabled={limitReached}>
                <option value="ADMINISTRATOR">Administrator — full dashboard</option>
                <option value="BRANCH_MANAGER">Branch Manager — selected dashboard tabs</option>
              </select>
            </label>
            <label>Full name<input name="fullName" minLength={2} maxLength={120} required disabled={limitReached} /></label>
            <label>Login username<input name="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" required disabled={limitReached} /></label>
            <label>Email address <small>(optional)</small><input name="email" type="email" disabled={limitReached} /></label>
            <label>Phone number <small>(optional)</small><input name="phone" maxLength={30} disabled={limitReached} /></label>
            <label>Temporary password
              <div className="password-field-row">
                <input value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={128} pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,128}" required disabled={limitReached} />
                <button type="button" onClick={() => setPassword(createTemporaryPassword())} disabled={limitReached}>Generate</button>
              </div>
            </label>
          </div>
        </section>

        {accountType === "ADMINISTRATOR" ? (
          <div className="secure-note">
            <strong>Full administrator</strong>
            <span>This account will use the normal business admin login, see all active branches, and inherit the complete Tenant Administrator permission set.</span>
          </div>
        ) : (
          <>
            <section>
              <div className="form-section-title"><span>1</span><div><h3>Branch access</h3><p>The manager can only operate on the branches selected here.</p></div></div>
              <div className="operator-access-check-grid">
                {branches.map((branch) => (
                  <label className="operator-access-check" key={branch.id}>
                    <input type="checkbox" checked={selectedBranches.includes(branch.id)} onChange={() => toggleBranch(branch.id)} />
                    <span><strong>{branch.name}</strong><small>{branch.code}</small></span>
                  </label>
                ))}
              </div>
            </section>
            <section>
              <div className="form-section-title"><span>2</span><div><h3>Dashboard tabs</h3><p>Only these modules will be shown and accepted for this manager.</p></div></div>
              <div className="operator-access-tab-grid">
                {DASHBOARD_SECTION_OPTIONS.map((option) => (
                  <label className="operator-access-check" key={option.slug}>
                    <input type="checkbox" checked={selectedSections.includes(option.slug)} disabled={option.slug === "dashboard"} onChange={() => toggleSection(option.slug)} />
                    <span><strong>{option.label}</strong><small>{option.description}</small></span>
                  </label>
                ))}
              </div>
            </section>
          </>
        )}

        {limitReached && <div className="operator-error"><strong>User limit reached.</strong><span>Upgrade this client&apos;s subscription before adding another account.</span></div>}
        {branches.length === 0 && <div className="operator-error"><strong>No active branch.</strong><span>Create an active branch before adding a branch manager.</span></div>}
        {error && <div className="operator-error" role="alert"><strong>Account was not created.</strong><span>{error}</span></div>}
        <button type="submit" className="operator-primary" disabled={loading || limitReached || (accountType === "BRANCH_MANAGER" && branches.length === 0)}>
          {loading ? "Creating account..." : "Create dashboard account"}
        </button>
      </form>

      {created && (
        <div className="operator-login-instructions operator-created-credentials" role="status">
          <strong>Credentials created — copy them now</strong>
          <span>Username: <code>{created.username}</code></span>
          {created.email && <span>Email: <code>{created.email}</code></span>}
          <span>Temporary password: <code>{created.password}</code></span>
          <span>Role: {created.role}</span>
          <span>Branches: {created.branches.join(", ") || "All active branches"}</span>
          <button type="button" className="manage-link" onClick={copyCredentials}>Copy credentials</button>
          <small>The temporary password is intentionally not stored in readable form and will not be shown again after this page state is lost.</small>
        </div>
      )}
    </div>
  );
}
