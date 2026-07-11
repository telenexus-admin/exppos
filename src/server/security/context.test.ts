import { describe, expect, it } from "vitest";
import { requireBranch, requirePermission, tenantBranchWhere, type TenantContext } from "./context";

const ctx: TenantContext = {
  kind: "tenant", userId: "u1", tenantId: "tenant-a", branchIds: ["branch-a"],
  permissions: new Set(["customer.view"]), requestId: "r1",
};

describe("tenant security context", () => {
  it("always emits tenant and assigned branch predicates", () => {
    expect(tenantBranchWhere(ctx)).toEqual({ tenantId: "tenant-a", branchId: { in: ["branch-a"] } });
  });
  it("rejects an unassigned branch", () => expect(() => requireBranch(ctx, "branch-b")).toThrow("Access denied"));
  it("rejects a missing permission", () => expect(() => requirePermission(ctx, "customer.update")).toThrow("Access denied"));
});
