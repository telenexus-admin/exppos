CREATE TABLE "AdminLoginOtpChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "identifierHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "deviceInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminLoginOtpChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminLoginOtpChallenge_userId_expiresAt_idx"
    ON "AdminLoginOtpChallenge"("userId", "expiresAt");

CREATE INDEX "AdminLoginOtpChallenge_tenantId_expiresAt_idx"
    ON "AdminLoginOtpChallenge"("tenantId", "expiresAt");

ALTER TABLE "AdminLoginOtpChallenge"
    ADD CONSTRAINT "AdminLoginOtpChallenge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdminLoginOtpChallenge"
    ADD CONSTRAINT "AdminLoginOtpChallenge_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
