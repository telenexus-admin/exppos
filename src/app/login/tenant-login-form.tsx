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

export function TenantLoginForm({ switching = false, mode = "admin" }: { switching?: boolean; mode?: "admin" | "staff" }) {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [forgotNotice, setForgotNotice] = useState(false);

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
        body: JSON.stringify({ identifier, password, portal: mode }),
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

      setStatus(mode === "staff" ? "Login successful. Opening your staff dashboard…" : "Login successful. Opening your admin dashboard…");
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
      <p className="eyebrow">{mode === "staff" ? "STAFF SIGN IN" : "ADMIN SIGN IN"}</p>
      <h2>Welcome Back</h2>
      <p className="tenant-login-help">
        Sign in to continue to your workspace.
      </p>

      {switching && (
        <p className="tenant-switch-notice" role="status">
          The previous business session was cleared. Sign in with the administrator or staff credentials for the account you want to open.
        </p>
      )}

      <label>
        Email Address or Username
        <input
          name="identifier"
          placeholder="Enter your email or username"
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
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
              <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
              <circle cx="12" cy="12" r="2.5" />
              {!showPassword && <path d="m3 3 18 18" />}
            </svg>
            <span className="sr-only">{showPassword ? "Hide password" : "Show password"}</span>
          </button>
        </span>
      </label>

      <button className="tenant-login-forgot" type="button" onClick={() => setForgotNotice(true)}>Forgot Password?</button>

      {forgotNotice && (
        <div className="tenant-recovery-notice" role="alert">
          <span>Password recovery not available at the moment contact our support team on 0724657480 for further assistance</span>
          <button type="button" aria-label="Close password recovery notice" onClick={() => setForgotNotice(false)}>×</button>
        </div>
      )}

      {error && <p className="form-error login-error" role="alert">{error}</p>}
      {status && <p className="login-status" role="status" aria-live="polite">{status}</p>}

      <button className="primary tenant-login-submit" type="submit" disabled={loading}>
        {loading ? "Signing in…" : "Sign In"}
      </button>

      {mode === "admin" && (
        <div className="tenant-login-switch" role="navigation" aria-label="Login type">
          <span>Staff member? <a href="/staff/login">Staff login</a></span>
        </div>
      )}
    </form>
  );
}
