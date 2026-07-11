import type { Prisma } from "@prisma/client";

export async function nextNumber(tx: Prisma.TransactionClient, tenantId: string, key: string, prefix: string) {
  await tx.numberSequence.upsert({ where: { tenantId_key: { tenantId, key } }, create: { tenantId, key, prefix }, update: {} });
  const rows = await tx.$queryRaw<Array<{ nextValue: bigint; prefix: string }>>`
    UPDATE "NumberSequence" SET "nextValue" = "nextValue" + 1, "updatedAt" = NOW()
    WHERE "tenantId" = ${tenantId} AND "key" = ${key}
    RETURNING "nextValue" - 1 AS "nextValue", "prefix"`;
  const value = rows[0];
  if (!value) throw new Error("Number sequence unavailable");
  return `${value.prefix}-${new Date().getUTCFullYear()}-${value.nextValue.toString().padStart(6, "0")}`;
}
