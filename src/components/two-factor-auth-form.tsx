"use client";

import { useState, type FormEvent } from "react";

type TwoFactorResponse = {
  ok?: boolean;
  enabled?: boolean;
  message?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

export function TwoFactorAuthForm({
  initialEnabled,
  email,
  available,
}: {
  initialEnabled: boolean;
  email: string;
  available: boolean;
}) {
  const [currentEnabled, setCurrentEnabled] = useState(initialEnabled);
  const [desiredEnabled, setDesiredEnabled] = useState(initialEnabled);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const emailEligible = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    && !email.trim().toLowerCase().endsWith(".dashboard.local");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || desiredEnabled === currentEnabled) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");

    setError("");
    setStatus("");

    if (!currentPassword) {
      setError("Enter your current password to change your 2FA preference.");
      return;
    }
    if (desiredEnabled && !available) {
      setError("Email OTP is not available on this server right now.");
      return;
    }
    if (desiredEnabled && !emailEligible) {
      setError("Set a real Business Profile email before email OTP 2FA can be enabled.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/v1/auth/two-factor", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ enabled: desiredEnabled, currentPassword }),
      });

      const body = (await response.json().catch(() => ({}))) as TwoFactorResponse;
      if (!response.ok) {
        setError(body.error?.message ?? "Your two-factor authentication preference could not be changed.");
        return;
      }

      const enabled = typeof body.enabled === "boolean" ? body.enabled : desiredEnabled;
      setCurrentEnabled(enabled);
      setDesiredEnabled(enabled);
      form.reset();
      setStatus(body.message ?? (enabled
        ? "Two-factor authentication is enabled."
        : "Two-factor authentication is disabled."));
    } catch {
      setError("The security service could not be reached. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const changing = desiredEnabled !== currentEnabled;

  return (
    <section className="settings-section" id="two-factor-security">
      <div className="settings-section-heading">
        <span>2FA</span>
        <div>
          <small>ACCOUNT SECURITY</small>
          <h3>Two-factor authentication</h3>
          <p>Add an email verification code after your password when signing in to the admin dashboard.</p>
        </div>
      </div>

      <form onSubmit={submit} noValidate>
        <label className="settings-choice" style={{ maxWidth: 620 }}>
          <input
            type="checkbox"
            checked={desiredEnabled}
            onChange={(event) => {
              setDesiredEnabled(event.target.checked);
              setError("");
              setStatus("");
            }}
            disabled={loading || (!available && !currentEnabled)}
          />
          <span>
            <strong>Password + email OTP</strong>
            <small>
              {desiredEnabled
                ? "After your password is accepted, a 6-digit code will be sent to the current Business Profile email before the dashboard opens."
                : "Your admin account will sign in using the password only."}
            </small>
          </span>
        </label>

        <div className="settings-grid" style={{ marginTop: 16 }}>
          <label>
            Verification email
            <input value={email} readOnly disabled />
            <small>This always follows the Business email saved under Business Profile.</small>
          </label>
          <label>
            Current password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required={changing}
              disabled={loading || !changing}
              placeholder={changing ? "Confirm your password" : "Change the option above first"}
            />
            <small>Your password is required before 2FA can be enabled or disabled.</small>
          </label>
        </div>

        {!available && !currentEnabled && (
          <p className="settings-message error" role="status" style={{ position: "static", marginTop: 16 }}>
            Email OTP is currently unavailable on this server. Contact the platform operator before enabling 2FA.
          </p>
        )}
        {!emailEligible && desiredEnabled && (
          <p className="settings-message error" role="alert" style={{ position: "static", marginTop: 16 }}>
            Replace the Business Profile email with a real deliverable address before enabling 2FA.
          </p>
        )}
        {error && <p className="settings-message error" role="alert" style={{ position: "static", marginTop: 16 }}>{error}</p>}
        {status && <p className="settings-message success" role="status" style={{ position: "static", marginTop: 16 }}>{status}</p>}

        <div className="settings-save-bar" style={{ position: "static", marginTop: 18 }}>
          <div>
            <strong>{currentEnabled ? "2FA is enabled" : "2FA is disabled"}</strong>
            <span>
              {currentEnabled
                ? "Your next admin login requires both your password and an OTP sent to the current Business Profile email."
                : "Enable it whenever you want an additional verification step on login."}
            </span>
          </div>
          <button
            className="primary"
            type="submit"
            disabled={loading || !changing || (desiredEnabled && (!available || !emailEligible))}
          >
            {loading
              ? "Saving…"
              : desiredEnabled
                ? "Enable 2FA"
                : "Disable 2FA"}
          </button>
        </div>
      </form>
    </section>
  );
}
