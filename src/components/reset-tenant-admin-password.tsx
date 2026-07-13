"use client";

import { useState, type FormEvent } from "react";

type ResetResponse = {
  ok?: boolean;
  login?: {
    adminName: string;
    adminEmail: string;
    adminUsername: string;
  };
  error?: { message?: string };
};

function randomCharacter(source: string) {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return source[value[0] % source.length];
}

function generatePassword() {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const numbers = "23456789";
  const special = "!@#$%*-_?";
  const all = `${lower}${upper}${numbers}${special}`;
  const characters = [
    randomCharacter(lower),
    randomCharacter(upper),
    randomCharacter(numbers),
    randomCharacter(special),
  ];

  while (characters.length < 18) characters.push(randomCharacter(all));

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    const swapIndex = value[0] % (index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }

  return characters.join("");
}

export function ResetTenantAdminPassword({
  tenantId,
  adminName,
}: {
  tenantId: string;
  adminName: string;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ResetResponse["login"] | null>(null);

  function close() {
    if (loading) return;
    setOpen(false);
    setPassword("");
    setConfirmPassword("");
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);

    if (password.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      setError("Use uppercase, lowercase, a number, and a special character.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The two passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`/api/v1/operator/tenants/${tenantId}/reset-admin-password`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ temporaryPassword: password }),
      });
      const body = await response.json().catch(() => ({})) as ResetResponse;

      if (!response.ok) {
        setError(body.error?.message ?? "The administrator password could not be reset.");
        return;
      }

      setResult(body.login ?? null);
      setOpen(false);
      setConfirmPassword("");
    } catch {
      setError("The server could not be reached. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyCredentials() {
    if (!result) return;
    const text = [
      `Login: ${window.location.origin}/login`,
      `Administrator email: ${result.adminEmail}`,
      `Administrator username: ${result.adminUsername}`,
      `Temporary password: ${password}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copy the login credentials", text);
    }
  }

  return (
    <>
      <span className="operator-action-wrap">
        <button type="button" onClick={() => { setError(""); setResult(null); setOpen(true); }}>
          Reset admin password
        </button>
      </span>

      {result && (
        <div className="operator-credential-result" role="status">
          <strong>Administrator password reset</strong>
          <span>{result.adminEmail} · {result.adminUsername}</span>
          <button type="button" onClick={copyCredentials}>Copy credentials</button>
          <button type="button" aria-label="Dismiss" onClick={() => { setResult(null); setPassword(""); }}>×</button>
        </div>
      )}

      {open && (
        <div className="operator-password-modal" role="dialog" aria-modal="true" aria-labelledby="reset-admin-password-title">
          <button className="operator-password-backdrop" type="button" aria-label="Close" onClick={close} />
          <form className="operator-password-card" onSubmit={submit}>
            <div className="operator-password-heading">
              <div>
                <small>TENANT ADMINISTRATOR</small>
                <h3 id="reset-admin-password-title">Reset {adminName}&apos;s password</h3>
                <p>The old password and existing sessions will stop working immediately.</p>
              </div>
              <button type="button" aria-label="Close" onClick={close}>×</button>
            </div>

            <label>
              New temporary password
              <span className="operator-password-input-row">
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  minLength={12}
                  required
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowPassword((value) => !value)}>
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>

            <button
              className="operator-generate-password"
              type="button"
              onClick={() => {
                const generated = generatePassword();
                setPassword(generated);
                setConfirmPassword(generated);
                setShowPassword(true);
              }}
            >
              Generate secure password
            </button>

            <label>
              Confirm temporary password
              <input
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                minLength={12}
                required
                autoComplete="new-password"
              />
            </label>

            <small className="operator-password-rules">At least 12 characters with uppercase, lowercase, number, and special character.</small>
            {error && <p className="operator-password-error" role="alert">{error}</p>}

            <div className="operator-password-actions">
              <button type="button" onClick={close}>Cancel</button>
              <button className="operator-primary" type="submit" disabled={loading}>
                {loading ? "Resetting…" : "Reset password"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
