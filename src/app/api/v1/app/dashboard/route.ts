import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, tenantContext } from "@/server/http";

export async function GET(req: NextRequest) { try { const ctx = await tenantContext(req); const since = new Date(); since.setHours(0,0,0,0); const branchScope = { in: [...ctx.branchIds] }; const [sales, customers, products, lowStock, openShifts] = await Promise.all([
  db.sale.aggregate({ where: { tenantId: ctx.tenantId, branchId: branchScope, createdAt: { gte: since }, status: "COMPLETED" }, _sum: { total: true }, _count: true }),
  db.customer.count({ where: { tenantId: ctx.tenantId, deletedAt: null } }), db.product.count({ where: { tenantId: ctx.tenantId, status: "active" } }),
  db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "BranchInventory" WHERE "tenantId" = ${ctx.tenantId} AND "branchId" = ANY(${ctx.branchIds as string[]}::text[]) AND quantity <= "reorderLevel"`,
  db.shift.count({ where: { tenantId: ctx.tenantId, branchId: branchScope, status: "OPEN" } }),
]); return NextResponse.json({ todaySales: sales._sum.total ?? 0, transactions: sales._count, customers, products, lowStock: Number(lowStock[0]?.count ?? 0), openShifts }); } catch (error) { return apiError(error); } }
