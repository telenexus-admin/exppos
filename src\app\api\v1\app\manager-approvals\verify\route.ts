import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, tenantContext } from "@/server/http";
import { issueManagerApproval } from "@/server/services/approvals";
const schema=z.object({branchId:z.string(),managerId:z.string(),pin:z.string().min(4).max(12),action:z.string().min(3),entityId:z.string().optional()});
export async function POST(req:NextRequest){try{const ctx=await tenantContext(req);return NextResponse.json(await issueManagerApproval(db,ctx,schema.parse(await req.json())))}catch(error){return apiError(error)}}
