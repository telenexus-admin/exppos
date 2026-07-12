"use client";

export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = () => fetch(input, { ...init, credentials: "same-origin" });
  let response = await request();

  if (response.status !== 401) return response;

  const refreshResponse = await fetch("/api/v1/auth/refresh", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
  });

  if (!refreshResponse.ok) {
    window.location.assign("/login?reason=session-expired");
    return response;
  }

  response = await request();
  if (response.status === 401) window.location.assign("/login?reason=session-expired");
  return response;
}
