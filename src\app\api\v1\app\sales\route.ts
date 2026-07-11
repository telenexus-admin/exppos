import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, tenantContext } from "@/server/http";
import { completeSale } from "@/server/services/pos";

const schema = z.object({ branchId: z.string(), shiftId: z.string(), customerId: z.string().optional(), idempotencyKey: z.string().min(8).max(100), items: z.array(z.object({ productId: z.string(), quantity: z.string(), unitPrice: z.string().optional(), discount: z.string().optional() })).min(1), payments: z.array(z.object({ method: z.enum(["Cash", "Mobile Money", "Card", "Bank", "Credit"]), amount: z.string(), externalReference: z.string().optional() })).min(1) });
export async function POST(req: NextRequest) { try { const ctx = await tenantContext(req); return NextResponse.json(await completeSale(db, ctx, schema.parse(await req.json())), { status: 201 }); } catch (error) { return apiError(error); } }
export async function GET(req: NextRequest) { try { const ctx = await tenantContext(req); const rows = await db.sale.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: [...ctx.branchIds] } }, orderBy: { createdAt: "desc" }, take: 100, include: { items: true, payments: true } }); return NextResponse.json({ data: rows }); } catch (error) { return apiError(error); } }
