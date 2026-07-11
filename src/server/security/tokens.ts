import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { TenantContext } from "./context";

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET);
export async function signAccessToken(ctx: Omit<TenantContext, "permissions"> & { permissions: ReadonlySet<string> }) {
  return new SignJWT({ kind: ctx.kind, tenantId: ctx.tenantId, branchIds: ctx.branchIds, permissions: [...ctx.permissions] })
    .setProtectedHeader({ alg: "HS256" }).setSubject(ctx.userId).setJti(ctx.requestId).setIssuedAt().setExpirationTime("15m").sign(secret());
}
export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
  return payload;
}
export function newRefreshToken() { const raw = randomBytes(48).toString("base64url"); return { raw, hash: hashToken(raw) }; }
export function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
