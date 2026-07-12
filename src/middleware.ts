import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/operator/") && req.nextUrl.pathname !== "/operator/login") {
    const token = req.cookies.get("operator_session")?.value;
    try {
      if (!token || !process.env.AUTH_SECRET) throw new Error("missing session");
      const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET), { algorithms: ["HS256"] });
      if (payload.kind !== "operator") throw new Error("wrong session type");
    } catch {
      const login = new URL("/operator/login", req.url);
      login.searchParams.set("next", req.nextUrl.pathname);
      return NextResponse.redirect(login);
    }
  }
  const headers = new Headers(req.headers); headers.set("x-request-id", req.headers.get("x-request-id") ?? crypto.randomUUID());
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("X-Content-Type-Options", "nosniff"); response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
