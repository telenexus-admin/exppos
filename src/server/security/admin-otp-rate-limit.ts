import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ADMIN_OTP_RESEND_COOLDOWN_MS } from "@/server/security/admin-otp";

const SEND_WINDOW_MS = 15 * 60_000;
const MAX_SENDS_PER_WINDOW = 10;

export async function assertAdminOtpSendAllowed(userId: string) {
  const now = new Date();
  const latest = await db.$queryRaw<Array<{ lastSentAt: Date }>>(Prisma.sql`
    SELECT "lastSentAt"
    FROM "AdminLoginOtpChallenge"
    WHERE "userId" = ${userId}
    ORDER BY "lastSentAt" DESC
    LIMIT 1
  `);
  const lastSentAt = latest[0]?.lastSentAt;
  if (lastSentAt) {
    const waitMs = ADMIN_OTP_RESEND_COOLDOWN_MS - (now.getTime() - lastSentAt.getTime());
    if (waitMs > 0) {
      throw new AppError("OTP_SEND_COOLDOWN", `Wait ${Math.ceil(waitMs / 1000)} seconds before requesting another verification code.`, 429);
    }
  }

  const totals = await db.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    SELECT COALESCE(SUM("sendCount"), 0)::bigint AS "total"
    FROM "AdminLoginOtpChallenge"
    WHERE "userId" = ${userId}
      AND "createdAt" > ${new Date(now.getTime() - SEND_WINDOW_MS)}
  `);
  if (Number(totals[0]?.total ?? 0n) >= MAX_SENDS_PER_WINDOW) {
    throw new AppError("OTP_SEND_LIMIT", "Too many verification codes were requested. Wait 15 minutes and try again.", 429);
  }
}

export async function invalidateAdminOtpChallenge(id: string) {
  const now = new Date();
  try {
    await db.$executeRaw(Prisma.sql`
      UPDATE "AdminLoginOtpChallenge"
      SET "consumedAt" = ${now}, "updatedAt" = ${now}
      WHERE "id" = ${id} AND "consumedAt" IS NULL
    `);
  } catch (error) {
    console.error("OTP challenge invalidation failed", { challengeId: id, error });
  }
}
