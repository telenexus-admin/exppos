import { NextResponse, type NextRequest } from "next/server";
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers); headers.set("x-request-id", req.headers.get("x-request-id") ?? crypto.randomUUID());
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("X-Content-Type-Options", "nosniff"); response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
