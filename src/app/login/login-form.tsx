"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type LoginError = { error?: { message?: string } };
type LoginSuccess = {
  accessToken: string;
  refreshToken: string;
  forcePasswordChange: boolean;
};

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const payload = {
      tenantSlug: String(form.get("tenantSlug") ?? "").trim().toLowerCase(),
      identifier: String(form.get("identifier") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    };

    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as LoginSuccess & LoginError;

      if (!response.ok) {
        setError(data.error?.message ?? "Unable to sign in. Check your details and try again.");
        return;
      }

      sessionStorage.setItem("speedyhive_access_token", data.accessToken);
      localStorage.setItem("speedyhive_refresh_token", data.refreshToken);
      router.push("/app/dashboard");
      router.refresh();
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <p className="eyebrow">BUSINESS SIGN IN</p>
      <h2>Welcome back</h2>
      <label>Business code<input name="tenantSlug" placeholder="your-business" autoComplete="organization" required /></label>
      <label>Email or phone<input name="identifier" placeholder="you@company.com" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p role="alert" className="login-error">{error}</p>}
      <button className="primary" type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in securely"}</button>
      <a href="#">Forgot password?</a>
      <small>Protected by rate limiting and secure session controls.</small>
    </form>
  );
}
