import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { TenantContext } from "./context";

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET);
export async function signAccessToken(
  ctx: Omit<TenantContext, "permissions"> & { permissions: ReadonlySet<string> },
  expiresMinutes = 15,
) {
  const duration = Math.min(480, Math.max(5, Math.round(expiresMinutes)));
  return new SignJWT({ kind: ctx.kind, tenantId: ctx.tenantId, branchIds: ctx.branchIds, permissions: [...ctx.permissions] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(ctx.userId)
    .setJti(ctx.requestId)
    .setIssuedAt()
    .setExpirationTime(`${duration}m`)
    .sign(secret());
}
export async function signOperatorToken(userId: string) {
  return new SignJWT({ kind: "operator" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("8h").sign(secret());
}
export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
  return payload;
}
export function newRefreshToken() { const raw = randomBytes(48).toString("base64url"); return { raw, hash: hashToken(raw) }; }
export function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
