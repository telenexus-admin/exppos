"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isDashboardSection } from "@/lib/dashboard-access";
import { TenantProfileMenu } from "@/components/tenant-profile-menu";

function restrictDashboardNavigation(sections: string[]) {
  const allowed = new Set(sections);
  const links = document.querySelectorAll<HTMLAnchorElement>(
    ".portal-sidebar nav a[href], .portal-mobile-nav a[href]",
  );

  for (const link of links) {
    const href = link.getAttribute("href");
    if (!href?.startsWith("/app")) continue;
    const url = new URL(href, window.location.origin);
    const section = url.pathname === "/app" ? "dashboard" : url.pathname.split("/")[2];
    if (!section || !isDashboardSection(section) || allowed.has(section)) continue;

    const parent = link.parentElement;
    if (
      link.closest(".portal-sidebar") &&
      parent?.tagName === "DIV" &&
      !parent.classList.contains("portal-sales-subnav")
    ) {
      parent.hidden = true;
    } else {
      link.hidden = true;
    }
  }
}

export function TenantAccountMount() {
  const pathname = usePathname();
  const isAppWorkspace = pathname.startsWith("/app/") && pathname !== "/app/login";
  const isWorkspace = isAppWorkspace || (pathname.startsWith("/staff/") && pathname !== "/staff/login");

  useEffect(() => {
    if (!isAppWorkspace) return;
    let cancelled = false;

    fetch("/api/v1/auth/dashboard-access", { cache: "no-store", credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((access) => {
        if (cancelled || !access?.restricted || !Array.isArray(access.sections)) return;
        restrictDashboardNavigation(access.sections);
      })
      .catch(() => undefined);

    return () => { cancelled = true; };
  }, [isAppWorkspace, pathname]);

  if (!isWorkspace || pathname === "/app/pos") return null;

  return (
    <div className="tenant-account-mount">
      <TenantProfileMenu fallbackRole="My account" />
    </div>
  );
}
