"use client";

import { usePathname } from "next/navigation";
import { TenantProfileMenu } from "@/components/tenant-profile-menu";

export function TenantAccountMount() {
  const pathname = usePathname();
  const isWorkspace = (pathname.startsWith("/app/") && pathname !== "/app/login") || (pathname.startsWith("/staff/") && pathname !== "/staff/login");
  if (!isWorkspace || pathname === "/app/pos") return null;

  return (
    <div className="tenant-account-mount">
      <TenantProfileMenu fallbackRole="My account" />
    </div>
  );
}
