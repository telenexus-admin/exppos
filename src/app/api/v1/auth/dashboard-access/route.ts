import { NextResponse, type NextRequest } from "next/server";
import { dashboardSectionsFromPermissions } from "@/lib/dashboard-access";
import { apiError, tenantContext } from "@/server/http";

export async function GET(req: NextRequest) {
  try {
    const ctx = await tenantContext(req);
    const sections = dashboardSectionsFromPermissions(ctx.permissions);
    return NextResponse.json({
      restricted: sections.length > 0,
      sections,
    }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    return apiError(error);
  }
}
