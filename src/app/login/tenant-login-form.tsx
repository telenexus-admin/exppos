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

export function TenantLoginForm() {
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
    const tenantSlug = String(data.get("tenantSlug") ?? "").trim();
    const identifier = String(data.get("identifier") ?? "").trim();
    const password = String(data.get("password") ?? "");

    if (tenantSlug.length < 2) {
      setError("Enter the business code or business slug supplied by the administrator.");
      return;
    }
    if (identifier.length < 3) {
      setError("Enter the staff username, email address, or phone number.");
      return;
    }
    if (!password) {
      setError("Enter the password supplied by the administrator.");
      return;
    }

    setLoading(true);
    setStatus("Checking your business and login credentials…");

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
        body: JSON.stringify({ tenantSlug, identifier, password }),
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
          setError(body.error?.message ?? "Incorrect business code, username, or password.");
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
        Administrators and staff use this same secure login page. Staff should enter the business code,
        username, and temporary password created in the Staff tab.
      </p>

      <label>
        Business slug or code
        <input
          name="tenantSlug"
          placeholder="your-business or CODE-001"
          required
          minLength={2}
          autoComplete="organization"
          disabled={loading}
        />
      </label>

      <label>
        Staff username, email, or phone
        <input
          name="identifier"
          placeholder="mary.w or you@company.com"
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
        A tenant administrator opens the admin dashboard. Cashiers and other staff open the staff dashboard.
      </small>
    </form>
  );
}
