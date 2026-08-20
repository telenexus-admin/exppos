import { AppError } from "@/lib/errors";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function resendConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  const fromName = process.env.RESEND_FROM_NAME?.trim() || "Speedyhive Cloud POS";
  if (!apiKey || !fromEmail) {
    throw new AppError(
      "OTP_EMAIL_NOT_CONFIGURED",
      "Administrator email verification is not configured yet. Contact the platform operator.",
      503,
    );
  }
  return { apiKey, fromEmail, fromName };
}

export async function sendAdminLoginOtpEmail(input: {
  to: string;
  code: string;
  fullName: string;
  tenantName: string;
  expiresMinutes?: number;
}) {
  const { apiKey, fromEmail, fromName } = resendConfig();
  const expiresMinutes = input.expiresMinutes ?? 10;
  const safeName = escapeHtml(input.fullName);
  const safeTenant = escapeHtml(input.tenantName);
  const safeCode = escapeHtml(input.code);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [input.to],
      subject: `${input.code} is your Speedyhive admin verification code`,
      text: `Hello ${input.fullName},\n\nYour verification code for ${input.tenantName} is ${input.code}. It expires in ${expiresMinutes} minutes.\n\nIf you did not try to sign in, you can ignore this email. Never share this code with anyone.`,
      html: `<!doctype html><html><body style="margin:0;background:#f3f7f5;font-family:Arial,sans-serif;color:#15362b"><div style="max-width:520px;margin:32px auto;padding:28px;background:#ffffff;border:1px solid #dce8e2;border-radius:16px"><div style="font-size:12px;font-weight:700;letter-spacing:.12em;color:#23815e">SPEEDYHIVE CLOUD POS</div><h1 style="font-size:22px;margin:16px 0 8px">Verify your administrator sign in</h1><p style="line-height:1.6;color:#5d7068">Hello ${safeName}, use this code to finish signing in to <strong>${safeTenant}</strong>.</p><div style="margin:24px 0;padding:18px;border-radius:12px;background:#ecf8f2;text-align:center;font-size:34px;font-weight:800;letter-spacing:.22em;color:#123d2d">${safeCode}</div><p style="line-height:1.6;color:#5d7068">This code expires in ${expiresMinutes} minutes. If you did not try to sign in, you can ignore this email.</p><p style="margin-top:24px;font-size:12px;color:#819087">Never share this verification code with anyone.</p></div></body></html>`,
    }),
    signal: AbortSignal.timeout(12_000),
  }).catch((error) => {
    console.error("Resend OTP request failed", { error });
    throw new AppError("OTP_EMAIL_UNAVAILABLE", "The verification email could not be sent. Try again shortly.", 503);
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.error("Resend OTP delivery failed", { status: response.status, details: details.slice(0, 500) });
    throw new AppError("OTP_EMAIL_UNAVAILABLE", "The verification email could not be sent. Try again shortly.", 503);
  }
}
