import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET);

async function validSession(token: string | undefined, kind: "operator" | "tenant") {
  if (!token || !process.env.AUTH_SECRET) return false;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.kind === kind;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (pathname.startsWith("/operator/") && pathname !== "/operator/login") {
    const authenticated = await validSession(req.cookies.get("operator_session")?.value, "operator");
    if (!authenticated) {
      const login = new URL("/operator/login", req.url);
      login.searchParams.set("next", pathname);
      return NextResponse.redirect(login);
    }
  }

  const tenantPage = pathname === "/app" || pathname.startsWith("/app/") || pathname === "/staff" || pathname.startsWith("/staff/");
  if (tenantPage) {
    const authenticated = await validSession(req.cookies.get("tenant_session")?.value, "tenant");
    if (!authenticated) {
      if (req.cookies.get("tenant_refresh")?.value) {
        const refresh = new URL("/api/v1/auth/refresh", req.url);
        refresh.searchParams.set("next", `${pathname}${req.nextUrl.search}`);
        return NextResponse.redirect(refresh);
      }

      const login = new URL("/login", req.url);
      login.searchParams.set("next", pathname);
      login.searchParams.set("reason", "session-expired");
      return NextResponse.redirect(login);
    }
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
