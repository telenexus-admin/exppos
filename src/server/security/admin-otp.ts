import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

export const ADMIN_OTP_TTL_MS = 10 * 60_000;
export const ADMIN_OTP_MAX_ATTEMPTS = 5;
export const ADMIN_OTP_MAX_SENDS = 5;
export const ADMIN_OTP_RESEND_COOLDOWN_MS = 60_000;

export type AdminOtpChallenge = {
  id: string;
  userId: string;
  tenantId: string;
  identifierHash: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attemptCount: number;
  sendCount: number;
  lastSentAt: Date;
  ipAddress: string | null;
  deviceInfo: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function authSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new AppError("AUTH_NOT_CONFIGURED", "Login is temporarily unavailable. Contact support.", 503);
  return secret;
}

export function adminOtpEnabled() {
  return process.env.ADMIN_OTP_ENABLED?.trim().toLowerCase() === "true";
}

export function isDeliverableAdminEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && !normalized.endsWith(".dashboard.local");
}

export function maskEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return "your email address";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, Math.min(8, local.length - visible.length + 2)))}@${domain}`;
}

export function generateAdminOtpCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashAdminOtpCode(challengeId: string, code: string) {
  return createHmac("sha256", authSecret()).update(`admin-login-otp:${challengeId}:${code}`).digest("hex");
}

export function adminOtpCodeMatches(challengeId: string, code: string, storedHash: string) {
  const expected = Buffer.from(hashAdminOtpCode(challengeId, code), "hex");
  const actual = Buffer.from(storedHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function createAdminOtpChallenge(input: {
  userId: string;
  tenantId: string;
  identifierHash: string;
  ipAddress?: string;
  deviceInfo?: string | null;
}) {
  const id = randomUUID();
  const code = generateAdminOtpCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ADMIN_OTP_TTL_MS);
  const codeHash = hashAdminOtpCode(id, code);

  await db.$transaction([
    db.$executeRaw(Prisma.sql`
      UPDATE "AdminLoginOtpChallenge"
      SET "consumedAt" = ${now}, "updatedAt" = ${now}
      WHERE "userId" = ${input.userId}
        AND "consumedAt" IS NULL
    `),
    db.$executeRaw(Prisma.sql`
      INSERT INTO "AdminLoginOtpChallenge" (
        "id", "userId", "tenantId", "identifierHash", "codeHash", "expiresAt",
        "attemptCount", "sendCount", "lastSentAt", "ipAddress", "deviceInfo", "createdAt", "updatedAt"
      ) VALUES (
        ${id}, ${input.userId}, ${input.tenantId}, ${input.identifierHash}, ${codeHash}, ${expiresAt},
        0, 1, ${now}, ${input.ipAddress ?? null}, ${input.deviceInfo ?? null}, ${now}, ${now}
      )
    `),
  ]);

  return { id, code, expiresAt };
}

export async function getAdminOtpChallenge(id: string) {
  const rows = await db.$queryRaw<AdminOtpChallenge[]>(Prisma.sql`
    SELECT * FROM "AdminLoginOtpChallenge" WHERE "id" = ${id} LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function recordAdminOtpFailure(id: string) {
  const now = new Date();
  const rows = await db.$queryRaw<Array<{ attemptCount: number; consumedAt: Date | null }>>(Prisma.sql`
    UPDATE "AdminLoginOtpChallenge"
    SET
      "attemptCount" = "attemptCount" + 1,
      "consumedAt" = CASE
        WHEN "attemptCount" + 1 >= ${ADMIN_OTP_MAX_ATTEMPTS} THEN ${now}
        ELSE "consumedAt"
      END,
      "updatedAt" = ${now}
    WHERE "id" = ${id}
      AND "consumedAt" IS NULL
      AND "expiresAt" > ${now}
    RETURNING "attemptCount", "consumedAt"
  `);
  return rows[0] ?? null;
}

export async function consumeAdminOtpChallenge(id: string, codeHash: string) {
  const now = new Date();
  return db.$executeRaw(Prisma.sql`
    UPDATE "AdminLoginOtpChallenge"
    SET "consumedAt" = ${now}, "updatedAt" = ${now}
    WHERE "id" = ${id}
      AND "codeHash" = ${codeHash}
      AND "consumedAt" IS NULL
      AND "expiresAt" > ${now}
      AND "attemptCount" < ${ADMIN_OTP_MAX_ATTEMPTS}
  `);
}

export async function prepareAdminOtpResend(id: string) {
  const challenge = await getAdminOtpChallenge(id);
  const now = new Date();
  if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) {
    throw new AppError("OTP_EXPIRED", "This verification request has expired. Sign in again to get a new code.", 410);
  }
  if (challenge.sendCount >= ADMIN_OTP_MAX_SENDS) {
    throw new AppError("OTP_RESEND_LIMIT", "Too many codes were requested. Sign in again to start a new verification.", 429);
  }
  const waitMs = ADMIN_OTP_RESEND_COOLDOWN_MS - (now.getTime() - challenge.lastSentAt.getTime());
  if (waitMs > 0) {
    throw new AppError("OTP_RESEND_COOLDOWN", `Wait ${Math.ceil(waitMs / 1000)} seconds before requesting another code.`, 429);
  }

  const code = generateAdminOtpCode();
  const codeHash = hashAdminOtpCode(id, code);
  const updated = await db.$queryRaw<AdminOtpChallenge[]>(Prisma.sql`
    UPDATE "AdminLoginOtpChallenge"
    SET
      "codeHash" = ${codeHash},
      "sendCount" = "sendCount" + 1,
      "lastSentAt" = ${now},
      "updatedAt" = ${now}
    WHERE "id" = ${id}
      AND "consumedAt" IS NULL
      AND "expiresAt" > ${now}
      AND "sendCount" = ${challenge.sendCount}
      AND "lastSentAt" = ${challenge.lastSentAt}
    RETURNING *
  `);

  if (!updated[0]) throw new AppError("OTP_RESEND_CONFLICT", "Another code was just requested. Check your email or try again shortly.", 409);
  return {
    challenge: updated[0],
    code,
    newCodeHash: codeHash,
    previous: {
      codeHash: challenge.codeHash,
      sendCount: challenge.sendCount,
      lastSentAt: challenge.lastSentAt,
    },
  };
}

export async function rollbackAdminOtpResend(
  id: string,
  newCodeHash: string,
  previous: { codeHash: string; sendCount: number; lastSentAt: Date },
) {
  const now = new Date();
  try {
    await db.$executeRaw(Prisma.sql`
      UPDATE "AdminLoginOtpChallenge"
      SET
        "codeHash" = ${previous.codeHash},
        "sendCount" = ${previous.sendCount},
        "lastSentAt" = ${previous.lastSentAt},
        "updatedAt" = ${now}
      WHERE "id" = ${id}
        AND "codeHash" = ${newCodeHash}
        AND "consumedAt" IS NULL
    `);
  } catch (error) {
    console.error("OTP resend rollback failed", { challengeId: id, error });
  }
}
