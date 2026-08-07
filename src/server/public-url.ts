type RequestLike = { headers: Headers; url?: string };

function usableOrigin(value?: string | null) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.hostname === "0.0.0.0" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" ? null : parsed.origin;
  } catch { return null; }
}

export function publicUrl(path: string, req?: RequestLike) {
  const configured = usableOrigin(process.env.APP_URL);
  if (configured) return new URL(path, configured);
  if (req) {
    const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host")?.trim();
    const protocol = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ? "https" : "http";
    const forwarded = usableOrigin(host ? `${protocol}://${host}` : null);
    if (forwarded) return new URL(path, forwarded);
    const requestOrigin = usableOrigin(req.url);
    if (requestOrigin) return new URL(path, requestOrigin);
  }
  return new URL(path, "http://192.241.151.24");
}
