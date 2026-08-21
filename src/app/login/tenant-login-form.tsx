"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";

type LoginResponse = {
  ok?: boolean;
  destination?: string;
  forcePasswordChange?: boolean;
  otpRequired?: boolean;
  challengeId?: string;
  maskedEmail?: string;
  expiresInSeconds?: number;
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

type OtpStep = {
  challengeId: string;
  maskedEmail: string;
  expiresInSeconds: number;
};

function blankOtpDigits() {
  return ["", "", "", "", "", ""];
}

async function readJson(response: Response) {
  const responseText = await response.text();
  if (!responseText) return {} as LoginResponse;
  try {
    return JSON.parse(responseText) as LoginResponse;
  } catch {
    return {} as LoginResponse;
  }
}

export function TenantLoginForm({ switching = false, mode = "admin" }: { switching?: boolean; mode?: "admin" | "staff" }) {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [otpStep, setOtpStep] = useState<OtpStep | null>(null);
  const [otpDigits, setOtpDigits] = useState<string[]>(blankOtpDigits);
  const otpInputs = useRef<Array<HTMLInputElement | null>>([]);
  const otpCode = otpDigits.join("");
  const otpChallengeId = otpStep?.challengeId;

  useEffect(() => {
    setOtpDigits(blankOtpDigits());
    if (!otpChallengeId) return;

    const frame = window.requestAnimationFrame(() => otpInputs.current[0]?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [otpChallengeId]);

  function focusOtp(index: number) {
    window.requestAnimationFrame(() => otpInputs.current[index]?.focus());
  }

  function changeOtpDigit(index: number, rawValue: string) {
    const digits = rawValue.replace(/\D/g, "");

    if (!digits) {
      setOtpDigits((current) => {
        const next = [...current];
        next[index] = "";
        return next;
      });
      return;
    }

    setOtpDigits((current) => {
      const next = [...current];
      digits.slice(0, 6 - index).split("").forEach((digit, offset) => {
        next[index + offset] = digit;
      });
      return next;
    });

    focusOtp(Math.min(index + digits.length, 5));
  }

  function handleOtpKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      event.preventDefault();
      setOtpDigits((current) => {
        const next = [...current];
        if (next[index]) {
          next[index] = "";
          focusOtp(Math.max(0, index - 1));
        } else if (index > 0) {
          next[index - 1] = "";
          focusOtp(index - 1);
        }
        return next;
      });
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusOtp(index - 1);
    }
    if (event.key === "ArrowRight" && index < 5) {
      event.preventDefault();
      focusOtp(index + 1);
    }
  }

  function handleOtpPaste(event: ClipboardEvent<HTMLDivElement>) {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;

    event.preventDefault();
    const next = blankOtpDigits();
    pasted.split("").forEach((digit, index) => {
      next[index] = digit;
    });
    setOtpDigits(next);
    focusOtp(Math.min(pasted.length - 1, 5));
  }

  function openDestination(body: LoginResponse) {
    const fallback = mode === "staff" ? "/staff/dashboard" : "/app/dashboard";
    const destination = typeof body.destination === "string" && body.destination.startsWith("/")
      ? body.destination
      : fallback;
    setStatus(mode === "staff" ? "Login successful. Opening your staff dashboard…" : "Verification successful. Opening your admin dashboard…");
    window.location.assign(destination);
  }

  async function submitCredentials(data: FormData, signal: AbortSignal) {
    const identifier = String(data.get("identifier") ?? "").trim();
    const password = String(data.get("password") ?? "");

    if (identifier.length < 3) {
      setError("Enter your username, email address, or phone number.");
      return false;
    }
    if (!password) {
      setError("Enter your password.");
      return false;
    }

    setStatus("Checking your login credentials…");
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ identifier, password, portal: mode }),
      signal,
    });
    const body = await readJson(response);

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
      return false;
    }

    if (
      mode === "admin" &&
      body.otpRequired === true &&
      typeof body.challengeId === "string" &&
      typeof body.maskedEmail === "string"
    ) {
      setOtpStep({
        challengeId: body.challengeId,
        maskedEmail: body.maskedEmail,
        expiresInSeconds: typeof body.expiresInSeconds === "number" ? body.expiresInSeconds : 600,
      });
      setStatus(`A 6-digit verification code was sent to ${body.maskedEmail}.`);
      return false;
    }

    openDestination(body);
    return true;
  }

  async function submitOtp(code: string, signal: AbortSignal) {
    if (!otpStep) return false;
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the complete 6-digit verification code from your email.");
      focusOtp(otpDigits.findIndex((digit) => !digit) >= 0 ? otpDigits.findIndex((digit) => !digit) : 0);
      return false;
    }

    setStatus("Verifying your code…");
    const response = await fetch("/api/v1/auth/admin-otp/verify", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ challengeId: otpStep.challengeId, code }),
      signal,
    });
    const body = await readJson(response);
    if (!response.ok) {
      setStatus("");
      setError(body.error?.message ?? "The verification code could not be accepted. Try again.");
      if (response.status === 410 || body.error?.code === "OTP_ATTEMPTS_EXCEEDED") {
        setOtpStep(null);
      } else {
        setOtpDigits(blankOtpDigits());
        focusOtp(0);
      }
      return false;
    }

    openDestination(body);
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError("");
    setStatus("");
    setLoading(true);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    let navigating = false;

    try {
      const data = new FormData(event.currentTarget);
      navigating = otpStep
        ? await submitOtp(otpCode, controller.signal)
        : await submitCredentials(data, controller.signal);
    } catch (requestError) {
      setStatus("");
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        setError("The request took too long. Check your connection and try again.");
      } else {
        setError("The login server could not be reached. Check your connection and try again.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (!navigating) setLoading(false);
    }
  }

  async function resendCode() {
    if (!otpStep || resending || loading) return;
    setError("");
    setStatus("");
    setResending(true);
    try {
      const response = await fetch("/api/v1/auth/admin-otp/resend", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ challengeId: otpStep.challengeId }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        setError(body.error?.message ?? "A new verification code could not be sent yet.");
        if (response.status === 410) setOtpStep(null);
        return;
      }
      setOtpStep((current) => current ? {
        ...current,
        maskedEmail: body.maskedEmail ?? current.maskedEmail,
        expiresInSeconds: body.expiresInSeconds ?? current.expiresInSeconds,
      } : current);
      setOtpDigits(blankOtpDigits());
      focusOtp(0);
      setStatus(`A new 6-digit code was sent to ${body.maskedEmail ?? otpStep.maskedEmail}.`);
    } catch {
      setError("The verification email service could not be reached. Try again shortly.");
    } finally {
      setResending(false);
    }
  }

  return (
    <form className="login-card tenant-login-card" onSubmit={submit} noValidate>
      <p className="eyebrow">{otpStep ? "VERIFY SIGN IN" : mode === "staff" ? "STAFF SIGN IN" : "ADMIN SIGN IN"}</p>
      <h2>{otpStep ? "Check Your Email" : "Welcome Back"}</h2>
      <p className="tenant-login-help">
        {otpStep
          ? `Enter the 6-digit code sent to ${otpStep.maskedEmail}. The code expires in about ${Math.ceil(otpStep.expiresInSeconds / 60)} minutes.`
          : "Sign in to continue to your workspace."}
      </p>

      {!otpStep && switching && (
        <p className="tenant-switch-notice" role="status">
          The previous business session was cleared. Sign in with the administrator or staff credentials for the account you want to open.
        </p>
      )}

      {otpStep ? (
        <>
          <div className="tenant-otp-field">
            <span className="tenant-otp-label" id="tenant-otp-label">Verification Code</span>
            <div
              className="tenant-otp-boxes"
              role="group"
              aria-labelledby="tenant-otp-label"
              onPaste={handleOtpPaste}
            >
              {otpDigits.map((digit, index) => (
                <input
                  key={index}
                  ref={(element) => { otpInputs.current[index] = element; }}
                  className="tenant-otp-box"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={digit}
                  autoComplete={index === 0 ? "one-time-code" : "off"}
                  enterKeyHint={index === 5 ? "done" : "next"}
                  aria-label={`Verification code digit ${index + 1} of 6`}
                  disabled={loading || resending}
                  onChange={(event) => changeOtpDigit(index, event.currentTarget.value)}
                  onKeyDown={(event) => handleOtpKeyDown(index, event)}
                  onFocus={(event) => event.currentTarget.select()}
                />
              ))}
            </div>
          </div>
          <div className="tenant-otp-actions">
            <button type="button" onClick={resendCode} disabled={loading || resending}>
              {resending ? "Sending…" : "Resend code"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOtpStep(null);
                setOtpDigits(blankOtpDigits());
                setError("");
                setStatus("");
              }}
              disabled={loading || resending}
            >
              Back to password
            </button>
          </div>
        </>
      ) : (
        <>
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
        </>
      )}

      {error && <p className="form-error login-error" role="alert">{error}</p>}
      {status && <p className="login-status" role="status" aria-live="polite">{status}</p>}

      <button
        className="primary tenant-login-submit"
        type="submit"
        disabled={loading || resending || (Boolean(otpStep) && otpCode.length !== 6)}
      >
        {loading ? (otpStep ? "Verifying…" : "Signing in…") : otpStep ? "Verify & Sign In" : "Sign In"}
      </button>
    </form>
  );
}
