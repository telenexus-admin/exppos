import type { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors";

export async function enforcePlanLimit(tx: Prisma.TransactionClient, tenantId: string, resource: "branches" | "users" | "products") {
  const sub = await tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId }, include: { plan: true } });
  if (!["TRIAL", "ACTIVE", "GRACE_PERIOD"].includes(sub.status)) throw new AppError("SUBSCRIPTION_RESTRICTED", "Subscription is not active", 403);
  const [count, max] = resource === "branches" ? [await tx.branch.count({ where: { tenantId } }), sub.plan.maxBranches]
    : resource === "users" ? [await tx.user.count({ where: { tenantId } }), sub.plan.maxUsers]
    : [await tx.product.count({ where: { tenantId } }), sub.plan.maxProducts];
  if (count >= max) throw new AppError("PLAN_LIMIT_REACHED", `${resource} plan limit reached`, 409);
}
