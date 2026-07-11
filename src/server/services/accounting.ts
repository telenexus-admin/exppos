import { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors";

export type JournalLine = { accountCode: string; debit: string; credit: string };
export function assertBalanced(lines: JournalLine[]) {
  const debit = lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0));
  const credit = lines.reduce((sum, line) => sum.plus(line.credit), new Prisma.Decimal(0));
  if (debit.lte(0) || !debit.equals(credit)) throw new AppError("UNBALANCED_JOURNAL", "Journal entry debits and credits must balance", 422);
}
