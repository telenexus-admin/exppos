import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify, type JWTPayload } from "jose";
import { dashboardSectionMarker, isDashboardSection, isDashboardSectionMarker } from "@/lib/dashboard-access";
import { publicUrl } from "@/server/public-url";

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET);

async function sessionPayload(token: string | undefined, kind: "operator" | "tenant"): Promise<JWTPayload | null> {
  if (!token || !process.env.AUTH_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.kind === kind ? payload : null;
  } catch {
    return null;
  }
}

function restrictedDashboardRedirect(req: NextRequest, payload: JWTPayload) {
  const permissions = Array.isArray(payload.permissions)
    ? payload.permissions.filter((value): value is string => typeof value === "string")
    : [];
  if (!permissions.some(isDashboardSectionMarker)) return null;

  const pathname = req.nextUrl.pathname;
  if (!(pathname === "/app" || pathname.startsWith("/app/"))) return null;
  const section = pathname === "/app" ? "dashboard" : pathname.split("/")[2];
  if (!section || !isDashboardSection(section)) return null;
  if (permissions.includes(dashboardSectionMarker(section))) return null;

  const destination = publicUrl("/app/dashboard", req);
  destination.searchParams.set("reason", "access-restricted");
  return NextResponse.redirect(destination);
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (pathname.startsWith("/operator/") && pathname !== "/operator/login") {
    const authenticated = await sessionPayload(req.cookies.get("operator_session")?.value, "operator");
    if (!authenticated) {
      const login = publicUrl("/operator/login", req);
      login.searchParams.set("next", pathname);
      return NextResponse.redirect(login);
    }
  }

  const isPublicTenantLogin = pathname === "/login" || pathname === "/staff/login";
  const tenantPage = !isPublicTenantLogin && (pathname === "/app" || pathname.startsWith("/app/") || pathname === "/staff" || pathname.startsWith("/staff/"));
  if (tenantPage) {
    const payload = await sessionPayload(req.cookies.get("tenant_session")?.value, "tenant");
    if (!payload) {
      if (req.cookies.get("tenant_refresh")?.value) {
        const refresh = publicUrl("/api/v1/auth/refresh", req);
        refresh.searchParams.set("next", `${pathname}${req.nextUrl.search}`);
        return NextResponse.redirect(refresh);
      }

      const login = publicUrl("/login", req);
      login.searchParams.set("next", pathname);
      login.searchParams.set("reason", "session-expired");
      return NextResponse.redirect(login);
    }

    const accessRedirect = restrictedDashboardRedirect(req, payload);
    if (accessRedirect) return accessRedirect;
  }

  const headers = new Headers(req.headers);
  headers.set("x-request-id", req.headers.get("x-request-id") ?? crypto.randomUUID());
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
  );
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
