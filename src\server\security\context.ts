import { forbidden } from "@/lib/errors";

export type Permission =
  | "tenant.view" | "tenant.update" | "branch.view" | "branch.create" | "branch.update"
  | "staff.view" | "staff.create" | "staff.update" | "staff.assign_role"
  | "customer.view" | "customer.create" | "customer.update" | "customer.archive"
  | "product.view" | "product.create" | "product.update"
  | "inventory.view" | "inventory.adjust" | "inventory.transfer"
  | "sale.create" | "sale.view" | "sale.discount" | "sale.override_price" | "sale.void" | "sale.refund"
  | "shift.open" | "shift.close" | "shift.review" | "payment.receive"
  | "purchase.create" | "purchase.approve" | "expense.manage"
  | "report.view" | "report.financial" | "accounting.manage"
  | "settings.manage" | "audit.view" | "manager.approve";

export type TenantContext = Readonly<{
  kind: "tenant";
  userId: string;
  tenantId: string;
  branchIds: readonly string[];
  permissions: ReadonlySet<Permission>;
  requestId: string;
}>;

export type OperatorContext = Readonly<{
  kind: "operator";
  userId: string;
  requestId: string;
}>;

export function requirePermission(ctx: TenantContext, permission: Permission): void {
  if (!ctx.permissions.has(permission)) throw forbidden();
}

export function requireBranch(ctx: TenantContext, branchId: string): void {
  if (!ctx.branchIds.includes(branchId)) throw forbidden();
}

export function tenantWhere(ctx: TenantContext) {
  return { tenantId: ctx.tenantId } as const;
}

export function tenantBranchWhere(ctx: TenantContext) {
  return { tenantId: ctx.tenantId, branchId: { in: [...ctx.branchIds] } } as const;
}
