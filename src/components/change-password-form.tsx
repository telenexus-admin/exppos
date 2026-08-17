"use client";

import { useState, type FormEvent } from "react";

type ChangePasswordResponse = {
  ok?: boolean;
  message?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

export function ChangePasswordForm({ loginPath }: { loginPath: "/login" | "/staff/login" }) {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmPassword = String(data.get("confirmPassword") ?? "");

    setError("");
    setStatus("");

    if (!currentPassword) {
      setError("Enter your current password.");
      return;
    }
    if (newPassword.length < 12 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError("New password must be at least 12 characters and contain uppercase, lowercase and a number.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The new password and confirmation do not match.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });

      const body = (await response.json().catch(() => ({}))) as ChangePasswordResponse;
      if (!response.ok) {
        setError(body.error?.message ?? "Your password could not be changed. Try again.");
        return;
      }

      form.reset();
      setStatus(body.message ?? "Password changed successfully. Sign in again with your new password.");
      window.setTimeout(() => {
        window.location.assign(`${loginPath}?reason=password-changed`);
      }, 1200);
    } catch {
      setError("The password service could not be reached. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="settings-section" id="password-security">
      <div className="settings-section-heading">
        <span>PW</span>
        <div>
          <small>ACCOUNT SECURITY</small>
          <h3>Change your password</h3>
          <p>Update the password for your own account. You will be signed out after the change.</p>
        </div>
      </div>

      <form onSubmit={submit} noValidate>
        <div className="settings-grid">
          <label className="settings-span-2">
            Current password
            <input
              name="currentPassword"
              type={showPasswords ? "text" : "password"}
              autoComplete="current-password"
              required
              disabled={loading}
            />
          </label>
          <label>
            New password
            <input
              name="newPassword"
              type={showPasswords ? "text" : "password"}
              autoComplete="new-password"
              minLength={12}
              required
              disabled={loading}
            />
            <small>At least 12 characters with uppercase, lowercase and a number.</small>
          </label>
          <label>
            Confirm new password
            <input
              name="confirmPassword"
              type={showPasswords ? "text" : "password"}
              autoComplete="new-password"
              minLength={12}
              required
              disabled={loading}
            />
          </label>
        </div>

        <label className="settings-choice" style={{ marginTop: 16, maxWidth: 340 }}>
          <input
            type="checkbox"
            checked={showPasswords}
            onChange={(event) => setShowPasswords(event.target.checked)}
            disabled={loading}
          />
          <span>
            <strong>Show passwords</strong>
            <small>Display the password fields while you type.</small>
          </span>
        </label>

        {error && <p className="settings-message error" role="alert" style={{ position: "static", marginTop: 16 }}>{error}</p>}
        {status && <p className="settings-message success" role="status" style={{ position: "static", marginTop: 16 }}>{status}</p>}

        <div className="settings-save-bar" style={{ position: "static", marginTop: 18 }}>
          <div>
            <strong>Secure your account</strong>
            <span>Changing your password signs out your active sessions.</span>
          </div>
          <button className="primary" type="submit" disabled={loading}>
            {loading ? "Changing password…" : "Change password"}
          </button>
        </div>
      </form>
    </section>
  );
}
