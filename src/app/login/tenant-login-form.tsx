"use client";

import { useState, type FormEvent } from "react";

type LoginResponse = {
  ok?: boolean;
  destination?: string;
  forcePasswordChange?: boolean;
  user?: {
    id?: string;
    name?: string;
    tenant?: string;
    roles?: string[];
  };
  error?: {
    code?: string;
    message?: string;
  };
};

export function TenantLoginForm({ switching = false }: { switching?: boolean }) {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setError("");
    setStatus("");

    const data = new FormData(event.currentTarget);
    const identifier = String(data.get("identifier") ?? "").trim();
    const password = String(data.get("password") ?? "");

    if (identifier.length < 3) {
      setError("Enter your username, email address, or phone number.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

    setLoading(true);
    setStatus("Checking your login credentials…");

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    let navigating = false;

    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ identifier, password }),
        signal: controller.signal,
      });

      const responseText = await response.text();
      let body: LoginResponse = {};

      if (responseText) {
        try {
          body = JSON.parse(responseText) as LoginResponse;
        } catch {
          body = {};
        }
      }

      if (!response.ok) {
        if (response.status === 401) {
          setError(body.error?.message ?? "Incorrect username, email, phone number, or password.");
        } else if (response.status === 409 && body.error?.code === "AMBIGUOUS_IDENTIFIER") {
          setError(body.error.message ?? "Use a unique email address or phone number for this account.");
        } else if (response.status === 429) {
          setError(body.error?.message ?? "Too many login attempts. Wait a few minutes and try again.");
        } else {
          setError(body.error?.message ?? "The login could not be completed. Please try again.");
        }
        setStatus("");
        return;
      }

      const destination = typeof body.destination === "string" && body.destination.startsWith("/")
        ? body.destination
        : "/staff/dashboard";

      setStatus(
        destination.startsWith("/staff")
          ? "Login successful. Opening your staff dashboard…"
          : "Login successful. Opening your admin dashboard…",
      );
      navigating = true;
      window.location.assign(destination);
    } catch (requestError) {
      setStatus("");
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        setError("The login request took too long. Check your connection and try again.");
      } else {
        setError("The login server could not be reached. Check your connection and try again.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (!navigating) setLoading(false);
    }
  }

  return (
    <form className="login-card tenant-login-card" onSubmit={submit} noValidate>
      <p className="eyebrow">ADMIN &amp; STAFF SIGN IN</p>
      <h2>Welcome back</h2>
      <p className="tenant-login-help">
        Use your username, email address, or phone number together with your password. A business code is no longer required.
      </p>

      {switching && (
        <p className="tenant-switch-notice" role="status">
          The previous business session was cleared. Sign in with the administrator or staff credentials for the account you want to open.
        </p>
      )}

      <label>
        Username, email, or phone
        <input
          name="identifier"
          placeholder="dennis, admin@business.com, or 07…"
          required
          minLength={3}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          disabled={loading}
        />
      </label>

      <label>
        Password
        <span className="tenant-password-field">
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            disabled={loading}
          />
          <button
            type="button"
            className="tenant-password-toggle"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            disabled={loading}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </span>
      </label>

      {error && <p className="form-error login-error" role="alert">{error}</p>}
      {status && <p className="login-status" role="status" aria-live="polite">{status}</p>}

      <button className="primary tenant-login-submit" type="submit" disabled={loading}>
        {loading ? "Signing in…" : "Open my dashboard"}
      </button>

      <small className="tenant-login-note">
        Tenant administrators open the admin dashboard. Cashiers and other staff open the staff dashboard.
      </small>
    </form>
  );
}
